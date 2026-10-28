import { Router } from 'express';
import { randomUUID } from 'crypto';
import { ApiError, asyncHandler, requireAuth } from '../auth';
import { all, get, run, tx, nowIso } from '../db';
import { attachmentDto, MESSAGE_COLUMNS, MessageDto, messageToDto, publicProfile, publicProfiles } from '../dto';
import { chatMemberIds, sendToUsers } from '../realtime';

export const groupRouter = Router();

type GroupRole = 'owner' | 'admin' | 'member';
const ROLE_RANK: Record<GroupRole, number> = { member: 0, admin: 1, owner: 2 };

interface GroupRow {
  id: string;
  name: string;
  description: string;
  is_public: number;
  owner_id: string;
  avatar_attachment_id: string | null;
  created_at: string;
}

function getGroup(id: string): GroupRow {
  const group = get<GroupRow>('SELECT * FROM groups WHERE id = ?', id);
  if (!group) throw new ApiError(404, 'Group not found.');
  return group;
}

function membership(groupId: string, userId: string): { role: GroupRole } | null {
  const row = get<{ role: string }>(
    'SELECT role FROM group_members WHERE group_id = ? AND user_id = ?',
    groupId,
    userId
  );
  return row ? { role: row.role as GroupRole } : null;
}

function requireMember(groupId: string, userId: string): GroupRole {
  const m = membership(groupId, userId);
  if (!m) throw new ApiError(403, 'You are not a member of this group.');
  return m.role;
}

function requireRole(groupId: string, userId: string, min: 'admin' | 'owner'): GroupRole {
  const role = requireMember(groupId, userId);
  if (ROLE_RANK[role] < ROLE_RANK[min]) {
    throw new ApiError(403, min === 'owner' ? 'Only the group owner can do that.' : 'Only group admins can do that.');
  }
  return role;
}

function memberCount(groupId: string): number {
  return Number(get<{ n: number }>('SELECT COUNT(*) AS n FROM group_members WHERE group_id = ?', groupId)?.n ?? 0);
}

function lastMessage(groupId: string): MessageDto | null {
  const row = get<Record<string, unknown>>(
    `SELECT ${MESSAGE_COLUMNS} FROM messages m WHERE m.group_id = ?
     ORDER BY m.created_at DESC, m.id DESC LIMIT 1`,
    groupId
  );
  if (!row) return null;
  return messageToDto(row, publicProfiles([String(row.sender_id)]));
}

function unreadCount(groupId: string, userId: string): number {
  const my = get<{ last_read_at: string | null }>(
    'SELECT last_read_at FROM group_members WHERE group_id = ? AND user_id = ?',
    groupId,
    userId
  );
  const lastRead = my?.last_read_at ?? null;
  return Number(
    get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM messages
       WHERE group_id = ? AND sender_id != ? AND (? IS NULL OR created_at > ?)`,
      groupId,
      userId,
      lastRead,
      lastRead
    )?.n ?? 0
  );
}

function groupDto(row: GroupRow, userId: string, withActivity: boolean) {
  const myRole = membership(row.id, userId)?.role ?? null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    is_public: row.is_public === 1,
    owner_id: row.owner_id,
    avatar_attachment_id: row.avatar_attachment_id,
    created_at: row.created_at,
    member_count: memberCount(row.id),
    my_role: myRole,
    ...(withActivity && myRole
      ? { last_message: lastMessage(row.id), unread_count: unreadCount(row.id, userId) }
      : {}),
  };
}

// ── my groups ─────────────────────────────────────────────────────────

groupRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const rows = all<GroupRow>(
      `SELECT g.* FROM groups g
       JOIN group_members gm ON gm.group_id = g.id
       WHERE gm.user_id = ?
       ORDER BY g.created_at DESC LIMIT 200`,
      userId
    );
    res.json({ groups: rows.map((r) => groupDto(r, userId, true)) });
  })
);

// ── discover public groups ────────────────────────────────────────────

groupRouter.get(
  '/discover',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = all<GroupRow>(
      `SELECT g.* FROM groups g WHERE g.is_public = 1
       ORDER BY g.created_at DESC LIMIT 30`
    );
    res.json({ groups: rows.map((r) => groupDto(r, req.userId!, false)) });
  })
);

// ── create ────────────────────────────────────────────────────────────

groupRouter.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const name = String(req.body?.name || '').trim().slice(0, 60);
    if (!name) throw new ApiError(400, 'Group name is required.');
    const description = String(req.body?.description || '').slice(0, 300);
    const isPublic = req.body?.is_public ? 1 : 0;
    const avatarId = req.body?.avatar_attachment_id ? String(req.body.avatar_attachment_id) : null;
    if (avatarId) {
      const att = get<{ id: string; uploader_id: string; kind: string }>(
        'SELECT uploader_id, kind FROM attachments WHERE id = ?',
        avatarId
      );
      if (!att || att.uploader_id !== userId || att.kind !== 'group_avatar') {
        throw new ApiError(400, 'Invalid group avatar.');
      }
    }
    const memberIds = Array.isArray(req.body?.member_ids)
      ? [...new Set((req.body.member_ids as unknown[]).map(String))].filter((id) => id !== userId)
      : [];
    for (const id of memberIds) {
      if (!publicProfile(id, false)) throw new ApiError(400, `User ${id} was not found.`);
    }

    const id = randomUUID();
    tx(() => {
      run(
        `INSERT INTO groups (id, name, description, is_public, owner_id, avatar_attachment_id, created_at)
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
        "INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?,?, 'owner', ?)",
        id,
        userId,
        nowIso()
      );
      for (const memberId of memberIds) {
        run(
          "INSERT OR IGNORE INTO group_members (group_id, user_id, role, joined_at) VALUES (?,?, 'member', ?)",
          id,
          memberId,
          nowIso()
        );
      }
    });
    const group = getGroup(id);
    res.status(201).json({ group: groupDto(group, userId, true) });
  })
);

