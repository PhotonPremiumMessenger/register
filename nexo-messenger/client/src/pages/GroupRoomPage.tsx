import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Crown,
  LogOut,
  Shield,
  ShieldAlert,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react';
import { api } from '../api';
import type { Group, GroupMember, Message } from '../api/types';
import { useAuth } from '../context/AuthContext';
import { useRealtime } from '../context/RealtimeContext';
import { useToast } from '../context/ToastContext';
import { Avatar } from '../components/Avatar';
import { Composer } from '../components/Composer';
import { MessageList } from '../components/MessageList';
import { UserPickerModal } from '../components/UserPickerModal';
import { EmptyState, Loading, Modal, Notice, Spinner } from '../components/ui';

const ROLE_LABEL: Record<string, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' };

export function GroupRoomPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const realtime = useRealtime();
  const { profile: me } = useAuth();

  const [group, setGroup] = useState<Group | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [members, setMembers] = useState<GroupMember[] | null>(null);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setGroup(null);
    setError(null);
    api.groups
      .detail(id)
      .then((res) => !cancelled && setGroup(res.group))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'Failed to load group.'));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const openMembers = async () => {
    setMembersOpen(true);
    setMembers(null);
    setMembersError(null);
    try {
      const res = await api.groups.members(id);
      setMembers(res.members);
    } catch (err) {
      setMembersError(err instanceof Error ? err.message : 'Failed to load members.');
    }
  };

  const refreshMembers = async () => {
    try {
      const res = await api.groups.members(id);
      setMembers(res.members);
      const g = await api.groups.detail(id);
      setGroup(g.group);
    } catch {
      /* ignore */
    }
  };

  const act = async (key: string, fn: () => Promise<unknown>, success?: string) => {
    setBusyAction(key);
    try {
      await fn();
      if (success) toast.success(success);
      await refreshMembers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setBusyAction(null);
    }
  };

  const leave = async () => {
    if (!me) return;
    await act('leave', async () => {
      await api.groups.removeMember(id, me.id);
    });
    toast.info(`You left the group.`);
    navigate('/groups', { replace: true });
  };

  const removeGroup = async () => {
    await act('delete', async () => {
      await api.groups.remove(id);
    });
    toast.info('Group deleted.');
    navigate('/groups', { replace: true });
  };

  const load = useCallback(
    async (before?: string): Promise<{ messages: Message[]; has_more: boolean }> =>
      api.groups.messages(id, before),
    [id]
  );
  const markRead = useCallback(() => {
    api.groups.read(id).catch(() => undefined);
  }, [id]);
  const send = useCallback(
    async (content: string, attachmentId: string | null) => {
      await api.groups.send(id, content, attachmentId);
    },
    [id]
  );

  if (error) {
    return (
      <div className="room">
        <div className="room-header">
          <Link to="/groups" className="icon-btn" aria-label="Back to groups">
            <ArrowLeft size={20} />
          </Link>
          <div className="rh-body">
            <div className="rh-title">Group</div>
          </div>
        </div>
        <EmptyState icon={<ShieldAlert size={26} />} title="Group unavailable" message={error} />
      </div>
    );
  }

  if (!group) {
    return (
      <div className="room">
        <Loading label="Opening group…" />
      </div>
    );
  }

  const myRole = group.my_role;
  const isOwner = myRole === 'owner';
  const isAdmin = myRole === 'owner' || myRole === 'admin';

  // Non-member viewing a public group → join screen
  if (!myRole) {
    return (
      <div className="room">
        <div className="room-header">
          <Link to="/groups" className="icon-btn" aria-label="Back to groups">
            <ArrowLeft size={20} />
          </Link>
          <Avatar name={group.name} attachmentId={group.avatar_attachment_id} size={40} rounded fallbackIcon={<Users size={19} />} />
          <div className="rh-body">
            <div className="rh-title truncate">{group.name}</div>
            <div className="rh-sub">Public group</div>
          </div>
        </div>
        <EmptyState
          icon={<Users size={26} />}
          title={group.name}
          message={group.description || `A public group with ${group.member_count} members.`}
          action={
            <button
              className="btn btn-primary"
              style={{ marginTop: 10 }}
              disabled={joining}
              onClick={async () => {
                setJoining(true);
                try {
                  const res = await api.groups.join(id);
                  setGroup(res.group);
                  toast.success(`Joined "${group.name}".`);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Failed to join group.');
                } finally {
                  setJoining(false);
                }
              }}
            >
              {joining ? <Spinner size="sm" /> : null} Join group
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="room">
      <div className="room-header">
        <Link to="/groups" className="icon-btn" aria-label="Back to groups">
          <ArrowLeft size={20} />
        </Link>
        <Avatar name={group.name} attachmentId={group.avatar_attachment_id} size={40} rounded fallbackIcon={<Users size={19} />} />
        <button className="rh-body" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => void openMembers()} aria-label="Group details">
          <div className="rh-title truncate">{group.name}</div>
          <div className="rh-sub">
            {group.member_count} member{group.member_count === 1 ? '' : 's'}
            {isOwner && ' · you own this group'}
          </div>
        </button>
        <button className="icon-btn" onClick={() => void openMembers()} aria-label="Group details">
          <Users size={19} />
        </button>
      </div>

      <MessageList
        chatType="group"
        chatId={id}
        load={load}
        markRead={markRead}
        emptyTitle={`Welcome to ${group.name}`}
        emptyMessage="Messages are visible to members only and delivered in realtime."
        resolveName={(uid) => members?.find((m) => m.id === uid)?.display_name || 'Someone'}
      />

      <Composer onSend={send} chatType="group" chatId={id} placeholder={`Message ${group.name}…`} />

      <Modal open={membersOpen} onClose={() => setMembersOpen(false)} title={group.name} wide>
        {group.description && <p className="t-sub" style={{ lineHeight: 1.5 }}>{group.description}</p>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span className={`chip ${group.is_public ? '' : 'accent'}`}>{group.is_public ? 'Public group' : 'Private group'}</span>
          {myRole && <span className="chip accent">{ROLE_LABEL[myRole]}</span>}
        </div>

        {membersError && <Notice kind="error">{membersError}</Notice>}
        {members === null && !membersError ? (
          <Loading label="Loading members…" />
        ) : (
          <div className="list" style={{ maxHeight: 340, overflowY: 'auto' }}>
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
                        title={m.role === 'admin' ? 'Demote to member' : 'Promote to admin'}
                        disabled={busyAction !== null}
                        onClick={() =>
                          void act(`role-${m.id}`, () => api.groups.setRole(id, m.id, m.role === 'admin' ? 'member' : 'admin'))
                        }
                      >
                        {busyAction === `role-${m.id}` ? <Spinner size="sm" /> : m.role === 'admin' ? <Shield size={17} /> : <ShieldAlert size={17} />}
                      </button>
                      <button
                        className="icon-btn"
                        title="Transfer ownership"
                        disabled={busyAction !== null}
                        onClick={() => {
                          if (window.confirm(`Transfer group ownership to ${m.display_name}? You will become an admin.`)) {
                            void act(`owner-${m.id}`, () => api.groups.setRole(id, m.id, 'owner'));
                          }
                        }}
                      >
                        <Crown size={17} />
                      </button>
                    </>
                  )}
                  {((isAdmin && m.role === 'member') || (isOwner && m.role === 'admin')) && m.id !== me?.id && (
                    <button
                      className="icon-btn"
                      title="Remove from group"
                      disabled={busyAction !== null}
                      onClick={() => void act(`kick-${m.id}`, () => api.groups.removeMember(id, m.id), `${m.display_name} was removed.`)}
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
              <UserPlus size={15} /> Add members
            </button>
          )}
          {myRole !== 'owner' && (
            <button className="btn btn-danger btn-sm" disabled={busyAction !== null} onClick={() => { if (window.confirm('Leave this group?')) void leave(); }}>
              {busyAction === 'leave' ? <Spinner size="sm" /> : <LogOut size={15} />} Leave group
            </button>
          )}
          {isOwner && (
            <button className="btn btn-danger btn-sm" disabled={busyAction !== null} onClick={() => { if (window.confirm('Delete this group for everyone? This cannot be undone.')) void removeGroup(); }}>
              {busyAction === 'delete' ? <Spinner size="sm" /> : <Trash2 size={15} />} Delete group
            </button>
          )}
        </div>
      </Modal>

      <UserPickerModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        multiple
        title="Add members"
        confirmLabel="Add"
        excludeIds={members?.map((m) => m.id) ?? []}
        onConfirm={async (selected) => {
          try {
            await api.groups.addMembers(id, selected.map((s) => s.id));
            toast.success(`Added ${selected.length} member${selected.length === 1 ? '' : 's'}.`);
            await refreshMembers();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to add members.');
          }
        }}
      />
    </div>
  );
}
