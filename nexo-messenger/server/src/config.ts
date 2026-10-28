import * as path from 'path';
import * as fs from 'fs';
import 'dotenv/config';

// Load nexo-messenger/.env (project root) as well as server/.env if present.
const rootEnv = path.join(__dirname, '..', '..', '.env');
if (fs.existsSync(rootEnv)) {
  // dotenv/config already loaded server/.env (cwd); also load root .env without overriding.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('dotenv').config({ path: rootEnv });
}

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const dataDir =
  process.env.DATA_DIR && process.env.DATA_DIR.trim() !== ''
    ? path.resolve(process.env.DATA_DIR.trim())
    : path.join(__dirname, '..', 'data');

const port = num(process.env.PORT, 3000);

export const config = {
  port,
  host: '0.0.0.0',
  jwtSecret: process.env.JWT_SECRET || 'nexo-dev-secret-do-not-use-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '30d',
  dataDir,
  dbFile: path.join(dataDir, 'nexo.db'),
  uploadsDir: path.join(dataDir, 'uploads'),
  clientDist: path.join(__dirname, '..', '..', 'client', 'dist'),
  migrationsDir: path.join(__dirname, '..', 'migrations'),
  publicAppUrl: (process.env.PUBLIC_APP_URL || '').replace(/\/+$/, ''),
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  },
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: num(process.env.SMTP_PORT, 587),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'NEXO Messenger <no-reply@nexo.local>',
  },
  devExposeResetLink: (process.env.DEV_EXPOSE_RESET_LINK || 'true') === 'true',
  maxUploadBytes: num(process.env.MAX_UPLOAD_MB, 15) * 1024 * 1024,
};

export const googleConfigured = Boolean(config.google.clientId && config.google.clientSecret);
export const smtpConfigured = Boolean(config.smtp.host && config.smtp.user);
