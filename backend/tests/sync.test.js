const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/app');
const { query, close } = require('../src/config/db');

describe('Milestone 4: Sync Engine, Idempotency & 3-Way Merge Test Suite', () => {
  let tech1Token = '';
  let tech2Token = '';
  let supervisorToken = '';
  let tech1UserId = '';
  let tech2UserId = '';
  let equipmentPumpId = '';
  let equipmentGenId = '';

  const trackedInspections = [];
  const trackedMutations = [];

  before(async () => {
    // 1. Authenticate users
    const resTech1 = await request(app)
      .post('/api/auth/login')
      .send({ email: 'tech1@syncproof.internal', password: 'Technician123!' });
    tech1Token = resTech1.body.token;
    tech1UserId = resTech1.body.user.id;

    const resTech2 = await request(app)
      .post('/api/auth/login')
      .send({ email: 'tech2@syncproof.internal', password: 'Technician123!' });
    tech2Token = resTech2.body.token;
    tech2UserId = resTech2.body.user.id;

    const resSup = await request(app)
      .post('/api/auth/login')
      .send({ email: 'supervisor@syncproof.internal', password: 'Supervisor123!' });
    supervisorToken = resSup.body.token;

    // 2. Fetch equipment IDs
    const equipRes = await query(`SELECT id, code FROM equipment WHERE code IN ('EQ-PUMP-001', 'EQ-GEN-003')`);
    for (const eq of equipRes.rows) {
      if (eq.code === 'EQ-PUMP-001') equipmentPumpId = eq.id;
      if (eq.code === 'EQ-GEN-003') equipmentGenId = eq.id;
    }
  });

  after(async () => {
    // Clean up created test entities
    for (const id of trackedInspections) {
      await query(`DELETE FROM inspections WHERE id = $1`, [id]);
    }
    for (const mutId of trackedMutations) {
      await query(`DELETE FROM sync_mutations WHERE client_mutation_id = $1`, [mutId]);
    }
    await close();
  });

  // ============================================================================
  // 1. Access Control & Payload Validation
  // ============================================================================
  describe('Sync API Access Control & Validation', () => {
    test('POST /api/sync rejects unauthenticated request with 401', async () => {
      const res = await request(app)
        .post('/api/sync')
        .send({ mutations: [] });

      assert.equal(res.status, 401);
      assert.equal(res.body.error, 'Unauthorized');
    });

    test('POST /api/sync rejects request missing mutations array with 400', async () => {
      const res = await request(app)
        .post('/api/sync')
        .set('Authorization', `Bearer ${tech1Token}`)
        .send({ invalidField: true });

      assert.equal(res.status, 400);
      assert.equal(res.body.error, 'Bad Request');
    });

    test('POST /api/sync handles empty mutations array with 200', async () => {
      const res = await request(app)
        .post('/api/sync')
        .set('Authorization', `Bearer ${tech1Token}`)
        .send({ mutations: [] });

      assert.equal(res.status, 200);
      assert.equal(res.body.processed, 0);
      assert.deepEqual(res.body.results, []);
    });
  });

  // ============================================================================
  // 2. Offline Create Mutation & Idempotency
  // ============================================================================
  describe('Offline Create Mutation & Idempotency', () => {
    const createMutationId = 'c1000000-0000-0000-0000-000000000001';
    let createdInspId = '';

    test('Processes offline create mutation, initializes version 1, and logs audit record', async () => {
      trackedMutations.push(createMutationId);

      const res = await request(app)
        .post('/api/sync')
        .set('Authorization', `Bearer ${tech1Token}`)
        .send({
          mutations: [
            {
              clientMutationId: createMutationId,
              action: 'create',
              equipmentId: equipmentPumpId,
              status: 'completed',
              overall_result: 'pass',
              readings: { temp_c: 41.5, pressure_psi: 88.0 },
              notes: 'Recorded in offline queue.',
            },
          ],
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.processed, 1);
      const result = res.body.results[0];
      assert.equal(result.clientMutationId, createMutationId);
      assert.equal(result.status, 'applied');
      assert.ok(result.inspection);
      assert.equal(result.inspection.version, 1);
      assert.equal(result.inspection.equipment_id, equipmentPumpId);

      createdInspId = result.inspection.id;
      trackedInspections.push(createdInspId);

      // Verify sync_mutations record in DB
      const mutDb = await query(`SELECT status FROM sync_mutations WHERE client_mutation_id = $1`, [createMutationId]);
      assert.equal(mutDb.rows.length, 1);
      assert.equal(mutDb.rows[0].status, 'applied');

      // Verify audit log
      const auditDb = await query(`SELECT action, version FROM inspection_audit_logs WHERE inspection_id = $1`, [createdInspId]);
      assert.equal(auditDb.rows.length, 1);
      assert.equal(auditDb.rows[0].action, 'created');
    });

    test('Replaying same create mutation returns cached result without duplicating inspection or audit log', async () => {
      const res = await request(app)
        .post('/api/sync')
        .set('Authorization', `Bearer ${tech1Token}`)
        .send({
          mutations: [
            {
              clientMutationId: createMutationId, // Same mutation ID
              action: 'create',
              equipmentId: equipmentPumpId,
              status: 'completed',
            },
          ],
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.processed, 1);
      const result = res.body.results[0];
      assert.equal(result.clientMutationId, createMutationId);
      assert.equal(result.replayed, true);
      assert.equal(result.status, 'applied');
      assert.equal(result.entityId, createdInspId);

      // Verify no duplicate inspection was created
      const countRes = await query(`SELECT COUNT(*) as count FROM sync_mutations WHERE client_mutation_id = $1`, [createMutationId]);
      assert.equal(Number(countRes.rows[0].count), 1);

      // Verify audit log count did not increase
      const auditRes = await query(`SELECT COUNT(*) as count FROM inspection_audit_logs WHERE inspection_id = $1`, [createdInspId]);
      assert.equal(Number(auditRes.rows[0].count), 1);
    });
  });

  // ============================================================================
  // 3. Clean Update Mutation & Idempotency
  // ============================================================================
  describe('Clean Update Mutation & Idempotency', () => {
    let testInspId = '';
    const updateMutationId = 'a1000000-0000-0000-0000-000000000001';

    before(async () => {
      // Create baseline inspection
      const ins = await query(
        `INSERT INTO inspections (equipment_id, inspector_id, status, overall_result, readings, notes, version, last_modified_by)
         VALUES ($1, $2, 'completed', 'pass', '{"vibration": 1.0}'::jsonb, 'Initial note', 1, $2)
         RETURNING id;`,
        [equipmentPumpId, tech1UserId]
      );
      testInspId = ins.rows[0].id;
      trackedInspections.push(testInspId);
    });

    test('Processes clean update mutation, increments version 1 -> 2, and logs audit record', async () => {
      trackedMutations.push(updateMutationId);

      const res = await request(app)
        .post('/api/sync')
        .set('Authorization', `Bearer ${tech1Token}`)
        .send({
          mutations: [
            {
              clientMutationId: updateMutationId,
              action: 'update',
              entityId: testInspId,
              baseVersion: 1,
              changes: {
                notes: 'Updated note via sync',
                readings: { vibration: 1.4 },
              },
            },
          ],
        });

      assert.equal(res.status, 200);
      const result = res.body.results[0];
      assert.equal(result.status, 'applied');
      assert.equal(result.inspection.version, 2);
      assert.equal(result.inspection.notes, 'Updated note via sync');

      // Check DB
      const dbRecord = await query(`SELECT version, notes FROM inspections WHERE id = $1`, [testInspId]);
      assert.equal(dbRecord.rows[0].version, 2);

      // Check audit log
      const auditRes = await query(`SELECT action, version FROM inspection_audit_logs WHERE inspection_id = $1 AND version = 2`, [testInspId]);
      assert.equal(auditRes.rows.length, 1);
      assert.equal(auditRes.rows[0].action, 'updated');
    });

    test('Replaying same update mutation returns original result without double-incrementing version', async () => {
      const res = await request(app)
        .post('/api/sync')
        .set('Authorization', `Bearer ${tech1Token}`)
        .send({
          mutations: [
            {
              clientMutationId: updateMutationId, // Replayed ID
              action: 'update',
              entityId: testInspId,
              baseVersion: 1,
              changes: { notes: 'Updated note via sync' },
            },
          ],
        });

      assert.equal(res.status, 200);
      const result = res.body.results[0];
      assert.equal(result.replayed, true);
      assert.equal(result.status, 'applied');

      // Ensure version in DB is STILL 2 (not 3)
      const dbRecord = await query(`SELECT version FROM inspections WHERE id = $1`, [testInspId]);
      assert.equal(dbRecord.rows[0].version, 2);
    });
  });

  // ============================================================================
  // 4. Three-Way Auto-Merge (Disjoint Field Changes)
  // ============================================================================
  describe('Three-Way Auto-Merge (Disjoint Changes)', () => {
    let mergeInspId = '';
    const mergeMutationId = 'd1000000-0000-0000-0000-000000000001';

    before(async () => {
      // 1. Create inspection at version 1
      const ins = await query(
        `INSERT INTO inspections (equipment_id, inspector_id, status, overall_result, readings, notes, version, last_modified_by)
         VALUES ($1, $2, 'scheduled', 'pass', '{"temp": 40, "pressure": 80}'::jsonb, 'Baseline note', 1, $2)
         RETURNING id;`,
        [equipmentPumpId, tech1UserId]
      );
      mergeInspId = ins.rows[0].id;
      trackedInspections.push(mergeInspId);

      // Record version 1 in audit log
      await query(
        `INSERT INTO inspection_audit_logs (inspection_id, user_id, action, version, new_state)
         VALUES ($1, $2, 'created', 1, '{"status": "scheduled", "overall_result": "pass", "notes": "Baseline note", "readings": {"temp": 40, "pressure": 80}}'::jsonb);`,
        [mergeInspId, tech1UserId]
      );

      // 2. Simulate concurrent online server edit (Server bumps version 1 -> 2, changes status & pressure)
      await query(
        `UPDATE inspections
         SET status = 'in_progress',
             readings = '{"temp": 40, "pressure": 95}'::jsonb,
             version = 2,
             updated_at = NOW()
         WHERE id = $1;`,
        [mergeInspId]
      );

      await query(
        `INSERT INTO inspection_audit_logs (inspection_id, user_id, action, version, new_state)
         VALUES ($1, $2, 'updated', 2, '{"status": "in_progress", "overall_result": "pass", "notes": "Baseline note", "readings": {"temp": 40, "pressure": 95}}'::jsonb);`,
        [mergeInspId, tech1UserId]
      );
    });

    test('Safely auto-merges disjoint edits (Client edited notes & temp, Server edited status & pressure)', async () => {
      trackedMutations.push(mergeMutationId);

      // Technician was offline since version 1:
      // Client changed notes to 'Technician offline report' and readings.temp to 48
      const res = await request(app)
        .post('/api/sync')
        .set('Authorization', `Bearer ${tech1Token}`)
        .send({
          mutations: [
            {
              clientMutationId: mergeMutationId,
              action: 'update',
              entityId: mergeInspId,
              baseVersion: 1, // Stale base version
              baseState: {
                status: 'scheduled',
                overall_result: 'pass',
                notes: 'Baseline note',
                readings: { temp: 40, pressure: 80 },
              },
              clientState: {
                status: 'scheduled', // Client didn't touch status
                overall_result: 'pass', // Client didn't touch result
                notes: 'Technician offline report', // Client changed notes
                readings: { temp: 48, pressure: 80 }, // Client changed temp
              },
            },
          ],
        });

      assert.equal(res.status, 200);
      const result = res.body.results[0];
      assert.equal(result.status, 'merged');
      assert.equal(result.inspection.version, 3); // Incremented from server's 2 -> 3
      assert.equal(result.inspection.status, 'in_progress'); // Preserved server status
      assert.equal(result.inspection.notes, 'Technician offline report'); // Merged client notes

      // Readings should have both changes: temp = 48 (client) AND pressure = 95 (server)
      const readings = typeof result.inspection.readings === 'string'
        ? JSON.parse(result.inspection.readings)
        : result.inspection.readings;
      assert.equal(readings.temp, 48);
      assert.equal(readings.pressure, 95);

      // Verify audit log has 'auto_merged' record
      const auditRes = await query(
        `SELECT action, version FROM inspection_audit_logs WHERE inspection_id = $1 AND version = 3`,
        [mergeInspId]
      );
      assert.equal(auditRes.rows.length, 1);
      assert.equal(auditRes.rows[0].action, 'auto_merged');
      assert.equal(auditRes.rows[0].version, 3);
    });
  });

  // ============================================================================
  // 5. Conflict Detection & Flagging (Colliding Field Changes)
  // ============================================================================
  describe('Conflict Detection & Collision Flagging', () => {
    let conflictInspId = '';
    const conflictMutationId = 'f1000000-0000-0000-0000-000000000001';

    before(async () => {
      // Create inspection currently at version 2 on server with overall_result: 'pass'
      const ins = await query(
        `INSERT INTO inspections (equipment_id, inspector_id, status, overall_result, readings, notes, version, last_modified_by)
         VALUES ($1, $2, 'completed', 'pass', '{"temp": 50}'::jsonb, 'Server evaluated pass', 2, $2)
         RETURNING id;`,
        [equipmentPumpId, tech1UserId]
      );
      conflictInspId = ins.rows[0].id;
      trackedInspections.push(conflictInspId);
    });

    test('Detects colliding edit on overall_result, flags inspection with pending conflict, and logs conflict audit event', async () => {
      trackedMutations.push(conflictMutationId);

      // Offline client based on baseVersion 1 proposes overall_result: 'fail' (collides with server's 'pass')
      const res = await request(app)
        .post('/api/sync')
        .set('Authorization', `Bearer ${tech1Token}`)
        .send({
          mutations: [
            {
              clientMutationId: conflictMutationId,
              action: 'update',
              entityId: conflictInspId,
              baseVersion: 1,
              baseState: {
                status: 'in_progress',
                overall_result: null,
                notes: 'Initial',
                readings: { temp: 40 },
              },
              clientState: {
                status: 'completed',
                overall_result: 'fail', // Collides with server's 'pass'
                notes: 'Critical vibration detected',
                readings: { temp: 65 },
              },
            },
          ],
        });

      assert.equal(res.status, 200);
      const result = res.body.results[0];
      assert.equal(result.status, 'conflicted');
      assert.ok(result.conflictId);
      assert.ok(result.conflictingFields.includes('overall_result'));

      // 1. Verify inspection in DB was NOT silently overwritten!
      const dbInsp = await query(`SELECT overall_result, version, has_pending_conflict FROM inspections WHERE id = $1`, [conflictInspId]);
      assert.equal(dbInsp.rows[0].overall_result, 'pass'); // Kept server value
      assert.equal(dbInsp.rows[0].version, 2); // Version NOT incremented
      assert.equal(dbInsp.rows[0].has_pending_conflict, true); // Flagged!

      // 2. Verify inspection_conflicts row was created
      const confRes = await query(
        `SELECT id, status, conflicting_fields, server_version, base_version FROM inspection_conflicts WHERE id = $1`,
        [result.conflictId]
      );
      assert.equal(confRes.rows.length, 1);
      assert.equal(confRes.rows[0].status, 'pending');
      assert.equal(confRes.rows[0].server_version, 2);
      assert.equal(confRes.rows[0].base_version, 1);

      // 3. Verify audit log entry for conflict flagging
      const auditRes = await query(
        `SELECT action FROM inspection_audit_logs WHERE inspection_id = $1 AND action = 'conflict_flagged'`,
        [conflictInspId]
      );
      assert.equal(auditRes.rows.length, 1);
    });

    test('Replaying conflicting mutation returns cached conflict result without creating duplicate conflict records', async () => {
      const res = await request(app)
        .post('/api/sync')
        .set('Authorization', `Bearer ${tech1Token}`)
        .send({
          mutations: [
            {
              clientMutationId: conflictMutationId,
              action: 'update',
              entityId: conflictInspId,
              baseVersion: 1,
            },
          ],
        });

      assert.equal(res.status, 200);
      const result = res.body.results[0];
      assert.equal(result.replayed, true);
      assert.equal(result.status, 'conflicted');

      // Verify no duplicate row in inspection_conflicts
      const countRes = await query(
        `SELECT COUNT(*) as count FROM inspection_conflicts WHERE client_mutation_id = $1`,
        [conflictMutationId]
      );
      assert.equal(Number(countRes.rows[0].count), 1);
    });
  });

  // ============================================================================
  // 6. Ownership & Permission Enforcement
  // ============================================================================
  describe('Permissions Enforcement in Sync', () => {
    let tech2InspId = '';
    const unauthorizedMutationId = 'e1000000-0000-0000-0000-000000000001';

    before(async () => {
      // Create inspection owned by tech2
      const ins = await query(
        `INSERT INTO inspections (equipment_id, inspector_id, status, overall_result, readings, notes, version, last_modified_by)
         VALUES ($1, $2, 'completed', 'pass', '{}'::jsonb, 'Owned by Tech2', 1, $2)
         RETURNING id;`,
        [equipmentGenId, tech2UserId]
      );
      tech2InspId = ins.rows[0].id;
      trackedInspections.push(tech2InspId);
    });

    test('Rejects update mutation when technician attempts to edit another technician inspection', async () => {
      trackedMutations.push(unauthorizedMutationId);

      const res = await request(app)
        .post('/api/sync')
        .set('Authorization', `Bearer ${tech1Token}`) // tech1 trying to edit tech2
        .send({
          mutations: [
            {
              clientMutationId: unauthorizedMutationId,
              action: 'update',
              entityId: tech2InspId,
              baseVersion: 1,
              changes: { notes: 'Unauthorized edit' },
            },
          ],
        });

      assert.equal(res.status, 200);
      const result = res.body.results[0];
      assert.equal(result.status, 'rejected');
      assert.ok(result.error.includes('Technicians are only permitted to edit their own'));

      // Check sync_mutations has recorded rejection for idempotency
      const mutRes = await query(`SELECT status FROM sync_mutations WHERE client_mutation_id = $1`, [unauthorizedMutationId]);
      assert.equal(mutRes.rows.length, 1);
      assert.equal(mutRes.rows[0].status, 'rejected');
    });
  });

  // ============================================================================
  // 7. Batch Processing
  // ============================================================================
  describe('Batch Sync Processing', () => {
    test('Successfully processes multiple mutations in a single batch request', async () => {
      const mutId1 = 'b1000000-0000-0000-0000-000000000001';
      const mutId2 = 'b2000000-0000-0000-0000-000000000002';
      trackedMutations.push(mutId1, mutId2);

      const res = await request(app)
        .post('/api/sync')
        .set('Authorization', `Bearer ${tech1Token}`)
        .send({
          mutations: [
            {
              clientMutationId: mutId1,
              action: 'create',
              equipmentId: equipmentPumpId,
              status: 'in_progress',
              notes: 'Batch create item',
            },
            {
              clientMutationId: mutId2,
              action: 'create',
              equipmentId: equipmentGenId,
              status: 'completed',
              overall_result: 'pass',
              notes: 'Batch create item 2',
            },
          ],
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.processed, 2);
      assert.equal(res.body.results.length, 2);
      assert.equal(res.body.results[0].status, 'applied');
      assert.equal(res.body.results[1].status, 'applied');

      trackedInspections.push(res.body.results[0].entityId);
      trackedInspections.push(res.body.results[1].entityId);
    });
  });
});
