import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

// Ensure global window object has indexedDB for tests
globalThis.window = {
  indexedDB: globalThis.indexedDB,
  addEventListener: () => {},
  removeEventListener: () => {},
};

import {
  openDB,
  closeDB,
  saveInspection,
  getAllInspections,
  getInspectionById,
  deleteInspection,
  enqueueMutation,
  getAllMutations,
  getPendingMutations,
  updateMutation,
  generateUuid,
} from '../src/db/indexedDb.js';
import { syncManager } from '../src/services/syncManager.js';
import { api } from '../src/api/client.js';

describe('Frontend Offline Inspection Workflow & Lifecycle Suite', () => {
  let originalApiSync;

  beforeEach(async () => {
    while (syncManager.isSyncing) {
      await new Promise((r) => setTimeout(r, 10));
    }
    syncManager.isSimulatedOffline = false;
    closeDB();
    await new Promise((resolve) => {
      const req = indexedDB.deleteDatabase('SyncProofDB');
      req.onsuccess = resolve;
      req.onerror = resolve;
      req.onblocked = resolve;
    });

    originalApiSync = api.sync;
    api.sync = async () => ({ processed: 0, results: [] });
    syncManager.isSyncing = false;
  });

  afterEach(async () => {
    while (syncManager.isSyncing) {
      await new Promise((r) => setTimeout(r, 10));
    }
    closeDB();
    api.sync = originalApiSync;
    syncManager.stop();
  });

  describe('Offline Inspection Creation & Editing Workflow', () => {
    test('Offline creation saves optimistic record and enqueues create mutation', async () => {
      const tempId = generateUuid();
      const equipId = '11111111-1111-4111-8111-111111111111';
      const optimisticRecord = {
        id: tempId,
        equipment_id: equipId,
        equipment_code: 'EQ-PUMP-001',
        equipment_name: 'High-Pressure Water Pump #1',
        inspector_id: 'tech-user-1',
        inspector_name: 'Alex Rivera',
        status: 'completed',
        overall_result: 'pass',
        readings: { temperature_c: 45.2, pressure_psi: 85 },
        notes: 'Offline initial inspection',
        version: 1,
        has_pending_conflict: false,
        _isOffline: true,
        _syncStatus: 'pending',
      };

      // 1. Enqueue create mutation
      const mutation = await enqueueMutation({
        action: 'create',
        entityId: tempId,
        equipmentId: equipId,
        baseVersion: 1,
        changes: {
          status: 'completed',
          overall_result: 'pass',
          readings: { temperature_c: 45.2, pressure_psi: 85 },
          notes: 'Offline initial inspection',
        },
        clientState: {
          status: 'completed',
          overall_result: 'pass',
          readings: { temperature_c: 45.2, pressure_psi: 85 },
          notes: 'Offline initial inspection',
        },
        optimisticRecord,
      });

      // 2. Save optimistic inspection to local cache
      await saveInspection(optimisticRecord);

      // Verify cached record
      const cached = await getInspectionById(tempId);
      assert.ok(cached);
      assert.equal(cached._isOffline, true);
      assert.equal(cached.overall_result, 'pass');
      assert.equal(cached.readings.pressure_psi, 85);

      // Verify outbox queue
      const pending = await getPendingMutations();
      assert.equal(pending.length, 1);
      assert.equal(pending[0].clientMutationId, mutation.clientMutationId);
      assert.equal(pending[0].action, 'create');
      assert.equal(pending[0].status, 'pending');
    });

    test('Offline editing of pending draft updates the pending create mutation directly', async () => {
      const tempId = generateUuid();
      const equipId = '11111111-1111-4111-8111-111111111111';

      // 1. Initial offline create
      const mutation = await enqueueMutation({
        action: 'create',
        entityId: tempId,
        equipmentId: equipId,
        baseVersion: 1,
        changes: { status: 'completed', overall_result: 'pass', notes: 'Initial note' },
        clientState: { status: 'completed', overall_result: 'pass', notes: 'Initial note' },
        optimisticRecord: { id: tempId, overall_result: 'pass', notes: 'Initial note', _isOffline: true },
      });
      await saveInspection({ id: tempId, overall_result: 'pass', notes: 'Initial note', _isOffline: true });

      // 2. Offline edit of draft before sync
      const revisedRecord = {
        id: tempId,
        overall_result: 'warning',
        notes: 'Revised finding: slight bearing noise',
        readings: { temperature_c: 58.0 },
        _isOffline: true,
      };

      // Directly update the pending create mutation
      await updateMutation(mutation.id, {
        changes: {
          ...mutation.changes,
          overall_result: 'warning',
          notes: 'Revised finding: slight bearing noise',
          readings: { temperature_c: 58.0 },
        },
        clientState: {
          status: 'completed',
          overall_result: 'warning',
          notes: 'Revised finding: slight bearing noise',
          readings: { temperature_c: 58.0 },
        },
        optimisticRecord: revisedRecord,
      });
      await saveInspection(revisedRecord);

      // Verify that outbox still has ONLY 1 pending mutation with updated changes
      const pending = await getPendingMutations();
      assert.equal(pending.length, 1);
      assert.equal(pending[0].action, 'create');
      assert.equal(pending[0].changes.overall_result, 'warning');
      assert.equal(pending[0].changes.notes, 'Revised finding: slight bearing noise');

      // Verify cached inspection has updated values
      const cached = await getInspectionById(tempId);
      assert.equal(cached.overall_result, 'warning');
      assert.equal(cached.notes, 'Revised finding: slight bearing noise');
    });

    test('Offline editing of cached server inspection preserves OCC baseVersion', async () => {
      const serverId = '22222222-2222-4222-8222-222222222222';
      // Pre-populate cached server inspection at version 3
      await saveInspection({
        id: serverId,
        equipment_id: '11111111-1111-4111-8111-111111111111',
        status: 'completed',
        overall_result: 'pass',
        version: 3,
        notes: 'Server inspection v3',
      });

      // Technician edits while offline
      const updateMutationRecord = await enqueueMutation({
        action: 'update',
        entityId: serverId,
        baseVersion: 3,
        changes: { notes: 'Offline technician edit', overall_result: 'warning' },
        clientState: { notes: 'Offline technician edit', overall_result: 'warning', status: 'completed' },
        baseState: { notes: 'Server inspection v3', overall_result: 'pass', status: 'completed' },
        optimisticRecord: {
          id: serverId,
          version: 3,
          notes: 'Offline technician edit',
          overall_result: 'warning',
          _isOffline: true,
        },
      });

      await saveInspection({
        id: serverId,
        version: 3,
        notes: 'Offline technician edit',
        overall_result: 'warning',
        _isOffline: true,
      });

      const pending = await getPendingMutations();
      assert.equal(pending.length, 1);
      assert.equal(pending[0].action, 'update');
      assert.equal(pending[0].baseVersion, 3);
      assert.equal(pending[0].entityId, serverId);

      const cached = await getInspectionById(serverId);
      assert.equal(cached.notes, 'Offline technician edit');
      assert.equal(cached._isOffline, true);
    });

    test('Data persistence survives database close and reopen (browser refresh simulation)', async () => {
      const tempId = generateUuid();
      await enqueueMutation({
        action: 'create',
        entityId: tempId,
        equipmentId: 'eq-1',
        changes: { status: 'completed' },
      });
      await saveInspection({ id: tempId, status: 'completed', _isOffline: true });

      // Simulate browser restart / page refresh by closing active DB connection
      closeDB();

      // Re-read data using a fresh DB handle
      const inspections = await getAllInspections();
      const mutations = await getAllMutations();

      assert.equal(inspections.length, 1);
      assert.equal(inspections[0].id, tempId);
      assert.equal(inspections[0]._isOffline, true);

      assert.equal(mutations.length, 1);
      assert.equal(mutations[0].entityId, tempId);
      assert.equal(mutations[0].status, 'pending');
    });
  });

  describe('Reconnection & Batch Synchronization Lifecycle', () => {
    test('Reconnection flushes queued mutations in batch and cleans up temporary client IDs', async () => {
      const tempId = generateUuid();
      const equipId = '11111111-1111-4111-8111-111111111111';
      const serverId = '99999999-9999-4999-8999-999999999999';

      // 1. Enqueue create mutation with tempId
      const mutation = await enqueueMutation({
        action: 'create',
        entityId: tempId,
        equipmentId: equipId,
        changes: { status: 'completed', overall_result: 'pass' },
      });
      await saveInspection({ id: tempId, status: 'completed', overall_result: 'pass', _isOffline: true });

      // 2. Mock server response returning newly generated server UUID
      api.sync = async (batch) => {
        assert.equal(batch.length, 1);
        assert.equal(batch[0].clientMutationId, mutation.clientMutationId);

        return {
          processed: 1,
          results: [
            {
              clientMutationId: mutation.clientMutationId,
              status: 'applied',
              entityId: serverId,
              inspection: {
                id: serverId,
                equipment_id: equipId,
                status: 'completed',
                overall_result: 'pass',
                version: 1,
                has_pending_conflict: false,
              },
            },
          ],
        };
      };

      // 3. Trigger sync
      const res = await syncManager.syncNow({ force: true });
      assert.equal(res.synced, 1);

      // 4. Verify tempId was deleted from cache
      const oldCached = await getInspectionById(tempId);
      assert.equal(oldCached, null, 'Temporary offline ID should be purged from IndexedDB');

      // 5. Verify server assigned record exists in cache
      const newCached = await getInspectionById(serverId);
      assert.ok(newCached, 'Server inspection should be saved into IndexedDB');
      assert.equal(newCached.id, serverId);
      assert.equal(newCached.version, 1);

      // 6. Verify outbox mutation is marked 'synced'
      const outbox = await getAllMutations();
      assert.equal(outbox[0].status, 'synced');
    });

    test('Server auto-merge result updates local cache and increments version', async () => {
      const serverId = '33333333-3333-4333-8333-333333333333';
      await saveInspection({
        id: serverId,
        version: 1,
        status: 'in_progress',
        overall_result: 'pass',
      });

      const mutation = await enqueueMutation({
        action: 'update',
        entityId: serverId,
        baseVersion: 1,
        changes: { notes: 'Technician disjoint note' },
      });

      // Mock server 3-way auto-merge response (v1 -> v2)
      api.sync = async () => ({
        processed: 1,
        results: [
          {
            clientMutationId: mutation.clientMutationId,
            status: 'merged',
            entityId: serverId,
            mergedFields: ['notes'],
            inspection: {
              id: serverId,
              version: 2,
              status: 'completed',
              overall_result: 'pass',
              notes: 'Technician disjoint note',
              has_pending_conflict: false,
            },
          },
        ],
      });

      const res = await syncManager.syncNow({ force: true });
      assert.equal(res.synced, 1);

      const cached = await getInspectionById(serverId);
      assert.equal(cached.version, 2);
      assert.equal(cached.notes, 'Technician disjoint note');
      assert.equal(cached.has_pending_conflict, false);
    });
  });
});
