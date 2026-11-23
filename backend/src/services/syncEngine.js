const { query, withTransaction } = require('../config/db');
const { isValidUuid } = require('../utils/validators');
const { threeWayMerge } = require('./mergeService');

/**
 * Sync Engine Service
 * Coordinates idempotent mutation batch processing, three-way merging,
 * collision flagging, and audit trail persistence.
 */

/**
 * Processes a single mutation.
 *
 * @param {Object} mutation
 * @param {Object} user - Authenticated user { id, role, email, fullName }
 * @returns {Object} Result of mutation processing
 */
async function processMutation(mutation, user) {
  const { clientMutationId } = mutation;

  // 1. Validate clientMutationId format
  if (!clientMutationId || !isValidUuid(clientMutationId)) {
    return {
      clientMutationId: clientMutationId || null,
      status: 'rejected',
      error: 'Invalid or missing clientMutationId. Must be a valid UUID.',
    };
  }

  // 2. Idempotency Check: Return previous response if mutation was already processed
  const existingRes = await query(
    `SELECT id, client_mutation_id, action, status, response_payload, created_at
     FROM sync_mutations
     WHERE client_mutation_id = $1`,
    [clientMutationId]
  );

  if (existingRes.rows.length > 0) {
    const existing = existingRes.rows[0];
    const payload = typeof existing.response_payload === 'string'
      ? JSON.parse(existing.response_payload)
      : existing.response_payload;

    return {
      clientMutationId,
      replayed: true,
      ...payload,
    };
  }

  // 3. Process according to action
  const action = (mutation.action || '').toLowerCase();

  if (action === 'create') {
    return await handleCreateMutation(mutation, user);
  } else if (action === 'update') {
    return await handleUpdateMutation(mutation, user);
  } else {
    // Record rejected mutation in sync_mutations for idempotency
    const rejectPayload = {
      status: 'rejected',
      error: `Unsupported mutation action: '${mutation.action}'. Allowed: ['create', 'update']`,
    };

    await recordSyncMutation(clientMutationId, user.id, 'inspection', '00000000-0000-0000-0000-000000000000', 'create', 'rejected', rejectPayload);

    return {
      clientMutationId,
      ...rejectPayload,
    };
  }
}

/**
 * Handles an offline 'create' mutation.
 */
async function handleCreateMutation(mutation, user) {
  const { clientMutationId, equipmentId, status = 'completed', overall_result = null, readings = {}, notes = '' } = mutation;

  if (!equipmentId || !isValidUuid(equipmentId)) {
    const errPayload = { status: 'rejected', error: 'Valid equipmentId is required for creation' };
    await recordSyncMutation(clientMutationId, user.id, 'inspection', '00000000-0000-0000-0000-000000000000', 'create', 'rejected', errPayload);
    return { clientMutationId, ...errPayload };
  }

  // Check equipment existence
  const equipRes = await query(`SELECT id FROM equipment WHERE id = $1`, [equipmentId]);
  if (equipRes.rows.length === 0) {
    const errPayload = { status: 'rejected', error: `Equipment with ID '${equipmentId}' not found` };
    await recordSyncMutation(clientMutationId, user.id, 'inspection', '00000000-0000-0000-0000-000000000000', 'create', 'rejected', errPayload);
    return { clientMutationId, ...errPayload };
  }

  const readingsJson = typeof readings === 'string' ? readings : JSON.stringify(readings);

  const result = await withTransaction(async (tx) => {
    // 1. Insert inspection
    const insertRes = await tx.query(
      `INSERT INTO inspections (
        equipment_id, inspector_id, status, overall_result, readings, notes, version, last_modified_by
      ) VALUES ($1, $2, $3, $4, $5, $6, 1, $7)
      RETURNING id, equipment_id, inspector_id, status, overall_result, readings, notes, version, has_pending_conflict, created_at, updated_at;`,
      [equipmentId, user.id, status, overall_result, readingsJson, notes, user.id]
    );

    const inspection = insertRes.rows[0];

    // 2. Insert audit log
    await tx.query(
      `INSERT INTO inspection_audit_logs (
        inspection_id, user_id, action, version, new_state, changed_fields
      ) VALUES ($1, $2, 'created', 1, $3, $4);`,
      [
        inspection.id,
        user.id,
        JSON.stringify({ status, overall_result, readings, notes }),
        JSON.stringify(['status', 'overall_result', 'readings', 'notes']),
      ]
    );

    // 3. Record in sync_mutations
    const responsePayload = {
      status: 'applied',
      entityId: inspection.id,
      inspection,
    };

    await tx.query(
      `INSERT INTO sync_mutations (
        client_mutation_id, user_id, entity_type, entity_id, action, status, response_payload
      ) VALUES ($1, $2, 'inspection', $3, 'create', 'applied', $4);`,
      [clientMutationId, user.id, inspection.id, JSON.stringify(responsePayload)]
    );

    return { clientMutationId, ...responsePayload };
  });

  return result;
}

