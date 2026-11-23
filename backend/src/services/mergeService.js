/**
 * Three-Way Field-Level Merge Service
 * Compares Base State, Server State, and Client State to determine whether
 * concurrent changes are mutually independent (safe to auto-merge) or colliding
 * on the same fields (requiring human review).
 */

/**
 * Normalizes an inspection state object.
 */
function normalizeState(state = {}) {
  return {
    status: state.status !== undefined ? state.status : null,
    overall_result: state.overall_result !== undefined ? state.overall_result : null,
    notes: state.notes !== undefined ? state.notes : '',
    readings: state.readings && typeof state.readings === 'object' && !Array.isArray(state.readings)
      ? state.readings
      : {},
  };
}

/**
 * Performs a three-way field-level merge.
 *
 * @param {Object} params
 * @param {Object} params.baseState - State at baseVersion when client began edits
 * @param {Object} params.serverState - Current state on server (at serverVersion)
 * @param {Object} params.clientState - Proposed state submitted by client
 * @returns {Object} { canAutoMerge: boolean, mergedState: Object, conflictingFields: string[], changedFields: string[] }
 */
function threeWayMerge({ baseState = {}, serverState = {}, clientState = {} }) {
  const base = normalizeState(baseState);
  const server = normalizeState(serverState);
  const client = normalizeState(clientState);

  const conflictingFields = [];
  const merged = { ...server };
  const changedFields = [];

  // 1. Scalar Fields: status, overall_result, notes
  const scalarFields = ['status', 'overall_result', 'notes'];

  for (const field of scalarFields) {
    const bVal = base[field];
    const sVal = server[field];
    const cVal = client[field];

    const clientChanged = cVal !== bVal;
    const serverChanged = sVal !== bVal;

    if (clientChanged && serverChanged) {
      if (cVal === sVal) {
        // Both changed to identical value -> safe
        merged[field] = cVal;
      } else {
        // Both changed to DIFFERENT values -> conflict!
        conflictingFields.push(field);
      }
    } else if (clientChanged && !serverChanged) {
      // Client changed field, server did not -> safe auto-merge
      merged[field] = cVal;
      changedFields.push(field);
    } else {
      // Server changed or neither changed -> keep server value
      merged[field] = sVal;
    }
  }

  // 2. JSONB Telemetry Object: readings
  const bReadings = base.readings || {};
  const sReadings = server.readings || {};
  const cReadings = client.readings || {};

  const allReadingKeys = Array.from(
    new Set([
      ...Object.keys(bReadings),
      ...Object.keys(sReadings),
      ...Object.keys(cReadings),
    ])
  );

  const mergedReadings = { ...sReadings };
  let readingsChangedByClient = false;

  for (const key of allReadingKeys) {
    const bVal = bReadings[key];
    const sVal = sReadings[key];
    const cVal = cReadings[key];

    const clientChanged = cVal !== bVal;
    const serverChanged = sVal !== bVal;

    if (clientChanged && serverChanged) {
      if (cVal === sVal) {
        mergedReadings[key] = cVal;
      } else {
        conflictingFields.push(`readings.${key}`);
      }
    } else if (clientChanged && !serverChanged) {
      mergedReadings[key] = cVal;
      readingsChangedByClient = true;
    } else {
      mergedReadings[key] = sVal;
    }
  }

  merged.readings = mergedReadings;
  if (readingsChangedByClient) {
    changedFields.push('readings');
  }

  return {
    canAutoMerge: conflictingFields.length === 0,
    mergedState: merged,
    conflictingFields,
    changedFields,
  };
}

module.exports = {
  threeWayMerge,
  normalizeState,
};
