/**
 * SyncManager Service
 * Coordinates client-side offline outbox queue, background sync engine,
 * online/offline connectivity monitoring, conflict detection, and cache updates.
 */

import { api } from '../api/client.js';
import {
  openDB,
  getPendingMutations,
  getAllMutations,
  updateMutation,
  saveInspection,
  deleteInspection,
  getOutboxStats,
} from '../db/indexedDb.js';

class SyncManager {
  constructor() {
    this.isOnline = typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean'
      ? navigator.onLine
      : true;
    this.isSimulatedOffline = false;
    this.isSyncing = false;
    this.lastSyncTime = null;
    this.lastError = null;
    this.listeners = new Set();
    this.syncIntervalId = null;

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('online', () => this.handleNetworkChange(true));
      window.addEventListener('offline', () => this.handleNetworkChange(false));
    }
  }

  /**
   * Initializes background listeners and periodic sync timer.
   */
  start() {
    if (this.syncIntervalId) return;

    // Periodic check every 20 seconds for pending items if online
    this.syncIntervalId = setInterval(() => {
      if (this.getEffectiveOnlineStatus() && !this.isSyncing) {
        this.syncNow({ background: true }).catch(() => {});
      }
    }, 20000);

    // Initial check on startup
    if (this.getEffectiveOnlineStatus()) {
      setTimeout(() => this.syncNow({ background: true }).catch(() => {}), 1500);
    }
  }

  stop() {
    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
  }

  /**
   * Returns true only if both physical network is online AND simulated offline is false.
   */
  getEffectiveOnlineStatus() {
    return Boolean(this.isOnline && !this.isSimulatedOffline);
  }

  /**
   * Toggles simulated offline mode (for portfolio demonstrations).
   */
  setSimulatedOffline(offline) {
    this.isSimulatedOffline = Boolean(offline);
    this.notifyListeners();

    if (!this.isSimulatedOffline && this.isOnline) {
      // Reconnected from simulated offline -> Trigger immediate sync
      this.syncNow({ force: true }).catch(() => {});
    }
  }

  handleNetworkChange(online) {
    this.isOnline = Boolean(online);
    this.notifyListeners();

    if (this.getEffectiveOnlineStatus()) {
      // Network returned -> Trigger immediate sync
      this.syncNow({ force: true }).catch(() => {});
    }
  }

  /**
   * Subscribes a listener to sync state changes.
   */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notifyListeners() {
    if (this.listeners.size === 0) return;

    getOutboxStats().then((stats) => {
      const state = {
        isOnline: this.getEffectiveOnlineStatus(),
        isSimulatedOffline: this.isSimulatedOffline,
        isSyncing: this.isSyncing,
        lastSyncTime: this.lastSyncTime,
        lastError: this.lastError,
        outboxStats: stats,
      };
      for (const listener of this.listeners) {
        try {
          listener(state);
        } catch (e) {
          console.error('[SyncManager] Listener error:', e);
        }
      }
    }).catch(() => {});
  }

  /**
   * Performs synchronization cycle of pending mutations.
   */
  async syncNow(options = {}) {
    if (!this.getEffectiveOnlineStatus() && !options.force) {
      return { synced: 0, message: 'Offline: Mutations remain queued in IndexedDB outbox.' };
    }

    if (this.isSyncing) {
      return { synced: 0, message: 'Sync already in progress.' };
    }

    this.isSyncing = true;
    this.lastError = null;
    this.notifyListeners();

    try {
      // 1. Fetch pending/failed mutations from IndexedDB outbox
      const pending = await getPendingMutations();

      if (pending.length === 0) {
        this.lastSyncTime = new Date();
        this.isSyncing = false;
        this.notifyListeners();
        return { synced: 0, message: 'Outbox is up to date.' };
      }

      // 2. Mark mutations as 'syncing'
      for (const item of pending) {
        await updateMutation(item.id, { status: 'syncing' });
      }
      this.notifyListeners();

      // 3. Format mutations payload for POST /api/sync
      const batchPayload = pending.map((item) => {
        if (item.action === 'create') {
          return {
            clientMutationId: item.clientMutationId,
            action: 'create',
            equipmentId: item.equipmentId,
            status: item.clientState?.status || item.changes?.status || 'completed',
            overall_result: item.clientState?.overall_result || item.changes?.overall_result || null,
            readings: item.clientState?.readings || item.changes?.readings || {},
            notes: item.clientState?.notes || item.changes?.notes || '',
          };
        } else {
          return {
            clientMutationId: item.clientMutationId,
            action: 'update',
            entityId: item.entityId,
            baseVersion: item.baseVersion,
            changes: item.changes || {},
            clientState: item.clientState || undefined,
            baseState: item.baseState || undefined,
          };
        }
      });

      // 4. Send batch to backend
      const response = await api.sync(batchPayload);
      const results = response.results || [];

      let appliedCount = 0;
      let conflictCount = 0;
      let rejectedCount = 0;

      // 5. Reconcile results with local cache and outbox
      for (const res of results) {
        const mutation = pending.find((m) => m.clientMutationId === res.clientMutationId);
        if (!mutation) continue;

        if (res.status === 'applied' || res.status === 'merged') {
          appliedCount++;
          // Mark outbox entry as synced
          await updateMutation(mutation.id, {
            status: 'synced',
            serverResult: res,
          });

          // Update local IndexedDB inspection cache
          if (res.inspection) {
            // If offline create used a temporary client ID, remove old temp record
            if (mutation.action === 'create' && mutation.entityId !== res.inspection.id) {
              await deleteInspection(mutation.entityId);
            }
            await saveInspection(res.inspection);
          }
        } else if (res.status === 'conflicted') {
          conflictCount++;
          // Mark outbox entry as conflicted
          await updateMutation(mutation.id, {
            status: 'conflicted',
            conflictId: res.conflictId,
            conflictingFields: res.conflictingFields,
            serverResult: res,
          });

          // Mark cached inspection record has_pending_conflict = true
          if (mutation.entityId) {
            const cachedInsp = mutation.optimisticRecord;
            if (cachedInsp) {
              await saveInspection({
                ...cachedInsp,
                has_pending_conflict: true,
              });
            }
          }
        } else {
          // Rejected or failed
          rejectedCount++;
          await updateMutation(mutation.id, {
            status: 'failed',
            lastError: res.error || 'Mutation rejected by server.',
            retryCount: (mutation.retryCount || 0) + 1,
          });
        }
      }

      this.lastSyncTime = new Date();
      return {
        synced: appliedCount,
        conflicts: conflictCount,
        rejected: rejectedCount,
        results,
      };
    } catch (err) {
      console.warn('[SyncManager] Sync request failed:', err.message);
      this.lastError = err.message || 'Network error during synchronization.';

      // Revert syncing mutations back to pending/failed for retry
      const all = await getAllMutations();
      for (const item of all) {
        if (item.status === 'syncing') {
          await updateMutation(item.id, {
            status: 'pending',
            lastError: err.message,
            retryCount: (item.retryCount || 0) + 1,
          });
        }
      }

      throw err;
    } finally {
      this.isSyncing = false;
      this.notifyListeners();
    }
  }
}

// Singleton instance
export const syncManager = new SyncManager();
