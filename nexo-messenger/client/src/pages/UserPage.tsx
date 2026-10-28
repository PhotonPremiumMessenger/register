import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CalendarDays, MessageCirclePlus, UserRoundX } from 'lucide-react';
import { api } from '../api';
import type { PublicProfile } from '../api/types';
import { useAuth } from '../context/AuthContext';
import { useRealtime } from '../context/RealtimeContext';
import { useToast } from '../context/ToastContext';
import { Avatar } from '../components/Avatar';
import { EmptyState, Loading, Spinner } from '../components/ui';
import { formatJoinedDate, timeAgo } from '../lib/time';

export function UserPage() {
  const { username = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const realtime = useRealtime();
  const { profile: me } = useAuth();
  const [user, setUser] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setUser(null);
    api.users
      .byUsername(username)
      .then((res) => !cancelled && setUser(res.profile))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'Failed to load profile.'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [username]);

  const startChat = async () => {
    if (!user) return;
    setStarting(true);
    try {
      const res = await api.chats.open(user.id);
      if (res.conversation) navigate(`/c/${res.conversation.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not open the conversation.');
    } finally {
      setStarting(false);
    }
  };

  if (loading) {
    return (
      <div className="page">
        <Loading label="Loading profile…" />
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="page">
        <Link to="/search" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }}>
          <ArrowLeft size={15} /> Back
        </Link>
        <EmptyState
          icon={<UserRoundX size={26} />}
          title="Profile not found"
          message={error || `@${username} does not exist (yet).`}
        />
      </div>
    );
  }

  const isMe = user.id === me?.id;
  const online = realtime.online.has(user.id);

  return (
    <div className="page">
      <Link to="/search" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }}>
        <ArrowLeft size={15} /> Back to search
      </Link>

      <div className="card profile-hero anim-fade-up">
        <Avatar name={user.display_name} attachmentId={user.avatar_attachment_id} size={104} online={online} />
        <div>
          <h2>{user.display_name}</h2>
          <div className="username">@{user.username}</div>
        </div>
        {user.bio && <p className="bio">{user.bio}</p>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <span className="chip">
            <CalendarDays size={12} /> Joined {formatJoinedDate(user.created_at)}
          </span>
          {online ? (
            <span className="chip success">● Online</span>
          ) : (
            <span className="chip">{user.last_seen_at ? `Last seen ${timeAgo(user.last_seen_at)}` : 'Offline'}</span>
          )}
        </div>
        {!isMe && (
          <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={() => void startChat()} disabled={starting}>
            {starting ? <Spinner size="sm" /> : <MessageCirclePlus size={17} />} Message
          </button>
        )}
        {isMe && (
          <button className="btn btn-glass" style={{ marginTop: 8 }} onClick={() => navigate('/profile')}>
            This is you — open your profile
          </button>
        )}
      </div>
    </div>
  );
}
