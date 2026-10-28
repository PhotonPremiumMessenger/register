import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from 'react';
import { getToken } from '../api';
import type { RealtimeEvent } from '../api/types';

type Listener = (event: RealtimeEvent) => void;

interface RealtimeState {
  status: 'idle' | 'connecting' | 'open' | 'closed';
  online: Set<string>;
  subscribe: (listener: Listener) => () => void;
  send: (event: Record<string, unknown>) => void;
}

const RealtimeContext = createContext<RealtimeState | null>(null);

export function useRealtime(): RealtimeState {
  const ctx = useContext(RealtimeContext);
  if (!ctx) throw new Error('useRealtime must be used inside RealtimeProvider');
  return ctx;
}

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<RealtimeState['status']>('idle');
  const [online, setOnline] = useState<Set<string>>(new Set());
  const wsRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef<Set<Listener>>(new Set());
  const retryRef = useRef(0);
  const disposedRef = useRef(false);
  const pingRef = useRef<number | null>(null);

  const subscribe = useCallback((listener: Listener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const send = useCallback((event: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  }, []);

  useEffect(() => {
    disposedRef.current = false;

    const connect = () => {
      const token = getToken();
      if (!token || disposedRef.current) {
        setStatus('idle');
        return;
      }
      setStatus('connecting');
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${window.location.host}/ws?token=${encodeURIComponent(token)}`);
      wsRef.current = ws;

      ws.onopen = () => {
        retryRef.current = 0;
        setStatus('open');
        pingRef.current = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
        }, 25_000);
      };

      ws.onmessage = (ev) => {
        let event: RealtimeEvent;
        try {
          event = JSON.parse(String(ev.data)) as RealtimeEvent;
        } catch {
          return;
        }
        if (event.type === 'welcome') {
          setOnline(new Set(event.online.filter(Boolean)));
        } else if (event.type === 'presence') {
          setOnline((prev) => {
            const next = new Set(prev);
            if (event.online) next.add(event.user_id);
            else next.delete(event.user_id);
            return next;
          });
        }
        for (const listener of listenersRef.current) {
          try {
            listener(event);
          } catch (err) {
            console.error('[realtime] listener error', err);
          }
        }
      };

      ws.onclose = () => {
        if (pingRef.current) window.clearInterval(pingRef.current);
        wsRef.current = null;
        if (disposedRef.current || !getToken()) {
          setStatus('idle');
          return;
        }
        setStatus('closed');
        const delay = Math.min(30_000, 800 * 2 ** retryRef.current++);
        window.setTimeout(connect, delay);
      };

      ws.onerror = () => {
        // onclose will follow and schedule the retry
      };
    };

    connect();
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'nexo.token') {
        wsRef.current?.close();
        retryRef.current = 0;
        connect();
      }
    };
    const onUnauthorized = () => {
      wsRef.current?.close();
      setOnline(new Set());
      setStatus('idle');
    };
    const onAuthChanged = () => {
      setOnline(new Set());
      retryRef.current = 0;
      if (pingRef.current) window.clearInterval(pingRef.current);
      const existing = wsRef.current;
      if (existing) {
        // Close and reconnect with the (possibly new) token.
        const prevDisposed = disposedRef.current;
        existing.onclose = () => {
          if (!prevDisposed) connect();
        };
        existing.close();
      } else {
        connect();
      }
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('nexo:unauthorized', onUnauthorized);
    window.addEventListener('nexo:auth-changed', onAuthChanged);

    return () => {
      disposedRef.current = true;
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('nexo:unauthorized', onUnauthorized);
      window.removeEventListener('nexo:auth-changed', onAuthChanged);
      if (pingRef.current) window.clearInterval(pingRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  const value = useMemo<RealtimeState>(() => ({ status, online, subscribe, send }), [status, online, subscribe, send]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}
