const bcrypt = require('bcryptjs');
const { getDb, withTransaction, close } = require('../config/db');

// Development-only credentials (clearly documented for testing)
const SEED_USERS = [
  {
    email: 'tech1@syncproof.internal',
    password: 'Technician123!',
    fullName: 'Alex Rivera',
    role: 'technician',
  },
  {
    email: 'tech2@syncproof.internal',
    password: 'Technician123!',
    fullName: 'Jordan Lee',
    role: 'technician',
  },
  {
    email: 'supervisor@syncproof.internal',
    password: 'Supervisor123!',
    fullName: 'Morgan Davis',
    role: 'supervisor',
  },
];

const SEED_EQUIPMENT = [
  {
    code: 'EQ-PUMP-001',
    name: 'High-Pressure Water Pump #1',
    location: 'Sector B - Water Treatment',
    serialNumber: 'SN-PUMP-2024-8841',
    status: 'active',
  },
  {
    code: 'EQ-COMP-002',
    name: 'Rotary Screw Air Compressor #2',
    location: 'Plant 1 - Compressor Room',
    serialNumber: 'SN-COMP-2023-1102',
    status: 'active',
  },
  {
    code: 'EQ-GEN-003',
    name: 'Emergency Backup Diesel Generator',
    location: 'Power Station Sub-Level 2',
    serialNumber: 'SN-GEN-2022-9904',
    status: 'maintenance',
  },
  {
    code: 'EQ-CONV-004',
    name: 'Main Assembly Conveyor Belt 4',
    location: 'Assembly Line 3',
    serialNumber: 'SN-CONV-2021-4411',
    status: 'active',
  },
];

async function runSeed() {
  console.log('[Seed] Starting database seeding...');
  const db = await getDb();
  console.log(`[Seed] Database connection active using provider: ${db.clientType}`);

  try {
    const userMap = {};
    const equipmentMap = {};

    await withTransaction(async (tx) => {
      // 1. Seed Users (with secure bcrypt hashes)
      console.log('[Seed] Seeding development users...');
      for (const u of SEED_USERS) {
        const salt = bcrypt.genSaltSync(10);
        const passwordHash = bcrypt.hashSync(u.password, salt);

        const res = await tx.query(
          `INSERT INTO users (email, password_hash, full_name, role)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (email) DO UPDATE 
           SET full_name = EXCLUDED.full_name,
               password_hash = EXCLUDED.password_hash,
               updated_at = NOW()
           RETURNING id, email, role;`,
          [u.email, passwordHash, u.fullName, u.role]
        );
        userMap[u.email] = res.rows[0].id;
        console.log(`  - Seeded user: ${u.email} (${u.role}) -> ${res.rows[0].id}`);
      }

      // 2. Seed Equipment
      console.log('[Seed] Seeding industrial equipment catalog...');
      for (const eq of SEED_EQUIPMENT) {
        const res = await tx.query(
          `INSERT INTO equipment (code, name, location, serial_number, status)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (code) DO UPDATE
           SET name = EXCLUDED.name,
               location = EXCLUDED.location,
               serial_number = EXCLUDED.serial_number,
               status = EXCLUDED.status,
               updated_at = NOW()
           RETURNING id, code;`,
          [eq.code, eq.name, eq.location, eq.serialNumber, eq.status]
        );
        equipmentMap[eq.code] = res.rows[0].id;
        console.log(`  - Seeded equipment: ${eq.code} -> ${res.rows[0].id}`);
      }

      // 3. Seed Baseline Inspections (if not already seeded)
      console.log('[Seed] Seeding baseline inspection records...');
      const existingInspections = await tx.query(`SELECT COUNT(*) as count FROM inspections;`);
      if (parseInt(existingInspections.rows[0].count, 10) === 0) {
        // Inspection 1: Passed inspection for EQ-PUMP-001 by Alex Rivera (tech1)
        const insp1 = await tx.query(
          `INSERT INTO inspections (
             equipment_id, inspector_id, status, overall_result, readings, notes, version, has_pending_conflict
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id, version;`,
          [
            equipmentMap['EQ-PUMP-001'],
            userMap['tech1@syncproof.internal'],
            'completed',
            'pass',
            JSON.stringify({ temperature_c: 42.5, pressure_psi: 85.0, vibration_mms: 1.2 }),
            'Routine 500-hour inspection completed. Impeller bearings running smoothly.',
            1,
            false,
          ]
        );

        // Audit log for Inspection 1
        await tx.query(
          `INSERT INTO inspection_audit_logs (
             inspection_id, user_id, action, version, new_state, changed_fields
           ) VALUES ($1, $2, $3, $4, $5, $6);`,
          [
            insp1.rows[0].id,
            userMap['tech1@syncproof.internal'],
            'created',
            1,
            JSON.stringify({ status: 'completed', overall_result: 'pass' }),
            JSON.stringify(['status', 'overall_result', 'readings', 'notes']),
          ]
        );
        console.log(`  - Seeded inspection 1 (pass) for EQ-PUMP-001 -> ${insp1.rows[0].id}`);

        // Inspection 2: Warning inspection for EQ-GEN-003 by Jordan Lee (tech2)
        const insp2 = await tx.query(
          `INSERT INTO inspections (
             equipment_id, inspector_id, status, overall_result, readings, notes, version, has_pending_conflict
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id, version;`,
          [
            equipmentMap['EQ-GEN-003'],
            userMap['tech2@syncproof.internal'],
            'completed',
            'warning',
            JSON.stringify({ battery_voltage_v: 11.8, oil_pressure_psi: 28.0, run_hours: 1420 }),
            'Battery voltage is below recommended 12.6V threshold. Scheduled battery replacement.',
            1,
            false,
          ]
        );

        // Audit log for Inspection 2
        await tx.query(
          `INSERT INTO inspection_audit_logs (
             inspection_id, user_id, action, version, new_state, changed_fields
           ) VALUES ($1, $2, $3, $4, $5, $6);`,
          [
            insp2.rows[0].id,
            userMap['tech2@syncproof.internal'],
            'created',
            1,
            JSON.stringify({ status: 'completed', overall_result: 'warning' }),
            JSON.stringify(['status', 'overall_result', 'readings', 'notes']),
          ]
        );
        console.log(`  - Seeded inspection 2 (warning) for EQ-GEN-003 -> ${insp2.rows[0].id}`);
      } else {
        console.log(`  - Baseline inspections already exist (${existingInspections.rows[0].count} found). Skipping inspection re-insertion.`);
      }
    });

    console.log('[Seed] Seeding completed successfully!');
  } catch (error) {
    console.error('[Seed] Seeding failed with error:', error);
    process.exitCode = 1;
  } finally {
    await close();
  }
}

if (require.main === module) {
  runSeed();
}

module.exports = { runSeed };
