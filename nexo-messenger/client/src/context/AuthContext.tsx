import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from 'react';
import { api, getToken, setToken } from '../api';
import type { AuthProviders, PublicProfile, Settings } from '../api/types';

interface AuthState {
  profile: PublicProfile | null;
  settings: Settings;
  providers: AuthProviders;
  initializing: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, username: string, displayName: string) => Promise<void>;
  signOut: () => void;
  adoptToken: (token: string) => Promise<boolean>;
  refresh: () => Promise<void>;
  setProfile: (p: PublicProfile) => void;
  setSettings: (s: Settings) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

const DEFAULT_SETTINGS: Settings = {
  theme: 'obsidian',
  notifications_enabled: true,
  notification_sound: true,
  show_online_status: true,
  allow_messages_from: 'everyone',
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfileState] = useState<PublicProfile | null>(null);
  const [settings, setSettingsState] = useState<Settings | null>(null);
  const [providers, setProviders] = useState<AuthProviders>({ google: false, smtp: false, dev_reset_link: false });
  const [initializing, setInitializing] = useState(true);

  const applySession = useCallback((token: string, p: PublicProfile, s: Settings) => {
    setToken(token);
    setProfileState(p);
    setSettingsState(s);
    window.dispatchEvent(new Event('nexo:auth-changed'));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      api.auth
        .providers()
        .then((p) => !cancelled && setProviders(p))
        .catch(() => undefined);
      const token = getToken();
      if (!token) {
        if (!cancelled) setInitializing(false);
        return;
      }
      try {
        const me = await api.auth.me();
        if (!cancelled) {
          setProfileState(me.profile);
          setSettingsState(me.settings);
        }
      } catch {
        setToken(null);
      } finally {
        if (!cancelled) setInitializing(false);
      }
    })();
    const onUnauthorized = () => {
      setProfileState(null);
      setSettingsState(null);
    };
    window.addEventListener('nexo:unauthorized', onUnauthorized);
    return () => {
      cancelled = true;
      window.removeEventListener('nexo:unauthorized', onUnauthorized);
    };
  }, []);

  // Apply persisted theme
  useEffect(() => {
    const theme = settings?.theme || 'obsidian';
    document.documentElement.setAttribute('data-theme', theme);
  }, [settings?.theme]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const res = await api.auth.signIn({ email, password });
      applySession(res.token, res.profile, res.settings);
    },
    [applySession]
  );

  const signUp = useCallback(
    async (email: string, password: string, username: string, displayName: string) => {
      const res = await api.auth.signUp({ email, password, username, display_name: displayName });
      applySession(res.token, res.profile, res.settings);
    },
    [applySession]
  );

  const signOut = useCallback(() => {
    setToken(null);
    setProfileState(null);
    setSettingsState(null);
    window.dispatchEvent(new Event('nexo:auth-changed'));
  }, []);

  const adoptToken = useCallback(
    async (token: string) => {
      try {
        const res = await api.auth.verify(token);
        applySession(res.token, res.profile, res.settings);
        return true;
      } catch {
        return false;
      }
    },
    [applySession]
  );

  const refresh = useCallback(async () => {
    if (!getToken()) return;
    try {
      const me = await api.auth.me();
      setProfileState(me.profile);
      setSettingsState(me.settings);
    } catch {
      /* handled by 401 interceptor */
    }
  }, []);

  const setSettings = useCallback((s: Settings) => setSettingsState(s), []);
  const setProfile = useCallback((p: PublicProfile) => setProfileState(p), []);

  const value = useMemo<AuthState>(
    () => ({
      profile,
      settings: settings ?? DEFAULT_SETTINGS,
      providers,
      initializing,
      signIn,
      signUp,
      signOut,
      adoptToken,
      refresh,
      setProfile,
      setSettings,
    }),
    [profile, settings, providers, initializing, signIn, signUp, signOut, adoptToken, refresh, setProfile, setSettings]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
