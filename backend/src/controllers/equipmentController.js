const { query } = require('../config/db');
const { isValidUuid } = require('../utils/validators');

/**
 * GET /api/equipment
 * Returns a list of equipment items with optional status filtering.
 */
async function listEquipment(req, res, next) {
  try {
    const { status, search } = req.query;
    let sql = `
      SELECT id, code, name, location, serial_number, status, created_at, updated_at
      FROM equipment
    `;
    const params = [];
    const conditions = [];

    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }

    if (search) {
      params.push(`%${search.trim()}%`);
      conditions.push(`(code ILIKE $${params.length} OR name ILIKE $${params.length} OR location ILIKE $${params.length})`);
    }

    if (conditions.length > 0) {
      sql += ` WHERE ` + conditions.join(' AND ');
    }

    sql += ` ORDER BY code ASC`;

    const result = await query(sql, params);

    res.status(200).json({
      count: result.rows.length,
      equipment: result.rows,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/equipment/:id
 * Returns a single equipment record by ID with recent inspection history.
 */
async function getEquipmentById(req, res, next) {
  try {
    const { id } = req.params;

    if (!isValidUuid(id)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid equipment ID format. Expected a valid UUID.',
      });
    }

    const equipRes = await query(
      `SELECT id, code, name, location, serial_number, status, created_at, updated_at
       FROM equipment
       WHERE id = $1`,
      [id]
    );

    if (equipRes.rows.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Equipment with ID '${id}' not found.`,
      });
    }

    const equipment = equipRes.rows[0];

    // Fetch recent inspections for this equipment
    const inspRes = await query(
      `SELECT i.id, i.status, i.overall_result, i.version, i.created_at, u.full_name as inspector_name
       FROM inspections i
       LEFT JOIN users u ON i.inspector_id = u.id
       WHERE i.equipment_id = $1
       ORDER BY i.created_at DESC
       LIMIT 5`,
      [id]
    );

    res.status(200).json({
      equipment: {
        ...equipment,
        recentInspections: inspRes.rows,
      },
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listEquipment,
  getEquipmentById,
};