/**
 * Handles an offline 'update' mutation with 3-way merge and collision detection.
 */
async function handleUpdateMutation(mutation, user) {
  const { clientMutationId, entityId, baseVersion, changes = {}, clientState: submittedClientState, baseState: submittedBaseState } = mutation;

  if (!entityId || !isValidUuid(entityId)) {
    const errPayload = { status: 'rejected', error: 'Valid entityId (UUID) is required for update' };
    await recordSyncMutation(clientMutationId, user.id, 'inspection', '00000000-0000-0000-0000-000000000000', 'update', 'rejected', errPayload);
    return { clientMutationId, ...errPayload };
  }

  const baseVerNum = Number(baseVersion);
  if (!Number.isInteger(baseVerNum) || baseVerNum < 1) {
    const errPayload = { status: 'rejected', error: 'baseVersion must be a positive integer' };
    await recordSyncMutation(clientMutationId, user.id, 'inspection', entityId, 'update', 'rejected', errPayload);
    return { clientMutationId, ...errPayload };
  }

  // Fetch current inspection
  const currRes = await query(
    `SELECT id, equipment_id, inspector_id, status, overall_result, readings, notes, version, has_pending_conflict
     FROM inspections
     WHERE id = $1`,
    [entityId]
  );

  if (currRes.rows.length === 0) {
    const errPayload = { status: 'rejected', error: `Inspection with ID '${entityId}' not found` };
    await recordSyncMutation(clientMutationId, user.id, 'inspection', entityId, 'update', 'rejected', errPayload);
    return { clientMutationId, ...errPayload };
  }

  const current = currRes.rows[0];

  // Permission check: Technicians can only edit inspections they own
  if (user.role === 'technician' && current.inspector_id !== user.id) {
    const errPayload = { status: 'rejected', error: 'Technicians are only permitted to edit their own inspection records' };
    await recordSyncMutation(clientMutationId, user.id, 'inspection', entityId, 'update', 'rejected', errPayload);
    return { clientMutationId, ...errPayload };
  }

  // Normalize server readings
  const serverReadings = typeof current.readings === 'string' ? JSON.parse(current.readings) : (current.readings || {});
  const serverState = {
    status: current.status,
    overall_result: current.overall_result,
    readings: serverReadings,
    notes: current.notes || '',
  };

  // Determine baseState
  let baseState = submittedBaseState;
  if (!baseState) {
    // Attempt retrieval from audit log at baseVersion
    const auditRes = await query(
      `SELECT new_state FROM inspection_audit_logs WHERE inspection_id = $1 AND version = $2 ORDER BY created_at DESC LIMIT 1`,
      [entityId, baseVerNum]
    );
    if (auditRes.rows.length > 0) {
      baseState = typeof auditRes.rows[0].new_state === 'string'
        ? JSON.parse(auditRes.rows[0].new_state)
        : auditRes.rows[0].new_state;
    } else {
      // Fallback: If baseVersion == current.version, baseState is serverState
      baseState = { ...serverState };
    }
  }

  // Determine clientState
  const clientState = submittedClientState
    ? submittedClientState
    : {
        status: changes.status !== undefined ? changes.status : baseState.status,
        overall_result: changes.overall_result !== undefined ? changes.overall_result : baseState.overall_result,
        notes: changes.notes !== undefined ? changes.notes : baseState.notes,
        readings: changes.readings !== undefined
          ? { ...(baseState.readings || {}), ...changes.readings }
          : (baseState.readings || {}),
      };

  // ============================================================================
  // Scenario 1: Clean Apply (No concurrent edit on server: current.version === baseVersion)
  // ============================================================================
  if (current.version === baseVerNum) {
    const nextVersion = current.version + 1;
    const readingsJson = JSON.stringify(clientState.readings || {});

    const result = await withTransaction(async (tx) => {
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
          clientState.status,
          clientState.overall_result,
          readingsJson,
          clientState.notes,
          nextVersion,
          user.id,
          entityId,
          current.version,
        ]
      );

      const updated = updateRes.rows[0];

      // Insert audit log
      await tx.query(
        `INSERT INTO inspection_audit_logs (
          inspection_id, user_id, action, version, previous_state, new_state, changed_fields
        ) VALUES ($1, $2, 'updated', $3, $4, $5, $6);`,
        [
          entityId,
          user.id,
          nextVersion,
          JSON.stringify(serverState),
          JSON.stringify(clientState),
          JSON.stringify(Object.keys(changes).length > 0 ? Object.keys(changes) : ['status', 'overall_result', 'readings', 'notes']),
        ]
      );

      // Record in sync_mutations
      const responsePayload = {
        status: 'applied',
        entityId,
        inspection: updated,
      };

      await tx.query(
        `INSERT INTO sync_mutations (
          client_mutation_id, user_id, entity_type, entity_id, action, status, response_payload
        ) VALUES ($1, $2, 'inspection', $3, 'update', 'applied', $4);`,
        [clientMutationId, user.id, entityId, JSON.stringify(responsePayload)]
      );

      return { clientMutationId, ...responsePayload };
    });

    return result;
  }

  // ============================================================================
  // Scenario 2: Concurrent edit on server (current.version > baseVersion)
  // Execute Three-Way Merge
  // ============================================================================
  const mergeResult = threeWayMerge({ baseState, serverState, clientState });

  if (mergeResult.canAutoMerge) {
    // --------------------------------------------------------------------------
    // Sub-case 2A: Clean Auto-Merge (Disjoint, non-overlapping field changes)
    // --------------------------------------------------------------------------
    const nextVersion = current.version + 1;
    const mergedReadingsJson = JSON.stringify(mergeResult.mergedState.readings || {});

    const result = await withTransaction(async (tx) => {
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
          mergeResult.mergedState.status,
          mergeResult.mergedState.overall_result,
          mergedReadingsJson,
          mergeResult.mergedState.notes,
          nextVersion,
          user.id,
          entityId,
          current.version,
        ]
      );

      const updated = updateRes.rows[0];

      // Audit log: action = 'auto_merged'
      await tx.query(
        `INSERT INTO inspection_audit_logs (
          inspection_id, user_id, action, version, previous_state, new_state, changed_fields
        ) VALUES ($1, $2, 'auto_merged', $3, $4, $5, $6);`,
        [
          entityId,
          user.id,
          nextVersion,
          JSON.stringify(serverState),
          JSON.stringify(mergeResult.mergedState),
          JSON.stringify(mergeResult.changedFields),
        ]
      );

      // Record in sync_mutations
      const responsePayload = {
        status: 'merged',
        entityId,
        mergedFields: mergeResult.changedFields,
        inspection: updated,
      };

      await tx.query(
        `INSERT INTO sync_mutations (
          client_mutation_id, user_id, entity_type, entity_id, action, status, response_payload
        ) VALUES ($1, $2, 'inspection', $3, 'update', 'merged', $4);`,
        [clientMutationId, user.id, entityId, JSON.stringify(responsePayload)]
      );

      return { clientMutationId, ...responsePayload };
    });

    return result;
  } else {
    // --------------------------------------------------------------------------
    // Sub-case 2B: Collision Detected (Overlapping conflicting changes)
    // NEVER silently overwrite. Record in inspection_conflicts and audit log.
    // --------------------------------------------------------------------------
    const result = await withTransaction(async (tx) => {
      // 1. Mark inspection has_pending_conflict = true
      await tx.query(
        `UPDATE inspections
         SET has_pending_conflict = true,
             updated_at = NOW()
         WHERE id = $1;`,
        [entityId]
      );

      // 2. Insert into inspection_conflicts
      const conflictRes = await tx.query(
        `INSERT INTO inspection_conflicts (
          inspection_id, client_mutation_id, technician_id,
          base_version, server_version,
          base_state, server_state, client_state,
          conflicting_fields, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
        RETURNING id;`,
        [
          entityId,
          clientMutationId,
          user.id,
          baseVerNum,
          current.version,
          JSON.stringify(baseState),
          JSON.stringify(serverState),
          JSON.stringify(clientState),
          JSON.stringify(mergeResult.conflictingFields),
        ]
      );

      const conflictId = conflictRes.rows[0].id;

      // 3. Insert into inspection_audit_logs: action = 'conflict_flagged'
      await tx.query(
        `INSERT INTO inspection_audit_logs (
          inspection_id, user_id, action, version, previous_state, new_state, changed_fields
        ) VALUES ($1, $2, 'conflict_flagged', $3, $4, $5, $6);`,
        [
          entityId,
          user.id,
          current.version,
          JSON.stringify(serverState),
          JSON.stringify(clientState),
          JSON.stringify(mergeResult.conflictingFields),
        ]
      );

      // 4. Record in sync_mutations: status = 'conflicted'
      const responsePayload = {
        status: 'conflicted',
        entityId,
        conflictId,
        conflictingFields: mergeResult.conflictingFields,
        baseVersion: baseVerNum,
        serverVersion: current.version,
        message: `Conflict detected on fields: [${mergeResult.conflictingFields.join(', ')}]. Flagged for supervisor review.`,
      };

      await tx.query(
        `INSERT INTO sync_mutations (
          client_mutation_id, user_id, entity_type, entity_id, action, status, response_payload
        ) VALUES ($1, $2, 'inspection', $3, 'update', 'conflicted', $4);`,
        [clientMutationId, user.id, entityId, JSON.stringify(responsePayload)]
      );

      return { clientMutationId, ...responsePayload };
    });

    return result;
  }
}

