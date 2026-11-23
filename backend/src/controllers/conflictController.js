const { query, withTransaction } = require('../config/db');
const { isValidUuid } = require('../utils/validators');

/**
 * GET /api/conflicts
 * Lists inspection conflicts.
 * Supervisors can see all conflicts. Technicians see conflicts for their inspections.
 * Optional query parameter: status ('pending', 'resolved', 'dismissed', 'all')
 */
async function listConflicts(req, res, next) {
  try {
    const { status = 'pending', inspection_id } = req.query;

    let sql = `
      SELECT 
        c.id,
        c.inspection_id,
        c.client_mutation_id,
        c.technician_id,
        u.full_name AS technician_name,
        u.email AS technician_email,
        c.base_version,
        c.server_version,
        c.base_state,
        c.server_state,
        c.client_state,
        c.conflicting_fields,
        c.status,
        c.resolved_by,
        r.full_name AS resolver_name,
        c.resolved_at,
        c.resolution_notes,
        c.created_at,
        e.code AS equipment_code,
        e.name AS equipment_name,
        e.location AS equipment_location
      FROM inspection_conflicts c
      JOIN users u ON c.technician_id = u.id
      JOIN inspections i ON c.inspection_id = i.id
      JOIN equipment e ON i.equipment_id = e.id
      LEFT JOIN users r ON c.resolved_by = r.id
    `;

    const params = [];
    const conditions = [];

    // Filter by user role: Technicians only see their own conflicts
    if (req.user.role === 'technician') {
      params.push(req.user.id);
      conditions.push(`c.technician_id = $${params.length}`);
    }

    if (status && status !== 'all') {
      params.push(status);
      conditions.push(`c.status = $${params.length}`);
    }

    if (inspection_id) {
      if (!isValidUuid(inspection_id)) {
        return res.status(400).json({ error: 'Bad Request', message: 'Invalid inspection_id format' });
      }
      params.push(inspection_id);
      conditions.push(`c.inspection_id = $${params.length}`);
    }

    if (conditions.length > 0) {
      sql += ` WHERE ` + conditions.join(' AND ');
    }

    sql += ` ORDER BY c.created_at DESC`;

    const result = await query(sql, params);

    res.status(200).json({
      count: result.rows.length,
      conflicts: result.rows,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/conflicts/:id
 * Retrieves detailed conflict information by conflict ID.
 */
async function getConflictById(req, res, next) {
  try {
    const { id } = req.params;

    if (!isValidUuid(id)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid conflict ID format. Expected a valid UUID.',
      });
    }

    const result = await query(
      `SELECT 
        c.id,
        c.inspection_id,
        c.client_mutation_id,
        c.technician_id,
        u.full_name AS technician_name,
        u.email AS technician_email,
        c.base_version,
        c.server_version,
        c.base_state,
        c.server_state,
        c.client_state,
        c.conflicting_fields,
        c.status,
        c.resolved_by,
        r.full_name AS resolver_name,
        c.resolved_at,
        c.resolution_notes,
        c.created_at,
        e.id AS equipment_id,
        e.code AS equipment_code,
        e.name AS equipment_name,
        e.location AS equipment_location,
        i.version AS current_inspection_version
      FROM inspection_conflicts c
      JOIN users u ON c.technician_id = u.id
      JOIN inspections i ON c.inspection_id = i.id
      JOIN equipment e ON i.equipment_id = e.id
      LEFT JOIN users r ON c.resolved_by = r.id
      WHERE c.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Conflict with ID '${id}' not found.`,
      });
    }

    const conflict = result.rows[0];

    // Technicians can only view conflicts on their own inspections
    if (req.user.role === 'technician' && conflict.technician_id !== req.user.id) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Technicians can only inspect conflicts originating from their own submissions.',
      });
    }

    res.status(200).json({ conflict });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/conflicts/:id/resolve
 * Resolves a pending conflict. Restricted to Supervisors.
 * Accepts resolutionStrategy: 'keep_server' | 'keep_client' | 'custom_merge'
 * Applies chosen resolution to inspection, updates conflict status, and logs audit record.
 */
