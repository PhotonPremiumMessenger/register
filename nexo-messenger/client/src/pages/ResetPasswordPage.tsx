import { FormEvent, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { api } from '../api';
import { LogoMark } from '../components/LogoSplash';
import { Notice, Spinner } from '../components/ui';

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!token) {
      setError('This reset link is missing its token. Request a new one from the sign-in page.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await api.auth.reset(token, password);
      setDone(true);
      window.setTimeout(() => navigate('/auth', { replace: true }), 1600);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-logo">
          <div className="logo-mark">
            <LogoMark size={28} />
          </div>
          <h1>NEXO MESSENGER</h1>
          <p>Choose a new password</p>
        </div>

        {error && <Notice kind="error">{error}</Notice>}
        {done && <Notice kind="success">Password updated. Redirecting to sign-in…</Notice>}

        <form onSubmit={submit} className="modal-body">
          <div className="field">
            <label htmlFor="new-password">New password</label>
            <input
              id="new-password"
              className="input"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>
          <div className="field">
            <label htmlFor="confirm-password">Confirm password</label>
            <input
              id="confirm-password"
              className="input"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={8}
            />
          </div>
          <button type="submit" className="btn btn-primary btn-block" disabled={busy || done}>
            {busy ? <Spinner size="sm" /> : <KeyRound size={16} />} Update password
          </button>
          <button type="button" className="btn btn-ghost btn-block" onClick={() => navigate('/auth')}>
            Cancel
          </button>
        </form>
      </div>
    </div>
  );
}
