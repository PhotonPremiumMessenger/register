import { useEffect, useRef, useState } from 'react';
import { Search, UserPlus, X } from 'lucide-react';
import { api } from '../api';
import type { PublicProfile } from '../api/types';
import { useAuth } from '../context/AuthContext';
import { Avatar } from './Avatar';
import { EmptyState, Modal, Spinner } from './ui';

export function UserPickerModal({
  open,
  onClose,
  onConfirm,
  title = 'Select people',
  multiple = false,
  excludeIds = [],
  confirmLabel = 'Continue',
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (selected: PublicProfile[]) => void | Promise<void>;
  title?: string;
  multiple?: boolean;
  excludeIds?: string[];
  confirmLabel?: string;
}) {
  const { profile: me } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PublicProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<PublicProfile[]>([]);
  const [busy, setBusy] = useState(false);
  const debounce = useRef<number | null>(null);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults([]);
      setSelected([]);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (debounce.current) window.clearTimeout(debounce.current);
    if (!query.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounce.current = window.setTimeout(async () => {
      try {
        const res = await api.search(query.trim(), 'people');
        setResults(res.people.filter((p) => p.id !== me?.id && !excludeIds.includes(p.id)));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Search failed.');
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounce.current) window.clearTimeout(debounce.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open]);

  const toggle = (p: PublicProfile) => {
    if (!multiple) {
      setSelected([p]);
      return;
    }
    setSelected((prev) =>
      prev.some((x) => x.id === p.id) ? prev.filter((x) => x.id !== p.id) : [...prev, p]
    );
  };

  const confirm = async () => {
    if (selected.length === 0 || busy) return;
    setBusy(true);
    try {
      await onConfirm(selected);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void confirm()} disabled={selected.length === 0 || busy}>
            {busy ? <Spinner size="sm" /> : <UserPlus size={16} />} {confirmLabel}
            {multiple && selected.length > 0 ? ` (${selected.length})` : ''}
          </button>
        </>
      }
    >
      <div className="input-with-icon">
        <Search size={16} className="input-icon" />
        <input
          className="input"
          type="search"
          placeholder="Search by name or @username…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      </div>

      {multiple && selected.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {selected.map((p) => (
            <span key={p.id} className="chip accent">
              @{p.username}
              <button type="button" onClick={() => toggle(p)} aria-label={`Remove ${p.username}`} style={{ display: 'flex' }}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 18 }}>
          <Spinner />
        </div>
      )}
      {error && <div className="notice error">{error}</div>}
      {!loading && !error && query.trim() && results.length === 0 && (
        <EmptyState icon={<Search size={24} />} title="No people found" message={`Nobody matches "${query}".`} />
      )}
      {!query.trim() && (
        <p className="t-faint" style={{ textAlign: 'center', padding: '10px 0' }}>
          Type at least one character to search registered users.
        </p>
      )}

      <div className="list" style={{ maxHeight: 300, overflowY: 'auto' }}>
        {results.map((p) => {
          const isSelected = selected.some((x) => x.id === p.id);
          return (
            <button
              type="button"
              key={p.id}
              className={`list-item ${isSelected ? 'active' : ''}`}
              onClick={() => toggle(p)}
            >
              <Avatar name={p.display_name} attachmentId={p.avatar_attachment_id} size={40} online={p.online} />
              <div className="li-body">
                <div className="li-title truncate">{p.display_name}</div>
                <div className="li-sub truncate">@{p.username}</div>
              </div>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
