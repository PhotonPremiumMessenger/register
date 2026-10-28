import type {
  Attachment,
  AuthProviders,
  Channel,
  ChannelMember,
  ChannelPost,
  Conversation,
  Group,
  GroupMember,
  Message,
  PublicProfile,
  SearchResults,
  Settings,
} from './types';

export const TOKEN_KEY = 'nexo.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let res: Response;
  try {
    res = await fetch(`/api${path}`, { ...options, headers });
  } catch {
    throw new ApiError(0, 'Network error — cannot reach the server. Check your connection.');
  }

  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const message =
      (data as { error?: string } | null)?.error || `Request failed (${res.status}).`;
    if (res.status === 401 && token && !path.startsWith('/auth')) {
      // Session expired — clear it so the app redirects to sign-in.
      setToken(null);
      window.dispatchEvent(new Event('nexo:unauthorized'));
    }
    throw new ApiError(res.status, message);
  }
  return data as T;
}

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const patch = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) });
const del = <T>(path: string) => request<T>(path, { method: 'DELETE' });

export const api = {
  auth: {
    providers: () => get<AuthProviders>('/auth/providers'),
    signUp: (body: { email: string; password: string; username: string; display_name: string }) =>
      post<{ token: string; profile: PublicProfile; settings: Settings }>('/auth/signup', body),
    signIn: (body: { email: string; password: string }) =>
      post<{ token: string; profile: PublicProfile; settings: Settings }>('/auth/signin', body),
    me: () => get<{ profile: PublicProfile; settings: Settings }>('/auth/me'),
    verify: (token: string) =>
      get<{ token: string; profile: PublicProfile; settings: Settings }>(
        `/auth/verify?token=${encodeURIComponent(token)}`
      ),
    forgot: (email: string) =>
      post<{ ok: boolean; message: string; dev_reset_url?: string | null; emailed?: boolean }>(
        '/auth/forgot',
        { email }
      ),
    reset: (token: string, password: string) => post<{ ok: boolean; message: string }>('/auth/reset', { token, password }),
    googleUrl: '/api/auth/google',
  },
  users: {
    byUsername: (username: string) =>
      get<{ profile: PublicProfile }>(`/users/by-username/${encodeURIComponent(username)}`),
    byId: (id: string) => get<{ profile: PublicProfile }>(`/users/${encodeURIComponent(id)}`),
    updateMe: (body: {
      display_name?: string;
      username?: string;
      bio?: string;
      avatar_attachment_id?: string | null;
    }) => patch<{ profile: PublicProfile }>('/users/me', body),
  },
  settings: {
    get: () => get<{ settings: Settings }>('/settings'),
    update: (body: Partial<Settings>) => patch<{ settings: Settings }>('/settings', body),
  },
  chats: {
    list: () => get<{ conversations: Conversation[] }>('/chats'),
    open: (userId: string) => post<{ conversation: Conversation }>('/chats', { user_id: userId }),
    detail: (id: string) => get<{ conversation: Conversation }>(`/chats/${id}`),
    messages: (id: string, before?: string, limit = 50) =>
      get<{ messages: Message[]; has_more: boolean }>(
        `/chats/${id}/messages?limit=${limit}${before ? `&before=${encodeURIComponent(before)}` : ''}`
      ),
    send: (id: string, content: string, attachmentId?: string | null) =>
      post<{ message: Message }>(`/chats/${id}/messages`, {
        content,
        attachment_id: attachmentId || undefined,
      }),
    read: (id: string) => post<{ ok: boolean; at: string }>(`/chats/${id}/read`),
  },
  groups: {
    list: () => get<{ groups: Group[] }>('/groups'),
    discover: () => get<{ groups: Group[] }>('/groups/discover'),
    create: (body: {
      name: string;
      description?: string;
      is_public?: boolean;
      avatar_attachment_id?: string | null;
      member_ids?: string[];
    }) => post<{ group: Group }>('/groups', body),
    detail: (id: string) => get<{ group: Group }>(`/groups/${id}`),
    update: (id: string, body: Record<string, unknown>) => patch<{ group: Group }>(`/groups/${id}`, body),
    remove: (id: string) => del<{ ok: boolean }>(`/groups/${id}`),
    members: (id: string) => get<{ members: GroupMember[] }>(`/groups/${id}/members`),
    join: (id: string) => post<{ group: Group }>(`/groups/${id}/join`),
    addMembers: (id: string, userIds: string[]) => post<{ ok: boolean }>(`/groups/${id}/members`, { user_ids: userIds }),
    setRole: (id: string, memberId: string, role: string) =>
      patch<{ ok: boolean }>(`/groups/${id}/members/${memberId}`, { role }),
    removeMember: (id: string, memberId: string) => del<{ ok: boolean }>(`/groups/${id}/members/${memberId}`),
    messages: (id: string, before?: string, limit = 50) =>
      get<{ messages: Message[]; has_more: boolean }>(
        `/groups/${id}/messages?limit=${limit}${before ? `&before=${encodeURIComponent(before)}` : ''}`
      ),
    send: (id: string, content: string, attachmentId?: string | null) =>
      post<{ message: Message }>(`/groups/${id}/messages`, {
        content,
        attachment_id: attachmentId || undefined,
      }),
    read: (id: string) => post<{ ok: boolean }>(`/groups/${id}/read`),
  },
  channels: {
    list: () => get<{ channels: Channel[] }>('/channels'),
    discover: () => get<{ channels: Channel[] }>('/channels/discover'),
    create: (body: {
      name: string;
      description?: string;
      is_public?: boolean;
      avatar_attachment_id?: string | null;
    }) => post<{ channel: Channel }>('/channels', body),
    detail: (id: string) => get<{ channel: Channel }>(`/channels/${id}`),
    update: (id: string, body: Record<string, unknown>) => patch<{ channel: Channel }>(`/channels/${id}`, body),
    remove: (id: string) => del<{ ok: boolean }>(`/channels/${id}`),
    subscribe: (id: string) => post<{ channel: Channel }>(`/channels/${id}/subscribe`),
    unsubscribe: (id: string) => del<{ ok: boolean }>(`/channels/${id}/subscribe`),
    members: (id: string) => get<{ members: ChannelMember[] }>(`/channels/${id}/members`),
    addMembers: (id: string, userIds: string[]) =>
      post<{ ok: boolean }>(`/channels/${id}/members`, { user_ids: userIds }),
    setRole: (id: string, memberId: string, role: string) =>
      patch<{ ok: boolean }>(`/channels/${id}/members/${memberId}`, { role }),
    removeMember: (id: string, memberId: string) => del<{ ok: boolean }>(`/channels/${id}/members/${memberId}`),
    posts: (id: string, before?: string, limit = 50) =>
      get<{ posts: ChannelPost[]; has_more: boolean }>(
        `/channels/${id}/posts?limit=${limit}${before ? `&before=${encodeURIComponent(before)}` : ''}`
      ),
    publish: (id: string, content: string, attachmentId?: string | null) =>
      post<{ post: ChannelPost }>(`/channels/${id}/posts`, {
        content,
        attachment_id: attachmentId || undefined,
      }),
    read: (id: string) => post<{ ok: boolean }>(`/channels/${id}/read`),
  },
  search: (q: string, scope: 'all' | 'people' | 'groups' | 'channels' = 'all') =>
    get<SearchResults>(`/search?q=${encodeURIComponent(q)}&scope=${scope}`),
};