// ── detail ────────────────────────────────────────────────────────────

groupRouter.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const group = getGroup(req.params.id);
    const myRole = membership(group.id, req.userId!);
    if (!myRole && group.is_public !== 1) {
      throw new ApiError(403, 'This group is private. Only members can view it.');
    }
    res.json({ group: groupDto(group, req.userId!, true) });
  })
);

groupRouter.patch(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const group = getGroup(req.params.id);
    requireRole(group.id, userId, 'admin');
    const body = req.body || {};
    if (body.name !== undefined) {
      const name = String(body.name).trim().slice(0, 60);
      if (!name) throw new ApiError(400, 'Group name cannot be empty.');
      run('UPDATE groups SET name = ? WHERE id = ?', name, group.id);
    }
    if (body.description !== undefined) {
      run('UPDATE groups SET description = ? WHERE id = ?', String(body.description).slice(0, 300), group.id);
    }
    if (body.is_public !== undefined) {
      run('UPDATE groups SET is_public = ? WHERE id = ?', body.is_public ? 1 : 0, group.id);
    }
    if (body.avatar_attachment_id !== undefined) {
      if (body.avatar_attachment_id === null) {
        run('UPDATE groups SET avatar_attachment_id = NULL WHERE id = ?', group.id);
      } else {
        const att = get<{ id: string; uploader_id: string; kind: string }>(
          'SELECT uploader_id, kind FROM attachments WHERE id = ?',
          String(body.avatar_attachment_id)
        );
        if (!att || att.uploader_id !== userId || att.kind !== 'group_avatar') {
          throw new ApiError(400, 'Invalid group avatar.');
        }
        run('UPDATE groups SET avatar_attachment_id = ? WHERE id = ?', att.id, group.id);
      }
    }
    res.json({ group: groupDto(getGroup(group.id), userId, true) });
  })
);

groupRouter.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const group = getGroup(req.params.id);
    requireRole(group.id, req.userId!, 'owner');
    run('DELETE FROM groups WHERE id = ?', group.id);
    res.json({ ok: true });
  })
);

// ── membership ────────────────────────────────────────────────────────

groupRouter.get(
  '/:id/members',
  requireAuth,
  asyncHandler(async (req, res) => {
    const group = getGroup(req.params.id);
    requireMember(group.id, req.userId!);
    const rows = all<{ user_id: string; role: string; joined_at: string }>(
      'SELECT user_id, role, joined_at FROM group_members WHERE group_id = ? ORDER BY joined_at ASC LIMIT 500',
      group.id
    );
    const profiles = publicProfiles(rows.map((r) => r.user_id));
    res.json({
      members: rows
        .map((r) => ({ ...profiles.get(r.user_id), role: r.role, joined_at: r.joined_at }))
        .filter((m) => m.id),
    });
  })
);

groupRouter.post(
  '/:id/join',
  requireAuth,
  asyncHandler(async (req, res) => {
    const group = getGroup(req.params.id);
    if (group.is_public !== 1) {
      throw new ApiError(403, 'This group is private. An admin must add you.');
    }
    run(
      "INSERT OR IGNORE INTO group_members (group_id, user_id, role, joined_at) VALUES (?,?, 'member', ?)",
      group.id,
      req.userId!,
      nowIso()
    );
    res.json({ group: groupDto(getGroup(group.id), req.userId!, true) });
  })
);

groupRouter.post(
  '/:id/members',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const group = getGroup(req.params.id);
    requireRole(group.id, userId, 'admin');
    const memberIds = Array.isArray(req.body?.user_ids)
      ? [...new Set((req.body.user_ids as unknown[]).map(String))]
      : [];
    if (memberIds.length === 0) throw new ApiError(400, 'No users selected.');
    for (const id of memberIds) {
      if (!publicProfile(id, false)) throw new ApiError(404, `User ${id} was not found.`);
      run(
        "INSERT OR IGNORE INTO group_members (group_id, user_id, role, joined_at) VALUES (?,?, 'member', ?)",
        group.id,
        id,
        nowIso()
      );
    }
    res.json({ ok: true, group: groupDto(getGroup(group.id), userId, true) });
  })
);

