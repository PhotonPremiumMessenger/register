import { useEffect, useRef, useState } from 'react';
import { Paperclip, SendHorizonal, X } from 'lucide-react';
import type { Attachment } from '../api/types';
import { uploadFile, attachmentUrl } from '../api';
import { useRealtime } from '../context/RealtimeContext';
import { useToast } from '../context/ToastContext';
import { Spinner } from './ui';

const ACCEPTED =
  'image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,text/markdown,application/zip,audio/mpeg,video/mp4';
const MAX_BYTES = 15 * 1024 * 1024; // mirrors server default (MAX_UPLOAD_MB)

interface PendingUpload {
  progress: number;
  done: boolean;
  attachment?: Attachment;
  previewUrl?: string;
  fileName: string;
}

export function Composer({
  onSend,
  placeholder = 'Message…',
  chatType,
  chatId,
  disabled,
  disabledNotice,
}: {
  onSend: (content: string, attachmentId: string | null) => Promise<void>;
  placeholder?: string;
  chatType?: 'dm' | 'group';
  chatId?: string;
  disabled?: boolean;
  disabledNotice?: string;
}) {
  const toast = useToast();
  const realtime = useRealtime();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [upload, setUpload] = useState<PendingUpload | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastTypingSent = useRef(0);
  const typingStopTimer = useRef<number | null>(null);

  const autoResize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  };

  useEffect(() => autoResize(), [text]);

  useEffect(() => {
    return () => {
      if (typingStopTimer.current) window.clearTimeout(typingStopTimer.current);
      if (chatType && chatId) {
        realtime.send({ type: 'typing', chat_type: chatType, chat_id: chatId, is_typing: false });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatType, chatId]);

  const emitTyping = () => {
    if (!chatType || !chatId || disabled) return;
    const now = Date.now();
    if (now - lastTypingSent.current > 2000) {
      lastTypingSent.current = now;
      realtime.send({ type: 'typing', chat_type: chatType, chat_id: chatId, is_typing: true });
    }
    if (typingStopTimer.current) window.clearTimeout(typingStopTimer.current);
    // automatic timeout: stop the indicator if no keys for 3s
    typingStopTimer.current = window.setTimeout(() => {
      realtime.send({ type: 'typing', chat_type: chatType, chat_id: chatId, is_typing: false });
    }, 3000);
  };

  const pickFile = async (file: File | undefined | null) => {
    if (!file) return;
    if (!ACCEPTED.split(',').includes(file.type)) {
      toast.error(`"${file.type || file.name}" is not a supported file type.`);
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error(`File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 15 MB.`);
      return;
    }
    setSendError(null);
    setUpload({ progress: 0, done: false, fileName: file.name });
    try {
      const attachment = await uploadFile(file, 'message', (p) =>
        setUpload((u) => (u ? { ...u, progress: p } : u))
      );
      let previewUrl: string | undefined;
      if (attachment.mime_type.startsWith('image/')) {
        previewUrl = await attachmentUrl(attachment.id).catch(() => undefined);
      }
      setUpload({ progress: 100, done: true, attachment, previewUrl, fileName: file.name });
    } catch (err) {
      setUpload(null);
      toast.error(err instanceof Error ? err.message : 'Upload failed.');
    }
  };

  const send = async () => {
    const content = text.trim();
    const attachmentId = upload?.attachment?.id ?? null;
    if (!content && !attachmentId) return;
    setSending(true);
    setSendError(null);
    try {
      await onSend(content, attachmentId);
      setText('');
      setUpload(null);
      if (chatType && chatId) {
        realtime.send({ type: 'typing', chat_type: chatType, chat_id: chatId, is_typing: false });
      }
      requestAnimationFrame(autoResize);
    } catch (err) {
      // Honest failure: keep the draft, show the error.
      setSendError(err instanceof Error ? err.message : 'Failed to send message.');
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  if (disabled) {
    return (
      <div className="composer-wrap">
        <div className="composer" style={{ justifyContent: 'center' }}>
          <span className="t-sub" style={{ padding: '8px 6px' }}>
            {disabledNotice || 'You cannot send messages here.'}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="composer-wrap">
      {upload && (
        <div className="pending-attachment">
          {upload.previewUrl ? (
            <img src={upload.previewUrl} alt="" />
          ) : (
            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--glass-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Paperclip size={17} />
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="truncate" style={{ fontSize: 'var(--fs-sm)', fontWeight: 600 }}>
              {upload.fileName}
            </div>
            {!upload.done ? (
              <div className="progress-track" style={{ marginTop: 6 }}>
                <div className="progress-fill" style={{ width: `${upload.progress}%` }} />
              </div>
            ) : (
              <div className="t-faint" style={{ color: 'var(--success)' }}>
                Uploaded — ready to send
              </div>
            )}
          </div>
          {upload.done && !sending ? (
            <button className="icon-btn" aria-label="Remove attachment" onClick={() => setUpload(null)}>
              <X size={16} />
            </button>
          ) : null}
        </div>
      )}
      {sendError && (
        <div style={{ maxWidth: 860, margin: '0 auto 8px' }}>
          <div className="notice error">{sendError} Your draft was kept — tap send to retry.</div>
        </div>
      )}
      <div className="composer">
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED}
          className="sr-only"
          onChange={(e) => {
            void pickFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <button
          className="icon-btn"
          aria-label="Attach a file"
          onClick={() => fileInputRef.current?.click()}
          disabled={Boolean(upload && !upload.done)}
        >
          <Paperclip size={20} />
        </button>
        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          placeholder={placeholder}
          onChange={(e) => {
            setText(e.target.value);
            emitTyping();
          }}
          onKeyDown={onKeyDown}
          aria-label="Message text"
        />
        <button
          className="send-btn"
          aria-label={sending ? 'Sending…' : 'Send message'}
          disabled={!text.trim() && !upload?.attachment ? true : sending}
          onClick={() => void send()}
        >
          {sending ? <Spinner size="sm" /> : <SendHorizonal size={20} />}
        </button>
      </div>
    </div>
  );
}
