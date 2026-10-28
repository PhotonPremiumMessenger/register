import { Router } from 'express';
import { ApiError, asyncHandler, requireAuth } from '../auth';
import { get, run } from '../db';

export const settingsRouter = Router();

const THEMES = ['obsidian', 'midnight', 'black'] as const;
const DM_POLICY = ['everyone', 'nobody'] as const;

function load(userId: string) {
  const row = get<Record<string, unknown>>(
    `SELECT theme, notifications_enabled, notification_sound, show_online_status, allow_messages_from
     FROM user_settings WHERE user_id = ?`,
    userId
  );
  if (!row) {
    run('INSERT INTO user_settings (user_id) VALUES (?)', userId);
    return load(userId);
  }
  return {
    theme: String(row.theme ?? 'obsidian'),
    notifications_enabled: Number(row.notifications_enabled ?? 1) === 1,
    notification_sound: Number(row.notification_sound ?? 1) === 1,
    show_online_status: Number(row.show_online_status ?? 1) === 1,
    allow_messages_from: String(row.allow_messages_from ?? 'everyone'),
  };
}

settingsRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ settings: load(req.userId!) });
  })
);

settingsRouter.patch(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    load(userId); // ensure row exists
    const body = req.body || {};

    if (body.theme !== undefined) {
      if (!THEMES.includes(body.theme)) throw new ApiError(400, 'Unknown theme.');
      run('UPDATE user_settings SET theme = ? WHERE user_id = ?', String(body.theme), userId);
    }
    for (const field of ['notifications_enabled', 'notification_sound', 'show_online_status'] as const) {
      if (body[field] !== undefined) {
        run(
          `UPDATE user_settings SET ${field} = ? WHERE user_id = ?`,
          body[field] ? 1 : 0,
          userId
        );
      }
    }
    if (body.allow_messages_from !== undefined) {
      if (!DM_POLICY.includes(body.allow_messages_from)) {
        throw new ApiError(400, 'Unknown message policy.');
      }
      run(
        'UPDATE user_settings SET allow_messages_from = ? WHERE user_id = ?',
        String(body.allow_messages_from),
        userId
      );
    }
    res.json({ settings: load(userId) });
  })
);
