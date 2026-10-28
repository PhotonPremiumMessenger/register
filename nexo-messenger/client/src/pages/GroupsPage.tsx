import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Compass, Globe, Lock, Users, UsersRound } from 'lucide-react';
import { api, uploadFile, attachmentUrl } from '../api';
import type { Group, PublicProfile } from '../api/types';
import { useRealtime } from '../context/RealtimeContext';
import { useToast } from '../context/ToastContext';
import { Avatar } from '../components/Avatar';
import { ChatListItem } from '../components/ChatListItem';
import { UserPickerModal } from '../components/UserPickerModal';
import { EmptyState, Loading, Modal, Notice, Segmented, Spinner, Toggle } from '../components/ui';

export function GroupsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const realtime = useRealtime();
  const [tab, setTab] = useState<'mine' | 'discover'>('mine');
  const [mine, setMine] = useState<Group[] | null>(null);
  const [discover, setDiscover] = useState<Group[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const refreshTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [m, d] = await Promise.all([api.groups.list(), api.groups.discover()]);
      setMine(m.groups);
      setDiscover(d.groups);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load groups.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const unsub = realtime.subscribe((event) => {
      if (event.type === 'message' && event.message.group_id) {
        if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
        refreshTimer.current = window.setTimeout(() => void load(), 400);
      }
    });
    return () => {
      unsub();
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    };
  }, [realtime, load]);

  const join = async (group: Group) => {
    try {
      await api.groups.join(group.id);
      toast.success(`Joined "${group.name}".`);
      navigate(`/g/${group.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to join group.');
    }
  };

  const groups = tab === 'mine' ? mine : discover;

  return (
    <div className="page">
      <div className="page-header">
        <h1>Groups</h1>
        <button className="btn btn-glass btn-sm" onClick={() => setCreateOpen(true)}>
          <UsersRound size={16} /> New group
        </button>
      </div>

      <Segmented
        options={[
          { id: 'mine', label: 'My groups' },
          { id: 'discover', label: 'Discover' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {error && <Notice kind="error">{error}</Notice>}

      {groups === null && !error ? (
        <Loading label="Loading groups…" />
      ) : groups && groups.length === 0 ? (
        tab === 'mine' ? (
          <EmptyState
            icon={<Users size={26} />}
            title="No groups yet"
            message="Create a group to chat with several people at once, or discover public groups below."
          />
        ) : (
          <EmptyState
            icon={<Compass size={26} />}
            title="No public groups yet"
            message="Public groups created by the community will appear here."
          />
        )
      ) : (
        <div className="list">
          {groups?.map((g) => (
            <ChatListItem
              key={g.id}
              title={g.name}
              subtitle={
                tab === 'mine'
                  ? g.last_message
                    ? `${g.last_message.sender?.display_name.split(' ')[0] || ''}: ${g.last_message.content || '📎 Attachment'}`
                    : `${g.member_count} member${g.member_count === 1 ? '' : 's'}`
                  : `${g.member_count} member${g.member_count === 1 ? '' : 's'} · ${g.is_public ? 'Public' : 'Private'}`
              }
              timestamp={tab === 'mine' ? g.last_message?.created_at : null}
              unread={tab === 'mine' ? g.unread_count ?? 0 : 0}
              avatarName={g.name}
              avatarAttachmentId={g.avatar_attachment_id}
              rounded
              fallbackIcon={<Users size={20} />}
              onClick={g.my_role ? () => navigate(`/g/${g.id}`) : undefined}
              trailing={
                !g.my_role ? (
                  g.is_public ? (
                    <button className="btn btn-primary btn-sm" onClick={(e) => { e.stopPropagation(); void join(g); }}>
                      Join
                    </button>
                  ) : (
                    <span className="chip">
                      <Lock size={11} /> Private
                    </span>
                  )
                ) : g.is_public ? (
                  <span className="chip muted" style={{ background: 'var(--glass)', color: 'var(--text-faint)' }}>
                    <Globe size={11} />
                  </span>
                ) : undefined
              }
            />
          ))}
        </div>
      )}

      <CreateGroupModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(g) => {
          void load();
          navigate(`/g/${g.id}`);
        }}
        onError={(m) => toast.error(m)}
      />
    </div>
  );
}

export function CreateGroupModal({
  open,
  onClose,
  onCreated,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (group: Group) => void;
  onError: (message: string) => void;
}) {
  const [step, setStep] = useState<'details' | 'members'>('details');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avatarId, setAvatarId] = useState<string | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [members, setMembers] = useState<PublicProfile[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setStep('details');
      setName('');
      setDescription('');
      setIsPublic(false);
      setAvatarId(null);
      setAvatarPreview(null);
      setMembers([]);
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const pickAvatar = async (file: File | undefined) => {
    if (!file) return;
    setUploadingAvatar(true);
    try {
      const att = await uploadFile(file, 'group_avatar');
      setAvatarId(att.id);
      setAvatarPreview(await attachmentUrl(att.id).catch(() => null));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Avatar upload failed.');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const submitDetails = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Group name is required.');
      return;
    }
    setError(null);
    setStep('members');
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.groups.create({
        name: name.trim(),
        description: description.trim(),
        is_public: isPublic,
        avatar_attachment_id: avatarId,
        member_ids: members.map((m) => m.id),
      });
      onCreated(res.group);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create group.';
      setError(message);
      onError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={step === 'details' ? 'New group' : 'Add members'}
        footer={
          step === 'details' ? (
            <>
              <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={submitDetails} disabled={uploadingAvatar}>
                Next
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setStep('details')}>Back</button>
              <button type="button" className="btn btn-primary" onClick={() => void create()} disabled={busy}>
                {busy ? <Spinner size="sm" /> : <UsersRound size={16} />} Create group
              </button>
            </>
          )
        }
      >
        {step === 'details' ? (
          <form onSubmit={submitDetails} className="modal-body">
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <button
                type="button"
                className="avatar"
                style={{ width: 84, height: 84, borderRadius: 26, cursor: 'pointer', fontSize: 26 }}
                onClick={() => fileRef.current?.click()}
                aria-label="Choose group avatar"
                title="Choose group avatar"
              >
                {avatarPreview ? <img src={avatarPreview} alt="" /> : uploadingAvatar ? <Spinner /> : <Users size={30} />}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                className="sr-only"
                onChange={(e) => { void pickAvatar(e.target.files?.[0]); e.target.value = ''; }}
              />
            </div>
            <div className="field">
              <label htmlFor="g-name">Group name</label>
              <input id="g-name" className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Design Team" required />
            </div>
            <div className="field">
              <label htmlFor="g-desc">Description (optional)</label>
              <textarea id="g-desc" className="input" rows={2} value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} placeholder="What is this group about?" />
            </div>
            <div className="setting-row" style={{ padding: '4px 0' }}>
              <div>
                <div className="sr-label">Public group</div>
                <div className="sr-desc">Anyone can find it in search and join.</div>
              </div>
              <Toggle checked={isPublic} onChange={setIsPublic} label="Public group" />
            </div>
            {error && <Notice kind="error">{error}</Notice>}
          </form>
        ) : (
          <div className="modal-body">
            <button type="button" className="btn btn-glass btn-block" onClick={() => setPickerOpen(true)}>
              <Users size={16} /> Search and add people
            </button>
            {members.length === 0 ? (
              <p className="t-faint" style={{ textAlign: 'center' }}>
                Optional — you can also create the group first and add members later.
              </p>
            ) : (
              <div className="list">
                {members.map((m) => (
                  <div key={m.id} className="member-row">
                    <Avatar name={m.display_name} attachmentId={m.avatar_attachment_id} size={36} />
                    <div className="mr-body">
                      <div style={{ fontWeight: 600 }}>{m.display_name}</div>
                      <div className="t-faint">@{m.username}</div>
                    </div>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMembers((prev) => prev.filter((x) => x.id !== m.id))}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
            {error && <Notice kind="error">{error}</Notice>}
          </div>
        )}
      </Modal>
      <UserPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        multiple
        title="Add members"
        confirmLabel="Add"
        excludeIds={members.map((m) => m.id)}
        onConfirm={(selected) => {
          setMembers((prev) => [...prev, ...selected]);
        }}
      />
    </>
  );
}
