import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LogoSplash } from '../components/LogoSplash';
import { EmptyState } from '../components/ui';
import { ShieldAlert } from 'lucide-react';

/**
 * Landing route for the Google OAuth redirect. The server places the session
 * JWT in the URL fragment (#token=…), which never reaches server logs.
 */
export function GoogleCallbackPage() {
  const navigate = useNavigate();
  const { adoptToken } = useAuth();
  const [failed, setFailed] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const token = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('token');
    if (!token) {
      setFailed(true);
      return;
    }
    // Remove the token from the URL immediately.
    window.history.replaceState(null, '', window.location.pathname);
    adoptToken(token).then((ok) => {
      if (ok) navigate('/chats', { replace: true });
      else setFailed(true);
    });
  }, [adoptToken, navigate]);

  if (failed) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <EmptyState
            icon={<ShieldAlert size={26} />}
            title="Google sign-in failed"
            message="The authentication session could not be completed. Please try again."
          />
          <button className="btn btn-primary btn-block" onClick={() => navigate('/auth', { replace: true })}>
            Back to sign in
          </button>
        </div>
      </div>
    );
  }
  return <LogoSplash label="Completing Google sign-in…" />;
}
