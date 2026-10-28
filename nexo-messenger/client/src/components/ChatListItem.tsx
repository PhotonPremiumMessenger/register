import { ReactNode } from 'react';
import { formatListTime } from '../lib/time';
import { Avatar } from './Avatar';
import { UnreadBadge } from './ui';

export function ChatListItem({
  title,
  subtitle,
  timestamp,
  unread,
  avatarName,
  avatarAttachmentId,
  online,
  rounded,
  fallbackIcon,
  onClick,
  trailing,
  muted,
}: {
  title: string;
  subtitle?: ReactNode;
  timestamp?: string | null;
  unread?: number;
  avatarName: string;
  avatarAttachmentId?: string | null;
  online?: boolean;
  rounded?: boolean;
  fallbackIcon?: ReactNode;
  onClick?: () => void;
  trailing?: ReactNode;
  muted?: boolean;
}) {
  return (
    <button type="button" className="list-item glass-hover" onClick={onClick} disabled={!onClick}>
      <Avatar name={avatarName} attachmentId={avatarAttachmentId} size={48} online={online} rounded={rounded} fallbackIcon={fallbackIcon} />
      <div className="li-body">
        <div className="li-title truncate" style={muted ? { color: 'var(--text-dim)' } : undefined}>
          {title}
        </div>
        {subtitle !== undefined && <div className="li-sub truncate">{subtitle}</div>}
      </div>
      <div className="li-trailing">
        {timestamp && <span className="t-faint">{formatListTime(timestamp)}</span>}
        {trailing}
        <UnreadBadge count={unread ?? 0} />
      </div>
    </button>
  );
}
