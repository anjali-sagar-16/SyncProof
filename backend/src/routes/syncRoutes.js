const express = require('express');
const router = express.Router();
const syncController = require('../controllers/syncController');
const { authenticate } = require('../middleware/auth');

// All sync operations require authentication
router.use(authenticate);

// Process batch synchronization of queued mutations
router.post('/', syncController.sync);

module.exports = router;
