import { FormEvent, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AtSign, Camera, CalendarDays, LogOut, MessageSquare, Pencil, Settings as SettingsIcon, UserRoundX } from 'lucide-react';
import { api, uploadFile } from '../api';
import { useAuth } from '../context/AuthContext';
import { useRealtime } from '../context/RealtimeContext';
import { useToast } from '../context/ToastContext';
import { Avatar } from '../components/Avatar';
import { Modal, Notice, Spinner } from '../components/ui';
import { formatJoinedDate } from '../lib/time';

export function ProfilePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const realtime = useRealtime();
  const { profile, settings, setProfile, signOut } = useAuth();

  const [editOpen, setEditOpen] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!profile) {
    return (
      <div className="page">
        <div className="empty-state">
          <div className="empty-icon">
            <UserRoundX size={26} />
          </div>
          <h3>Profile unavailable</h3>
          <p>Your profile could not be loaded. Please sign in again.</p>
          <button className="btn btn-primary btn-sm" onClick={signOut}>
            Sign out
          </button>
        </div>
      </div>
    );
  }

  const openEdit = () => {
    setDisplayName(profile.display_name);
    setUsername(profile.username);
    setBio(profile.bio);
    setEditError(null);
    setEditOpen(true);
  };

  const changeAvatar = async (file: File | undefined) => {
    if (!file) return;
    setAvatarBusy(true);
    try {
      const att = await uploadFile(file, 'avatar');
      const res = await api.users.updateMe({ avatar_attachment_id: att.id });
      if (res.profile) setProfile(res.profile);
      toast.success('Avatar updated.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update avatar.');
    } finally {
      setAvatarBusy(false);
    }
  };

  const saveProfile = async () => {
    setSaving(true);
    setEditError(null);
    try {
      const res = await api.users.updateMe({
        display_name: displayName.trim(),
        username: username.trim(),
        bio: bio.trim(),
      });
      if (res.profile) setProfile(res.profile);
      toast.success('Profile saved.');
      setEditOpen(false);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to save profile.');
    } finally {
      setSaving(false);
    }
  };

  const online = settings.show_online_status && realtime.online.has(profile.id);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Profile</h1>
        <button className="btn btn-glass btn-sm" onClick={openEdit}>
          <Pencil size={15} /> Edit
        </button>
      </div>

      <div className="card profile-hero anim-fade-up">
        <div className="avatar-edit" onClick={() => fileRef.current?.click()} role="button" tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && fileRef.current?.click()} aria-label="Change avatar">
          <Avatar name={profile.display_name} attachmentId={profile.avatar_attachment_id} size={104} online={online} />
          <span className="cam-badge">{avatarBusy ? <Spinner size="sm" /> : <Camera size={15} />}</span>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          className="sr-only"
          onChange={(e) => {
            void changeAvatar(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <div>
          <h2>{profile.display_name}</h2>
          <div className="username">@{profile.username}</div>
        </div>
        {profile.bio ? (
          <p className="bio">{profile.bio}</p>
        ) : (
          <p className="bio" style={{ opacity: 0.6 }}>
            No bio yet — tell people a little about yourself.
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <span className="chip">
            <CalendarDays size={12} /> Joined {formatJoinedDate(profile.created_at)}
          </span>
          <span className={`chip ${online ? 'success' : ''}`}>{online ? '● Online' : '○ Offline to others'}</span>
        </div>
      </div>

      <div className="list">
        <button className="list-item glass-hover" onClick={() => navigate('/settings')}>
          <span style={{ color: 'var(--accent)', display: 'flex' }}>
            <SettingsIcon size={20} />
          </span>
          <div className="li-body">
            <div className="li-title">Settings</div>
            <div className="li-sub">Theme, notifications, privacy and account</div>
          </div>
        </button>
        <button className="list-item glass-hover" onClick={() => navigate('/search')}>
          <span style={{ color: 'var(--accent)', display: 'flex' }}>
            <MessageSquare size={20} />
          </span>
          <div className="li-body">
            <div className="li-title">Find people</div>
            <div className="li-sub">Search the community and start a chat</div>
          </div>
        </button>
        <button className="list-item glass-hover" onClick={signOut} style={{ color: 'var(--danger)' }}>
          <span style={{ display: 'flex' }}>
            <LogOut size={20} />
          </span>
          <div className="li-body">
            <div className="li-title" style={{ color: 'var(--danger)' }}>
              Sign out
            </div>
            <div className="li-sub">End this session on this device</div>
          </div>
        </button>
      </div>

      <p className="t-faint" style={{ textAlign: 'center' }}>
        Your unique ID: <span className="t-mono">{profile.id.slice(0, 8)}…</span>
      </p>

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit profile"
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setEditOpen(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void saveProfile()} disabled={saving}>
              {saving ? <Spinner size="sm" /> : null} Save changes
            </button>
          </>
        }
      >
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); void saveProfile(); }} className="modal-body">
          {editError && <Notice kind="error">{editError}</Notice>}
          <div className="field">
            <label htmlFor="p-display">Display name</label>
            <input id="p-display" className="input" value={displayName} maxLength={60} onChange={(e) => setDisplayName(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="p-username">Username</label>
            <div className="input-with-icon">
              <AtSign size={16} className="input-icon" />
              <input
                id="p-username"
                className="input"
                value={username}
                maxLength={20}
                onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                required
                pattern="[a-z0-9_]{3,20}"
                title="3–20 characters: lowercase letters, numbers, underscores"
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="p-bio">Bio</label>
            <textarea id="p-bio" className="input" rows={3} value={bio} maxLength={300} onChange={(e) => setBio(e.target.value)} placeholder="A few words about you…" />
          </div>
        </form>
      </Modal>
    </div>
  );
}
