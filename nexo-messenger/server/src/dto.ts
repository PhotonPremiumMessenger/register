import { all, get } from './db';
import { getOnlineUserIds } from './realtime';

// ── Shared DTO helpers. All API responses use snake_case to match rows. ──

export interface PublicProfile {
  id: string;
  username: string;
  display_name: string;
  bio: string;
  avatar_attachment_id: string | null;
  last_seen_at: string | null;
  created_at: string;
  online?: boolean;
}

export interface AttachmentDto {
  id: string;
  kind: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
}

const PROFILE_SELECT = `
  SELECT u.id, p.username, p.display_name, p.bio, p.avatar_attachment_id,
         p.last_seen_at, p.created_at
  FROM profiles p JOIN users u ON u.id = p.user_id`;

function profileRowToDto(row: Record<string, unknown>, includeOnline: boolean): PublicProfile {
  const online = includeOnline ? getOnlineUserIds().has(String(row.id)) : undefined;
  return {
    id: String(row.id),
    username: String(row.username),
    display_name: String(row.display_name),
    bio: String(row.bio ?? ''),
    avatar_attachment_id: (row.avatar_attachment_id as string | null) ?? null,
    last_seen_at: (row.last_seen_at as string | null) ?? null,
    created_at: String(row.created_at),
    ...(online !== undefined ? { online } : {}),
  };
}

export function publicProfile(userId: string, includeOnline = true): PublicProfile | null {
  const row = get(`${PROFILE_SELECT} WHERE u.id = ?`, userId);
  return row ? profileRowToDto(row, includeOnline) : null;
}

export function publicProfiles(userIds: string[]): Map<string, PublicProfile> {
  const map = new Map<string, PublicProfile>();
  if (userIds.length === 0) return map;
  const placeholders = userIds.map(() => '?').join(',');
  const rows = all(`${PROFILE_SELECT} WHERE u.id IN (${placeholders})`, ...userIds);
  for (const row of rows) map.set(String(row.id), profileRowToDto(row, true));
  return map;
}

export function attachmentDto(attachmentId: string | null | undefined): AttachmentDto | null {
  if (!attachmentId) return null;
  const row = get<{ id: string; kind: string; file_name: string; mime_type: string; size_bytes: number }>(
    'SELECT id, kind, file_name, mime_type, size_bytes FROM attachments WHERE id = ?',
    attachmentId
  );
  return row ?? null;
}

export interface MessageDto {
  id: string;
  conversation_id: string | null;
  group_id: string | null;
  sender: PublicProfile | null;
  content: string;
  attachment: AttachmentDto | null;
  created_at: string;
}

export function messageToDto(row: Record<string, unknown>, profiles: Map<string, PublicProfile>): MessageDto {
  const senderId = String(row.sender_id);
  return {
    id: String(row.id),
    conversation_id: (row.conversation_id as string | null) ?? null,
    group_id: (row.group_id as string | null) ?? null,
    sender: profiles.get(senderId) ?? null,
    content: String(row.content ?? ''),
    attachment: attachmentDto(row.attachment_id as string | null),
    created_at: String(row.created_at),
  };
}

export const MESSAGE_COLUMNS = `m.id, m.conversation_id, m.group_id, m.sender_id, m.content, m.attachment_id, m.created_at`;
