import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  BellOff,
  Crown,
  Megaphone,
  ShieldAlert,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react';
import { api } from '../api';
import type { Channel, ChannelMember, ChannelPost, Message } from '../api/types';
import { useAuth } from '../context/AuthContext';
import { useRealtime } from '../context/RealtimeContext';
import { useToast } from '../context/ToastContext';
import { Avatar } from '../components/Avatar';
import { Composer } from '../components/Composer';
import { MessageList } from '../components/MessageList';
import { UserPickerModal } from '../components/UserPickerModal';
import { EmptyState, Loading, Modal, Notice, Spinner } from '../components/ui';

const ROLE_LABEL: Record<string, string> = { owner: 'Owner', admin: 'Admin', subscriber: 'Subscriber' };

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

export function ChannelRoomPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const realtime = useRealtime();
  const { profile: me } = useAuth();

  const [channel, setChannel] = useState<Channel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [members, setMembers] = useState<ChannelMember[] | null>(null);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [subscribing, setSubscribing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setChannel(null);
    setError(null);
    api.channels
      .detail(id)
      .then((res) => !cancelled && setChannel(res.channel))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'Failed to load channel.'));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const openInfo = async () => {
    setInfoOpen(true);
    setMembers(null);
    setMembersError(null);
    try {
      const res = await api.channels.members(id);
      setMembers(res.members);
    } catch (err) {
      setMembersError(err instanceof Error ? err.message : 'Failed to load subscribers.');
    }
  };

  const refreshChannel = async () => {
    try {
      const res = await api.channels.detail(id);
      setChannel(res.channel);
    } catch {
      /* ignore */
    }
  };

  const act = async (key: string, fn: () => Promise<unknown>, success?: string) => {
    setBusyAction(key);
    try {
      await fn();
      if (success) toast.success(success);
      await refreshChannel();
      if (infoOpen) {
        const res = await api.channels.members(id);
        setMembers(res.members);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setBusyAction(null);
    }
  };

  const load = useCallback(
    async (before?: string): Promise<{ messages: Message[]; has_more: boolean }> => {
      const res = await api.channels.posts(id, before);
      return { messages: res.posts.map(postToMessage), has_more: res.has_more };
    },
    [id]
  );
  const markRead = useCallback(() => {
    api.channels.read(id).catch(() => undefined);
  }, [id]);
  const publish = useCallback(
    async (content: string, attachmentId: string | null) => {
      await api.channels.publish(id, content, attachmentId);
    },
    [id]
  );

  if (error) {
    return (
      <div className="room">
        <div className="room-header">
          <Link to="/channels" className="icon-btn" aria-label="Back to channels">
            <ArrowLeft size={20} />
          </Link>
          <div className="rh-body">
            <div className="rh-title">Channel</div>
          </div>
        </div>
        <EmptyState icon={<ShieldAlert size={26} />} title="Channel unavailable" message={error} />
      </div>
    );
  }

  if (!channel) {
    return (
      <div className="room">
        <Loading label="Opening channel…" />
      </div>
    );
  }

  const myRole = channel.my_role;
  const isOwner = myRole === 'owner';
  const isAdmin = myRole === 'owner' || myRole === 'admin';

  if (!myRole) {
    // Public channel, not subscribed yet
    return (
      <div className="room">
        <div className="room-header">
          <Link to="/channels" className="icon-btn" aria-label="Back to channels">
            <ArrowLeft size={20} />
          </Link>
          <Avatar name={channel.name} attachmentId={channel.avatar_attachment_id} size={40} rounded fallbackIcon={<Megaphone size={19} />} />
          <div className="rh-body">
            <div className="rh-title truncate">{channel.name}</div>
            <div className="rh-sub">Public channel</div>
          </div>
        </div>
        <EmptyState
          icon={<Megaphone size={26} />}
          title={channel.name}
          message={channel.description || `${channel.subscriber_count} subscribers.`}
          action={
            channel.is_public ? (
              <button
                className="btn btn-primary"
                style={{ marginTop: 10 }}
                disabled={subscribing}
                onClick={async () => {
                  setSubscribing(true);
                  try {
                    const res = await api.channels.subscribe(id);
                    setChannel(res.channel);
                    toast.success(`Subscribed to "${channel.name}".`);
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : 'Failed to subscribe.');
                  } finally {
                    setSubscribing(false);
                  }
                }}
              >
                {subscribing ? <Spinner size="sm" /> : null} Subscribe
              </button>
            ) : (
              <Notice kind="info">This channel is private. An admin must add you.</Notice>
            )
          }
        />
      </div>
    );
  }

  return (
    <div className="room">
      <div className="room-header">
        <Link to="/channels" className="icon-btn" aria-label="Back to channels">
          <ArrowLeft size={20} />
        </Link>
        <Avatar name={channel.name} attachmentId={channel.avatar_attachment_id} size={40} rounded fallbackIcon={<Megaphone size={19} />} />
        <button className="rh-body" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => void openInfo()} aria-label="Channel info">
          <div className="rh-title truncate">{channel.name}</div>
          <div className="rh-sub">
            {channel.subscriber_count} subscriber{channel.subscriber_count === 1 ? '' : 's'}
            {channel.can_publish ? ' · you can publish' : ''}
          </div>
        </button>
        <button className="icon-btn" onClick={() => void openInfo()} aria-label="Channel info">
          <Users size={19} />
        </button>
      </div>

      <MessageList
        chatType="channel"
        chatId={id}
        load={load}
        markRead={markRead}
        emptyTitle="No posts yet"
        emptyMessage={
          channel.can_publish
            ? 'Publish the first post — every subscriber receives it in realtime.'
            : 'When the channel admins publish posts, they will appear here.'
        }
        resolveName={(uid) => members?.find((m) => m.id === uid)?.display_name || 'Someone'}
      />

      {channel.can_publish ? (
        <Composer onSend={publish} placeholder={`Post to ${channel.name}…`} />
      ) : (
        <div className="composer-wrap">
          <div className="composer" style={{ justifyContent: 'center' }}>
            <span className="t-sub" style={{ padding: '8px 6px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <BellOff size={15} /> Only the owner and admins can publish posts in this channel.
            </span>
          </div>
        </div>
      )}

      <Modal open={infoOpen} onClose={() => setInfoOpen(false)} title={channel.name} wide>
        {channel.description && <p className="t-sub" style={{ lineHeight: 1.5 }}>{channel.description}</p>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span className={`chip ${channel.is_public ? '' : 'accent'}`}>{channel.is_public ? 'Public channel' : 'Private channel'}</span>
          <span className="chip accent">{ROLE_LABEL[myRole]}</span>
          <span className="chip">{channel.subscriber_count} subscribers</span>
        </div>

        {membersError && <Notice kind="error">{membersError}</Notice>}
        {members === null && !membersError ? (
          <Loading label="Loading subscribers…" />
        ) : (
          <div className="list" style={{ maxHeight: 320, overflowY: 'auto' }}>
            {members?.map((m) => (
              <div key={m.id} className="member-row">
                <Avatar name={m.display_name} attachmentId={m.avatar_attachment_id} size={38} online={realtime.online.has(m.id)} />
                <div className="mr-body">
                  <div style={{ fontWeight: 600 }} className="truncate">
                    {m.display_name} {m.id === me?.id && <span className="t-faint">(you)</span>}
                  </div>
                  <div className="t-faint">
                    @{m.username} · {ROLE_LABEL[m.role]}
                  </div>
                </div>
                <div className="mr-actions">
                  {isOwner && m.role !== 'owner' && m.id !== me?.id && (
                    <>
                      <button
                        className="icon-btn"
                        title={m.role === 'admin' ? 'Demote to subscriber' : 'Grant publishing (make admin)'}
                        disabled={busyAction !== null}
                        onClick={() =>
                          void act(`role-${m.id}`, () =>
                            api.channels.setRole(id, m.id, m.role === 'admin' ? 'subscriber' : 'admin')
                          )
                        }
                      >
                        {busyAction === `role-${m.id}` ? <Spinner size="sm" /> : m.role === 'admin' ? <Crown size={17} /> : <Crown size={17} style={{ opacity: 0.5 }} />}
                      </button>
                      <button
                        className="icon-btn"
                        title="Transfer ownership"
                        disabled={busyAction !== null}
                        onClick={() => {
                          if (window.confirm(`Transfer channel ownership to ${m.display_name}? You will become an admin.`)) {
                            void act(`owner-${m.id}`, () => api.channels.setRole(id, m.id, 'owner'));
                          }
                        }}
                      >
                        <Crown size={17} />
                      </button>
                    </>
                  )}
                  {isAdmin && m.role === 'subscriber' && m.id !== me?.id && (
                    <button
                      className="icon-btn"
                      title="Remove subscriber"
                      disabled={busyAction !== null}
                      onClick={() => void act(`kick-${m.id}`, () => api.channels.removeMember(id, m.id), `${m.display_name} was removed.`)}
                    >
                      {busyAction === `kick-${m.id}` ? <Spinner size="sm" /> : <UserMinus size={17} />}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 16 }}>
          {isAdmin && (
            <button className="btn btn-glass btn-sm" onClick={() => setAddOpen(true)}>
              <UserPlus size={15} /> Add subscribers
            </button>
          )}
          {!isOwner && (
            <button
              className="btn btn-danger btn-sm"
              disabled={busyAction !== null}
              onClick={async () => {
                if (!window.confirm('Unsubscribe from this channel?')) return;
                setBusyAction('unsub');
                try {
                  await api.channels.unsubscribe(id);
                  toast.info('Unsubscribed.');
                  navigate('/channels', { replace: true });
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Failed to unsubscribe.');
                } finally {
                  setBusyAction(null);
                }
              }}
            >
              {busyAction === 'unsub' ? <Spinner size="sm" /> : <BellOff size={15} />} Unsubscribe
            </button>
          )}
          {isOwner && (
            <button
              className="btn btn-danger btn-sm"
              disabled={busyAction !== null}
              onClick={() => {
                if (window.confirm('Delete this channel for everyone? This cannot be undone.')) {
                  void act('delete', async () => {
                    await api.channels.remove(id);
                    navigate('/channels', { replace: true });
                  });
                }
              }}
            >
              {busyAction === 'delete' ? <Spinner size="sm" /> : <Trash2 size={15} />} Delete channel
            </button>
          )}
        </div>
      </Modal>

      <UserPickerModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        multiple
        title="Add subscribers"
        confirmLabel="Add"
        excludeIds={members?.map((m) => m.id) ?? []}
        onConfirm={async (selected) => {
          try {
            await api.channels.addMembers(id, selected.map((s) => s.id));
            toast.success(`Added ${selected.length} subscriber${selected.length === 1 ? '' : 's'}.`);
            await refreshChannel();
            const res = await api.channels.members(id);
            setMembers(res.members);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to add subscribers.');
          }
        }}
      />
    </div>
  );
}
