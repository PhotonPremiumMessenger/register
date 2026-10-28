import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Compass, Megaphone, Search as SearchIcon, SearchX, Users } from 'lucide-react';
import { api } from '../api';
import type { SearchResults } from '../api/types';
import { useRealtime } from '../context/RealtimeContext';
import { useToast } from '../context/ToastContext';
import { ChatListItem } from '../components/ChatListItem';
import { EmptyState, Notice, Segmented, Spinner } from '../components/ui';

type Scope = 'all' | 'people' | 'groups' | 'channels';

export function SearchPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const realtime = useRealtime();
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounce = useRef<number | null>(null);

  useEffect(() => {
    if (debounce.current) window.clearTimeout(debounce.current);
    if (!query.trim()) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounce.current = window.setTimeout(async () => {
      try {
        const res = await api.search(query.trim(), scope);
        setResults(res);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Search failed. Please try again.');
        setResults(null);
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => {
      if (debounce.current) window.clearTimeout(debounce.current);
    };
  }, [query, scope]);

  const openPerson = (username: string) => {
    navigate(`/u/${username}`);
  };

  const openGroup = async (groupId: string, isPublic: boolean, myRole: string | null) => {
    if (myRole) {
      navigate(`/g/${groupId}`);
      return;
    }
    if (isPublic) {
      try {
        await api.groups.join(groupId);
        toast.success('Joined the group.');
        navigate(`/g/${groupId}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to join group.');
      }
      return;
    }
    toast.info('This group is private — a member must add you.');
  };

  const openChannel = async (channelId: string, isPublic: boolean, myRole: string | null) => {
    if (myRole) {
      navigate(`/ch/${channelId}`);
      return;
    }
    if (isPublic) {
      try {
        await api.channels.subscribe(channelId);
        toast.success('Subscribed to the channel.');
        navigate(`/ch/${channelId}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to subscribe.');
      }
      return;
    }
    toast.info('This channel is private — an admin must add you.');
  };

  const nothingFound =
    results && results.people.length === 0 && results.groups.length === 0 && results.channels.length === 0;

  return (
    <div className="page">
      <div className="page-header">
        <h1>Search</h1>
      </div>

      <div className="input-with-icon">
        <SearchIcon size={17} className="input-icon" />
        <input
          className="input"
          type="search"
          placeholder="Search people, groups and channels…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
          aria-label="Search query"
        />
        {loading && (
          <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)' }}>
            <Spinner size="sm" />
          </span>
        )}
      </div>

      <Segmented
        options={[
          { id: 'all', label: 'All' },
          { id: 'people', label: 'People' },
          { id: 'groups', label: 'Groups' },
          { id: 'channels', label: 'Channels' },
        ]}
        value={scope}
        onChange={(s) => setScope(s)}
      />

      {error && <Notice kind="error">{error}</Notice>}

      {!query.trim() && (
        <EmptyState
          icon={<Compass size={26} />}
          title="Find people and communities"
          message="Search by @username, display name, group or channel name. Results come straight from the database."
        />
      )}

      {nothingFound && (
        <EmptyState
          icon={<SearchX size={26} />}
          title="No results"
          message={`Nothing matches "${query}". Try a different name, or check the spelling.`}
        />
      )}

      {results && results.people.length > 0 && (scope === 'all' || scope === 'people') && (
        <section>
          <div className="section-title">People</div>
          <div className="list">
            {results.people.map((p) => (
              <ChatListItem
                key={p.id}
                title={p.display_name}
                subtitle={
                  <span>
                    @{p.username}
                    {p.bio ? ` · ${p.bio}` : ''}
                  </span>
                }
                avatarName={p.display_name}
                avatarAttachmentId={p.avatar_attachment_id}
                online={realtime.online.has(p.id)}
                onClick={() => openPerson(p.username)}
              />
            ))}
          </div>
        </section>
      )}

      {results && results.groups.length > 0 && (scope === 'all' || scope === 'groups') && (
        <section>
          <div className="section-title">Groups</div>
          <div className="list">
            {results.groups.map((g) => (
              <ChatListItem
                key={g.id}
                title={g.name}
                subtitle={`${g.member_count} member${g.member_count === 1 ? '' : 's'} · ${g.is_public ? 'Public' : 'Private'}`}
                avatarName={g.name}
                avatarAttachmentId={g.avatar_attachment_id}
                rounded
                fallbackIcon={<Users size={20} />}
                onClick={() => void openGroup(g.id, g.is_public, g.my_role)}
                trailing={
                  g.my_role ? (
                    <span className="chip accent">Joined</span>
                  ) : g.is_public ? (
                    <span className="chip">Join →</span>
                  ) : (
                    <span className="chip">Private</span>
                  )
                }
              />
            ))}
          </div>
        </section>
      )}

      {results && results.channels.length > 0 && (scope === 'all' || scope === 'channels') && (
        <section>
          <div className="section-title">Channels</div>
          <div className="list">
            {results.channels.map((c) => (
              <ChatListItem
                key={c.id}
                title={c.name}
                subtitle={`${c.subscriber_count} subscriber${c.subscriber_count === 1 ? '' : 's'} · ${c.is_public ? 'Public' : 'Private'}`}
                avatarName={c.name}
                avatarAttachmentId={c.avatar_attachment_id}
                rounded
                fallbackIcon={<Megaphone size={19} />}
                onClick={() => void openChannel(c.id, c.is_public, c.my_role)}
                trailing={
                  c.my_role ? (
                    <span className="chip accent">Subscribed</span>
                  ) : c.is_public ? (
                    <span className="chip">Subscribe →</span>
                  ) : (
                    <span className="chip">Private</span>
                  )
                }
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
