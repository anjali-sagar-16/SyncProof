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
  enqueueMutation,
  getAllMutations,
  getInspectionById,
  saveInspection,
  closeDB,
} from '../src/db/indexedDb.js';
import { syncManager } from '../src/services/syncManager.js';
import { api } from '../src/api/client.js';

describe('Frontend Synchronization Engine: SyncManager Suite', () => {
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

  describe('Connectivity & Simulated Offline Control', () => {
    test('reports online status correctly', () => {
      syncManager.setSimulatedOffline(false);
      assert.equal(syncManager.getEffectiveOnlineStatus(), true);
    });

    test('toggling simulated offline sets effective status to false', () => {
      syncManager.setSimulatedOffline(true);
      assert.equal(syncManager.getEffectiveOnlineStatus(), false);
      syncManager.setSimulatedOffline(false);
      assert.equal(syncManager.getEffectiveOnlineStatus(), true);
    });

    test('syncNow rejects execution when offline without force flag', async () => {
      syncManager.setSimulatedOffline(true);
      const res = await syncManager.syncNow();
      assert.equal(res.synced, 0);
      assert.match(res.message, /Offline/);
    });
  });

  describe('Batch Sync Processing & Reconciliations', () => {
    test('processes applied create mutation, marks outbox synced, and caches inspection', async () => {
      const equipId = '11111111-1111-4111-8111-111111111111';
      const mutation = await enqueueMutation({
        action: 'create',
        equipmentId: equipId,
        clientState: { status: 'completed', overall_result: 'pass', notes: 'Offline created' },
      });

      const serverInspectionId = '55555555-5555-4555-8555-555555555555';

      // Mock api.sync response
      api.sync = async (batch) => {
        assert.equal(batch.length, 1);
        assert.equal(batch[0].clientMutationId, mutation.clientMutationId);
        assert.equal(batch[0].action, 'create');

        return {
          processed: 1,
          results: [
            {
              clientMutationId: mutation.clientMutationId,
              status: 'applied',
              entityId: serverInspectionId,
              inspection: {
                id: serverInspectionId,
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

      const syncResult = await syncManager.syncNow({ force: true });
      assert.equal(syncResult.synced, 1);

      // Verify outbox record is marked 'synced'
      const outbox = await getAllMutations();
      assert.equal(outbox[0].status, 'synced');

      // Verify server inspection is persisted in IndexedDB cache
      const cached = await getInspectionById(serverInspectionId);
      assert.ok(cached);
      assert.equal(cached.id, serverInspectionId);
      assert.equal(cached.version, 1);
    });

    test('processes conflicted update mutation and flags cached record', async () => {
      const inspectionId = '66666666-6666-4666-8666-666666666666';

      // Pre-populate inspection in cache
      await saveInspection({
        id: inspectionId,
        equipment_id: '11111111-1111-4111-8111-111111111111',
        overall_result: 'pass',
        version: 1,
        has_pending_conflict: false,
      });

      const mutation = await enqueueMutation({
        action: 'update',
        entityId: inspectionId,
        baseVersion: 1,
        changes: { overall_result: 'fail' },
        optimisticRecord: {
          id: inspectionId,
          overall_result: 'fail',
          version: 1,
          has_pending_conflict: false,
        },
      });

      // Mock server returning conflict result
      api.sync = async () => ({
        processed: 1,
        results: [
          {
            clientMutationId: mutation.clientMutationId,
            status: 'conflicted',
            entityId: inspectionId,
            conflictId: '77777777-7777-4777-8777-777777777777',
            conflictingFields: ['overall_result'],
            baseVersion: 1,
            serverVersion: 2,
          },
        ],
      });

      const syncResult = await syncManager.syncNow({ force: true });
      assert.equal(syncResult.conflicts, 1);

      // Verify outbox entry is marked 'conflicted'
      const outbox = await getAllMutations();
      assert.equal(outbox[0].status, 'conflicted');
      assert.equal(outbox[0].conflictId, '77777777-7777-4777-8777-777777777777');

      // Verify cached inspection has has_pending_conflict = true
      const cached = await getInspectionById(inspectionId);
      assert.equal(cached.has_pending_conflict, true);
    });

    test('handles network failure safely: reverts status to pending and increments retryCount', async () => {
      const mutation = await enqueueMutation({
        action: 'create',
        equipmentId: '11111111-1111-4111-8111-111111111111',
      });

      // Mock network failure
      api.sync = async () => {
        throw new Error('TypeError: Failed to fetch (Network connection lost)');
      };

      await assert.rejects(
        async () => {
          await syncManager.syncNow({ force: true });
        },
        /Failed to fetch/
      );

      // Verify mutation is reverted to pending/failed with retryCount incremented
      const outbox = await getAllMutations();
      assert.equal(outbox[0].status, 'pending');
      assert.equal(outbox[0].retryCount, 1);
      assert.match(outbox[0].lastError, /Failed to fetch/);
    });
  });
});
