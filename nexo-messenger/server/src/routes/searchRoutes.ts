import { Router } from 'express';
import { ApiError, asyncHandler, requireAuth } from '../auth';
import { all, get } from '../db';
import { publicProfile } from '../dto';

export const searchRouter = Router();

function escapeLike(q: string): string {
  return q.replace(/[%_]/g, (m) => `\\${m}`);
}

searchRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const q = String(req.query.q || '').trim();
    const scope = String(req.query.scope || 'all');
    if (!q) {
      return res.json({ people: [], groups: [], channels: [] });
    }
    if (q.length > 100) throw new ApiError(400, 'Search query is too long.');
    const userId = req.userId!;
    const like = `%${escapeLike(q.toLowerCase())}%`;
    const limit = 10;

    const result: {
      people: ReturnType<typeof publicProfile>[];
      groups: Record<string, unknown>[];
      channels: Record<string, unknown>[];
    } = { people: [], groups: [], channels: [] };

    if (scope === 'all' || scope === 'people') {
      const rows = all<{ user_id: string }>(
        `SELECT user_id FROM profiles
         WHERE username LIKE ? ESCAPE '\\' OR lower(display_name) LIKE ? ESCAPE '\\'
         ORDER BY
           CASE WHEN username = ? THEN 0 WHEN username LIKE ? THEN 1 ELSE 2 END,
           display_name
         LIMIT ?`,
        like,
        like,
        q.toLowerCase().replace(/^@/, ''),
        `${escapeLike(q.toLowerCase().replace(/^@/, ''))}%`,
        limit
      );
      result.people = rows.map((r) => publicProfile(r.user_id)).filter(Boolean);
    }

    if (scope === 'all' || scope === 'groups') {
      const rows = all<Record<string, unknown>>(
        `SELECT g.id, g.name, g.description, g.is_public, g.owner_id, g.avatar_attachment_id, g.created_at,
                (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) AS member_count,
                (SELECT gm2.role FROM group_members gm2 WHERE gm2.group_id = g.id AND gm2.user_id = ?) AS my_role
         FROM groups g
         WHERE lower(g.name) LIKE ? ESCAPE '\\' AND (g.is_public = 1 OR my_role IS NOT NULL)
         ORDER BY g.is_public DESC, member_count DESC
         LIMIT ?`,
        userId,
        like,
        limit
      );
      result.groups = rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        is_public: r.is_public === 1,
        owner_id: r.owner_id,
        avatar_attachment_id: r.avatar_attachment_id ?? null,
        created_at: r.created_at,
        member_count: Number(r.member_count ?? 0),
        my_role: r.my_role ?? null,
      }));
    }

    if (scope === 'all' || scope === 'channels') {
      const rows = all<Record<string, unknown>>(
        `SELECT c.id, c.name, c.description, c.is_public, c.owner_id, c.avatar_attachment_id, c.created_at,
                (SELECT COUNT(*) FROM channel_members cm WHERE cm.channel_id = c.id) AS subscriber_count,
                (SELECT cm2.role FROM channel_members cm2 WHERE cm2.channel_id = c.id AND cm2.user_id = ?) AS my_role
         FROM channels c
         WHERE lower(c.name) LIKE ? ESCAPE '\\' AND (c.is_public = 1 OR my_role IS NOT NULL)
         ORDER BY c.is_public DESC, subscriber_count DESC
         LIMIT ?`,
        userId,
        like,
        limit
      );
      result.channels = rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        is_public: r.is_public === 1,
        owner_id: r.owner_id,
        avatar_attachment_id: r.avatar_attachment_id ?? null,
        created_at: r.created_at,
        subscriber_count: Number(r.subscriber_count ?? 0),
        my_role: r.my_role ?? null,
      }));
    }

    res.json(result);
  })
);
