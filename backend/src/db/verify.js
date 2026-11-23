const bcrypt = require('bcryptjs');
const { getDb, close } = require('../config/db');

async function runVerification() {
  console.log('==============================================================');
  console.log('SyncProof Database Verification Suite');
  console.log('==============================================================\n');

  const db = await getDb();
  console.log(`[Verify] Connected via provider: ${db.clientType}\n`);

  let allPassed = true;

  try {
    // 1. Verify Tables Exist
    console.log('[Check 1] Verifying all 6 required tables exist in database...');
    const tablesRes = await db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);
    const foundTables = tablesRes.rows.map(r => r.table_name);
    const expectedTables = [
      'equipment',
      'inspection_audit_logs',
      'inspection_conflicts',
      'inspections',
      'sync_mutations',
      'users',
    ];

    const missingTables = expectedTables.filter(t => !foundTables.includes(t));
    if (missingTables.length === 0) {
      console.log(`  PASSED: All 6 required tables are present: [${foundTables.join(', ')}]`);
    } else {
      console.error(`  FAILED: Missing tables: [${missingTables.join(', ')}]`);
      allPassed = false;
    }

    // 2. Verify Seeded Users & Role Constraints
    console.log('\n[Check 2] Verifying seeded users, roles, and password hashing...');
    const usersRes = await db.query(`
      SELECT id, email, full_name, role, password_hash, created_at 
      FROM users 
      ORDER BY role, email;
    `);
    console.log(`  Found ${usersRes.rows.length} users:`);
    for (const u of usersRes.rows) {
      const isBcrypt = u.password_hash.startsWith('$2a$') || u.password_hash.startsWith('$2b$');
      const testPass = u.role === 'supervisor' ? 'Supervisor123!' : 'Technician123!';
      const passMatches = bcrypt.compareSync(testPass, u.password_hash);
      console.log(`    - ${u.email} | Role: ${u.role} | Hashed: ${isBcrypt} | Password Valid: ${passMatches} | ID: ${u.id}`);
      if (!isBcrypt || !passMatches) allPassed = false;
    }

    // 3. Verify Role Check Constraint
    console.log('\n[Check 3] Verifying CHECK constraint on user roles (rejecting invalid role)...');
    try {
      await db.query(`
        INSERT INTO users (email, password_hash, full_name, role)
        VALUES ('invalid@syncproof.internal', 'hash', 'Invalid Role', 'administrator');
      `);
      console.error('  FAILED: Database accepted invalid role "administrator"!');
      allPassed = false;
    } catch (err) {
      console.log(`  PASSED: Database correctly rejected invalid role: ${err.message}`);
    }

    // 4. Verify Equipment Catalog
    console.log('\n[Check 4] Verifying industrial equipment catalog...');
    const equipRes = await db.query(`
      SELECT id, code, name, location, status, serial_number 
      FROM equipment 
      ORDER BY code;
    `);
    console.log(`  Found ${equipRes.rows.length} equipment items:`);
    for (const eq of equipRes.rows) {
      console.log(`    - [${eq.code}] ${eq.name} | Location: ${eq.location} | Status: ${eq.status} | Serial: ${eq.serial_number}`);
    }
    if (equipRes.rows.length !== 4) allPassed = false;

    // 5. Verify Unique Code Constraint on Equipment
    console.log('\n[Check 5] Verifying UNIQUE constraint on equipment code...');
    try {
      await db.query(`
        INSERT INTO equipment (code, name, location)
        VALUES ('EQ-PUMP-001', 'Duplicate Pump', 'Sector X');
      `);
      console.error('  FAILED: Database allowed duplicate equipment code "EQ-PUMP-001"!');
      allPassed = false;
    } catch (err) {
      console.log(`  PASSED: Database correctly rejected duplicate code: ${err.message}`);
    }

    // 6. Verify Inspections and Foreign Keys
    console.log('\n[Check 6] Verifying inspection records, foreign keys, and JSONB readings...');
    const inspRes = await db.query(`
      SELECT 
        i.id, 
        i.version, 
        i.status, 
        i.overall_result, 
        i.readings, 
        i.notes, 
        i.has_pending_conflict,
        e.code AS equipment_code, 
        e.name AS equipment_name,
        u.full_name AS inspector_name,
        u.email AS inspector_email
      FROM inspections i
      JOIN equipment e ON i.equipment_id = e.id
      JOIN users u ON i.inspector_id = u.id
      ORDER BY i.created_at;
    `);
    console.log(`  Found ${inspRes.rows.length} inspections with joined foreign keys:`);
    for (const insp of inspRes.rows) {
      const readings = typeof insp.readings === 'string' ? JSON.parse(insp.readings) : insp.readings;
      console.log(`    - ID: ${insp.id} | Equip: ${insp.equipment_code} | Inspector: ${insp.inspector_name} | Result: ${insp.overall_result} | OCC Version: ${insp.version}`);
      console.log(`      Readings JSONB: ${JSON.stringify(readings)}`);
      console.log(`      Notes: "${insp.notes}"`);
    }
    if (inspRes.rows.length === 0) allPassed = false;

    // 7. Verify Audit Logs
    console.log('\n[Check 7] Verifying inspection audit log records...');
    const auditRes = await db.query(`
      SELECT a.id, a.action, a.version, a.inspection_id, u.email as user_email, a.created_at
      FROM inspection_audit_logs a
      LEFT JOIN users u ON a.user_id = u.id
      ORDER BY a.created_at;
    `);
    console.log(`  Found ${auditRes.rows.length} audit log entries:`);
    for (const log of auditRes.rows) {
      console.log(`    - Action: ${log.action} | Version: ${log.version} | Inspection ID: ${log.inspection_id} | User: ${log.user_email}`);
    }
    if (auditRes.rows.length === 0) allPassed = false;

    // 8. Verify Sync Mutations Idempotency Constraint
    console.log('\n[Check 8] Verifying sync_mutations table and client_mutation_id unique constraint...');
    const testMutationId = 'a0000000-0000-0000-0000-000000000001';
    const firstUserId = usersRes.rows[0].id;
    const firstInspId = inspRes.rows[0].id;

    await db.query(`
      INSERT INTO sync_mutations (client_mutation_id, user_id, entity_type, entity_id, action, status)
      VALUES ($1, $2, 'inspection', $3, 'update', 'applied');
    `, [testMutationId, firstUserId, firstInspId]);

    try {
      await db.query(`
        INSERT INTO sync_mutations (client_mutation_id, user_id, entity_type, entity_id, action, status)
        VALUES ($1, $2, 'inspection', $3, 'update', 'applied');
      `, [testMutationId, firstUserId, firstInspId]);
      console.error('  FAILED: Duplicate client_mutation_id was accepted!');
      allPassed = false;
    } catch (err) {
      console.log(`  PASSED: Idempotency constraint verified. Duplicate client_mutation_id rejected: ${err.message}`);
    }

    // Clean up test mutation record
    await db.query(`DELETE FROM sync_mutations WHERE client_mutation_id = $1;`, [testMutationId]);

    console.log('\n==============================================================');
    if (allPassed) {
      console.log('OVERALL RESULT: ALL CHECKS PASSED SUCCESSFULLY!');
    } else {
      console.log('OVERALL RESULT: SOME CHECKS FAILED!');
      process.exitCode = 1;
    }
    console.log('==============================================================\n');
  } catch (err) {
    console.error('[Verify] Verification encountered error:', err);
    process.exitCode = 1;
  } finally {
    await close();
  }
}

if (require.main === module) {
  runVerification();
}

module.exports = { runVerification };