async function resolveConflict(req, res, next) {
  try {
    const { id } = req.params;

    if (!isValidUuid(id)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid conflict ID format. Expected a valid UUID.',
      });
    }

    const { resolutionStrategy, resolvedState, notes = '' } = req.body;

    if (!['keep_server', 'keep_client', 'custom_merge'].includes(resolutionStrategy)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: "resolutionStrategy must be one of: 'keep_server', 'keep_client', 'custom_merge'",
      });
    }

    // Fetch conflict record
    const confRes = await query(
      `SELECT * FROM inspection_conflicts WHERE id = $1`,
      [id]
    );

    if (confRes.rows.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Conflict with ID '${id}' not found.`,
      });
    }

    const conflict = confRes.rows[0];

    if (conflict.status !== 'pending') {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Conflict '${id}' is already ${conflict.status}.`,
      });
    }

    // Parse JSON states if stored as strings
    const baseState = typeof conflict.base_state === 'string' ? JSON.parse(conflict.base_state) : conflict.base_state;
    const serverState = typeof conflict.server_state === 'string' ? JSON.parse(conflict.server_state) : conflict.server_state;
    const clientState = typeof conflict.client_state === 'string' ? JSON.parse(conflict.client_state) : conflict.client_state;

    // Determine final state
    let finalState = {};

    if (resolutionStrategy === 'keep_server') {
      finalState = { ...serverState };
    } else if (resolutionStrategy === 'keep_client') {
      finalState = { ...clientState };
    } else if (resolutionStrategy === 'custom_merge') {
      if (!resolvedState || typeof resolvedState !== 'object') {
        return res.status(400).json({
          error: 'Bad Request',
          message: "'resolvedState' object is required when resolutionStrategy is 'custom_merge'",
        });
      }
      finalState = {
        status: resolvedState.status !== undefined ? resolvedState.status : serverState.status,
        overall_result: resolvedState.overall_result !== undefined ? resolvedState.overall_result : serverState.overall_result,
        readings: resolvedState.readings !== undefined ? resolvedState.readings : serverState.readings,
        notes: resolvedState.notes !== undefined ? resolvedState.notes : serverState.notes,
      };
    }

    // Ensure valid status and overall_result
    const validStatuses = ['scheduled', 'in_progress', 'completed'];
    if (finalState.status && !validStatuses.includes(finalState.status)) {
      return res.status(400).json({ error: 'Bad Request', message: `Invalid status: ${finalState.status}` });
    }
    const validResults = ['pass', 'fail', 'warning', null];
    if (finalState.overall_result && !validResults.includes(finalState.overall_result)) {
      return res.status(400).json({ error: 'Bad Request', message: `Invalid overall_result: ${finalState.overall_result}` });
    }

    const readingsJson = JSON.stringify(finalState.readings || {});

    // Atomic transaction: Update inspection, close conflict, create audit log
    const resolutionResult = await withTransaction(async (tx) => {
      // 1. Fetch current inspection version
      const inspRes = await tx.query(
        `SELECT id, version FROM inspections WHERE id = $1 FOR UPDATE`,
        [conflict.inspection_id]
      );

      if (inspRes.rows.length === 0) {
        throw new Error('Associated inspection record not found');
      }

      const currentInsp = inspRes.rows[0];
      const nextVersion = currentInsp.version + 1;

      // 2. Check if other pending conflicts remain for this inspection
      const otherConflictsRes = await tx.query(
        `SELECT COUNT(*) AS count FROM inspection_conflicts 
         WHERE inspection_id = $1 AND id != $2 AND status = 'pending'`,
        [conflict.inspection_id, id]
      );
      const remainingConflicts = parseInt(otherConflictsRes.rows[0].count, 10);
      const hasPendingConflict = remainingConflicts > 0;

      // 3. Update inspection with resolved state
      const updateInspRes = await tx.query(
        `UPDATE inspections
         SET status = $1,
             overall_result = $2,
             readings = $3,
             notes = $4,
             version = $5,
             has_pending_conflict = $6,
             last_modified_by = $7,
             updated_at = NOW()
         WHERE id = $8
         RETURNING id, equipment_id, inspector_id, status, overall_result, readings, notes, version, has_pending_conflict, updated_at`,
        [
          finalState.status,
          finalState.overall_result,
          readingsJson,
          finalState.notes || '',
          nextVersion,
          hasPendingConflict,
          req.user.id,
          conflict.inspection_id,
        ]
      );

      const updatedInspection = updateInspRes.rows[0];

      // 4. Update inspection_conflicts record
      const resolutionDetails = {
        strategy: resolutionStrategy,
        supervisorNotes: notes,
        resolvedByEmail: req.user.email,
        resolvedByName: req.user.fullName,
      };

      const updateConfRes = await tx.query(
        `UPDATE inspection_conflicts
         SET status = 'resolved',
             resolved_by = $1,
             resolved_at = NOW(),
             resolution_notes = $2
         WHERE id = $3
         RETURNING id, inspection_id, status, resolved_by, resolved_at, resolution_notes`,
        [
          req.user.id,
          JSON.stringify(resolutionDetails),
          id,
        ]
      );

      // 5. Insert audit log record
      await tx.query(
        `INSERT INTO inspection_audit_logs (
          inspection_id, user_id, action, version, previous_state, new_state, changed_fields
        ) VALUES ($1, $2, 'conflict_resolved', $3, $4, $5, $6);`,
        [
          conflict.inspection_id,
          req.user.id,
          nextVersion,
          JSON.stringify(serverState),
          JSON.stringify(finalState),
          JSON.stringify(conflict.conflicting_fields || ['resolution']),
        ]
      );

      return {
        conflict: updateConfRes.rows[0],
        inspection: updatedInspection,
      };
    });

    res.status(200).json({
      message: 'Conflict resolved successfully',
      resolution: resolutionResult,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listConflicts,
  getConflictById,
  resolveConflict,
};
