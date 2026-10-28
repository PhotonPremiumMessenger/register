import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageCirclePlus, MessagesSquare, Paperclip } from 'lucide-react';
import { api } from '../api';
import type { Conversation, PublicProfile } from '../api/types';
import { useRealtime } from '../context/RealtimeContext';
import { ChatListItem } from '../components/ChatListItem';
import { UserPickerModal } from '../components/UserPickerModal';
import { EmptyState, Loading, Notice } from '../components/ui';

function previewText(conv: Conversation): string {
  const last = conv.last_message;
  if (!last) return 'No messages yet — say hello';
  const prefix = last.attachment ? `${last.content ? `${last.content} · ` : ''}📎 ${last.attachment.file_name}` : last.content;
  return prefix || '📎 Attachment';
}

export function ChatsPage() {
  const navigate = useNavigate();
  const realtime = useRealtime();
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const refreshTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.chats.list();
      setConversations(res.conversations);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load chats.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Refresh (debounced) when realtime activity touches DMs
  useEffect(() => {
    const unsub = realtime.subscribe((event) => {
      if (event.type === 'message' && event.message.conversation_id) {
        if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
        refreshTimer.current = window.setTimeout(() => void load(), 400);
      } else if (event.type === 'read' && event.chat_type === 'dm') {
        if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
        refreshTimer.current = window.setTimeout(() => void load(), 400);
      }
    });
    return () => {
      unsub();
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    };
  }, [realtime, load]);

  const startChat = async (selected: PublicProfile[]) => {
    const target = selected[0];
    if (!target) return;
    try {
      const res = await api.chats.open(target.id);
      if (res.conversation) navigate(`/c/${res.conversation.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open the conversation.');
      throw err; // keep the modal open on failure
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1>Chats</h1>
        <button className="btn btn-glass btn-sm" onClick={() => setPickerOpen(true)}>
          <MessageCirclePlus size={16} /> New chat
        </button>
      </div>

      {error && <Notice kind="error">{error}</Notice>}

      {conversations === null && !error ? (
        <Loading label="Loading conversations…" />
      ) : conversations && conversations.length === 0 ? (
        <EmptyState
          icon={<MessagesSquare size={26} />}
          title="No conversations yet"
          message="Start a private conversation with anyone on NEXO. Messages are stored securely and arrive in realtime."
          action={
            <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} onClick={() => setPickerOpen(true)}>
              <MessageCirclePlus size={16} /> Find someone
            </button>
          }
        />
      ) : (
        <div className="list">
          {conversations?.map((conv) => {
            const other = conv.other;
            if (!other) {
              return (
                <div key={conv.id} className="list-item" style={{ opacity: 0.6, cursor: 'default' }}>
                  <div className="li-body">
                    <div className="li-title">Missing profile</div>
                    <div className="li-sub">This account no longer exists.</div>
                  </div>
                </div>
              );
            }
            return (
              <ChatListItem
                key={conv.id}
                title={other.display_name}
                subtitle={
                  <span className="truncate">
                    {conv.last_message?.attachment && !conv.last_message.content ? (
                      <Paperclip size={12} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 4 }} />
                    ) : null}
                    {previewText(conv)}
                  </span>
                }
                timestamp={conv.last_message?.created_at ?? conv.last_activity_at}
                unread={conv.unread_count}
                avatarName={other.display_name}
                avatarAttachmentId={other.avatar_attachment_id}
                online={realtime.online.has(other.id)}
                onClick={() => navigate(`/c/${conv.id}`)}
              />
            );
          })}
        </div>
      )}

      <UserPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onConfirm={startChat}
        title="New conversation"
        confirmLabel="Open chat"
      />
    </div>
  );
}
