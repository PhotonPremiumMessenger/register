import * as fs from 'fs';
import * as path from 'path';
import express, { NextFunction, Request, Response } from 'express';
import { config } from './config';
import { ApiError } from './auth';
import { getDb } from './db';
import { initRealtime } from './realtime';
import { authRouter } from './routes/authRoutes';
import { userRouter } from './routes/userRoutes';
import { settingsRouter } from './routes/settingsRoutes';
import { attachmentRouter } from './routes/attachmentRoutes';
import { chatRouter } from './routes/chatRoutes';
import { groupRouter } from './routes/groupRoutes';
import { channelRouter } from './routes/channelRoutes';
import { searchRouter } from './routes/searchRoutes';
import { multerErrorMessage } from './uploads';
import { googleConfigured, smtpConfigured } from './config';

// Initialize database (runs migrations) before accepting requests.
getDb();

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'nexo-messenger',
    google_oauth: googleConfigured,
    smtp: smtpConfigured,
    time: new Date().toISOString(),
  });
});

app.use('/api/auth', authRouter);
app.use('/api/users', userRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/attachments', attachmentRouter);
app.use('/api/chats', chatRouter);
app.use('/api/groups', groupRouter);
app.use('/api/channels', channelRouter);
app.use('/api/search', searchRouter);

// Unknown API route → JSON 404 (never fall through to the SPA shell)
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Unknown API endpoint.' });
});

// Static client (production build). In dev, Vite serves the client and proxies /api + /ws here.
const clientDist = config.clientDist;
if (fs.existsSync(path.join(clientDist, 'index.html'))) {
  app.use(express.static(clientDist, { maxAge: '1h', index: 'index.html' }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
} else {
  app.get('*', (_req, res) => {
    res
      .status(200)
      .type('html')
      .send(
        `<html><body style="background:#050507;color:#eee;font-family:sans-serif;padding:40px">
         <h1>NEXO Messenger API</h1>
         <p>The client has not been built yet. Run <code>npm run build</code> in the project root, then restart.</p>
         </body></html>`
      );
  });
}

// Central error handler — honest errors, no fake successes.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  const e = err as { type?: string; code?: string; message?: string; name?: string };
  if (e?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Invalid JSON body.' });
    return;
  }
  if (e?.code === 'LIMIT_FILE_SIZE' || e?.code === 'LIMIT_UNEXPECTED_FILE' || e?.name === 'MulterError') {
    res.status(400).json({ error: multerErrorMessage(err) });
    return;
  }
  console.error('[server] unhandled error:', err);
  res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
});

const server = app.listen(config.port, config.host, () => {
  console.log(`[nexo] server listening on http://${config.host}:${config.port}`);
  console.log(`[nexo] database: ${config.dbFile}`);
  console.log(`[nexo] google oauth: ${googleConfigured ? 'configured' : 'NOT configured (see .env.example)'}`);
});

initRealtime(server);
