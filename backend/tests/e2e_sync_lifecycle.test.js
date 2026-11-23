const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const crypto = require('crypto');
const app = require('../src/app');
const { query, close } = require('../src/config/db');

describe('Full End-to-End Offline-First Sync & Conflict Lifecycle Suite', () => {
  let techToken = '';
  let supervisorToken = '';
  let technicianUser = null;
  let equipmentId = '';

  const trackedInspections = [];

  before(async () => {
    // 1. Authenticate technician
    const resTech = await request(app)
      .post('/api/auth/login')
      .send({ email: 'tech1@syncproof.internal', password: 'Technician123!' });
    techToken = resTech.body.token;
    technicianUser = resTech.body.user;

    // 2. Authenticate supervisor
    const resSup = await request(app)
      .post('/api/auth/login')
      .send({ email: 'supervisor@syncproof.internal', password: 'Supervisor123!' });
    supervisorToken = resSup.body.token;

    // 3. Fetch equipment ID
    const eqRes = await query(`SELECT id, code, name FROM equipment LIMIT 1`);
    equipmentId = eqRes.rows[0].id;
  });

  after(async () => {
    // Cleanup test records
    for (const id of trackedInspections) {
      await query(`DELETE FROM inspections WHERE id = $1`, [id]);
    }
    await close();
  });

  test('Complete End-to-End Lifecycle: Offline Create -> Concurrent Edit Collision -> Batch Sync -> Supervisor 3-Way Arbitration', async () => {
    // --------------------------------------------------------------------------
    // Step 1: Base Inspection on Server
    // --------------------------------------------------------------------------
    const initialRes = await request(app)
      .post('/api/inspections')
      .set('Authorization', `Bearer ${techToken}`)
      .send({
        equipment_id: equipmentId,
        status: 'completed',
        overall_result: 'pass',
        readings: { temperature_c: 55, pressure_psi: 100 },
        notes: 'Initial operational inspection',
      });

    assert.equal(initialRes.status, 201);
    const existingInspectionId = initialRes.body.inspection.id;
    trackedInspections.push(existingInspectionId);
    assert.equal(initialRes.body.inspection.version, 1);

    // --------------------------------------------------------------------------
    // Step 2: Concurrent Server Update (Version advances v1 -> v2)
    // --------------------------------------------------------------------------
    const serverUpdateRes = await request(app)
      .put(`/api/inspections/${existingInspectionId}`)
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({
        baseVersion: 1,
        status: 'completed',
        overall_result: 'warning', // Supervisor flagged warning
        readings: { temperature_c: 68, pressure_psi: 100 },
        notes: 'Supervisor observed elevated temperature',
      });

    assert.equal(serverUpdateRes.status, 200);
    assert.equal(serverUpdateRes.body.inspection.version, 2);

    // --------------------------------------------------------------------------
    // Step 3: Offline Technician Queues Two Mutations in Outbox:
    // Mutation A: Offline Create on equipment
    // Mutation B: Offline Update on existingInspectionId (based on stale v1, colliding on overall_result)
    // --------------------------------------------------------------------------
    const createMutationId = crypto.randomUUID();
    const updateMutationId = crypto.randomUUID();

    const offlineOutboxBatch = [
      {
        clientMutationId: createMutationId,
        action: 'create',
        equipmentId,
        status: 'completed',
        overall_result: 'pass',
        readings: { temperature_c: 48, pressure_psi: 95 },
        notes: 'Inspection performed while offline in remote tunnel',
      },
      {
        clientMutationId: updateMutationId,
        action: 'update',
        entityId: existingInspectionId,
        baseVersion: 1, // Technician was offline and only knew version 1
        changes: {
          overall_result: 'fail', // Collides with server's 'warning'
          notes: 'Technician found physical fracture while offline',
        },
        clientState: {
          status: 'completed',
          overall_result: 'fail',
          readings: { temperature_c: 55, pressure_psi: 100 },
          notes: 'Technician found physical fracture while offline',
        },
        baseState: {
          status: 'completed',
          overall_result: 'pass',
          readings: { temperature_c: 55, pressure_psi: 100 },
          notes: 'Initial operational inspection',
        },
      },
    ];

    // --------------------------------------------------------------------------
    // Step 4: Network Reconnects -> Client Flushes Outbox to POST /api/sync
    // --------------------------------------------------------------------------
    const syncRes = await request(app)
      .post('/api/sync')
      .set('Authorization', `Bearer ${techToken}`)
      .send({ mutations: offlineOutboxBatch });

    assert.equal(syncRes.status, 200);
    assert.equal(syncRes.body.processed, 2);

    const [resCreate, resUpdate] = syncRes.body.results;

    // Verification Mutation A (Create): Successfully applied
    assert.equal(resCreate.clientMutationId, createMutationId);
    assert.equal(resCreate.status, 'applied');
    assert.ok(resCreate.inspection);
    assert.equal(resCreate.inspection.version, 1);
    trackedInspections.push(resCreate.inspection.id);

    // Verification Mutation B (Update): Conflict detected and flagged!
    assert.equal(resUpdate.clientMutationId, updateMutationId);
    assert.equal(resUpdate.status, 'conflicted');
    assert.ok(resUpdate.conflictId);
    assert.ok(resUpdate.conflictingFields.includes('overall_result'));

    const conflictId = resUpdate.conflictId;

    // --------------------------------------------------------------------------
    // Step 5: Idempotency Protection: Replaying the Outbox Batch
    // --------------------------------------------------------------------------
    const replayRes = await request(app)
      .post('/api/sync')
      .set('Authorization', `Bearer ${techToken}`)
      .send({ mutations: offlineOutboxBatch });

    assert.equal(replayRes.status, 200);
    assert.equal(replayRes.body.results[0].replayed, true);
    assert.equal(replayRes.body.results[1].replayed, true);
    assert.equal(replayRes.body.results[1].conflictId, conflictId);

    // --------------------------------------------------------------------------
    // Step 6: Supervisor Reviews Conflicts Queue (GET /api/conflicts)
    // --------------------------------------------------------------------------
    const conflictsListRes = await request(app)
      .get('/api/conflicts?status=pending')
      .set('Authorization', `Bearer ${supervisorToken}`);

    assert.equal(conflictsListRes.status, 200);
    const activeConflict = conflictsListRes.body.conflicts.find((c) => c.id === conflictId);
    assert.ok(activeConflict, 'Conflict must appear in supervisor pending queue');
    assert.equal(activeConflict.inspection_id, existingInspectionId);

    // --------------------------------------------------------------------------
    // Step 7: Supervisor Inspects 3-Way Details (GET /api/conflicts/:id)
    // --------------------------------------------------------------------------
    const conflictDetailRes = await request(app)
      .get(`/api/conflicts/${conflictId}`)
      .set('Authorization', `Bearer ${supervisorToken}`);

    assert.equal(conflictDetailRes.status, 200);
    const detail = conflictDetailRes.body.conflict;
    assert.equal(detail.status, 'pending');
    assert.equal(detail.base_version, 1);
    assert.equal(detail.server_version, 2);

    // --------------------------------------------------------------------------
    // Step 8: Supervisor Resolves Conflict via Custom Arbitrated Merge
    // --------------------------------------------------------------------------
    const resolveRes = await request(app)
      .post(`/api/conflicts/${conflictId}/resolve`)
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({
        resolutionStrategy: 'custom_merge',
        resolvedState: {
          status: 'completed',
          overall_result: 'fail', // Confirm fail based on technician fracture observation
          readings: { temperature_c: 68, pressure_psi: 100 }, // Keep accurate elevated temperature
          notes: 'Supervisor arbitrated: confirmed technician fracture observation alongside elevated temperature.',
        },
        notes: 'Approved after telephone conference with field technician.',
      });

    assert.equal(resolveRes.status, 200);
    assert.equal(resolveRes.body.resolution.conflict.status, 'resolved');
    assert.equal(resolveRes.body.resolution.inspection.version, 3); // Incremented v2 -> v3
    assert.equal(resolveRes.body.resolution.inspection.has_pending_conflict, false);

    // --------------------------------------------------------------------------
    // Step 9: Verify Immutable Audit Trail
    // --------------------------------------------------------------------------
    const inspFinalRes = await request(app)
      .get(`/api/inspections/${existingInspectionId}`)
      .set('Authorization', `Bearer ${supervisorToken}`);

    assert.equal(inspFinalRes.status, 200);
    const auditLogs = inspFinalRes.body.inspection.auditHistory;
    const actions = auditLogs.map((a) => a.action);

    // Expected audit actions throughout the lifecycle:
    assert.ok(actions.includes('created'), 'Audit must contain initial created event');
    assert.ok(actions.includes('updated'), 'Audit must contain server update event');
    assert.ok(actions.includes('conflict_flagged'), 'Audit must contain conflict_flagged event');
    assert.ok(actions.includes('conflict_resolved'), 'Audit must contain conflict_resolved event');

    const resolveAudit = auditLogs.find((a) => a.action === 'conflict_resolved');
    assert.equal(resolveAudit.version, 3);
  });
});
