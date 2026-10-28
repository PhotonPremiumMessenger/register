import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  MessageCircle,
  Users,
  Megaphone,
  Search,
  UserRound,
  Settings as SettingsIcon,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useRealtime } from '../context/RealtimeContext';
import { api } from '../api';
import { Avatar } from './Avatar';

const NAV_ITEMS = [
  { to: '/chats', label: 'Chats', icon: MessageCircle, key: 'chats' },
  { to: '/groups', label: 'Groups', icon: Users, key: 'groups' },
  { to: '/channels', label: 'Channels', icon: Megaphone, key: 'channels' },
  { to: '/search', label: 'Search', icon: Search, key: 'search' },
  { to: '/profile', label: 'Profile', icon: UserRound, key: 'profile' },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, key: 'settings' },
] as const;

function useUnreadCounts() {
  const realtime = useRealtime();
  const { profile } = useAuth();
  const [counts, setCounts] = useState({ chats: 0, groups: 0, channels: 0 });
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!profile) return;
    const refresh = async () => {
      try {
        const [c, g, ch] = await Promise.all([api.chats.list(), api.groups.list(), api.channels.list()]);
        setCounts({
          chats: c.conversations.reduce((n, x) => n + (x.unread_count || 0), 0),
          groups: g.groups.reduce((n, x) => n + (x.unread_count || 0), 0),
          channels: ch.channels.reduce((n, x) => n + (x.unread_count || 0), 0),
        });
      } catch {
        /* transient — retried on next event */
      }
    };
    void refresh();
    const schedule = () => {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(refresh, 500);
    };
    const unsub = realtime.subscribe((event) => {
      if (event.type === 'message' || event.type === 'post' || event.type === 'read') schedule();
    });
    const onVisible = () => document.visibilityState === 'visible' && schedule();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      unsub();
      document.removeEventListener('visibilitychange', onVisible);
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [profile, realtime]);

  return counts;
}

/** Soft WebAudio ping for incoming messages (no audio assets needed). */
export function playNotificationSound(): void {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
    osc.onended = () => ctx.close().catch(() => undefined);
  } catch {
    /* audio unavailable */
  }
}

export function AppShell() {
  const location = useLocation();
  const { profile, settings } = useAuth();
  const realtime = useRealtime();
  const counts = useUnreadCounts();

  const isRoom = useMemo(() => /^\/(c|g|ch)\//.test(location.pathname), [location.pathname]);

  // Browser notifications + sound for incoming messages outside the active room
  useEffect(() => {
    if (!profile) return;
    const unsub = realtime.subscribe((event) => {
      const isIncomingMessage = event.type === 'message' || event.type === 'post';
      if (!isIncomingMessage) return;
      const senderId = event.type === 'message' ? event.message.sender?.id : event.post.author?.id;
      if (senderId === profile.id) return;

      const chatId =
        event.type === 'message'
          ? event.message.conversation_id || event.message.group_id || ''
          : event.post.channel_id;
      const viewingThisRoom =
        isRoom && (location.pathname.endsWith(`/c/${chatId}`) || location.pathname.endsWith(`/g/${chatId}`) || location.pathname.endsWith(`/ch/${chatId}`));
      if (viewingThisRoom && document.visibilityState === 'visible') return;

      const title = event.type === 'message' ? event.message.sender?.display_name || 'New message' : event.post.author?.display_name || 'New post';
      const body = event.type === 'message'
        ? event.message.content || (event.message.attachment ? '📎 Attachment' : '')
        : event.post.content || (event.post.attachment ? '📎 Attachment' : '');

      if (settings.notifications_enabled && 'Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
        try {
          new Notification(title, { body: body.slice(0, 120), silent: true, tag: chatId });
        } catch {
          /* notification failed — ignore */
        }
      }
      if (settings.notification_sound) playNotificationSound();
    });
    return unsub;
  }, [profile, realtime, settings.notifications_enabled, settings.notification_sound, isRoom, location.pathname]);

  const badgeFor = (key: string): number =>
    key === 'chats' ? counts.chats : key === 'groups' ? counts.groups : key === 'channels' ? counts.channels : 0;

  return (
    <div className="app-shell">
      <nav className="nav-rail" aria-label="Main navigation">
        <div className="rail-logo" aria-hidden>
          <svg width="22" height="22" viewBox="0 0 32 32" fill="none">
            <path d="M8 22V10l8 7.5V10l8 12-8-7.5V22z" fill="currentColor" />
          </svg>
        </div>
        {NAV_ITEMS.map(({ to, label, icon: Icon, key }) => (
          <NavLink key={to} to={to} className={({ isActive }) => `rail-item ${isActive ? 'active' : ''}`}>
            <Icon size={21} strokeWidth={1.9} />
            <span>{label}</span>
            {badgeFor(key) > 0 && <span className="rail-badge">{badgeFor(key) > 9 ? '9+' : badgeFor(key)}</span>}
          </NavLink>
        ))}
        <div className="rail-spacer" />
        {profile && (
          <NavLink to="/profile" aria-label="Open profile" style={{ marginBottom: 4 }}>
            <Avatar
              name={profile.display_name}
              attachmentId={profile.avatar_attachment_id}
              size={40}
              online={settings.show_online_status ? true : undefined}
            />
          </NavLink>
        )}
      </nav>

      <div className="app-content">
        <Outlet />
      </div>

      {!isRoom && (
        <nav className="bottom-nav" aria-label="Main navigation">
          {NAV_ITEMS.map(({ to, label, icon: Icon, key }) => (
            <NavLink key={to} to={to} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <Icon size={21} strokeWidth={1.9} />
              <span className="truncate">{label}</span>
              {badgeFor(key) > 0 && <span className="nav-badge">{badgeFor(key) > 9 ? '9+' : badgeFor(key)}</span>}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
