import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import type { ChannelPost, Message } from '../api/types';
import { useAuth } from '../context/AuthContext';
import { useRealtime } from '../context/RealtimeContext';
import { MessageBubble, formatDayLabel } from './MessageBubble';
import { EmptyState, Loading } from './ui';
import { MessagesSquare } from 'lucide-react';

function postToMessage(post: ChannelPost): Message {
  return {
    id: post.id,
    conversation_id: null,
    group_id: null,
    sender: post.author,
    content: post.content,
    attachment: post.attachment,
    created_at: post.created_at,
  };
}

interface TypingUser {
  userId: string;
  expiresAt: number;
}

export interface MessageListProps {
  /** 'channel' normalizes posts into message shape automatically via realtime events */
  chatType: 'dm' | 'group' | 'channel';
  chatId: string;
  load: (before?: string) => Promise<{ messages: Message[]; has_more: boolean }>;
  /** Called when the viewer has seen the latest messages (marks read on the server). */
  markRead?: () => void;
  /** For DMs: timestamp of the other participant's last read (drives ✓✓ states). */
  theirLastRead?: string | null;
  emptyTitle?: string;
  emptyMessage?: string;
  /** Names for typing indicator display */
  resolveName?: (userId: string) => string;
}

export function MessageList({
  chatType,
  chatId,
  load,
  markRead,
  theirLastRead: theirLastReadProp,
  emptyTitle = 'No messages yet',
  emptyMessage = 'Send the first message — it will be stored and delivered in realtime.',
  resolveName,
}: MessageListProps) {
  const { profile } = useAuth();
  const realtime = useRealtime();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [theirLastRead, setTheirLastRead] = useState<string | null>(theirLastReadProp ?? null);
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;

  useEffect(() => setTheirLastRead(theirLastReadProp ?? null), [theirLastReadProp]);

  const appendMessage = useCallback((m: Message) => {
    setMessages((prev) => {
      if (prev.some((x) => x.id === m.id)) return prev;
      const next = [...prev, m].sort((a, b) => a.created_at.localeCompare(b.created_at));
      return next;
    });
  }, []);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    load()
      .then((res) => {
        if (cancelled) return;
        setMessages(res.messages);
        setHasMore(res.has_more);
        requestAnimationFrame(() => {
          const el = scrollRef.current;
          if (el) el.scrollTop = el.scrollHeight;
        });
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load messages.');
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, chatType]);

  // Realtime subscriptions
  useEffect(() => {
    const unsubscribe = realtime.subscribe((event) => {
      if (event.type === 'message') {
        const m = event.message;
        const matches =
          (chatType === 'dm' && m.conversation_id === chatId) ||
          (chatType === 'group' && m.group_id === chatId);
        if (matches) {
          appendMessage(m);
          if (m.sender?.id !== profile?.id) markRead?.();
        }
      } else if (event.type === 'post' && chatType === 'channel' && event.post.channel_id === chatId) {
        appendMessage(postToMessage(event.post));
        if (event.post.author?.id !== profile?.id) markRead?.();
      } else if (event.type === 'read' && chatType === 'dm' && event.chat_id === chatId) {
        setTheirLastRead((prev) => (!prev || event.at > prev ? event.at : prev));
      } else if (event.type === 'typing' && event.chat_type === chatType && event.chat_id === chatId) {
        setTypingUsers((prev) => {
          const others = prev.filter((t) => t.userId !== event.user_id);
          if (!event.is_typing) return others;
          return [...others, { userId: event.user_id, expiresAt: Date.now() + 5000 }];
        });
      }
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, chatType, profile?.id, appendMessage, markRead]);

  // Typing indicator expiry
  useEffect(() => {
    if (typingUsers.length === 0) return;
    const timer = window.setInterval(() => {
      setTypingUsers((prev) => prev.filter((t) => t.expiresAt > Date.now()));
    }, 700);
    return () => window.clearInterval(timer);
  }, [typingUsers.length]);

  // Autoscroll on new messages when the viewer is at the bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (atBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, typingUsers]);

  // Mark read when visible messages change and the tab is focused
  useEffect(() => {
    if (!loading && document.visibilityState === 'visible') markRead?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, loading, chatId]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (el.scrollTop < 260 && hasMore && !loadingMore) {
      setLoadingMore(true);
      const prevHeight = el.scrollHeight;
      const oldest = messagesRef.current[0]?.created_at;
      load(oldest)
        .then((res) => {
          setMessages((prev) => {
            const seen = new Set(prev.map((m) => m.id));
            const merged = [...res.messages.filter((m) => !seen.has(m.id)), ...prev];
            merged.sort((a, b) => a.created_at.localeCompare(b.created_at));
            return merged;
          });
          setHasMore(res.has_more);
          requestAnimationFrame(() => {
            const el2 = scrollRef.current;
            if (el2) el2.scrollTop = el2.scrollHeight - prevHeight;
          });
        })
        .catch(() => setHasMore(false))
        .finally(() => setLoadingMore(false));
    }
  };

  if (loading) {
    return (
      <div className="messages-scroll">
        <Loading label="Loading messages…" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="messages-scroll">
        <EmptyState icon={<MessagesSquare size={26} />} title="Could not load messages" message={loadError} />
      </div>
    );
  }

  const activeTyping = typingUsers.filter((t) => t.expiresAt > Date.now());

  return (
    <div className="messages-scroll" ref={scrollRef} onScroll={onScroll}>
      <div className="messages-inner">
        {loadingMore && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 8 }}>
            <Loading label="" />
          </div>
        )}
        {!loadingMore && hasMore && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 6 }}>
            <button className="btn btn-ghost btn-sm" onClick={onScroll}>
              <ArrowUp size={14} /> Load earlier messages
            </button>
          </div>
        )}
        {messages.length === 0 && (
          <EmptyState icon={<MessagesSquare size={26} />} title={emptyTitle} message={emptyMessage} />
        )}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const isMe = m.sender?.id === profile?.id;
          const sameDay = prev && prev.created_at.slice(0, 10) === m.created_at.slice(0, 10);
          const grouped =
            Boolean(prev) &&
            sameDay &&
            prev.sender?.id === m.sender?.id &&
            new Date(m.created_at).getTime() - new Date(prev!.created_at).getTime() < 5 * 60 * 1000 &&
            !(prev!.attachment && m.attachment);
          const readState = isMe && chatType === 'dm'
            ? {
                delivered: true, // stored on the server + fanned out over WS
                read: Boolean(theirLastRead && m.created_at <= theirLastRead),
              }
            : null;
          return (
            <div key={m.id}>
              {!sameDay && <div className="day-sep">{formatDayLabel(m.created_at)}</div>}
              <MessageBubble
                message={m}
                isMe={isMe}
                showSender={chatType !== 'dm'}
                grouped={grouped}
                readState={readState}
              />
            </div>
          );
        })}
        {activeTyping.length > 0 && (
          <div className="typing-row">
            <div className="typing-dots">
              <span />
              <span />
              <span />
            </div>
            <span>
              {activeTyping
                .map((t) => resolveName?.(t.userId) || 'Someone')
                .slice(0, 2)
                .join(', ')}{' '}
              {activeTyping.length > 2 ? `+${activeTyping.length - 2} ` : ''}
              {activeTyping.length === 1 ? 'is' : 'are'} typing…
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
