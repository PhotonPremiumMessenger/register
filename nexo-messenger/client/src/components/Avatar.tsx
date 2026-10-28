import { useEffect, useState, ReactNode } from 'react';
import { attachmentUrl } from '../api';

function hueFrom(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() || '').join('') || '?';
}

/** Loads an attachment through the authorized endpoint (never a raw <img src>). */
export function useSecureImage(attachmentId: string | null | undefined): { url: string | null; loading: boolean } {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(attachmentId));

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    if (!attachmentId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    attachmentUrl(attachmentId)
      .then((u) => !cancelled && setUrl(u))
      .catch(() => !cancelled && setUrl(null))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [attachmentId]);

  return { url, loading };
}

export function Avatar({
  name,
  attachmentId,
  size = 44,
  online,
  rounded,
  fallbackIcon,
}: {
  name: string;
  attachmentId?: string | null;
  size?: number;
  online?: boolean;
  rounded?: boolean;
  fallbackIcon?: ReactNode;
}) {
  const { url } = useSecureImage(attachmentId);
  const hue = hueFrom(name || '?');
  return (
    <div
      className="avatar"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(11, size * 0.36),
        borderRadius: rounded ? Math.max(10, size * 0.3) : '50%',
        background: url
          ? undefined
          : `linear-gradient(135deg, hsla(${hue}, 68%, 62%, 0.34), hsla(${(hue + 48) % 360}, 68%, 52%, 0.18))`,
      }}
      aria-hidden={online === undefined}
    >
      {url ? <img src={url} alt="" /> : fallbackIcon ? <span style={{ display: 'flex', opacity: 0.9 }}>{fallbackIcon}</span> : initials(name)}
      {online !== undefined && <span className={`presence-dot ${online ? '' : 'offline'}`} title={online ? 'Online' : 'Offline'} />}
    </div>
  );
}
