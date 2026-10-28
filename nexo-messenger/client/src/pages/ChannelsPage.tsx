import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Compass, Globe, Lock, Megaphone, Plus } from 'lucide-react';
import { api, uploadFile, attachmentUrl } from '../api';
import type { Channel } from '../api/types';
import { useRealtime } from '../context/RealtimeContext';
import { useToast } from '../context/ToastContext';
import { ChatListItem } from '../components/ChatListItem';
import { EmptyState, Loading, Modal, Notice, Segmented, Spinner, Toggle } from '../components/ui';

export function ChannelsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const realtime = useRealtime();
  const [tab, setTab] = useState<'mine' | 'discover'>('mine');
  const [mine, setMine] = useState<Channel[] | null>(null);
  const [discover, setDiscover] = useState<Channel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const refreshTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [m, d] = await Promise.all([api.channels.list(), api.channels.discover()]);
      setMine(m.channels);
      setDiscover(d.channels);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load channels.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const unsub = realtime.subscribe((event) => {
      if (event.type === 'post') {
        if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
        refreshTimer.current = window.setTimeout(() => void load(), 400);
      }
    });
    return () => {
      unsub();
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    };
  }, [realtime, load]);

  const subscribe = async (channel: Channel) => {
    try {
      await api.channels.subscribe(channel.id);
      toast.success(`Subscribed to "${channel.name}".`);
      navigate(`/ch/${channel.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to subscribe.');
    }
  };

  const channels = tab === 'mine' ? mine : discover;

  return (
    <div className="page">
      <div className="page-header">
        <h1>Channels</h1>
        <button className="btn btn-glass btn-sm" onClick={() => setCreateOpen(true)}>
          <Plus size={16} /> New channel
        </button>
      </div>

      <Segmented
        options={[
          { id: 'mine', label: 'My channels' },
          { id: 'discover', label: 'Discover' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {error && <Notice kind="error">{error}</Notice>}

      {channels === null && !error ? (
        <Loading label="Loading channels…" />
      ) : channels && channels.length === 0 ? (
        tab === 'mine' ? (
          <EmptyState
            icon={<Megaphone size={26} />}
            title="No channels yet"
            message="Channels broadcast posts to subscribers. Create one, or discover public channels."
          />
        ) : (
          <EmptyState
            icon={<Compass size={26} />}
            title="No public channels yet"
            message="Public channels created by the community will appear here."
          />
        )
      ) : (
        <div className="list">
          {channels?.map((c) => (
            <ChatListItem
              key={c.id}
              title={c.name}
              subtitle={
                tab === 'mine'
                  ? c.last_post
                    ? c.last_post.content || '📎 Attachment'
                    : `${c.subscriber_count} subscriber${c.subscriber_count === 1 ? '' : 's'}`
                  : `${c.subscriber_count} subscriber${c.subscriber_count === 1 ? '' : 's'} · ${c.is_public ? 'Public' : 'Private'}`
              }
              timestamp={tab === 'mine' ? c.last_post?.created_at : null}
              unread={tab === 'mine' ? c.unread_count ?? 0 : 0}
              avatarName={c.name}
              avatarAttachmentId={c.avatar_attachment_id}
              rounded
              fallbackIcon={<Megaphone size={19} />}
              onClick={c.my_role ? () => navigate(`/ch/${c.id}`) : undefined}
              trailing={
                !c.my_role ? (
                  c.is_public ? (
                    <button className="btn btn-primary btn-sm" onClick={(e) => { e.stopPropagation(); void subscribe(c); }}>
                      Subscribe
                    </button>
                  ) : (
                    <span className="chip">
                      <Lock size={11} /> Private
                    </span>
                  )
                ) : c.is_public ? (
                  <span className="chip">
                    <Globe size={11} />
                  </span>
                ) : undefined
              }
            />
          ))}
        </div>
      )}

      <CreateChannelModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(c) => {
          void load();
          navigate(`/ch/${c.id}`);
        }}
      />
    </div>
  );
}

function CreateChannelModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (channel: Channel) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avatarId, setAvatarId] = useState<string | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setName('');
      setDescription('');
      setIsPublic(true);
      setAvatarId(null);
      setAvatarPreview(null);
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const pickAvatar = async (file: File | undefined) => {
    if (!file) return;
    setUploadingAvatar(true);
    try {
      const att = await uploadFile(file, 'channel_avatar');
      setAvatarId(att.id);
      setAvatarPreview(await attachmentUrl(att.id).catch(() => null));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Avatar upload failed.');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const submit = async () => {
    if (!name.trim()) {
      setError('Channel name is required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.channels.create({
        name: name.trim(),
        description: description.trim(),
        is_public: isPublic,
        avatar_attachment_id: avatarId,
      });
      onCreated(res.channel);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create channel.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New channel"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy || uploadingAvatar}>
            {busy ? <Spinner size="sm" /> : <Megaphone size={16} />} Create channel
          </button>
        </>
      }
    >
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); void submit(); }} className="modal-body">
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <button
            type="button"
            className="avatar"
            style={{ width: 84, height: 84, borderRadius: 26, cursor: 'pointer' }}
            onClick={() => fileRef.current?.click()}
            aria-label="Choose channel avatar"
            title="Choose channel avatar"
          >
            {avatarPreview ? <img src={avatarPreview} alt="" /> : uploadingAvatar ? <Spinner /> : <Megaphone size={30} />}
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
          <label htmlFor="c-name">Channel name</label>
          <input id="c-name" className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Product Announcements" required />
        </div>
        <div className="field">
          <label htmlFor="c-desc">Description</label>
          <textarea id="c-desc" className="input" rows={2} value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} placeholder="What will this channel broadcast?" />
        </div>
        <div className="setting-row" style={{ padding: '4px 0' }}>
          <div>
            <div className="sr-label">Public channel</div>
            <div className="sr-desc">Anyone can find it and subscribe. Private channels require an admin invite.</div>
          </div>
          <Toggle checked={isPublic} onChange={setIsPublic} label="Public channel" />
        </div>
        {error && <Notice kind="error">{error}</Notice>}
      </form>
    </Modal>
  );
}
