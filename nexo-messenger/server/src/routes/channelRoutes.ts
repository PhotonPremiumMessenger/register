import { Router } from 'express';
import { randomUUID } from 'crypto';
import { ApiError, asyncHandler, requireAuth } from '../auth';
import { all, get, run, tx, nowIso } from '../db';
import { attachmentDto, publicProfile, publicProfiles } from '../dto';
import { sendToUsers } from '../realtime';

export const channelRouter = Router();

type ChannelRole = 'owner' | 'admin' | 'subscriber';
const ROLE_RANK: Record<ChannelRole, number> = { subscriber: 0, admin: 1, owner: 2 };

interface ChannelRow {
  id: string;
  name: string;
  description: string;
  is_public: number;
  owner_id: string;
  avatar_attachment_id: string | null;
  created_at: string;
}

function getChannel(id: string): ChannelRow {
  const channel = get<ChannelRow>('SELECT * FROM channels WHERE id = ?', id);
  if (!channel) throw new ApiError(404, 'Channel not found.');
  return channel;
}

function membership(channelId: string, userId: string): ChannelRole | null {
  const row = get<{ role: string }>(
    'SELECT role FROM channel_members WHERE channel_id = ? AND user_id = ?',
    channelId,
    userId
  );
  return row ? (row.role as ChannelRole) : null;
}

function requireMember(channelId: string, userId: string): ChannelRole {
  const role = membership(channelId, userId);
  if (!role) throw new ApiError(403, 'You are not subscribed to this channel.');
  return role;
}

function subscriberCount(channelId: string): number {
  return Number(
    get<{ n: number }>('SELECT COUNT(*) AS n FROM channel_members WHERE channel_id = ?', channelId)?.n ?? 0
  );
}

interface PostRow {
  id: string;
  channel_id: string;
  author_id: string;
  content: string;
  attachment_id: string | null;
  created_at: string;
}

function postToDto(row: PostRow) {
  return {
    id: row.id,
    channel_id: row.channel_id,
    author: publicProfile(row.author_id),
    content: row.content,
    attachment: attachmentDto(row.attachment_id),
    created_at: row.created_at,
  };
}

function lastPost(channelId: string) {
  const row = get<PostRow>(
    'SELECT * FROM channel_posts WHERE channel_id = ? ORDER BY created_at DESC, id DESC LIMIT 1',
    channelId
  );
  return row ? postToDto(row) : null;
}