/**
 * Helper to record rejected or failed mutations into sync_mutations.
 */
async function recordSyncMutation(clientMutationId, userId, entityType, entityId, action, status, responsePayload) {
  try {
    await query(
      `INSERT INTO sync_mutations (
        client_mutation_id, user_id, entity_type, entity_id, action, status, response_payload
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (client_mutation_id) DO NOTHING;`,
      [
        clientMutationId,
        userId,
        entityType,
        entityId,
        action,
        status,
        JSON.stringify(responsePayload),
      ]
    );
  } catch (err) {
    console.error('[SyncEngine] Error recording sync mutation:', err.message);
  }
}

/**
 * Processes a batch of queued mutations.
 *
 * @param {Array} mutations - Array of mutation objects
 * @param {Object} user - Authenticated user
 * @returns {Object} { processed: number, results: Array }
 */
async function processSyncBatch(mutations, user) {
  const results = [];

  for (const mutation of mutations) {
    try {
      const outcome = await processMutation(mutation, user);
      results.push(outcome);
    } catch (err) {
      console.error(`[SyncEngine] Unexpected error processing mutation ${mutation.clientMutationId}:`, err);
      results.push({
        clientMutationId: mutation.clientMutationId || null,
        status: 'rejected',
        error: err.message || 'Internal processing error',
      });
    }
  }

  return {
    processed: results.length,
    results,
  };
}

module.exports = {
  processMutation,
  processSyncBatch,
};
