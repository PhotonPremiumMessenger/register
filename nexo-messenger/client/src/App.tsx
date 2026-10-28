import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { AppShell } from './components/AppShell';
import { AuthPage } from './pages/AuthPage';
import { GoogleCallbackPage } from './pages/GoogleCallbackPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { ChatsPage } from './pages/ChatsPage';
import { ChatRoomPage } from './pages/ChatRoomPage';
import { GroupsPage } from './pages/GroupsPage';
import { GroupRoomPage } from './pages/GroupRoomPage';
import { ChannelsPage } from './pages/ChannelsPage';
import { ChannelRoomPage } from './pages/ChannelRoomPage';
import { SearchPage } from './pages/SearchPage';
import { ProfilePage } from './pages/ProfilePage';
import { UserPage } from './pages/UserPage';
import { SettingsPage } from './pages/SettingsPage';
import { LogoSplash } from './components/LogoSplash';

export default function App() {
  const { profile, initializing } = useAuth();
  const location = useLocation();

  if (initializing) {
    return <LogoSplash label="Preparing your workspace…" />;
  }

  return (
    <Routes>
      <Route path="/auth" element={profile ? <Navigate to="/chats" replace /> : <AuthPage />} />
      <Route path="/auth/callback" element={<GoogleCallbackPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      <Route element={profile ? <AppShell /> : <Navigate to="/auth" state={{ from: location.pathname }} replace />}>
        <Route path="/chats" element={<ChatsPage />} />
        <Route path="/c/:id" element={<ChatRoomPage />} />
        <Route path="/groups" element={<GroupsPage />} />
        <Route path="/g/:id" element={<GroupRoomPage />} />
        <Route path="/channels" element={<ChannelsPage />} />
        <Route path="/ch/:id" element={<ChannelRoomPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/u/:username" element={<UserPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>

      <Route path="*" element={<Navigate to={profile ? '/chats' : '/auth'} replace />} />
    </Routes>
  );
}