function unreadCount(channelId: string, userId: string): number {
  const my = get<{ last_read_at: string | null }>(
    'SELECT last_read_at FROM channel_members WHERE channel_id = ? AND user_id = ?',
    channelId,
    userId
  );
  const lastRead = my?.last_read_at ?? null;
  return Number(
    get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM channel_posts
       WHERE channel_id = ? AND author_id != ? AND (? IS NULL OR created_at > ?)`,
      channelId,
      userId,
      lastRead,
      lastRead
    )?.n ?? 0
  );
}

function channelDto(row: ChannelRow, userId: string, withActivity: boolean) {
  const myRole = membership(row.id, userId);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    is_public: row.is_public === 1,
    owner_id: row.owner_id,
    avatar_attachment_id: row.avatar_attachment_id,
    created_at: row.created_at,
    subscriber_count: subscriberCount(row.id),
    my_role: myRole,
    can_publish: myRole === 'owner' || myRole === 'admin',
    ...(withActivity && myRole ? { last_post: lastPost(row.id), unread_count: unreadCount(row.id, userId) } : {}),
  };
}

function channelMembers(channelId: string): string[] {
  return all<{ user_id: string }>('SELECT user_id FROM channel_members WHERE channel_id = ?', channelId).map(
    (r) => r.user_id
  );
}

// ── my channels ───────────────────────────────────────────────────────

channelRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = all<ChannelRow>(
      `SELECT c.* FROM channels c
       JOIN channel_members cm ON cm.channel_id = c.id
       WHERE cm.user_id = ?
       ORDER BY c.created_at DESC LIMIT 200`,
      req.userId!
    );
    res.json({ channels: rows.map((r) => channelDto(r, req.userId!, true)) });
  })
);

// ── discover public channels ─────────────────────────────────────────

channelRouter.get(
  '/discover',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = all<ChannelRow>(
      `SELECT c.* FROM channels c WHERE c.is_public = 1
       ORDER BY c.created_at DESC LIMIT 30`
    );
    res.json({ channels: rows.map((r) => channelDto(r, req.userId!, false)) });
  })
);

// ── create ────────────────────────────────────────────────────────────

channelRouter.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const name = String(req.body?.name || '').trim().slice(0, 60);
    if (!name) throw new ApiError(400, 'Channel name is required.');
    const description = String(req.body?.description || '').slice(0, 500);
    const isPublic = req.body?.is_public === false ? 0 : 1;
    const avatarId = req.body?.avatar_attachment_id ? String(req.body.avatar_attachment_id) : null;
    if (avatarId) {
      const att = get<{ id: string; uploader_id: string; kind: string }>(
        'SELECT uploader_id, kind FROM attachments WHERE id = ?',
        avatarId
      );
      if (!att || att.uploader_id !== userId || att.kind !== 'channel_avatar') {
        throw new ApiError(400, 'Invalid channel avatar.');
      }
    }

    const id = randomUUID();
    tx(() => {
      run(
        `INSERT INTO channels (id, name, description, is_public, owner_id, avatar_attachment_id, created_at)
         VALUES (?,?,?,?,?,?,?)`,
        id,
        name,
        description,
        isPublic,
        userId,
        avatarId,
        nowIso()
      );
      run(
        "INSERT INTO channel_members (channel_id, user_id, role, joined_at) VALUES (?,?, 'owner', ?)",
        id,
        userId,
        nowIso()
      );
    });
    res.status(201).json({ channel: channelDto(getChannel(id), userId, true) });
  })
);

// ── detail ────────────────────────────────────────────────────────────

channelRouter.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const channel = getChannel(req.params.id);
    const myRole = membership(channel.id, req.userId!);
    if (!myRole && channel.is_public !== 1) {
      throw new ApiError(403, 'This channel is private. Only subscribers can view it.');
    }
    res.json({ channel: channelDto(channel, req.userId!, true) });
  })
);

channelRouter.patch(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const channel = getChannel(req.params.id);
    const role = requireMember(channel.id, userId);
    if (ROLE_RANK[role] < ROLE_RANK.admin) throw new ApiError(403, 'Only channel admins can edit the channel.');
    const body = req.body || {};
    if (body.name !== undefined) {
      const name = String(body.name).trim().slice(0, 60);
      if (!name) throw new ApiError(400, 'Channel name cannot be empty.');
      run('UPDATE channels SET name = ? WHERE id = ?', name, channel.id);
    }
    if (body.description !== undefined) {
      run('UPDATE channels SET description = ? WHERE id = ?', String(body.description).slice(0, 500), channel.id);
    }
    if (body.is_public !== undefined && role === 'owner') {
      run('UPDATE channels SET is_public = ? WHERE id = ?', body.is_public ? 1 : 0, channel.id);
    }
    if (body.avatar_attachment_id !== undefined) {
      if (body.avatar_attachment_id === null) {
        run('UPDATE channels SET avatar_attachment_id = NULL WHERE id = ?', channel.id);
      } else {
        const att = get<{ id: string; uploader_id: string; kind: string }>(
          'SELECT uploader_id, kind FROM attachments WHERE id = ?',
          String(body.avatar_attachment_id)
        );
        if (!att || att.uploader_id !== userId || att.kind !== 'channel_avatar') {
          throw new ApiError(400, 'Invalid channel avatar.');
        }
        run('UPDATE channels SET avatar_attachment_id = ? WHERE id = ?', att.id, channel.id);
      }
    }
    res.json({ channel: channelDto(getChannel(channel.id), userId, true) });
  })
);

channelRouter.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const channel = getChannel(req.params.id);
    if (membership(channel.id, req.userId!) !== 'owner') {
      throw new ApiError(403, 'Only the channel owner can delete the channel.');
    }
    run('DELETE FROM channels WHERE id = ?', channel.id);
    res.json({ ok: true });
  })
);

// ── subscribe / unsubscribe / members ────────────────────────────────

channelRouter.post(
  '/:id/subscribe',
  requireAuth,
  asyncHandler(async (req, res) => {
    const channel = getChannel(req.params.id);
    if (channel.is_public !== 1) {
      throw new ApiError(403, 'This channel is private. An admin must add you.');
    }
    run(
      "INSERT OR IGNORE INTO channel_members (channel_id, user_id, role, joined_at) VALUES (?,?, 'subscriber', ?)",
      channel.id,
      req.userId!,
      nowIso()
    );
    res.json({ channel: channelDto(getChannel(channel.id), req.userId!, true) });
  })
);

channelRouter.delete(
  '/:id/subscribe',
  requireAuth,
  asyncHandler(async (req, res) => {
    const channel = getChannel(req.params.id);
    const role = requireMember(channel.id, req.userId!);
    if (role === 'owner') {
      throw new ApiError(400, 'The owner cannot unsubscribe. Delete the channel instead.');
    }
    run('DELETE FROM channel_members WHERE channel_id = ? AND user_id = ?', channel.id, req.userId!);
    res.json({ ok: true });
  })
);

channelRouter.get(
  '/:id/members',
  requireAuth,
  asyncHandler(async (req, res) => {
    const channel = getChannel(req.params.id);
    requireMember(channel.id, req.userId!);
    const rows = all<{ user_id: string; role: string; joined_at: string }>(
      'SELECT user_id, role, joined_at FROM channel_members WHERE channel_id = ? ORDER BY joined_at ASC LIMIT 1000',
      channel.id
    );
    const profiles = publicProfiles(rows.map((r) => r.user_id));
    res.json({
      members: rows.map((r) => ({ ...profiles.get(r.user_id), role: r.role, joined_at: r.joined_at })).filter((m) => m.id),
    });
  })
);

channelRouter.post(
  '/:id/members',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const channel = getChannel(req.params.id);
    const role = requireMember(channel.id, userId);
    if (ROLE_RANK[role] < ROLE_RANK.admin) {
      throw new ApiError(403, 'Only channel admins can add subscribers.');
    }
    const memberIds = Array.isArray(req.body?.user_ids)
      ? [...new Set((req.body.user_ids as unknown[]).map(String))]
      : [];
    if (memberIds.length === 0) throw new ApiError(400, 'No users selected.');
    for (const id of memberIds) {
      if (!publicProfile(id, false)) throw new ApiError(404, `User ${id} was not found.`);
      run(
        "INSERT OR IGNORE INTO channel_members (channel_id, user_id, role, joined_at) VALUES (?,?, 'subscriber', ?)",
        channel.id,
        id,
        nowIso()
      );
    }
    res.json({ ok: true, channel: channelDto(getChannel(channel.id), userId, true) });
  })
);

channelRouter.patch(
  '/:id/members/:memberId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const channel = getChannel(req.params.id);
    if (membership(channel.id, userId) !== 'owner') {
      throw new ApiError(403, 'Only the channel owner can manage roles.');
    }
    const targetRole = membership(channel.id, req.params.memberId);
    if (!targetRole) throw new ApiError(404, 'That user is not a subscriber of this channel.');
    const newRole = String(req.body?.role || '');
    if (newRole === 'owner') {
      tx(() => {
        run("UPDATE channel_members SET role = 'owner' WHERE channel_id = ? AND user_id = ?", channel.id, req.params.memberId);
        run("UPDATE channel_members SET role = 'admin' WHERE channel_id = ? AND user_id = ?", channel.id, userId);
        run('UPDATE channels SET owner_id = ? WHERE id = ?', req.params.memberId, channel.id);
      });
      return res.json({ ok: true, transferred: true });
    }
    if (!['admin', 'subscriber'].includes(newRole)) {
      throw new ApiError(400, 'Role must be "admin" or "subscriber".');
    }
    if (targetRole === 'owner') throw new ApiError(400, "The owner's role cannot be changed. Transfer ownership instead.");
    run('UPDATE channel_members SET role = ? WHERE channel_id = ? AND user_id = ?', newRole, channel.id, req.params.memberId);
    res.json({ ok: true });
  })
);

channelRouter.delete(
  '/:id/members/:memberId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const channel = getChannel(req.params.id);
    const myRole = requireMember(channel.id, userId);
    if (ROLE_RANK[myRole] < ROLE_RANK.admin) throw new ApiError(403, 'Only channel admins can remove subscribers.');
    const targetRole = membership(channel.id, req.params.memberId);
    if (!targetRole) throw new ApiError(404, 'That user is not a subscriber of this channel.');
    if (ROLE_RANK[targetRole] >= ROLE_RANK[myRole]) {
      throw new ApiError(403, 'You cannot remove a subscriber with an equal or higher role than yours.');
    }
    run('DELETE FROM channel_members WHERE channel_id = ? AND user_id = ?', channel.id, req.params.memberId);
    res.json({ ok: true });
  })
);

// ── posts ─────────────────────────────────────────────────────────────

channelRouter.get(
  '/:id/posts',
  requireAuth,
  asyncHandler(async (req, res) => {
    const channel = getChannel(req.params.id);
    requireMember(channel.id, req.userId!);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const before = typeof req.query.before === 'string' ? req.query.before : null;
    const rows = all<PostRow>(
      `SELECT * FROM channel_posts
       WHERE channel_id = ? AND (? IS NULL OR created_at < ?)
       ORDER BY created_at DESC, id DESC LIMIT ?`,
      channel.id,
      before,
      before,
      limit
    );
    rows.reverse();
    res.json({ posts: rows.map(postToDto), has_more: rows.length === limit });
  })
);

channelRouter.post(
  '/:id/posts',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const channel = getChannel(req.params.id);
    const role = requireMember(channel.id, userId);
    if (role !== 'owner' && role !== 'admin') {
      throw new ApiError(403, 'Only the channel owner and admins can publish posts.');
    }
    const content = String(req.body?.content ?? '').slice(0, 8000);
    const attachmentId = req.body?.attachment_id ? String(req.body.attachment_id) : null;
    if (!content.trim() && !attachmentId) throw new ApiError(400, 'Post cannot be empty.');
    if (attachmentId) {
      const att = get<{ uploader_id: string }>('SELECT uploader_id FROM attachments WHERE id = ?', attachmentId);
      if (!att || att.uploader_id !== userId) throw new ApiError(400, 'Invalid attachment.');
    }

    const id = randomUUID();
    const createdAt = nowIso();
    run(
      `INSERT INTO channel_posts (id, channel_id, author_id, content, attachment_id, created_at)
       VALUES (?,?,?,?,?,?)`,
      id,
      channel.id,
      userId,
      content,
      attachmentId,
      createdAt
    );
    const post = {
      id,
      channel_id: channel.id,
      author: publicProfile(userId),
      content,
      attachment: attachmentDto(attachmentId),
      created_at: createdAt,
    };
    sendToUsers(channelMembers(channel.id), { type: 'post', post });
    res.status(201).json({ post });
  })
);

channelRouter.post(
  '/:id/read',
  requireAuth,
  asyncHandler(async (req, res) => {
    const channel = getChannel(req.params.id);
    requireMember(channel.id, req.userId!);
    run(
      'UPDATE channel_members SET last_read_at = ? WHERE channel_id = ? AND user_id = ?',
      nowIso(),
      channel.id,
      req.userId!
    );
    res.json({ ok: true });
  })
);
