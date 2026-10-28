import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CircleAlert, Lock, LogOut, MoonStar, Palette, ShieldCheck, UserRound } from 'lucide-react';
import { api } from '../api';
import type { Settings } from '../api/types';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { playNotificationSound } from '../components/AppShell';
import { Notice, Spinner, Toggle } from '../components/ui';
import { formatJoinedDate } from '../lib/time';

const THEME_LABELS: Record<Settings['theme'], string> = {
  obsidian: 'Obsidian Glass (default)',
  midnight: 'Midnight — deeper, less transparent',
  black: 'Pure Black — opaque, no blur (AMOLED)',
};

export function SettingsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { profile, settings, setSettings, signOut, providers } = useAuth();
  const [local, setLocal] = useState<Settings>(settings);
  const [savingField, setSavingField] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setLocal(settings), [settings]);

  const update = async (patch: Partial<Settings>, field: string) => {
    setSavingField(field);
    setError(null);
    const optimistic = { ...local, ...patch };
    setLocal(optimistic);
    // Apply theme immediately for instant feedback
    if (patch.theme) document.documentElement.setAttribute('data-theme', patch.theme);
    try {
      const res = await api.settings.update(patch);
      setSettings(res.settings);
      setLocal(res.settings);
    } catch (err) {
      // Roll back on failure — never pretend a failed save succeeded.
      setLocal(settings);
      document.documentElement.setAttribute('data-theme', settings.theme);
      const message = err instanceof Error ? err.message : 'Failed to save setting.';
      setError(message);
      toast.error(message);
    } finally {
      setSavingField(null);
    }
  };

  const toggleNotifications = async (next: boolean) => {
    if (next && 'Notification' in window && Notification.permission === 'default') {
      try {
        await Notification.requestPermission();
      } catch {
        /* permission UI unavailable */
      }
    }
    if (next && 'Notification' in window && Notification.permission === 'denied') {
      toast.error('Browser notifications are blocked for this site. Allow them in your browser settings to enable this option.');
    }
    await update({ notifications_enabled: next }, 'notifications_enabled');
  };

  const notificationPermission = 'Notification' in window ? Notification.permission : 'unsupported';

  return (
    <div className="page">
      <div className="page-header">
        <h1>Settings</h1>
      </div>

      {error && <Notice kind="error">{error}</Notice>}

      {/* Account */}
      <section className="card settings-section anim-fade-up">
        <h3>
          <UserRound size={12} style={{ marginRight: 6, verticalAlign: -1 }} />
          Account
        </h3>
        <div className="setting-row">
          <div>
            <div className="sr-label">{profile?.display_name || '—'}</div>
            <div className="sr-desc">@{profile?.username || '—'}</div>
          </div>
          <button className="btn btn-glass btn-sm" onClick={() => navigate('/profile')}>
            Edit profile
          </button>
        </div>
        <div className="setting-row">
          <div>
            <div className="sr-label">Email</div>
            <div className="sr-desc">
              {profile?.id ? 'Signed in with email + password or Google.' : ''}
              {providers.google ? '' : ' Google OAuth is not configured on this server yet.'}
            </div>
          </div>
        </div>
        <div className="setting-row">
          <div>
            <div className="sr-label">Member since</div>
            <div className="sr-desc">{profile ? formatJoinedDate(profile.created_at) : '—'}</div>
          </div>
        </div>
      </section>

      {/* Appearance */}
      <section className="card settings-section anim-fade-up">
        <h3>
          <Palette size={12} style={{ marginRight: 6, verticalAlign: -1 }} />
          Appearance
        </h3>
        <div className="setting-row">
          <div style={{ flex: 1 }}>
            <div className="sr-label">Theme</div>
            <div className="sr-desc">The default is the black transparent glassmorphism design.</div>
          </div>
          <select
            className="input"
            value={local.theme}
            disabled={savingField === 'theme'}
            onChange={(e) => void update({ theme: e.target.value as Settings['theme'] }, 'theme')}
            aria-label="Theme"
          >
            {(Object.keys(THEME_LABELS) as Settings['theme'][]).map((t) => (
              <option key={t} value={t}>
                {THEME_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="setting-row">
          <div>
            <div className="sr-label">
              <MoonStar size={13} style={{ verticalAlign: -2, marginRight: 6 }} />
              Dark interface
            </div>
            <div className="sr-desc">NEXO is dark-only by design to protect the glass effect. A light theme is not available in this build.</div>
          </div>
        </div>
      </section>

      {/* Notifications */}
      <section className="card settings-section anim-fade-up">
        <h3>
          <Bell size={12} style={{ marginRight: 6, verticalAlign: -1 }} />
          Notifications
        </h3>
        <div className="setting-row">
          <div>
            <div className="sr-label">Message notifications</div>
            <div className="sr-desc">
              Browser notifications for incoming messages when the app is in the background.
              {notificationPermission === 'denied' && ' Currently blocked by your browser.'}
              {notificationPermission === 'unsupported' && ' Not supported by this browser.'}
            </div>
          </div>
          <Toggle
            checked={local.notifications_enabled}
            onChange={(v) => void toggleNotifications(v)}
            disabled={savingField !== null || notificationPermission === 'unsupported'}
            label="Message notifications"
          />
        </div>
        <div className="setting-row">
          <div>
            <div className="sr-label">Notification sound</div>
            <div className="sr-desc">
              Soft ping for incoming messages.{' '}
              <button type="button" className="btn btn-ghost btn-sm" style={{ minHeight: 24, padding: '2px 8px' }} onClick={playNotificationSound}>
                Preview
              </button>
            </div>
          </div>
          <Toggle
            checked={local.notification_sound}
            onChange={(v) => void update({ notification_sound: v }, 'notification_sound')}
            disabled={savingField !== null}
            label="Notification sound"
          />
        </div>
      </section>

      {/* Privacy */}
      <section className="card settings-section anim-fade-up">
        <h3>
          <ShieldCheck size={12} style={{ marginRight: 6, verticalAlign: -1 }} />
          Privacy
        </h3>
        <div className="setting-row">
          <div>
            <div className="sr-label">Show online status</div>
            <div className="sr-desc">When off, other people never see you as online (enforced server-side).</div>
          </div>
          <Toggle
            checked={local.show_online_status}
            onChange={(v) => void update({ show_online_status: v }, 'show_online_status')}
            disabled={savingField !== null}
            label="Show online status"
          />
        </div>
        <div className="setting-row">
          <div>
            <div className="sr-label">Direct messages</div>
            <div className="sr-desc">Who can start a conversation with you. Enforced by the server.</div>
          </div>
          <select
            className="input"
            value={local.allow_messages_from}
            disabled={savingField === 'allow_messages_from'}
            onChange={(e) =>
              void update({ allow_messages_from: e.target.value as Settings['allow_messages_from'] }, 'allow_messages_from')
            }
            aria-label="Who can message me"
          >
            <option value="everyone">Everyone</option>
            <option value="nobody">Nobody</option>
          </select>
        </div>
        <div className="setting-row">
          <div>
            <div className="sr-label">
              <Lock size={13} style={{ verticalAlign: -2, marginRight: 6 }} />
              End-to-end encryption
            </div>
            <div className="sr-desc">
              Not available in this build — messages are encrypted in transit (HTTPS/WSS when deployed behind TLS) and access-controlled
              on the server, but not end-to-end encrypted.
            </div>
          </div>
        </div>
      </section>

      {/* Session */}
      <section className="card settings-section anim-fade-up">
        <h3>
          <CircleAlert size={12} style={{ marginRight: 6, verticalAlign: -1 }} />
          Session
        </h3>
        <div className="setting-row">
          <div>
            <div className="sr-label">Password reset</div>
            <div className="sr-desc">
              {providers.smtp
                ? 'Reset links are sent by email (SMTP configured).'
                : providers.dev_reset_link
                  ? 'No SMTP configured — this server runs in dev mode and shows reset links directly after requesting one.'
                  : 'No SMTP configured and dev links are disabled — password reset emails cannot be delivered on this server yet.'}
            </div>
          </div>
        </div>
        <button
          className="btn btn-danger btn-block"
          onClick={() => {
            signOut();
            navigate('/auth', { replace: true });
          }}
          style={{ marginTop: 10 }}
        >
          {savingField ? <Spinner size="sm" /> : <LogOut size={16} />} Sign out
        </button>
      </section>

      <p className="t-faint" style={{ textAlign: 'center', lineHeight: 1.6 }}>
        NEXO Messenger · settings are stored in the database and follow your account across devices.
      </p>
    </div>
  );
}