groupRouter.patch(
  '/:id/members/:memberId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const group = getGroup(req.params.id);
    requireRole(group.id, userId, 'owner'); // only owners manage roles
    const target = membership(group.id, req.params.memberId);
    if (!target) throw new ApiError(404, 'That user is not a member of this group.');
    const newRole = String(req.body?.role || '');

    if (newRole === 'owner') {
      // Ownership transfer: allowed only from the current owner to a member.
      if (userId !== group.owner_id) throw new ApiError(403, 'Only the owner can transfer ownership.');
      tx(() => {
        run("UPDATE group_members SET role = 'owner' WHERE group_id = ? AND user_id = ?", group.id, req.params.memberId);
        run("UPDATE group_members SET role = 'admin' WHERE group_id = ? AND user_id = ?", group.id, userId);
        run('UPDATE groups SET owner_id = ? WHERE id = ?', req.params.memberId, group.id);
      });
      return res.json({ ok: true, transferred: true });
    }
    if (!['admin', 'member'].includes(newRole)) throw new ApiError(400, 'Role must be "admin" or "member".');
    if (target.role === 'owner') throw new ApiError(400, 'The owner\'s role cannot be changed. Transfer ownership instead.');
    run('UPDATE group_members SET role = ? WHERE group_id = ? AND user_id = ?', newRole, group.id, req.params.memberId);
    res.json({ ok: true });
  })
);

groupRouter.delete(
  '/:id/members/:memberId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const group = getGroup(req.params.id);
    const targetId = req.params.memberId;

    if (targetId === userId) {
      // Leaving
      const role = requireMember(group.id, userId);
      if (role === 'owner') {
        throw new ApiError(400, 'Owners cannot leave their own group. Transfer ownership or delete the group first.');
      }
      run('DELETE FROM group_members WHERE group_id = ? AND user_id = ?', group.id, userId);
      return res.json({ ok: true, left: true });
    }

    // Kicking someone else
    const myRole = requireRole(group.id, userId, 'admin');
    const target = membership(group.id, targetId);
    if (!target) throw new ApiError(404, 'That user is not a member of this group.');
    if (ROLE_RANK[target.role] >= ROLE_RANK[myRole]) {
      throw new ApiError(403, 'You cannot remove a member with an equal or higher role than yours.');
    }
    run('DELETE FROM group_members WHERE group_id = ? AND user_id = ?', group.id, targetId);
    res.json({ ok: true });
  })
);

// ── messages ──────────────────────────────────────────────────────────

groupRouter.get(
  '/:id/messages',
  requireAuth,
  asyncHandler(async (req, res) => {
    const group = getGroup(req.params.id);
    requireMember(group.id, req.userId!);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const before = typeof req.query.before === 'string' ? req.query.before : null;
    const rows = all<Record<string, unknown>>(
      `SELECT ${MESSAGE_COLUMNS} FROM messages m
       WHERE m.group_id = ? AND (? IS NULL OR m.created_at < ?)
       ORDER BY m.created_at DESC, m.id DESC LIMIT ?`,
      group.id,
      before,
      before,
      limit
    );
    rows.reverse();
    const profiles = publicProfiles(rows.map((r) => String(r.sender_id)));
    res.json({ messages: rows.map((r) => messageToDto(r, profiles)), has_more: rows.length === limit });
  })
);

groupRouter.post(
  '/:id/messages',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const group = getGroup(req.params.id);
    requireMember(group.id, userId);
    const content = String(req.body?.content ?? '').slice(0, 4000);
    const attachmentId = req.body?.attachment_id ? String(req.body.attachment_id) : null;
    if (!content.trim() && !attachmentId) throw new ApiError(400, 'Message cannot be empty.');
    if (attachmentId) {
      const att = get<{ uploader_id: string }>('SELECT uploader_id FROM attachments WHERE id = ?', attachmentId);
      if (!att || att.uploader_id !== userId) throw new ApiError(400, 'Invalid attachment.');
    }

    const id = randomUUID();
    const createdAt = nowIso();
    run(
      `INSERT INTO messages (id, conversation_id, group_id, sender_id, content, attachment_id, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      id,
      null,
      group.id,
      userId,
      content,
      attachmentId,
      createdAt
    );

    const dto: MessageDto = {
      id,
      conversation_id: null,
      group_id: group.id,
      sender: publicProfile(userId),
      content,
      attachment: attachmentDto(attachmentId),
      created_at: createdAt,
    };
    sendToUsers(chatMemberIds('group', group.id), { type: 'message', message: dto });
    res.status(201).json({ message: dto });
  })
);

groupRouter.post(
  '/:id/read',
  requireAuth,
  asyncHandler(async (req, res) => {
    const group = getGroup(req.params.id);
    requireMember(group.id, req.userId!);
    const at = nowIso();
    run(
      'UPDATE group_members SET last_read_at = ? WHERE group_id = ? AND user_id = ?',
      at,
      group.id,
      req.userId!
    );
    sendToUsers(chatMemberIds('group', group.id).filter((id) => id !== req.userId!), {
      type: 'read',
      chat_type: 'group',
      chat_id: group.id,
      user_id: req.userId!,
      at,
    });
    res.json({ ok: true, at });
  })
);