// ── Attachments / uploads ─────────────────────────────────────────────

export function uploadFile(
  file: File,
  kind: 'message' | 'avatar' | 'group_avatar' | 'channel_avatar',
  onProgress?: (percent: number) => void
): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append('file', file);
    form.append('kind', kind);
    xhr.open('POST', '/api/attachments');
    const token = getToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data.attachment as Attachment);
        } else {
          reject(new ApiError(xhr.status, data.error || `Upload failed (${xhr.status}).`));
        }
      } catch {
        reject(new ApiError(xhr.status, `Upload failed (${xhr.status}).`));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, 'Upload failed — network error.'));
    xhr.send(form);
  });
}

const blobUrlCache = new Map<string, string>();

/** Fetch an attachment through the authorized endpoint and return a blob URL. */
export async function attachmentUrl(attachmentId: string): Promise<string> {
  const cached = blobUrlCache.get(attachmentId);
  if (cached) return cached;
  const token = getToken();
  const res = await fetch(`/api/attachments/${attachmentId}/file`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) {
    let message = `Failed to load file (${res.status}).`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      /* keep default */
    }
    throw new ApiError(res.status, message);
  }
  const url = URL.createObjectURL(await res.blob());
  blobUrlCache.set(attachmentId, url);
  return url;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
