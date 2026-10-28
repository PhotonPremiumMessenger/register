import { Router } from 'express';
import { randomUUID } from 'crypto';
import { ApiError, asyncHandler, requireAuth } from '../auth';
import { all, get, run, tx, nowIso } from '../db';
import { attachmentDto, MESSAGE_COLUMNS, MessageDto, messageToDto, publicProfile, publicProfiles } from '../dto';
import { chatMemberIds, sendToUsers } from '../realtime';

export const chatRouter = Router();

function requireConversationMember(userId: string, conversationId: string) {
  const conv = get<{ id: string; user_a_id: string; user_b_id: string }>(
    'SELECT id, user_a_id, user_b_id FROM conversations WHERE id = ?',
    conversationId
  );
  if (!conv) throw new ApiError(404, 'Conversation not found.');
  if (conv.user_a_id !== userId && conv.user_b_id !== userId) {
    throw new ApiError(403, 'You are not a participant of this conversation.');
  }
  return conv;
}

function readState(conversationId: string, userId: string) {
  const rows = all<{ user_id: string; last_read_at: string | null }>(
    'SELECT user_id, last_read_at FROM conversation_members WHERE conversation_id = ?',
    conversationId
  );
  const mine = rows.find((r) => r.user_id === userId)?.last_read_at ?? null;
  const theirs = rows.find((r) => r.user_id !== userId)?.last_read_at ?? null;
  return { my_last_read: mine, their_last_read: theirs };
}

