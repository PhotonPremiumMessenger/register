import { useState } from 'react';
import { Check, CheckCheck, Download, FileText, Film, Image as ImageIcon, Music, X } from 'lucide-react';
import type { Attachment, Message } from '../api/types';
import { attachmentUrl, formatBytes } from '../api';
import { useToast } from '../context/ToastContext';
import { useSecureImage } from './Avatar';

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatDayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(d, today)) return 'Today';
  if (same(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
}

function AttachmentView({ attachment }: { attachment: Attachment }) {
  const toast = useToast();
  const isImage = attachment.mime_type.startsWith('image/');
  const { url } = useSecureImage(isImage ? attachment.id : null);
  const [lightbox, setLightbox] = useState(false);

  const openFile = async () => {
    try {
      const fileUrl = url || (await attachmentUrl(attachment.id));
      window.open(fileUrl, '_blank', 'noopener');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to open the file.');
    }
  };

  if (isImage) {
    return (
      <div className="bubble-attachment">
        {url ? (
          <img
            className="attach-img"
            src={url}
            alt={attachment.file_name}
            loading="lazy"
            onClick={() => setLightbox(true)}
          />
        ) : (
          <div className="file-chip">
            <ImageIcon size={20} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="fc-name truncate">Loading image…</div>
            </div>
          </div>
        )}
        {lightbox && (
          <div className="lightbox" onClick={() => setLightbox(false)}>
            <button
              className="icon-btn"
              style={{ position: 'absolute', top: 18, right: 18, color: '#fff' }}
              aria-label="Close preview"
              onClick={() => setLightbox(false)}
            >
              <X size={22} />
            </button>
            <img src={url || undefined} alt={attachment.file_name} />
          </div>
        )}
      </div>
    );
  }

  const icon = attachment.mime_type.startsWith('video/') ? (
    <Film size={20} />
  ) : attachment.mime_type.startsWith('audio/') ? (
    <Music size={20} />
  ) : (
    <FileText size={20} />
  );
  return (
    <div className="bubble-attachment">
      <div className="file-chip" role="button" tabIndex={0} onClick={openFile} onKeyDown={(e) => e.key === 'Enter' && openFile()}>
        <span style={{ color: 'var(--accent)', display: 'flex' }}>{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="fc-name truncate">{attachment.file_name}</div>
          <div className="fc-size">{formatBytes(attachment.size_bytes)}</div>
        </div>
        <Download size={16} style={{ color: 'var(--text-faint)' }} />
      </div>
    </div>
  );
}

export interface BubbleReadState {
  delivered: boolean;
  read: boolean;
}

export function MessageBubble({
  message,
  isMe,
  showSender,
  grouped,
  readState,
}: {
  message: Message;
  isMe: boolean;
  showSender?: boolean;
  grouped?: boolean;
  readState?: BubbleReadState | null;
}) {
  const sender = message.sender;
  return (
    <div className={`msg-row ${isMe ? 'me' : ''}`}>
      <div className="msg-col">
        <div
          className={`bubble ${
            grouped ? (isMe ? 'grouped-me' : 'grouped-them') : ''
          }`}
        >
          {showSender && !isMe && !grouped && sender && (
            <div className="bubble-sender">{sender.display_name}</div>
          )}
          {message.attachment && <AttachmentView attachment={message.attachment} />}
          {message.content ? <div>{message.content}</div> : null}
          <div className="bubble-meta">
            <span>{formatTime(message.created_at)}</span>
            {isMe && readState && (
              <span className="checks" title={readState.read ? 'Read' : readState.delivered ? 'Delivered' : 'Sent'}>
                {readState.read ? <CheckCheck size={13} /> : readState.delivered ? <CheckCheck size={13} style={{ opacity: 0.55 }} /> : <Check size={13} />}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
