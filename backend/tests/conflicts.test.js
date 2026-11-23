const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const crypto = require('crypto');
const app = require('../src/app');
const { query, close } = require('../src/config/db');

describe('Milestone 5: Conflict Review and Resolution REST API Test Suite', () => {
  let techToken = '';
  let supervisorToken = '';
  let techUserId = '';
  let equipmentId = '';

  const trackedInspections = [];
  const trackedConflicts = [];

  before(async () => {
    // 1. Authenticate technician
    const resTech = await request(app)
      .post('/api/auth/login')
      .send({ email: 'tech1@syncproof.internal', password: 'Technician123!' });
    techToken = resTech.body.token;
    techUserId = resTech.body.user.id;

    // 2. Authenticate supervisor
    const resSup = await request(app)
      .post('/api/auth/login')
      .send({ email: 'supervisor@syncproof.internal', password: 'Supervisor123!' });
    supervisorToken = resSup.body.token;

    // 3. Fetch equipment ID
    const eqRes = await query(`SELECT id FROM equipment LIMIT 1`);
    equipmentId = eqRes.rows[0].id;
  });

  after(async () => {
    // Cleanup created test records
    for (const id of trackedInspections) {
      await query(`DELETE FROM inspections WHERE id = $1`, [id]);
    }
    await close();
  });

  // Helper to generate a conflict via sync API
  async function createTestConflict() {
    // 1. Create inspection
    const createRes = await request(app)
      .post('/api/inspections')
      .set('Authorization', `Bearer ${techToken}`)
      .send({
        equipment_id: equipmentId,
        status: 'completed',
        overall_result: 'pass',
        readings: { temperature_c: 50, vibration_mms: 2.1 },
        notes: 'Initial base reading',
      });

    const inspectionId = createRes.body.inspection.id;
    trackedInspections.push(inspectionId);

    // 2. Server update (advances version to 2)
    await request(app)
      .put(`/api/inspections/${inspectionId}`)
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({
        baseVersion: 1,
        status: 'completed',
        overall_result: 'warning', // Server changed to warning
        readings: { temperature_c: 65, vibration_mms: 2.1 },
        notes: 'Supervisor flagged elevated temperature',
      });

    // 3. Offline client update based on version 1 colliding on overall_result (fails 3-way merge)
    const clientMutationId = crypto.randomUUID();
    const syncRes = await request(app)
      .post('/api/sync')
      .set('Authorization', `Bearer ${techToken}`)
      .send({
        mutations: [
          {
            clientMutationId,
            action: 'update',
            entityId: inspectionId,
            baseVersion: 1,
            changes: {
              overall_result: 'fail', // Collides with server 'warning'
              notes: 'Technician flagged fail due to smoke',
            },
            clientState: {
              status: 'completed',
              overall_result: 'fail',
              readings: { temperature_c: 50, vibration_mms: 2.1 },
              notes: 'Technician flagged fail due to smoke',
            },
          },
        ],
      });

    const syncOutcome = syncRes.body.results[0];
    assert.equal(syncOutcome.status, 'conflicted');
    assert.ok(syncOutcome.conflictId);

    trackedConflicts.push(syncOutcome.conflictId);

    return {
      inspectionId,
      conflictId: syncOutcome.conflictId,
      clientMutationId,
    };
  }

  describe('Conflict API Access Control & Validation', () => {
    test('GET /api/conflicts rejects unauthenticated request with 401', async () => {
      const res = await request(app).get('/api/conflicts');
      assert.equal(res.status, 401);
    });

    test('POST /api/conflicts/:id/resolve rejects unauthenticated request with 401', async () => {
      const res = await request(app)
        .post('/api/conflicts/00000000-0000-0000-0000-000000000000/resolve')
        .send({ resolutionStrategy: 'keep_server' });
      assert.equal(res.status, 401);
    });

    test('POST /api/conflicts/:id/resolve rejects technician with 403 Forbidden', async () => {
      const { conflictId } = await createTestConflict();
      const res = await request(app)
        .post(`/api/conflicts/${conflictId}/resolve`)
        .set('Authorization', `Bearer ${techToken}`)
        .send({ resolutionStrategy: 'keep_server' });

      assert.equal(res.status, 403);
      assert.equal(res.body.error, 'Forbidden');
    });

    test('GET /api/conflicts/:id with invalid UUID returns 400', async () => {
      const res = await request(app)
        .get('/api/conflicts/not-a-valid-uuid')
        .set('Authorization', `Bearer ${supervisorToken}`);

      assert.equal(res.status, 400);
      assert.equal(res.body.error, 'Bad Request');
    });

    test('GET /api/conflicts/:id with non-existent UUID returns 404', async () => {
      const res = await request(app)
        .get('/api/conflicts/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${supervisorToken}`);

      assert.equal(res.status, 404);
      assert.equal(res.body.error, 'Not Found');
    });
  });

  describe('Conflict Listing and Detail Retrieval', () => {
    test('GET /api/conflicts returns pending conflicts for supervisor', async () => {
      const { conflictId, inspectionId } = await createTestConflict();

      const res = await request(app)
        .get('/api/conflicts?status=pending')
        .set('Authorization', `Bearer ${supervisorToken}`);

      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.conflicts));
      const found = res.body.conflicts.find((c) => c.id === conflictId);
      assert.ok(found, 'Created conflict must be listed in pending conflicts');
      assert.equal(found.inspection_id, inspectionId);
      assert.equal(found.status, 'pending');
      assert.ok(found.equipment_code);
      assert.ok(found.technician_name);
    });

    test('GET /api/conflicts/:id returns conflict details with 3-way states', async () => {
      const { conflictId, inspectionId } = await createTestConflict();

      const res = await request(app)
        .get(`/api/conflicts/${conflictId}`)
        .set('Authorization', `Bearer ${supervisorToken}`);

      assert.equal(res.status, 200);
      const conf = res.body.conflict;
      assert.equal(conf.id, conflictId);
      assert.equal(conf.inspection_id, inspectionId);
      assert.equal(conf.status, 'pending');
      assert.ok(conf.conflicting_fields);

      const fields = typeof conf.conflicting_fields === 'string'
        ? JSON.parse(conf.conflicting_fields)
        : conf.conflicting_fields;
      assert.ok(fields.includes('overall_result'));
    });
  });

  describe('Supervisor Conflict Resolution Strategies', () => {
    test('Supervisor resolves conflict with keep_client strategy', async () => {
      const { conflictId, inspectionId } = await createTestConflict();

      const res = await request(app)
        .post(`/api/conflicts/${conflictId}/resolve`)
        .set('Authorization', `Bearer ${supervisorToken}`)
        .send({
          resolutionStrategy: 'keep_client',
          notes: 'Supervisor verified technician on-site report and approved client fail state.',
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.message, 'Conflict resolved successfully');

      const { inspection, conflict } = res.body.resolution;
      assert.equal(conflict.status, 'resolved');
      assert.equal(inspection.has_pending_conflict, false);
      assert.equal(inspection.overall_result, 'fail'); // Client's state chosen
      assert.equal(inspection.version, 3); // Incremented v2 -> v3

      // Verify audit log has conflict_resolved record
      const inspDetailRes = await request(app)
        .get(`/api/inspections/${inspectionId}`)
        .set('Authorization', `Bearer ${supervisorToken}`);

      const auditTrail = inspDetailRes.body.inspection.auditHistory;
      const resolveAudit = auditTrail.find((a) => a.action === 'conflict_resolved');
      assert.ok(resolveAudit, 'Must record conflict_resolved action in audit history');
      assert.equal(resolveAudit.version, 3);
    });

    test('Supervisor resolves conflict with keep_server strategy', async () => {
      const { conflictId, inspectionId } = await createTestConflict();

      const res = await request(app)
        .post(`/api/conflicts/${conflictId}/resolve`)
        .set('Authorization', `Bearer ${supervisorToken}`)
        .send({
          resolutionStrategy: 'keep_server',
          notes: 'Server sensor telemetry verified, keeping server warning state.',
        });

      assert.equal(res.status, 200);
      const { inspection, conflict } = res.body.resolution;
      assert.equal(conflict.status, 'resolved');
      assert.equal(inspection.overall_result, 'warning'); // Server state preserved
      assert.equal(inspection.has_pending_conflict, false);
      assert.equal(inspection.version, 3);
    });

    test('Supervisor resolves conflict with custom_merge strategy', async () => {
      const { conflictId, inspectionId } = await createTestConflict();

      const res = await request(app)
        .post(`/api/conflicts/${conflictId}/resolve`)
        .set('Authorization', `Bearer ${supervisorToken}`)
        .send({
          resolutionStrategy: 'custom_merge',
          resolvedState: {
            status: 'completed',
            overall_result: 'warning',
            readings: { temperature_c: 62, vibration_mms: 2.3 },
            notes: 'Arbitrated compromise: flagged warning with adjusted temperature reading.',
          },
          notes: 'Supervisor reviewed logs and arbitrated consensus values.',
        });

      assert.equal(res.status, 200);
      const { inspection, conflict } = res.body.resolution;
      assert.equal(conflict.status, 'resolved');
      assert.equal(inspection.overall_result, 'warning');
      assert.equal(inspection.has_pending_conflict, false);
      assert.equal(inspection.notes, 'Arbitrated compromise: flagged warning with adjusted temperature reading.');
    });

    test('Re-resolving an already resolved conflict returns 400 Bad Request', async () => {
      const { conflictId } = await createTestConflict();

      // First resolution succeeds
      await request(app)
        .post(`/api/conflicts/${conflictId}/resolve`)
        .set('Authorization', `Bearer ${supervisorToken}`)
        .send({ resolutionStrategy: 'keep_server' });

      // Second resolution attempt fails
      const res = await request(app)
        .post(`/api/conflicts/${conflictId}/resolve`)
        .set('Authorization', `Bearer ${supervisorToken}`)
        .send({ resolutionStrategy: 'keep_client' });

      assert.equal(res.status, 400);
      assert.ok(res.body.message.includes('already resolved'));
    });
  });
});
