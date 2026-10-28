import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { verifyToken } from './auth';
import { all, get, run, nowIso } from './db';

// ── Presence + realtime broadcast layer ───────────────────────────────
// One WS connection per open tab; a user is "online" while ≥1 socket is open.
// Presence ends with the socket (heartbeat-enforced), so users are never
// permanently shown online after their session ends.

const connections = new Map<string, Set<WebSocket>>();

export type RealtimeEvent =
  | { type: 'welcome'; user_id: string; online: string[] }
  | { type: 'presence'; user_id: string; online: boolean; last_seen_at?: string | null }
  | { type: 'message'; message: unknown }
  | { type: 'post'; post: unknown }
  | { type: 'typing'; chat_type: 'dm' | 'group'; chat_id: string; user_id: string; is_typing: boolean }
  | { type: 'read'; chat_type: 'dm' | 'group'; chat_id: string; user_id: string; at: string }
  | { type: 'pong' };

export function getOnlineUserIds(): Set<string> {
  return new Set(connections.keys());
}

/** Online users whose privacy setting allows others to see their status. */
function visibleOnlineUserIds(): Set<string> {
  const visible = new Set<string>();
  for (const userId of connections.keys()) {
    const row = get<{ show_online_status: number }>(
      'SELECT show_online_status FROM user_settings WHERE user_id = ?',
      userId
    );
    if (!row || row.show_online_status === 1) visible.add(userId);
  }
  return visible;
}

function send(socket: WebSocket, event: RealtimeEvent): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(event));
  }
}

export function sendToUser(userId: string, event: RealtimeEvent): void {
  const sockets = connections.get(userId);
  if (!sockets) return;
  for (const socket of sockets) send(socket, event);
}

export function sendToUsers(userIds: Iterable<string>, event: RealtimeEvent): void {
  const seen = new Set<string>();
  for (const id of userIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    sendToUser(id, event);
  }
}

function broadcast(event: RealtimeEvent, exceptUserId?: string): void {
  for (const [userId, sockets] of connections) {
    if (userId === exceptUserId) continue;
    for (const socket of sockets) send(socket, event);
  }
}

/** Broadcast a presence change, respecting the user's show_online_status setting. */
function broadcastPresence(userId: string, online: boolean, lastSeenAt?: string | null): void {
  const row = get<{ show_online_status: number }>(
    'SELECT show_online_status FROM user_settings WHERE user_id = ?',
    userId
  );
  if (row && row.show_online_status !== 1) return; // user hides their status
  broadcast({ type: 'presence', user_id: userId, online, last_seen_at: lastSeenAt ?? null });
}

/** Member user ids of a DM conversation or group (used for typing/read fan-out). */
export function chatMemberIds(chatType: 'dm' | 'group', chatId: string): string[] {
  if (chatType === 'group') {
    return all<{ user_id: string }>(
      'SELECT user_id FROM group_members WHERE group_id = ?',
      chatId
    ).map((r) => r.user_id);
  }
  return all<{ user_id: string }>(
    'SELECT user_id FROM conversation_members WHERE conversation_id = ?',
    chatId
  ).map((r) => r.user_id);
}

export function initRealtime(server: http.Server): void {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (socket: WebSocket, req) => {
    const ws = socket as WebSocket & { isAlive?: boolean };
    ws.isAlive = true;
    socket.on('pong', () => {
      ws.isAlive = true;
    });

    let userId: string | null = null;
    const url = new URL(req.url || '', 'http://internal');
    const token = url.searchParams.get('token');
    if (token) {
      const payload = verifyToken(token);
      if (payload) userId = payload.sub;
    }
    if (!userId) {
      send(socket, { type: 'welcome', user_id: '', online: [] });
      socket.close(4001, 'Unauthorized');
      return;
    }

    const authedId = userId;
    let sockets = connections.get(authedId);
    const wasOffline = !sockets || sockets.size === 0;
    if (!sockets) {
      sockets = new Set();
      connections.set(authedId, sockets);
    }
    sockets.add(socket);

    run('UPDATE profiles SET last_seen_at = ? WHERE user_id = ?', nowIso(), authedId);
    send(socket, { type: 'welcome', user_id: authedId, online: [...visibleOnlineUserIds()] });
    if (wasOffline) broadcastPresence(authedId, true);

    socket.on('message', (raw) => {
      let event: { type?: string; chat_type?: string; chat_id?: string; is_typing?: boolean };
      try {
        event = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (event.type === 'ping') {
        send(socket, { type: 'pong' });
        return;
      }
      if (event.type === 'typing' && event.chat_id) {
        const chatType = event.chat_type === 'group' ? 'group' : 'dm';
        const memberIds = chatMemberIds(chatType, String(event.chat_id));
        sendToUsers(
          memberIds.filter((id) => id !== authedId),
          {
            type: 'typing',
            chat_type: chatType,
            chat_id: String(event.chat_id),
            user_id: authedId,
            is_typing: Boolean(event.is_typing),
          }
        );
      }
    });

    const cleanup = () => {
      const current = connections.get(authedId);
      if (!current) return;
      current.delete(socket);
      if (current.size === 0) {
        connections.delete(authedId);
        const lastSeen = nowIso();
        run('UPDATE profiles SET last_seen_at = ? WHERE user_id = ?', lastSeen, authedId);
        broadcastPresence(authedId, false, lastSeen);
      }
    };
    socket.on('close', cleanup);
    socket.on('error', cleanup);
  });

  // Heartbeat: drop dead sockets so presence never sticks.
  const interval = setInterval(() => {
    wss.clients.forEach((client) => {
      const c = client as WebSocket & { isAlive?: boolean };
      if (c.isAlive === false) {
        c.terminate();
        return;
      }
      c.isAlive = false;
      try {
        c.ping();
      } catch {
        /* socket already closing */
      }
    });
  }, 30_000);

  wss.on('close', () => clearInterval(interval));
}
