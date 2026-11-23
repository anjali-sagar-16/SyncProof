const path = require('path');
const os = require('os');
const dotenv = require('dotenv');

// Load .env from backend folder if present
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const defaultPgData = path.join(
  process.env.LOCALAPPDATA || os.tmpdir(),
  'syncproof_pgdata'
);

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';

// Guard against hardcoded development JWT secret in production mode
const devFallbackSecret = 'dev_jwt_secret_change_in_production_12345';
const jwtSecret = process.env.JWT_SECRET || devFallbackSecret;

if (isProduction && (!process.env.JWT_SECRET || process.env.JWT_SECRET === devFallbackSecret)) {
  throw new Error(
    'SECURITY ERROR: JWT_SECRET environment variable must be explicitly defined with a secure secret in production.'
  );
}

const config = {
  env: nodeEnv,
  port: parseInt(process.env.PORT, 10) || 5000,
  dbClient: (process.env.DB_CLIENT || 'auto').toLowerCase(),
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    database: process.env.DB_NAME || 'syncproof_db',
    user: process.env.DB_USER || 'syncproof_user',
    password: process.env.DB_PASSWORD || 'syncproof_dev_password',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    pgliteDataDir: process.env.PGLITE_DATA_DIR
      ? (path.isAbsolute(process.env.PGLITE_DATA_DIR)
          ? process.env.PGLITE_DATA_DIR
          : path.resolve(__dirname, '../../', process.env.PGLITE_DATA_DIR))
      : defaultPgData,
  },
  jwt: {
    secret: jwtSecret,
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  },
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
};

module.exports = config;
