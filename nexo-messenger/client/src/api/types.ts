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

export interface Settings {
  theme: 'obsidian' | 'midnight' | 'black';
  notifications_enabled: boolean;
  notification_sound: boolean;
  show_online_status: boolean;
  allow_messages_from: 'everyone' | 'nobody';
}

export interface Attachment {
  id: string;
  kind: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
}

export interface Message {
  id: string;
  conversation_id: string | null;
  group_id: string | null;
  sender: PublicProfile | null;
  content: string;
  attachment: Attachment | null;
  created_at: string;
}

export interface Conversation {
  id: string;
  kind: 'dm';
  other: PublicProfile | null;
  last_message: Message | null;
  unread_count: number;
  my_last_read: string | null;
  their_last_read: string | null;
  last_activity_at: string;
}

export type GroupRole = 'owner' | 'admin' | 'member';

export interface Group {
  id: string;
  name: string;
  description: string;
  is_public: boolean;
  owner_id: string;
  avatar_attachment_id: string | null;
  created_at: string;
  member_count: number;
  my_role: GroupRole | null;
  last_message?: Message | null;
  unread_count?: number;
}

export interface GroupMember extends PublicProfile {
  role: GroupRole;
  joined_at: string;
}

export type ChannelRole = 'owner' | 'admin' | 'subscriber';

export interface Channel {
  id: string;
  name: string;
  description: string;
  is_public: boolean;
  owner_id: string;
  avatar_attachment_id: string | null;
  created_at: string;
  subscriber_count: number;
  my_role: ChannelRole | null;
  can_publish: boolean;
  last_post?: ChannelPost | null;
  unread_count?: number;
}

export interface ChannelPost {
  id: string;
  channel_id: string;
  author: PublicProfile | null;
  content: string;
  attachment: Attachment | null;
  created_at: string;
}

export interface ChannelMember extends PublicProfile {
  role: ChannelRole;
  joined_at: string;
}

export interface SearchResults {
  people: PublicProfile[];
  groups: Group[];
  channels: Channel[];
}

export interface AuthProviders {
  google: boolean;
  smtp: boolean;
  dev_reset_link: boolean;
}

export type RealtimeEvent =
  | { type: 'welcome'; user_id: string; online: string[] }
  | { type: 'presence'; user_id: string; online: boolean; last_seen_at?: string | null }
  | { type: 'message'; message: Message }
  | { type: 'post'; post: ChannelPost }
  | { type: 'typing'; chat_type: 'dm' | 'group'; chat_id: string; user_id: string; is_typing: boolean }
  | { type: 'read'; chat_type: 'dm' | 'group'; chat_id: string; user_id: string; at: string }
  | { type: 'pong' };
