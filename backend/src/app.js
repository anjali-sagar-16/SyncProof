const express = require('express');
const cors = require('cors');
const config = require('./config/env');
const { getDb } = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const equipmentRoutes = require('./routes/equipmentRoutes');
const inspectionRoutes = require('./routes/inspectionRoutes');
const syncRoutes = require('./routes/syncRoutes');
const conflictRoutes = require('./routes/conflictRoutes');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// Global Middleware
app.use(cors({
  origin: config.clientUrl || '*',
  credentials: true,
}));
app.use(express.json());

// Health Check Endpoint
app.get('/api/health', async (req, res) => {
  try {
    const db = await getDb();
    res.status(200).json({
      status: 'ok',
      service: 'SyncProof Backend API',
      timestamp: new Date().toISOString(),
      database: {
        provider: db.clientType,
        status: 'connected',
      },
      environment: config.env,
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      service: 'SyncProof Backend API',
      timestamp: new Date().toISOString(),
      database: {
        status: 'disconnected',
        error: error.message,
      },
    });
  }
});

// Mount Application Routes
app.use('/api/auth', authRoutes);
app.use('/api/equipment', equipmentRoutes);
app.use('/api/inspections', inspectionRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/conflicts', conflictRoutes);

// 404 Not Found Handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.originalUrl}`,
  });
});

// Centralized Error Handler
app.use(errorHandler);

module.exports = app;
