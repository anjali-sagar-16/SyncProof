const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config/env');
const { query } = require('../config/db');

/**
 * Generates a signed JWT for an authenticated user.
 */
function generateToken(user) {
  const payload = {
    id: user.id,
    email: user.email,
    role: user.role,
    fullName: user.full_name,
  };

  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  });
}

/**
 * POST /api/auth/login
 * Authenticates user credentials against bcrypt hashes and issues a JWT token.
 */
async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Both email and password are required.',
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Query user by email
    const userRes = await query(
      `SELECT id, email, password_hash, full_name, role, created_at FROM users WHERE email = $1`,
      [normalizedEmail]
    );

    if (userRes.rows.length === 0) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid email or password.',
      });
    }

    const user = userRes.rows[0];

    // Compare provided password with stored bcrypt hash
    const passwordValid = await bcrypt.compare(password, user.password_hash);
    if (!passwordValid) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid email or password.',
      });
    }

    // Generate JWT
    const token = generateToken(user);

    // Return user profile and token WITHOUT exposing password_hash or internal secrets
    res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: user.role,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/auth/me
 * Returns profile details of currently authenticated user.
 */
async function getMe(req, res) {
  res.status(200).json({
    user: req.user,
  });
}

/**
 * Test endpoint for supervisor-only role verification.
 */
function supervisorTest(req, res) {
  res.status(200).json({
    message: 'Supervisor authorization verified successfully.',
    role: req.user.role,
    user: req.user.email,
  });
}

/**
 * Test endpoint for technician or supervisor role verification.
 */
function technicianTest(req, res) {
  res.status(200).json({
    message: 'Technician/Supervisor authorization verified successfully.',
    role: req.user.role,
    user: req.user.email,
  });
}

module.exports = {
  login,
  getMe,
  supervisorTest,
  technicianTest,
};
