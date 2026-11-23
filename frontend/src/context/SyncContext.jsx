import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { syncManager } from '../services/syncManager';
import {
  enqueueMutation,
  updateMutation,
  saveInspection,
  getAllMutations,
  getOutboxStats,
  generateUuid,
} from '../db/indexedDb';
import { api } from '../api/client';

const SyncContext = createContext(null);

export function SyncProvider({ children }) {
  const [syncState, setSyncState] = useState({
    isOnline: syncManager.getEffectiveOnlineStatus(),
    isSimulatedOffline: syncManager.isSimulatedOffline,
    isSyncing: false,
    lastSyncTime: null,
    lastError: null,
    outboxStats: { total: 0, pending: 0, syncing: 0, synced: 0, failed: 0, conflicted: 0 },
  });

  const [outboxItems, setOutboxItems] = useState([]);

  const refreshOutbox = useCallback(async () => {
    try {
      const [items, stats] = await Promise.all([
        getAllMutations(),
        getOutboxStats(),
      ]);
      setOutboxItems(items);
      setSyncState((prev) => ({ ...prev, outboxStats: stats }));
    } catch (e) {
      console.warn('[SyncContext] Could not refresh outbox:', e);
    }
  }, []);

  useEffect(() => {
    // Start background sync manager
    syncManager.start();

    // Subscribe to syncManager state updates
    const unsubscribe = syncManager.subscribe((state) => {
      setSyncState((prev) => ({
        ...prev,
        isOnline: state.isOnline,
        isSimulatedOffline: state.isSimulatedOffline,
        isSyncing: state.isSyncing,
        lastSyncTime: state.lastSyncTime,
        lastError: state.lastError,
        outboxStats: state.outboxStats || prev.outboxStats,
      }));
      refreshOutbox();
    });

    refreshOutbox();

    return () => {
      unsubscribe();
      syncManager.stop();
    };
  }, [refreshOutbox]);

  const toggleSimulatedOffline = useCallback(() => {
    const nextVal = !syncManager.isSimulatedOffline;
    syncManager.setSimulatedOffline(nextVal);
  }, []);

  const triggerSync = useCallback(async () => {
    try {
      const res = await syncManager.syncNow({ force: true });
      await refreshOutbox();
      return res;
    } catch (err) {
      await refreshOutbox();
      throw err;
    }
  }, [refreshOutbox]);

  /**
   * Smart save for inspection creation:
   * If online, tries direct API first. If network fails or user is offline,
   * cleanly persists to IndexedDB outbox and stores an optimistic record locally.
   */
  const saveNewInspection = useCallback(async (payload, user) => {
    const isEffectivelyOnline = syncManager.getEffectiveOnlineStatus();

    if (isEffectivelyOnline) {
      try {
        const res = await api.createInspection(payload);
        if (res.inspection) {
          await saveInspection(res.inspection);
        }
        await refreshOutbox();
        return { inspection: res.inspection, isOffline: false };
      } catch (err) {
        // If it's a validation error (400) or unauthorized (401/403), rethrow to let UI show validation messages
        if (err.status && err.status < 500 && err.status !== 408) {
          throw err;
        }
        console.warn('[Sync] API call failed, saving to offline outbox:', err.message);
      }
    }

    // Offline or Network Fallback: Enqueue mutation in IndexedDB Outbox
    const tempId = generateUuid();
    const optimisticRecord = {
      id: tempId,
      equipment_id: payload.equipment_id,
      equipment_code: payload.equipment_code || 'LOCAL',
      equipment_name: payload.equipment_name || 'Equipment',
      inspector_id: user?.id || 'offline-user',
      inspector_name: user?.fullName || 'Technician',
      status: payload.status || 'completed',
      overall_result: payload.overall_result || 'pass',
      readings: payload.readings || {},
      notes: payload.notes || '',
      version: 1,
      has_pending_conflict: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      _isOffline: true,
      _syncStatus: 'pending',
    };

    // 1. Enqueue outbox mutation
    await enqueueMutation({
      action: 'create',
      entityId: tempId,
      equipmentId: payload.equipment_id,
      baseVersion: 1,
      changes: payload,
      clientState: {
        status: payload.status,
        overall_result: payload.overall_result,
        readings: payload.readings,
        notes: payload.notes,
      },
      optimisticRecord,
    });

    // 2. Save optimistic inspection to local cache
    await saveInspection(optimisticRecord);
    await refreshOutbox();

    return { inspection: optimisticRecord, isOffline: true };
  }, [refreshOutbox]);

  /**
   * Smart save for inspection update:
   * If online, tries direct OCC API first. If network fails or user is offline,
   * cleanly persists update mutation to outbox with baseVersion.
   */
  const saveUpdatedInspection = useCallback(async (id, payload, originalInspection, user) => {
    const isEffectivelyOnline = syncManager.getEffectiveOnlineStatus();

    if (isEffectivelyOnline) {
      try {
        const res = await api.updateInspection(id, payload);
        if (res.inspection) {
          await saveInspection(res.inspection);
        }
        await refreshOutbox();
        return { inspection: res.inspection, isOffline: false };
      } catch (err) {
        // If 409 OCC Conflict or validation error, rethrow so UI can handle it immediately
        if (err.status === 409 || (err.status && err.status < 500 && err.status !== 408)) {
          throw err;
        }
        console.warn('[Sync] Update API failed, saving to offline outbox:', err.message);
      }
    }

    // Offline or Network Fallback: Enqueue update mutation
    const optimisticRecord = {
      ...originalInspection,
      status: payload.status !== undefined ? payload.status : originalInspection.status,
      overall_result: payload.overall_result !== undefined ? payload.overall_result : originalInspection.overall_result,
      readings: payload.readings !== undefined ? payload.readings : originalInspection.readings,
      notes: payload.notes !== undefined ? payload.notes : originalInspection.notes,
      updated_at: new Date().toISOString(),
      _isOffline: true,
      _syncStatus: 'pending',
    };

    // If this inspection is an offline-created draft still pending in outbox, update the pending create directly
    const allOutbox = await getAllMutations();
    const pendingCreate = allOutbox.find(
      (m) => m.action === 'create' && (m.entityId === id || m.id === id) && (m.status === 'pending' || m.status === 'failed')
    );

    if (pendingCreate) {
      const mergedClientState = {
        status: optimisticRecord.status,
        overall_result: optimisticRecord.overall_result,
        readings: typeof optimisticRecord.readings === 'string'
          ? JSON.parse(optimisticRecord.readings)
          : (optimisticRecord.readings || {}),
        notes: optimisticRecord.notes || '',
      };

      await updateMutation(pendingCreate.id, {
        changes: {
          ...pendingCreate.changes,
          ...payload,
        },
        clientState: mergedClientState,
        optimisticRecord,
        status: 'pending',
      });

      await saveInspection(optimisticRecord);
      await refreshOutbox();

      return { inspection: optimisticRecord, isOffline: true };
    }

    const baseState = {
      status: originalInspection.status,
      overall_result: originalInspection.overall_result,
      readings: typeof originalInspection.readings === 'string'
        ? JSON.parse(originalInspection.readings)
        : (originalInspection.readings || {}),
      notes: originalInspection.notes || '',
    };

    const clientState = {
      status: optimisticRecord.status,
      overall_result: optimisticRecord.overall_result,
      readings: typeof optimisticRecord.readings === 'string'
        ? JSON.parse(optimisticRecord.readings)
        : (optimisticRecord.readings || {}),
      notes: optimisticRecord.notes || '',
    };

    await enqueueMutation({
      action: 'update',
      entityId: id,
      equipmentId: originalInspection.equipment_id,
      baseVersion: payload.baseVersion || originalInspection.version,
      changes: {
        status: payload.status,
        overall_result: payload.overall_result,
        readings: payload.readings,
        notes: payload.notes,
      },
      clientState,
      baseState,
      optimisticRecord,
    });

    await saveInspection(optimisticRecord);
    await refreshOutbox();

    return { inspection: optimisticRecord, isOffline: true };
  }, [refreshOutbox]);

  const value = {
    isOnline: syncState.isOnline,
    isSimulatedOffline: syncState.isSimulatedOffline,
    isSyncing: syncState.isSyncing,
    pendingCount: syncState.outboxStats.pending + syncState.outboxStats.failed,
    failedCount: syncState.outboxStats.failed,
    conflictedCount: syncState.outboxStats.conflicted,
    outboxStats: syncState.outboxStats,
    outboxItems,
    lastSyncTime: syncState.lastSyncTime,
    lastError: syncState.lastError,
    triggerSync,
    toggleSimulatedOffline,
    saveNewInspection,
    saveUpdatedInspection,
    refreshOutbox,
  };

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync() {
  const context = useContext(SyncContext);
  if (!context) {
    throw new Error('useSync must be used within a SyncProvider');
  }
  return context;
}
