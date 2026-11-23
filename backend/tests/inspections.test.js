const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/app');
const { query, close } = require('../src/config/db');

describe('Milestone 3: Equipment & Inspection REST APIs with OCC Test Suite', () => {
  let tech1Token = '';
  let tech2Token = '';
  let supervisorToken = '';
  let tech1UserId = '';
  let tech2UserId = '';
  let equipmentPumpId = '';
  let equipmentGenId = '';
  let createdInspectionId = '';
  let tech2InspectionId = '';

  before(async () => {
    // 1. Log in tech1
    const resTech1 = await request(app)
      .post('/api/auth/login')
      .send({ email: 'tech1@syncproof.internal', password: 'Technician123!' });
    tech1Token = resTech1.body.token;
    tech1UserId = resTech1.body.user.id;

    // 2. Log in tech2
    const resTech2 = await request(app)
      .post('/api/auth/login')
      .send({ email: 'tech2@syncproof.internal', password: 'Technician123!' });
    tech2Token = resTech2.body.token;
    tech2UserId = resTech2.body.user.id;

    // 3. Log in supervisor
    const resSup = await request(app)
      .post('/api/auth/login')
      .send({ email: 'supervisor@syncproof.internal', password: 'Supervisor123!' });
    supervisorToken = resSup.body.token;

    // Fetch existing equipment IDs from database
    const equipRes = await query(`SELECT id, code FROM equipment WHERE code IN ('EQ-PUMP-001', 'EQ-GEN-003')`);
    for (const eq of equipRes.rows) {
      if (eq.code === 'EQ-PUMP-001') equipmentPumpId = eq.id;
      if (eq.code === 'EQ-GEN-003') equipmentGenId = eq.id;
    }
  });

  after(async () => {
    // Clean up created test inspections
    if (createdInspectionId) {
      await query(`DELETE FROM inspections WHERE id = $1`, [createdInspectionId]);
    }
    if (tech2InspectionId) {
      await query(`DELETE FROM inspections WHERE id = $1`, [tech2InspectionId]);
    }
    await close();
  });

  // ============================================================================
  // 1. Unauthenticated Requests
  // ============================================================================
  describe('Unauthenticated Access Control', () => {
    test('GET /api/equipment rejects unauthenticated request with 401', async () => {
      const res = await request(app).get('/api/equipment');
      assert.equal(res.status, 401);
      assert.equal(res.body.error, 'Unauthorized');
    });

    test('GET /api/equipment/:id rejects unauthenticated request with 401', async () => {
      const res = await request(app).get(`/api/equipment/${equipmentPumpId}`);
      assert.equal(res.status, 401);
      assert.equal(res.body.error, 'Unauthorized');
    });

    test('GET /api/inspections rejects unauthenticated request with 401', async () => {
      const res = await request(app).get('/api/inspections');
      assert.equal(res.status, 401);
      assert.equal(res.body.error, 'Unauthorized');
    });

    test('POST /api/inspections rejects unauthenticated request with 401', async () => {
      const res = await request(app)
        .post('/api/inspections')
        .send({ equipment_id: equipmentPumpId });
      assert.equal(res.status, 401);
      assert.equal(res.body.error, 'Unauthorized');
    });

    test('PUT /api/inspections/:id rejects unauthenticated request with 401', async () => {
      const res = await request(app)
        .put('/api/inspections/00000000-0000-0000-0000-000000000000')
        .send({ baseVersion: 1, notes: 'Attempt' });
      assert.equal(res.status, 401);
      assert.equal(res.body.error, 'Unauthorized');
    });
  });

  // ============================================================================
  // 2. Equipment Catalog APIs
  // ============================================================================
  describe('Equipment APIs', () => {
    test('GET /api/equipment returns equipment list for authenticated technician', async () => {
      const res = await request(app)
        .get('/api/equipment')
        .set('Authorization', `Bearer ${tech1Token}`);

      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.equipment));
      assert.ok(res.body.equipment.length >= 4);
      assert.ok(res.body.equipment.some(e => e.code === 'EQ-PUMP-001'));
    });

    test('GET /api/equipment/:id returns single equipment details and recent inspections', async () => {
      const res = await request(app)
        .get(`/api/equipment/${equipmentPumpId}`)
        .set('Authorization', `Bearer ${tech1Token}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.equipment.id, equipmentPumpId);
      assert.equal(res.body.equipment.code, 'EQ-PUMP-001');
      assert.ok(Array.isArray(res.body.equipment.recentInspections));
    });

    test('GET /api/equipment/:id with invalid UUID returns 400 Bad Request', async () => {
      const res = await request(app)
        .get('/api/equipment/not-a-valid-uuid')
        .set('Authorization', `Bearer ${tech1Token}`);

      assert.equal(res.status, 400);
      assert.equal(res.body.error, 'Bad Request');
    });

    test('GET /api/equipment/:id with non-existent UUID returns 404 Not Found', async () => {
      const res = await request(app)
        .get('/api/equipment/ffffffff-ffff-ffff-ffff-ffffffffffff')
        .set('Authorization', `Bearer ${tech1Token}`);

      assert.equal(res.status, 404);
      assert.equal(res.body.error, 'Not Found');
    });
  });

  // ============================================================================
  // 3. Inspection Creation APIs & Validation
  // ============================================================================
  describe('Inspection Creation & Input Validation', () => {
    test('POST /api/inspections creates a new inspection at version 1', async () => {
      const newInspectionPayload = {
        equipment_id: equipmentPumpId,
        status: 'completed',
        overall_result: 'pass',
        readings: { temperature_c: 44.0, pressure_psi: 86.5 },
        notes: 'Operational check on pump 1. Pressure optimal.',
      };

      const res = await request(app)
        .post('/api/inspections')
        .set('Authorization', `Bearer ${tech1Token}`)
        .send(newInspectionPayload);

      assert.equal(res.status, 201);
      assert.equal(res.body.message, 'Inspection created successfully');
      assert.equal(res.body.inspection.version, 1);
      assert.equal(res.body.inspection.equipment_id, equipmentPumpId);
      assert.equal(res.body.inspection.inspector_id, tech1UserId);
      assert.equal(res.body.inspection.status, 'completed');
      assert.equal(res.body.inspection.overall_result, 'pass');

      createdInspectionId = res.body.inspection.id;

      // Verify audit log was created in DB
      const auditRes = await query(
        `SELECT action, version FROM inspection_audit_logs WHERE inspection_id = $1`,
        [createdInspectionId]
      );
      assert.equal(auditRes.rows.length, 1);
      assert.equal(auditRes.rows[0].action, 'created');
      assert.equal(auditRes.rows[0].version, 1);
    });

    test('POST /api/inspections rejects missing equipment_id with 400', async () => {
      const res = await request(app)
        .post('/api/inspections')
        .set('Authorization', `Bearer ${tech1Token}`)
        .send({ status: 'completed' });

      assert.equal(res.status, 400);
      assert.equal(res.body.error, 'Bad Request');
      assert.ok(res.body.errors.some(e => e.includes('equipment_id is required')));
    });

    test('POST /api/inspections rejects invalid equipment_id UUID format with 400', async () => {
      const res = await request(app)
        .post('/api/inspections')
        .set('Authorization', `Bearer ${tech1Token}`)
        .send({ equipment_id: '12345' });

      assert.equal(res.status, 400);
      assert.equal(res.body.error, 'Bad Request');
    });

    test('POST /api/inspections rejects non-existent equipment_id with 404', async () => {
      const res = await request(app)
        .post('/api/inspections')
        .set('Authorization', `Bearer ${tech1Token}`)
        .send({ equipment_id: '00000000-0000-0000-0000-000000000000' });

      assert.equal(res.status, 404);
      assert.equal(res.body.error, 'Not Found');
    });

    test('POST /api/inspections rejects invalid status with 400', async () => {
      const res = await request(app)
        .post('/api/inspections')
        .set('Authorization', `Bearer ${tech1Token}`)
        .send({ equipment_id: equipmentPumpId, status: 'invalid_status' });

      assert.equal(res.status, 400);
      assert.equal(res.body.error, 'Bad Request');
    });

    test('POST /api/inspections rejects invalid overall_result with 400', async () => {
      const res = await request(app)
        .post('/api/inspections')
        .set('Authorization', `Bearer ${tech1Token}`)
        .send({ equipment_id: equipmentPumpId, overall_result: 'excellent' });

      assert.equal(res.status, 400);
      assert.equal(res.body.error, 'Bad Request');
    });

    test('POST /api/inspections rejects non-object readings with 400', async () => {
      const res = await request(app)
        .post('/api/inspections')
        .set('Authorization', `Bearer ${tech1Token}`)
        .send({ equipment_id: equipmentPumpId, readings: 'temperature 40' });

      assert.equal(res.status, 400);
      assert.equal(res.body.error, 'Bad Request');
    });
  });

  // ============================================================================
  // 4. Inspection Retrieval & Supervisor Review
  // ============================================================================
  describe('Inspection List & Review APIs', () => {
    test('GET /api/inspections allows supervisor to review all inspections', async () => {
      const res = await request(app)
        .get('/api/inspections')
        .set('Authorization', `Bearer ${supervisorToken}`);

      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.inspections));
      assert.ok(res.body.inspections.length >= 3);
      // Ensure joins include equipment and inspector names
      const sample = res.body.inspections[0];
      assert.ok(sample.equipment_code);
      assert.ok(sample.inspector_name);
    });

    test('GET /api/inspections/:id returns single inspection with full audit trail', async () => {
      const res = await request(app)
        .get(`/api/inspections/${createdInspectionId}`)
        .set('Authorization', `Bearer ${supervisorToken}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.inspection.id, createdInspectionId);
      assert.ok(Array.isArray(res.body.inspection.auditHistory));
      assert.equal(res.body.inspection.auditHistory.length, 1);
      assert.equal(res.body.inspection.auditHistory[0].action, 'created');
    });

    test('GET /api/inspections/:id with invalid UUID returns 400', async () => {
      const res = await request(app)
        .get('/api/inspections/invalid-uuid')
        .set('Authorization', `Bearer ${supervisorToken}`);

      assert.equal(res.status, 400);
      assert.equal(res.body.error, 'Bad Request');
    });

    test('GET /api/inspections/:id with non-existent UUID returns 404', async () => {
      const res = await request(app)
        .get('/api/inspections/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${supervisorToken}`);

      assert.equal(res.status, 404);
      assert.equal(res.body.error, 'Not Found');
    });
  });

  // ============================================================================
  // 5. Optimistic Concurrency Control (OCC) & Version Increment
  // ============================================================================
  describe('Optimistic Concurrency Control (OCC)', () => {
    test('PUT /api/inspections/:id rejects update when baseVersion is missing with 400', async () => {
      const res = await request(app)
        .put(`/api/inspections/${createdInspectionId}`)
        .set('Authorization', `Bearer ${tech1Token}`)
        .send({ notes: 'Updating without version' });

      assert.equal(res.status, 400);
      assert.equal(res.body.error, 'Bad Request');
      assert.ok(res.body.errors.some(e => e.includes('baseVersion')));
    });

    test('PUT /api/inspections/:id updates inspection and increments version 1 -> 2 when baseVersion matches', async () => {
      const updatePayload = {
        baseVersion: 1,
        status: 'completed',
        overall_result: 'warning',
        readings: { temperature_c: 58.2, pressure_psi: 91.0 },
        notes: 'Temperature elevated during peak cycle. Flagged for review.',
      };

      const res = await request(app)
        .put(`/api/inspections/${createdInspectionId}`)
        .set('Authorization', `Bearer ${tech1Token}`)
        .send(updatePayload);

      assert.equal(res.status, 200);
      assert.equal(res.body.message, 'Inspection updated successfully');
      assert.equal(res.body.inspection.version, 2);
      assert.equal(res.body.inspection.overall_result, 'warning');
      assert.equal(res.body.inspection.notes, 'Temperature elevated during peak cycle. Flagged for review.');

      // Verify audit log has two records: created (v1) and updated (v2)
      const auditRes = await query(
        `SELECT action, version FROM inspection_audit_logs WHERE inspection_id = $1 ORDER BY version ASC`,
        [createdInspectionId]
      );
      assert.equal(auditRes.rows.length, 2);
      assert.equal(auditRes.rows[0].version, 1);
      assert.equal(auditRes.rows[1].action, 'updated');
      assert.equal(auditRes.rows[1].version, 2);
    });

    test('PUT /api/inspections/:id rejects stale update with HTTP 409 Conflict', async () => {
      // The inspection is now at version 2. Submitting baseVersion: 1 must be rejected!
      const stalePayload = {
        baseVersion: 1,
        notes: 'Stale offline edit attempting to overwrite version 2',
      };

      const res = await request(app)
        .put(`/api/inspections/${createdInspectionId}`)
        .set('Authorization', `Bearer ${tech1Token}`)
        .send(stalePayload);

      assert.equal(res.status, 409);
      assert.equal(res.body.error, 'Conflict');
      assert.equal(res.body.currentVersion, 2);
      assert.equal(res.body.submittedVersion, 1);
      assert.ok(res.body.message.includes('Version conflict detected'));

      // Verify DB was NOT modified by the rejected stale request
      const checkRes = await query(`SELECT version, notes FROM inspections WHERE id = $1`, [createdInspectionId]);
      assert.equal(checkRes.rows[0].version, 2);
      assert.equal(checkRes.rows[0].notes, 'Temperature elevated during peak cycle. Flagged for review.');
    });

    test('Concurrent edit simulation: first update wins (v2 -> v3), second update fails with 409', async () => {
      // Both sessions read version 2
      const payloadSessionA = { baseVersion: 2, notes: 'Session A commit' };
      const payloadSessionB = { baseVersion: 2, notes: 'Session B commit' };

      // Session A sends update
      const resA = await request(app)
        .put(`/api/inspections/${createdInspectionId}`)
        .set('Authorization', `Bearer ${tech1Token}`)
        .send(payloadSessionA);

      assert.equal(resA.status, 200);
      assert.equal(resA.body.inspection.version, 3);
      assert.equal(resA.body.inspection.notes, 'Session A commit');

      // Session B sends update with stale baseVersion 2
      const resB = await request(app)
        .put(`/api/inspections/${createdInspectionId}`)
        .set('Authorization', `Bearer ${tech1Token}`)
        .send(payloadSessionB);

      assert.equal(resB.status, 409);
      assert.equal(resB.body.error, 'Conflict');
      assert.equal(resB.body.currentVersion, 3);
      assert.equal(resB.body.submittedVersion, 2);
    });
  });

  // ============================================================================
  // 6. Role Permissions & Ownership Guards
  // ============================================================================
  describe('Permissions & Ownership Guards', () => {
    before(async () => {
      // Create inspection owned by tech2
      const res = await request(app)
        .post('/api/inspections')
        .set('Authorization', `Bearer ${tech2Token}`)
        .send({
          equipment_id: equipmentGenId,
          status: 'completed',
          overall_result: 'pass',
          notes: 'Inspection performed by Tech2 Jordan Lee',
        });
      tech2InspectionId = res.body.inspection.id;
    });

    test('Technician 1 cannot edit Technician 2 inspection (403 Forbidden)', async () => {
      const res = await request(app)
        .put(`/api/inspections/${tech2InspectionId}`)
        .set('Authorization', `Bearer ${tech1Token}`)
        .send({ baseVersion: 1, notes: 'Tech1 unauthorized tampering' });

      assert.equal(res.status, 403);
      assert.equal(res.body.error, 'Forbidden');
      assert.ok(res.body.message.includes('Technicians are only permitted to edit their own'));
    });

    test('Supervisor CAN edit Technician 2 inspection for authorized review (200 OK)', async () => {
      const res = await request(app)
        .put(`/api/inspections/${tech2InspectionId}`)
        .set('Authorization', `Bearer ${supervisorToken}`)
        .send({
          baseVersion: 1,
          notes: 'Supervisor Morgan Davis reviewed and approved.',
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.inspection.version, 2);
      assert.equal(res.body.inspection.notes, 'Supervisor Morgan Davis reviewed and approved.');
    });
  });

  // ============================================================================
  // 7. Database Persistence
  // ============================================================================
  describe('Database Persistence Verification', () => {
    test('Persisted records retain incremented version, updated timestamps, and audit history', async () => {
      const res = await request(app)
        .get(`/api/inspections/${createdInspectionId}`)
        .set('Authorization', `Bearer ${supervisorToken}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.inspection.version, 3);
      assert.equal(res.body.inspection.notes, 'Session A commit');
      assert.ok(res.body.inspection.auditHistory.length >= 3);
    });
  });
});
