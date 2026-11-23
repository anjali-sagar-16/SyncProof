const { query, withTransaction } = require('../config/db');
const {
  isValidUuid,
  validateInspectionCreate,
  validateInspectionUpdate,
} = require('../utils/validators');

/**
 * GET /api/inspections
 * Lists inspections with optional filtering (equipment_id, inspector_id, status).
 * Accessible by both technicians and supervisors.
 */
async function listInspections(req, res, next) {
  try {
    const { equipment_id, inspector_id, status, has_pending_conflict } = req.query;

    let sql = `
      SELECT 
        i.id,
        i.equipment_id,
        e.code AS equipment_code,
        e.name AS equipment_name,
        e.location AS equipment_location,
        i.inspector_id,
        u.full_name AS inspector_name,
        u.email AS inspector_email,
        i.status,
        i.overall_result,
        i.readings,
        i.notes,
        i.version,
        i.has_pending_conflict,
        i.last_modified_by,
        m.full_name AS modifier_name,
        i.created_at,
        i.updated_at
      FROM inspections i
      JOIN equipment e ON i.equipment_id = e.id
      JOIN users u ON i.inspector_id = u.id
      LEFT JOIN users m ON i.last_modified_by = m.id
    `;

    const params = [];
    const conditions = [];

    if (equipment_id) {
      if (!isValidUuid(equipment_id)) {
        return res.status(400).json({ error: 'Bad Request', message: 'Invalid equipment_id format' });
      }
      params.push(equipment_id);
      conditions.push(`i.equipment_id = $${params.length}`);
    }

    if (inspector_id) {
      if (!isValidUuid(inspector_id)) {
        return res.status(400).json({ error: 'Bad Request', message: 'Invalid inspector_id format' });
      }
      params.push(inspector_id);
      conditions.push(`i.inspector_id = $${params.length}`);
    }

    if (status) {
      params.push(status);
      conditions.push(`i.status = $${params.length}`);
    }

    if (has_pending_conflict !== undefined) {
      params.push(has_pending_conflict === 'true');
      conditions.push(`i.has_pending_conflict = $${params.length}`);
    }

    if (conditions.length > 0) {
      sql += ` WHERE ` + conditions.join(' AND ');
    }

    sql += ` ORDER BY i.created_at DESC`;

    const result = await query(sql, params);

    res.status(200).json({
      count: result.rows.length,
      inspections: result.rows,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/inspections/:id
 * Retrieves a single inspection along with its equipment details and audit trail.
 */
async function getInspectionById(req, res, next) {
  try {
    const { id } = req.params;

    if (!isValidUuid(id)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid inspection ID format. Expected a valid UUID.',
      });
    }

    const inspRes = await query(
      `SELECT 
        i.id,
        i.equipment_id,
        e.code AS equipment_code,
        e.name AS equipment_name,
        e.location AS equipment_location,
        i.inspector_id,
        u.full_name AS inspector_name,
        u.email AS inspector_email,
        i.status,
        i.overall_result,
        i.readings,
        i.notes,
        i.version,
        i.has_pending_conflict,
        i.last_modified_by,
        m.full_name AS modifier_name,
        i.created_at,
        i.updated_at
      FROM inspections i
      JOIN equipment e ON i.equipment_id = e.id
      JOIN users u ON i.inspector_id = u.id
      LEFT JOIN users m ON i.last_modified_by = m.id
      WHERE i.id = $1`,
      [id]
    );

    if (inspRes.rows.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Inspection with ID '${id}' not found.`,
      });
    }

    // Fetch audit history
    const auditRes = await query(
      `SELECT a.id, a.action, a.version, a.previous_state, a.new_state, a.changed_fields, a.created_at, u.full_name as user_name
       FROM inspection_audit_logs a
       LEFT JOIN users u ON a.user_id = u.id
       WHERE a.inspection_id = $1
       ORDER BY a.version ASC, a.created_at ASC`,
      [id]
    );

    res.status(200).json({
      inspection: {
        ...inspRes.rows[0],
        auditHistory: auditRes.rows,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/inspections
 * Creates a new inspection record.
 * Allowed for technicians and supervisors. Sets version to 1.
 */
async function createInspection(req, res, next) {
  try {
    const validation = validateInspectionCreate(req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Validation failed for inspection creation.',
        errors: validation.errors,
      });
    }

    const {
      equipment_id,
      status = 'completed',
      overall_result = null,
      readings = {},
      notes = '',
    } = req.body;

    // Verify equipment exists
    const equipCheck = await query(`SELECT id FROM equipment WHERE id = $1`, [equipment_id]);
    if (equipCheck.rows.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Equipment with ID '${equipment_id}' does not exist.`,
      });
    }

    const inspectorId = req.user.id;
    const initialVersion = 1;
    const readingsJson = typeof readings === 'string' ? readings : JSON.stringify(readings);

    const createdInspection = await withTransaction(async (tx) => {
      // 1. Insert inspection
      const insertRes = await tx.query(
        `INSERT INTO inspections (
          equipment_id, inspector_id, status, overall_result, readings, notes, version, last_modified_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, equipment_id, inspector_id, status, overall_result, readings, notes, version, has_pending_conflict, created_at, updated_at;`,
        [
          equipment_id,
          inspectorId,
          status,
          overall_result,
          readingsJson,
          notes,
          initialVersion,
          inspectorId,
        ]
      );

      const inspection = insertRes.rows[0];

      // 2. Insert audit log
      await tx.query(
        `INSERT INTO inspection_audit_logs (
          inspection_id, user_id, action, version, new_state, changed_fields
        ) VALUES ($1, $2, $3, $4, $5, $6);`,
        [
          inspection.id,
          inspectorId,
          'created',
          initialVersion,
          JSON.stringify({ status, overall_result, readings, notes }),
          JSON.stringify(['status', 'overall_result', 'readings', 'notes']),
        ]
      );

      return inspection;
    });

    res.status(201).json({
      message: 'Inspection created successfully',
      inspection: createdInspection,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PUT /api/inspections/:id
 * Updates an existing inspection record with Optimistic Concurrency Control (OCC).
 * Rejects with HTTP 409 Conflict if baseVersion !== current version.
 * Increments version on success.
 */
async function updateInspection(req, res, next) {
  try {
    const { id } = req.params;

    if (!isValidUuid(id)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid inspection ID format. Expected a valid UUID.',
      });
    }

    const validation = validateInspectionUpdate(req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Validation failed for inspection update.',
        errors: validation.errors,
      });
    }

    const { versionNumber } = validation;
    const { status, overall_result, readings, notes } = req.body;

    // Fetch current record
    const currentRes = await query(
      `SELECT id, equipment_id, inspector_id, status, overall_result, readings, notes, version
       FROM inspections
       WHERE id = $1`,
      [id]
    );

    if (currentRes.rows.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Inspection with ID '${id}' not found.`,
      });
    }

    const current = currentRes.rows[0];

    // Permission enforcement: Technicians can only edit their own inspections
    if (req.user.role === 'technician' && current.inspector_id !== req.user.id) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Technicians are only permitted to edit their own inspection records.',
      });
    }

    // Optimistic Concurrency Control (OCC) Check
    if (current.version !== versionNumber) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'Inspection record has been modified by another user or session. Version conflict detected.',
        currentVersion: current.version,
        submittedVersion: versionNumber,
      });
    }

    // Determine new field values
    const newStatus = status !== undefined ? status : current.status;
    const newOverallResult = overall_result !== undefined ? overall_result : current.overall_result;
    const newReadings = readings !== undefined ? readings : current.readings;
    const newNotes = notes !== undefined ? notes : current.notes;
    const nextVersion = current.version + 1;

    // Track changed fields
    const changedFields = [];
    if (status !== undefined && status !== current.status) changedFields.push('status');
    if (overall_result !== undefined && overall_result !== current.overall_result) changedFields.push('overall_result');
    if (readings !== undefined) changedFields.push('readings');
    if (notes !== undefined && notes !== current.notes) changedFields.push('notes');

    const readingsJson = typeof newReadings === 'string' ? newReadings : JSON.stringify(newReadings);

    const updatedInspection = await withTransaction(async (tx) => {
      // 1. Update inspection atomically checking version in WHERE clause
      const updateRes = await tx.query(
        `UPDATE inspections
         SET status = $1,
             overall_result = $2,
             readings = $3,
             notes = $4,
             version = $5,
             last_modified_by = $6,
             updated_at = NOW()
         WHERE id = $7 AND version = $8
         RETURNING id, equipment_id, inspector_id, status, overall_result, readings, notes, version, has_pending_conflict, created_at, updated_at;`,
        [
          newStatus,
          newOverallResult,
          readingsJson,
          newNotes,
          nextVersion,
          req.user.id,
          id,
          current.version,
        ]
      );

      if (updateRes.rows.length === 0) {
        // Race condition occurred inside transaction
        throw { statusCode: 409, message: 'Concurrent modification conflict during transaction.' };
      }

      const updated = updateRes.rows[0];

      // 2. Insert audit log
      await tx.query(
        `INSERT INTO inspection_audit_logs (
          inspection_id, user_id, action, version, previous_state, new_state, changed_fields
        ) VALUES ($1, $2, $3, $4, $5, $6, $7);`,
        [
          id,
          req.user.id,
          'updated',
          nextVersion,
          JSON.stringify({
            status: current.status,
            overall_result: current.overall_result,
            readings: current.readings,
            notes: current.notes,
          }),
          JSON.stringify({
            status: newStatus,
            overall_result: newOverallResult,
            readings: newReadings,
            notes: newNotes,
          }),
          JSON.stringify(changedFields.length > 0 ? changedFields : ['updated']),
        ]
      );

      return updated;
    });

    res.status(200).json({
      message: 'Inspection updated successfully',
      inspection: updatedInspection,
    });
  } catch (error) {
    if (error.statusCode === 409) {
      return res.status(409).json({ error: 'Conflict', message: error.message });
    }
    next(error);
  }
}

module.exports = {
  listInspections,
  getInspectionById,
  createInspection,
  updateInspection,
};
