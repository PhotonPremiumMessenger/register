import { randomBytes, randomUUID, createHash } from 'crypto';
import { Router } from 'express';
import nodemailer from 'nodemailer';
import { config, googleConfigured, smtpConfigured } from '../config';
import {
  ApiError,
  asyncHandler,
  hashPassword,
  normalizeEmail,
  normalizeUsername,
  requireAuth,
  signToken,
  validateEmail,
  validatePassword,
  validateUsername,
  verifyPassword,
  verifyToken,
} from '../auth';
import { get, run, tx, nowIso } from '../db';
import { publicProfile } from '../dto';
import { Request } from 'express';

export const authRouter = Router();

// ── helpers ───────────────────────────────────────────────────────────

function appBase(req: Request): string {
  if (config.publicAppUrl) return config.publicAppUrl;
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
  return `${proto}://${req.get('host') || `localhost:${config.port}`}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Generate a unique @username from a seed (e.g. e-mail prefix or Google name). */
function generateUsername(seed: string): string {
  const base =
    seed
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 15) || 'user';
  let candidate = base.length >= 3 ? base : `${base}_${randomBytes(2).toString('hex')}`;
  for (let i = 0; i < 50; i++) {
    const exists = get('SELECT 1 FROM profiles WHERE username = ?', candidate);
    if (!exists) return candidate;
    candidate = `${base}_${randomBytes(3).toString('hex')}`;
  }
  return `user_${randomUUID().slice(0, 12)}`;
}

function loadSettings(userId: string) {
  const row = get<Record<string, unknown>>(
    'SELECT theme, notifications_enabled, notification_sound, show_online_status, allow_messages_from FROM user_settings WHERE user_id = ?',
    userId
  );
  return {
    theme: String(row?.theme ?? 'obsidian'),
    notifications_enabled: Number(row?.notifications_enabled ?? 1) === 1,
    notification_sound: Number(row?.notification_sound ?? 1) === 1,
    show_online_status: Number(row?.show_online_status ?? 1) === 1,
    allow_messages_from: String(row?.allow_messages_from ?? 'everyone'),
  };
}

// ── provider capabilities ─────────────────────────────────────────────

authRouter.get(
  '/providers',
  asyncHandler(async (_req, res) => {
    res.json({
      google: googleConfigured,
      smtp: smtpConfigured,
      dev_reset_link: config.devExposeResetLink && !smtpConfigured,
    });
  })
);

// ── email + password ──────────────────────────────────────────────────

authRouter.post(
  '/signup',
  asyncHandler(async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const password = validatePassword(req.body?.password);
    const username = normalizeUsername(req.body?.username);
    const displayName = String(req.body?.display_name || '').trim().slice(0, 60);

    validateEmail(email);
    validateUsername(username);
    if (!displayName) throw new ApiError(400, 'Display name is required.');

    if (get('SELECT 1 FROM users WHERE email = ?', email)) {
      throw new ApiError(409, 'An account with this email already exists. Try signing in.');
    }
    if (get('SELECT 1 FROM profiles WHERE username = ?', username)) {
      throw new ApiError(409, `Username @${username} is already taken.`);
    }

    const userId = randomUUID();
    const passwordHash = await hashPassword(password);
    tx(() => {
      run(
        'INSERT INTO users (id, email, password_hash, created_at) VALUES (?,?,?,?)',
        userId,
        email,
        passwordHash,
        nowIso()
      );
      run(
        'INSERT INTO profiles (user_id, username, display_name, bio, created_at) VALUES (?,?,?,?,?)',
        userId,
        username,
        displayName,
        '',
        nowIso()
      );
      run('INSERT INTO user_settings (user_id) VALUES (?)', userId);
    });

    const token = signToken(userId, email);
    res.status(201).json({ token, profile: publicProfile(userId), settings: loadSettings(userId) });
  })
);

authRouter.post(
  '/signin',
  asyncHandler(async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');
    validateEmail(email);
    if (!password) throw new ApiError(400, 'Password is required.');

    const user = get<{ id: string; password_hash: string | null }>(
      'SELECT id, password_hash FROM users WHERE email = ?',
      email
    );
    if (!user || !user.password_hash || !(await verifyPassword(password, user.password_hash))) {
      throw new ApiError(401, 'Incorrect email or password.');
    }
    const token = signToken(user.id, email);
    res.json({ token, profile: publicProfile(user.id), settings: loadSettings(user.id) });
  })
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const profile = publicProfile(req.userId!);
    if (!profile) throw new ApiError(404, 'Profile not found for this session.');
    res.json({ profile, settings: loadSettings(req.userId!) });
  })
);

// ── password reset ────────────────────────────────────────────────────

authRouter.post(
  '/forgot',
  asyncHandler(async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    validateEmail(email);
    const generic = {
      ok: true,
      message: 'If an account exists for that email, a password reset link is on its way.',
    };

    const user = get<{ id: string }>('SELECT id FROM users WHERE email = ?', email);
    if (!user) return res.json({ ...generic, dev_reset_url: null });

    const rawToken = randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    run(
      'UPDATE users SET reset_token_hash = ?, reset_token_expires_at = ? WHERE id = ?',
      sha256(rawToken),
      expires,
      user.id
    );
    const resetUrl = `${appBase(req)}/reset-password?token=${rawToken}`;

    if (smtpConfigured) {
      try {
        const transport = nodemailer.createTransport({
          host: config.smtp.host,
          port: config.smtp.port,
          secure: config.smtp.port === 465,
          auth: { user: config.smtp.user, pass: config.smtp.pass },
        });
        await transport.sendMail({
          from: config.smtp.from,
          to: email,
          subject: 'Reset your NEXO Messenger password',
          text: `Open this link to reset your password (valid 1 hour):\n\n${resetUrl}\n\nIf you did not request this, ignore this email.`,
        });
        return res.json({ ...generic, dev_reset_url: null, emailed: true });
      } catch (err) {
        console.error('[auth] SMTP send failed:', err);
        throw new ApiError(502, 'Failed to send reset email. Please try again later.');
      }
    }

    if (config.devExposeResetLink) {
      // Honest dev-mode behaviour: no SMTP configured, so the link is returned
      // to the caller and the UI clearly labels it as dev mode.
      return res.json({ ...generic, dev_reset_url: resetUrl, emailed: false });
    }
    return res.json({ ...generic, dev_reset_url: null, emailed: false });
  })
);

authRouter.post(
  '/reset',
  asyncHandler(async (req, res) => {
    const rawToken = String(req.body?.token || '');
    const password = validatePassword(req.body?.password);
    if (!rawToken) throw new ApiError(400, 'Reset token is required.');

    const user = get<{ id: string; reset_token_expires_at: string | null }>(
      'SELECT id, reset_token_expires_at FROM users WHERE reset_token_hash = ?',
      sha256(rawToken)
    );
    if (!user || !user.reset_token_expires_at || user.reset_token_expires_at < nowIso()) {
      throw new ApiError(400, 'This reset link is invalid or has expired. Request a new one.');
    }
    const passwordHash = await hashPassword(password);
    run(
      'UPDATE users SET password_hash = ?, reset_token_hash = NULL, reset_token_expires_at = NULL WHERE id = ?',
      passwordHash,
      user.id
    );
    res.json({ ok: true, message: 'Password updated. You can sign in now.' });
  })
);

// ── Google OAuth (official authorization-code flow) ──────────────────

const oauthStates = new Map<string, number>();
setInterval(() => {
  const cutoff = Date.now();
  for (const [state, exp] of oauthStates) if (exp < cutoff) oauthStates.delete(state);
}, 60_000).unref();

authRouter.get(
  '/google',
  asyncHandler(async (req, res) => {
    if (!googleConfigured) {
      throw new ApiError(
        501,
        'Google sign-in is not configured on this server. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (see README).'
      );
    }
    const state = randomBytes(16).toString('hex');
    oauthStates.set(state, Date.now() + 10 * 60 * 1000);
    const redirectUri = `${appBase(req)}/api/auth/google/callback`;
    const params = new URLSearchParams({
      client_id: config.google.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  })
);

authRouter.get(
  '/google/callback',
  asyncHandler(async (req, res) => {
    const base = appBase(req);
    try {
      if (!googleConfigured) throw new Error('Google sign-in is not configured on this server.');
      const code = String(req.query.code || '');
      const state = String(req.query.state || '');
      const stateExpiry = oauthStates.get(state);
      if (!code || !stateExpiry || stateExpiry < Date.now()) {
        throw new Error('Invalid or expired OAuth state. Please try again.');
      }
      oauthStates.delete(state);

      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: config.google.clientId,
          client_secret: config.google.clientSecret,
          redirect_uri: `${base}/api/auth/google/callback`,
          grant_type: 'authorization_code',
        }),
      });
      if (!tokenRes.ok) throw new Error(`Google token exchange failed (${tokenRes.status}).`);
      const tokens = (await tokenRes.json()) as { id_token?: string; access_token?: string };

      const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token || tokens.id_token || ''}` },
      });
      if (!infoRes.ok) throw new Error('Failed to fetch Google profile.');
      const info = (await infoRes.json()) as {
        sub: string;
        email?: string;
        name?: string;
        given_name?: string;
        picture?: string;
      };
      if (!info.email) throw new Error('Google account has no email address.');

      const email = normalizeEmail(info.email);
      let user = get<{ id: string }>(
        'SELECT id FROM users WHERE google_id = ? OR email = ?',
        info.sub,
        email
      );
      let userId: string;
      if (user) {
        userId = user.id;
        run(
          'UPDATE users SET google_id = COALESCE(google_id, ?) WHERE id = ?',
          info.sub,
          userId
        );
      } else {
        userId = randomUUID();
        const username = generateUsername(email.split('@')[0] || info.given_name || 'user');
        const displayName = (info.name || info.given_name || username).slice(0, 60);
        tx(() => {
          run(
            'INSERT INTO users (id, email, google_id, created_at) VALUES (?,?,?,?)',
            userId,
            email,
            info.sub,
            nowIso()
          );
          run(
            'INSERT INTO profiles (user_id, username, display_name, bio, created_at) VALUES (?,?,?,?,?)',
            userId,
            username,
            displayName,
            '',
            nowIso()
          );
          run('INSERT INTO user_settings (user_id) VALUES (?)', userId);
        });
      }

      const token = signToken(userId, email);
      // Token in the URL fragment — never sent to servers/logs.
      res.redirect(`${base}/auth/callback#token=${encodeURIComponent(token)}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Google sign-in failed.';
      res.redirect(`${base}/auth?google_error=${encodeURIComponent(message)}`);
    }
  })
);

// Verify a token (used by the /auth/callback SPA page via GET /me with the token)
authRouter.get(
  '/verify',
  asyncHandler(async (req, res) => {
    const token = String(req.query.token || '');
    const payload = token ? verifyToken(token) : null;
    if (!payload) throw new ApiError(401, 'Invalid token.');
    const profile = publicProfile(payload.sub);
    if (!profile) throw new ApiError(404, 'Profile not found.');
    res.json({ token, profile, settings: loadSettings(payload.sub) });
  })
);
