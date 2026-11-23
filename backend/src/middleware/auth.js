const jwt = require('jsonwebtoken');
const config = require('../config/env');
const { query } = require('../config/db');

/**
 * Authentication middleware.
 * Validates the JWT Bearer token from the Authorization header and attaches
 * the authenticated user record (without password_hash) to req.user.
 */
async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication token missing or invalid format. Expected Bearer token.',
      });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication token is empty.',
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, config.jwt.secret);
    } catch (jwtErr) {
      if (jwtErr.name === 'TokenExpiredError') {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Authentication token has expired. Please log in again.',
        });
      }
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid authentication token signature.',
      });
    }

    // Verify user still exists in database
    const userRes = await query(
      `SELECT id, email, full_name, role, created_at FROM users WHERE id = $1`,
      [decoded.id]
    );

    if (userRes.rows.length === 0) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'User associated with this token no longer exists.',
      });
    }

    const user = userRes.rows[0];
    req.user = {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
      createdAt: user.created_at,
    };

    next();
  } catch (error) {
    next(error);
  }
}

module.exports = { authenticate };
