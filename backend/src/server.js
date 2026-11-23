const app = require('./app');
const config = require('./config/env');
const { getDb, close } = require('./config/db');

async function startServer() {
  try {
    // Initialize and test database connection on boot
    const db = await getDb();
    console.log(`[Server] Database initialized using provider: ${db.clientType}`);

    const server = app.listen(config.port, () => {
      console.log(`[Server] SyncProof API running on http://localhost:${config.port}`);
      console.log(`[Server] Health check: http://localhost:${config.port}/api/health`);
    });

    // Graceful Shutdown
    const shutdown = async (signal) => {
      console.log(`\n[Server] Received ${signal}. Shutting down gracefully...`);
      server.close(async () => {
        console.log('[Server] HTTP server closed.');
        await close();
        console.log('[Server] Database connections closed.');
        process.exit(0);
      });
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (error) {
    console.error('[Server] Failed to start server:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = { startServer };
