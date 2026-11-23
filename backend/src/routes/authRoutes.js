const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const { authorizeRoles } = require('../middleware/rbac');

// Public route: User login
router.post('/login', authController.login);

// Protected route: Current user profile
router.get('/me', authenticate, authController.getMe);

// Role-protected test route: Supervisor only
router.get(
  '/supervisor-test',
  authenticate,
  authorizeRoles('supervisor'),
  authController.supervisorTest
);

// Role-protected test route: Technician or Supervisor
router.get(
  '/technician-test',
  authenticate,
  authorizeRoles('technician', 'supervisor'),
  authController.technicianTest
);

module.exports = router;
