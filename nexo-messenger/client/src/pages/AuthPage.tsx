import { FormEvent, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AtSign, Eye, EyeOff, KeyRound, Lock, Mail, UserRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api } from '../api';
import { LogoMark } from '../components/LogoSplash';
import { Notice, Spinner } from '../components/ui';

type Mode = 'signin' | 'signup';

function GoogleIcon() {
  return (
    <svg className="g-icon" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.09 3.57-5.17 3.57-8.81z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.08 7.94-2.91l-3.87-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A12 12 0 0 0 12 24z"
      />
      <path fill="#FBBC05" d="M5.27 14.28a7.2 7.2 0 0 1 0-4.56V6.63H1.29a12 12 0 0 0 0 10.74l3.98-3.09z" />
      <path
        fill="#EA4335"
        d="M12 4.76c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.29 6.63l3.98 3.09C6.22 6.87 8.87 4.76 12 4.76z"
      />
    </svg>
  );
}

export function AuthPage() {
  const { signIn, signUp, providers } = useAuth();
  const toast = useToast();
  const [params] = useSearchParams();

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // forgot-password inline flow
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotResult, setForgotResult] = useState<{ message: string; devUrl?: string | null } | null>(null);

  const googleError = params.get('google_error');
  useEffect(() => {
    if (googleError) toast.error(googleError);
  }, [googleError, toast]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setBusy(true);
    try {
      if (mode === 'signin') {
        await signIn(email, password);
      } else {
        await signUp(email, password, username, displayName);
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setBusy(false);
    }
  };

  const submitForgot = async (e: FormEvent) => {
    e.preventDefault();
    setForgotBusy(true);
    setForgotResult(null);
    try {
      const res = await api.auth.forgot(forgotEmail);
      setForgotResult({ message: res.message, devUrl: res.dev_reset_url });
    } catch (err) {
      setForgotResult({ message: err instanceof Error ? err.message : 'Request failed.' });
    } finally {
      setForgotBusy(false);
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setFormError(null);
    setForgotOpen(false);
  };

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-logo">
          <div className="logo-mark">
            <LogoMark size={28} />
          </div>
          <h1>NEXO MESSENGER</h1>
          <p>Private, fast, beautifully dark.</p>
        </div>

        <div className="segmented" role="tablist" aria-label="Authentication mode">
          <button type="button" role="tab" aria-selected={mode === 'signin'} className={mode === 'signin' ? 'active' : ''} onClick={() => switchMode('signin')}>
            Sign in
          </button>
          <button type="button" role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'active' : ''} onClick={() => switchMode('signup')}>
            Create account
          </button>
        </div>

        {googleError && <Notice kind="error">Google sign-in failed: {googleError}</Notice>}
        {formError && <Notice kind="error">{formError}</Notice>}

        {forgotOpen ? (
          <form onSubmit={submitForgot} className="modal-body">
            <div className="field">
              <label htmlFor="forgot-email">Reset password</label>
              <div className="input-with-icon">
                <Mail size={16} className="input-icon" />
                <input
                  id="forgot-email"
                  className="input"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  required
                />
              </div>
            </div>
            {forgotResult && (
              <Notice kind={forgotResult.devUrl ? 'info' : 'success'}>
                {forgotResult.message}
                {forgotResult.devUrl && (
                  <>
                    <br />
                    <strong>Dev mode (no SMTP configured):</strong>{' '}
                    <a href={forgotResult.devUrl}>open reset link</a>
                  </>
                )}
              </Notice>
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setForgotOpen(false)}>
                Back
              </button>
              <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={forgotBusy}>
                {forgotBusy ? <Spinner size="sm" /> : <KeyRound size={16} />} Send link
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={submit} className="modal-body">
            {mode === 'signup' && (
              <>
                <div className="field">
                  <label htmlFor="display-name">Display name</label>
                  <div className="input-with-icon">
                    <UserRound size={16} className="input-icon" />
                    <input
                      id="display-name"
                      className="input"
                      type="text"
                      autoComplete="name"
                      placeholder="Alex Carter"
                      value={displayName}
                      maxLength={60}
                      onChange={(e) => setDisplayName(e.target.value)}
                      required
                    />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="username">Username</label>
                  <div className="input-with-icon">
                    <AtSign size={16} className="input-icon" />
                    <input
                      id="username"
                      className="input"
                      type="text"
                      autoComplete="username"
                      placeholder="alex"
                      value={username}
                      maxLength={20}
                      onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                      required
                      pattern="[a-z0-9_]{3,20}"
                      title="3–20 characters: lowercase letters, numbers, underscores"
                    />
                  </div>
                </div>
              </>
            )}
            <div className="field">
              <label htmlFor="email">Email</label>
              <div className="input-with-icon">
                <Mail size={16} className="input-icon" />
                <input
                  id="email"
                  className="input"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <div className="input-with-icon">
                <Lock size={16} className="input-icon" />
                <input
                  id="password"
                  className="input"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={mode === 'signup' ? 8 : undefined}
                />
                <button
                  type="button"
                  className="icon-btn"
                  style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', width: 38, height: 38 }}
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
              {busy ? <Spinner size="sm" /> : null}
              {mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>

            {mode === 'signin' && (
              <button type="button" className="btn btn-ghost btn-block btn-sm" onClick={() => setForgotOpen(true)}>
                Forgot password?
              </button>
            )}
          </form>
        )}

        {!forgotOpen && (
          <>
            <div className="auth-divider">or</div>
            {providers.google ? (
              <a className="btn btn-glass btn-block" href="/api/auth/google" rel="noopener">
                <GoogleIcon /> Continue with Google
              </a>
            ) : (
              <button
                type="button"
                className="btn btn-glass btn-block"
                disabled
                title="Google OAuth is not configured on this server yet."
                style={{ position: 'relative' }}
              >
                <GoogleIcon /> Continue with Google
              </button>
            )}
            {!providers.google && (
              <p className="t-faint" style={{ textAlign: 'center', lineHeight: 1.5 }}>
                Google sign-in is not configured on this server. Set <span className="t-mono">GOOGLE_CLIENT_ID</span> and{' '}
                <span className="t-mono">GOOGLE_CLIENT_SECRET</span> in the server environment — see the README for the exact
                OAuth console steps.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
