const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const VALID_INSPECTION_STATUSES = ['scheduled', 'in_progress', 'completed'];
const VALID_OVERALL_RESULTS = ['pass', 'fail', 'warning'];

function isValidUuid(id) {
  if (typeof id !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

function validateInspectionCreate(body) {
  const errors = [];
  const { equipment_id, status, overall_result, readings, notes } = body;

  if (!equipment_id) {
    errors.push('equipment_id is required');
  } else if (!isValidUuid(equipment_id)) {
    errors.push('equipment_id must be a valid UUID');
  }

  if (status !== undefined && !VALID_INSPECTION_STATUSES.includes(status)) {
    errors.push(`status must be one of: [${VALID_INSPECTION_STATUSES.join(', ')}]`);
  }

  if (overall_result !== undefined && overall_result !== null && !VALID_OVERALL_RESULTS.includes(overall_result)) {
    errors.push(`overall_result must be one of: [${VALID_OVERALL_RESULTS.join(', ')}]`);
  }

  if (readings !== undefined && readings !== null) {
    if (typeof readings !== 'object' || Array.isArray(readings)) {
      errors.push('readings must be a JSON object');
    }
  }

  if (notes !== undefined && notes !== null && typeof notes !== 'string') {
    errors.push('notes must be a string');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

function validateInspectionUpdate(body) {
  const errors = [];
  const { baseVersion, version, status, overall_result, readings, notes } = body;

  // Accept either baseVersion or version
  const submittedVersion = baseVersion !== undefined ? baseVersion : version;

  if (submittedVersion === undefined || submittedVersion === null) {
    errors.push('baseVersion (or version) is required for optimistic concurrency control');
  } else {
    const num = Number(submittedVersion);
    if (!Number.isInteger(num) || num < 1) {
      errors.push('baseVersion must be a positive integer');
    }
  }

  if (status !== undefined && !VALID_INSPECTION_STATUSES.includes(status)) {
    errors.push(`status must be one of: [${VALID_INSPECTION_STATUSES.join(', ')}]`);
  }

  if (overall_result !== undefined && overall_result !== null && !VALID_OVERALL_RESULTS.includes(overall_result)) {
    errors.push(`overall_result must be one of: [${VALID_OVERALL_RESULTS.join(', ')}]`);
  }

  if (readings !== undefined && readings !== null) {
    if (typeof readings !== 'object' || Array.isArray(readings)) {
      errors.push('readings must be a JSON object');
    }
  }

  if (notes !== undefined && notes !== null && typeof notes !== 'string') {
    errors.push('notes must be a string');
  }

  return {
    isValid: errors.length === 0,
    errors,
    versionNumber: submittedVersion !== undefined ? Number(submittedVersion) : null,
  };
}

module.exports = {
  isValidUuid,
  validateInspectionCreate,
  validateInspectionUpdate,
  VALID_INSPECTION_STATUSES,
  VALID_OVERALL_RESULTS,
};
