const express = require('express');
const router = express.Router();
const inspectionController = require('../controllers/inspectionController');
const { authenticate } = require('../middleware/auth');
const { authorizeRoles } = require('../middleware/rbac');

// All inspection endpoints require authentication
router.use(authenticate);

// List inspections (Supervisors and Technicians)
router.get('/', inspectionController.listInspections);

// Get inspection by ID with audit trail
router.get('/:id', inspectionController.getInspectionById);

// Create inspection (Technicians and Supervisors)
router.post(
  '/',
  authorizeRoles('technician', 'supervisor'),
  inspectionController.createInspection
);

// Update inspection with Optimistic Concurrency Control (Technicians and Supervisors)
router.put(
  '/:id',
  authorizeRoles('technician', 'supervisor'),
  inspectionController.updateInspection
);

module.exports = router;
