import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Info, ShieldAlert } from 'lucide-react';
import { api } from '../api';
import type { Conversation, Message } from '../api/types';
import { useAuth } from '../context/AuthContext';
import { useRealtime } from '../context/RealtimeContext';
import { Avatar } from '../components/Avatar';
import { Composer } from '../components/Composer';
import { MessageList } from '../components/MessageList';
import { EmptyState, Loading } from '../components/ui';
import { timeAgo } from '../lib/time';

export function ChatRoomPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { profile: me } = useAuth();
  const realtime = useRealtime();
  const [conv, setConv] = useState<Conversation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setConv(null);
    setError(null);
    api.chats
      .detail(id)
      .then((res) => !cancelled && setConv(res.conversation))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'Failed to open conversation.'));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const load = useCallback(
    async (before?: string): Promise<{ messages: Message[]; has_more: boolean }> => {
      const res = await api.chats.messages(id, before);
      return res;
    },
    [id]
  );

  const markRead = useCallback(() => {
    api.chats.read(id).catch(() => undefined);
  }, [id]);

  const send = useCallback(
    async (content: string, attachmentId: string | null) => {
      await api.chats.send(id, content, attachmentId);
    },
    [id]
  );

  if (error) {
    return (
      <div className="room">
        <RoomHeader title="Conversation" onBack={() => navigate('/chats')} />
        <EmptyState icon={<ShieldAlert size={26} />} title="Conversation unavailable" message={error} />
      </div>
    );
  }

  if (!conv) {
    return (
      <div className="room">
        <Loading label="Opening conversation…" />
      </div>
    );
  }

  const other = conv.other;
  const online = other ? realtime.online.has(other.id) : false;

  return (
    <div className="room">
      <div className="room-header">
        <Link to="/chats" className="icon-btn" aria-label="Back to chats">
          <ArrowLeft size={20} />
        </Link>
        {other ? (
          <>
            <Avatar name={other.display_name} attachmentId={other.avatar_attachment_id} size={40} online={online} />
            <div className="rh-body">
              <div className="rh-title truncate">{other.display_name}</div>
              <div className="rh-sub">
                {online ? (
                  <span style={{ color: 'var(--success)' }}>online</span>
                ) : other.last_seen_at ? (
                  <span>last seen {timeAgo(other.last_seen_at)}</span>
                ) : (
                  <span>@{other.username}</span>
                )}
              </div>
            </div>
            <Link to={`/u/${other.username}`} className="icon-btn" aria-label="View profile">
              <Info size={19} />
            </Link>
          </>
        ) : (
          <div className="rh-body">
            <div className="rh-title">Missing profile</div>
            <div className="rh-sub">This account no longer exists</div>
          </div>
        )}
      </div>

      <MessageList
        chatType="dm"
        chatId={id}
        load={load}
        markRead={markRead}
        theirLastRead={conv.their_last_read}
        emptyTitle={other ? `Say hello to ${other.display_name}` : 'No messages yet'}
        emptyMessage="Messages are end-to-end stored on the server and delivered in realtime."
        resolveName={(uid) => (uid === me?.id ? 'You' : other?.display_name || 'Unknown')}
      />

      <Composer
        onSend={send}
        chatType="dm"
        chatId={id}
        placeholder={other ? `Message ${other.display_name}…` : 'Message…'}
      />
    </div>
  );
}

export function RoomHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="room-header">
      <button className="icon-btn" onClick={onBack} aria-label="Go back">
        <ArrowLeft size={20} />
      </button>
      <div className="rh-body">
        <div className="rh-title">{title}</div>
      </div>
    </div>
  );
}