function unreadCount(conversationId: string, userId: string, myLastRead: string | null): number {
  const row = get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM messages
     WHERE conversation_id = ? AND sender_id != ? AND (? IS NULL OR created_at > ?)`,
    conversationId,
    userId,
    myLastRead,
    myLastRead
  );
  return Number(row?.n ?? 0);
}

function lastMessage(conversationId: string): MessageDto | null {
  const row = get<Record<string, unknown>>(
    `SELECT ${MESSAGE_COLUMNS} FROM messages m WHERE m.conversation_id = ?
     ORDER BY m.created_at DESC, m.id DESC LIMIT 1`,
    conversationId
  );
  if (!row) return null;
  const profiles = publicProfiles([String(row.sender_id)]);
  return messageToDto(row, profiles);
}

function conversationDto(conversationId: string, userId: string) {
  const conv = get<{ id: string; user_a_id: string; user_b_id: string; last_activity_at: string }>(
    'SELECT id, user_a_id, user_b_id, last_activity_at FROM conversations WHERE id = ?',
    conversationId
  );
  if (!conv) return null;
  const otherId = conv.user_a_id === userId ? conv.user_b_id : conv.user_a_id;
  const { my_last_read, their_last_read } = readState(conversationId, userId);
  return {
    id: conv.id,
    kind: 'dm' as const,
    other: publicProfile(otherId),
    last_message: lastMessage(conversationId),
    unread_count: unreadCount(conversationId, userId, my_last_read),
    my_last_read,
    their_last_read,
    last_activity_at: conv.last_activity_at,
  };
}

// ── list conversations ────────────────────────────────────────────────

chatRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const rows = all<{ id: string; last_activity_at: string }>(
      `SELECT id, last_activity_at FROM conversations
       WHERE user_a_id = ? OR user_b_id = ?
       ORDER BY last_activity_at DESC LIMIT 200`,
      userId,
      userId
    );
    res.json({ conversations: rows.map((r) => conversationDto(r.id, userId)).filter(Boolean) });
  })
);

// ── start (or open) a DM ──────────────────────────────────────────────

chatRouter.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const otherId = String(req.body?.user_id || '');
    if (!otherId) throw new ApiError(400, 'user_id is required.');
    if (otherId === userId) throw new ApiError(400, 'You cannot message yourself.');
    const other = publicProfile(otherId, false);
    if (!other) throw new ApiError(404, 'User not found.');

    const settings = get<{ allow_messages_from: string }>(
      'SELECT allow_messages_from FROM user_settings WHERE user_id = ?',
      otherId
    );
    if (settings && settings.allow_messages_from === 'nobody') {
      throw new ApiError(403, `${other.display_name} does not accept direct messages.`);
    }

    const existing = get<{ id: string }>(
      `SELECT id FROM conversations
       WHERE (user_a_id = ? AND user_b_id = ?) OR (user_a_id = ? AND user_b_id = ?)`,
      userId,
      otherId,
      otherId,
      userId
    );
    if (existing) return res.json({ conversation: conversationDto(existing.id, userId) });

    const [a, b] = userId < otherId ? [userId, otherId] : [otherId, userId];
    const id = randomUUID();
    tx(() => {
      run(
        'INSERT INTO conversations (id, user_a_id, user_b_id, created_at, last_activity_at) VALUES (?,?,?,?,?)',
        id,
        a,
        b,
        nowIso(),
        nowIso()
      );
      run('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?,?)', id, a);
      run('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?,?)', id, b);
    });
    res.status(201).json({ conversation: conversationDto(id, userId) });
  })
);

// ── conversation detail ───────────────────────────────────────────────

chatRouter.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    requireConversationMember(req.userId!, req.params.id);
    const dto = conversationDto(req.params.id, req.userId!);
    if (!dto) throw new ApiError(404, 'Conversation not found.');
    res.json({ conversation: dto });
  })
);

// ── messages ──────────────────────────────────────────────────────────

chatRouter.get(
  '/:id/messages',
  requireAuth,
  asyncHandler(async (req, res) => {
    requireConversationMember(req.userId!, req.params.id);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const before = typeof req.query.before === 'string' ? req.query.before : null;
    const rows = all<Record<string, unknown>>(
      `SELECT ${MESSAGE_COLUMNS} FROM messages m
       WHERE m.conversation_id = ? AND (? IS NULL OR m.created_at < ?)
       ORDER BY m.created_at DESC, m.id DESC LIMIT ?`,
      req.params.id,
      before,
      before,
      limit
    );
    rows.reverse();
    const profiles = publicProfiles(rows.map((r) => String(r.sender_id)));
    res.json({
      messages: rows.map((r) => messageToDto(r, profiles)),
      has_more: rows.length === limit,
    });
  })
);

chatRouter.post(
  '/:id/messages',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    requireConversationMember(userId, req.params.id);
    const content = String(req.body?.content ?? '').slice(0, 4000);
    const attachmentId = req.body?.attachment_id ? String(req.body.attachment_id) : null;

    if (!content.trim() && !attachmentId) {
      throw new ApiError(400, 'Message cannot be empty.');
    }
    if (attachmentId) {
      const att = get<{ id: string; uploader_id: string }>(
        'SELECT id, uploader_id FROM attachments WHERE id = ?',
        attachmentId
      );
      if (!att || att.uploader_id !== userId) throw new ApiError(400, 'Invalid attachment.');
    }

    const id = randomUUID();
    const createdAt = nowIso();
    tx(() => {
      run(
        `INSERT INTO messages (id, conversation_id, group_id, sender_id, content, attachment_id, created_at)
         VALUES (?,?,?,?,?,?,?)`,
        id,
        req.params.id,
        null,
        userId,
        content,
        attachmentId,
        createdAt
      );
      run('UPDATE conversations SET last_activity_at = ? WHERE id = ?', createdAt, req.params.id);
    });

    const dto: MessageDto = {
      id,
      conversation_id: req.params.id,
      group_id: null,
      sender: publicProfile(userId),
      content,
      attachment: attachmentDto(attachmentId),
      created_at: createdAt,
    };
    sendToUsers(chatMemberIds('dm', req.params.id), { type: 'message', message: dto });
    res.status(201).json({ message: dto });
  })
);

chatRouter.post(
  '/:id/read',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    requireConversationMember(userId, req.params.id);
    const at = nowIso();
    run(
      'UPDATE conversation_members SET last_read_at = ? WHERE conversation_id = ? AND user_id = ?',
      at,
      req.params.id,
      userId
    );
    sendToUsers(chatMemberIds('dm', req.params.id).filter((id) => id !== userId), {
      type: 'read',
      chat_type: 'dm',
      chat_id: req.params.id,
      user_id: userId,
      at,
    });
    res.json({ ok: true, at });
  })
);
