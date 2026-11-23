const express = require('express');
const router = express.Router();
const equipmentController = require('../controllers/equipmentController');
const { authenticate } = require('../middleware/auth');

// All equipment endpoints require authentication
router.use(authenticate);

// List equipment
router.get('/', equipmentController.listEquipment);

// Get equipment by ID
router.get('/:id', equipmentController.getEquipmentById);

module.exports = router;
