const express = require('express');
const router = express.Router();
const conflictController = require('../controllers/conflictController');
const { authenticate } = require('../middleware/auth');
const { authorizeRoles } = require('../middleware/rbac');

// All conflict endpoints require authentication
router.use(authenticate);

// List conflicts (Supervisors see all; Technicians see their own)
router.get('/', conflictController.listConflicts);

// Get conflict detail by ID
router.get('/:id', conflictController.getConflictById);

// Resolve conflict (Supervisors ONLY)
router.post(
  '/:id/resolve',
  authorizeRoles('supervisor'),
  conflictController.resolveConflict
);

module.exports = router;
