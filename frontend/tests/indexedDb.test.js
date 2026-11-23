import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

// Ensure global window object has indexedDB for tests
globalThis.window = {
  indexedDB: globalThis.indexedDB,
};

import {
  openDB,
  saveEquipment,
  saveEquipmentBatch,
  getAllEquipment,
  getEquipmentById,
  saveInspection,
  saveInspectionBatch,
  getAllInspections,
  getInspectionById,
  deleteInspection,
  enqueueMutation,
  getPendingMutations,
  getAllMutations,
  updateMutation,
  removeMutation,
  clearSyncedMutations,
  getOutboxStats,
  generateUuid,
  closeDB,
} from '../src/db/indexedDb.js';

describe('Frontend Storage: IndexedDB & Offline Outbox Suite', () => {
  beforeEach(async () => {
    closeDB();
    await new Promise((resolve) => {
      const req = indexedDB.deleteDatabase('SyncProofDB');
      req.onsuccess = resolve;
      req.onerror = resolve;
      req.onblocked = resolve;
    });
  });

  afterEach(() => {
    closeDB();
  });

  describe('UUID Generation & DB Initialization', () => {
    test('generateUuid produces valid RFC4122 v4 UUID format', () => {
      const id = generateUuid();
      assert.ok(typeof id === 'string');
      assert.match(
        id,
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        'UUID should conform to standard RFC4122 v4 pattern'
      );
    });

    test('openDB initializes database with equipment, inspections, and outbox object stores', async () => {
      const db = await openDB();
      assert.ok(db.objectStoreNames.contains('equipment'));
      assert.ok(db.objectStoreNames.contains('inspections'));
      assert.ok(db.objectStoreNames.contains('outbox'));
    });
  });

  describe('Equipment Cache Operations', () => {
    test('saves and retrieves single equipment item', async () => {
      const equip = {
        id: '11111111-1111-4111-8111-111111111111',
        code: 'EQ-TEST-001',
        name: 'Centrifugal Test Pump',
        location: 'Bay 4',
        status: 'active',
      };

      await saveEquipment(equip);
      const retrieved = await getEquipmentById(equip.id);

      assert.ok(retrieved);
      assert.equal(retrieved.id, equip.id);
      assert.equal(retrieved.code, 'EQ-TEST-001');
      assert.ok(retrieved._cachedAt);
    });

    test('saves batch of equipment items and retrieves all', async () => {
      const items = [
        { id: '22222222-2222-4222-8222-222222222222', code: 'EQ-002', name: 'Turbine A', status: 'active' },
        { id: '33333333-3333-4333-8333-333333333333', code: 'EQ-003', name: 'Generator B', status: 'maintenance' },
      ];

      const count = await saveEquipmentBatch(items);
      assert.equal(count, 2);

      const all = await getAllEquipment();
      assert.equal(all.length, 2);
    });
  });

  describe('Inspection Cache Operations', () => {
    test('saves, updates, and deletes inspection record', async () => {
      const insp = {
        id: '44444444-4444-4444-8444-444444444444',
        equipment_id: '11111111-1111-4111-8111-111111111111',
        status: 'completed',
        overall_result: 'pass',
        version: 1,
        readings: { temperature_c: 65 },
        notes: 'Initial inspection',
      };

      await saveInspection(insp);
      const fetched = await getInspectionById(insp.id);
      assert.equal(fetched.id, insp.id);
      assert.equal(fetched.overall_result, 'pass');

      // Update inspection
      const updated = { ...fetched, overall_result: 'warning', version: 2 };
      await saveInspection(updated);
      const fetchedUpdated = await getInspectionById(insp.id);
      assert.equal(fetchedUpdated.overall_result, 'warning');
      assert.equal(fetchedUpdated.version, 2);

      // Delete inspection
      await deleteInspection(insp.id);
      const deleted = await getInspectionById(insp.id);
      assert.equal(deleted, null);
    });
  });

  describe('Offline Mutation Outbox Queue Operations', () => {
    test('enqueues create mutation with unique clientMutationId and pending status', async () => {
      const mutation = await enqueueMutation({
        action: 'create',
        equipmentId: '11111111-1111-4111-8111-111111111111',
        changes: { status: 'completed', overall_result: 'pass' },
        clientState: { status: 'completed', overall_result: 'pass' },
      });

      assert.ok(mutation.id);
      assert.equal(mutation.id, mutation.clientMutationId);
      assert.equal(mutation.action, 'create');
      assert.equal(mutation.status, 'pending');
      assert.equal(mutation.retryCount, 0);

      const pending = await getPendingMutations();
      assert.equal(pending.length, 1);
      assert.equal(pending[0].clientMutationId, mutation.clientMutationId);
    });

    test('enqueues update mutation preserving OCC baseVersion', async () => {
      const mutation = await enqueueMutation({
        action: 'update',
        entityId: '44444444-4444-4444-8444-444444444444',
        baseVersion: 2,
        changes: { overall_result: 'fail', notes: 'Bearing failure detected' },
        clientState: { overall_result: 'fail', notes: 'Bearing failure detected' },
        baseState: { overall_result: 'pass', notes: 'Normal' },
      });

      assert.equal(mutation.action, 'update');
      assert.equal(mutation.baseVersion, 2);
      assert.equal(mutation.entityId, '44444444-4444-4444-8444-444444444444');
    });

    test('transitions mutation status from pending -> syncing -> synced', async () => {
      const mutation = await enqueueMutation({
        action: 'create',
        equipmentId: '11111111-1111-4111-8111-111111111111',
        changes: { overall_result: 'pass' },
      });

      // Update to syncing
      await updateMutation(mutation.id, { status: 'syncing' });
      let pending = await getPendingMutations();
      // Should not be in pending since it is actively syncing
      assert.equal(pending.length, 0);

      // Update to synced
      await updateMutation(mutation.id, { status: 'synced' });
      const stats = await getOutboxStats();
      assert.equal(stats.synced, 1);
      assert.equal(stats.pending, 0);
    });

    test('handles failed mutation status and tracks retry count', async () => {
      const mutation = await enqueueMutation({
        action: 'update',
        entityId: '44444444-4444-4444-8444-444444444444',
        baseVersion: 1,
      });

      // Simulate failure
      await updateMutation(mutation.id, {
        status: 'failed',
        lastError: 'HTTP 503 Server Unavailable',
        retryCount: 1,
      });

      // Failed mutations ARE returned by getPendingMutations for automatic retry
      const pending = await getPendingMutations();
      assert.equal(pending.length, 1);
      assert.equal(pending[0].status, 'failed');
      assert.equal(pending[0].retryCount, 1);
      assert.equal(pending[0].lastError, 'HTTP 503 Server Unavailable');
    });

    test('clearSyncedMutations purges synced items while preserving pending items', async () => {
      const m1 = await enqueueMutation({ action: 'create', equipmentId: 'eq-1' });
      const m2 = await enqueueMutation({ action: 'update', entityId: 'insp-1', baseVersion: 1 });

      await updateMutation(m1.id, { status: 'synced' });

      const cleared = await clearSyncedMutations();
      assert.equal(cleared, 1);

      const remaining = await getAllMutations();
      assert.equal(remaining.length, 1);
      assert.equal(remaining[0].id, m2.id);
      assert.equal(remaining[0].status, 'pending');
    });
  });
});
