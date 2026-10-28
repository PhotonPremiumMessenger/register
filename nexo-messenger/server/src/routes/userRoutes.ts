import { Router } from 'express';
import {
  ApiError,
  asyncHandler,
  normalizeUsername,
  requireAuth,
  validateUsername,
} from '../auth';
import { get, run } from '../db';
import { publicProfile } from '../dto';

export const userRouter = Router();

userRouter.get(
  '/by-username/:username',
  requireAuth,
  asyncHandler(async (req, res) => {
    const username = normalizeUsername(req.params.username);
    const row = get<{ user_id: string }>('SELECT user_id FROM profiles WHERE username = ?', username);
    if (!row) throw new ApiError(404, `No user found with @${username}.`);
    res.json({ profile: publicProfile(row.user_id) });
  })
);

userRouter.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const profile = publicProfile(req.params.id);
    if (!profile) throw new ApiError(404, 'User not found.');
    res.json({ profile });
  })
);

userRouter.patch(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const { display_name, username, bio, avatar_attachment_id } = req.body || {};

    if (username !== undefined) {
      const normalized = normalizeUsername(username);
      validateUsername(normalized);
      const clash = get<{ user_id: string }>(
        'SELECT user_id FROM profiles WHERE username = ? AND user_id != ?',
        normalized,
        userId
      );
      if (clash) throw new ApiError(409, `Username @${normalized} is already taken.`);
      run('UPDATE profiles SET username = ? WHERE user_id = ?', normalized, userId);
    }
    if (display_name !== undefined) {
      const name = String(display_name).trim().slice(0, 60);
      if (!name) throw new ApiError(400, 'Display name cannot be empty.');
      run('UPDATE profiles SET display_name = ? WHERE user_id = ?', name, userId);
    }
    if (bio !== undefined) {
      run('UPDATE profiles SET bio = ? WHERE user_id = ?', String(bio).slice(0, 300), userId);
    }
    if (avatar_attachment_id !== undefined) {
      if (avatar_attachment_id === null) {
        run('UPDATE profiles SET avatar_attachment_id = NULL WHERE user_id = ?', userId);
      } else {
        const att = get<{ id: string; uploader_id: string; kind: string }>(
          'SELECT id, uploader_id, kind FROM attachments WHERE id = ?',
          String(avatar_attachment_id)
        );
        if (!att || att.uploader_id !== userId || att.kind !== 'avatar') {
          throw new ApiError(400, 'Invalid avatar attachment.');
        }
        run('UPDATE profiles SET avatar_attachment_id = ? WHERE user_id = ?', att.id, userId);
      }
    }
    res.json({ profile: publicProfile(userId) });
  })
);
