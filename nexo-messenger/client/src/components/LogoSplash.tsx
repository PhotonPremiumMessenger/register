import { Spinner } from './ui';

export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <path d="M8 22V10l8 7.5V10l8 12-8-7.5V22z" fill="currentColor" />
    </svg>
  );
}

export function LogoSplash({ label = 'NEXO Messenger' }: { label?: string }) {
  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 18,
      }}
    >
      <div className="auth-logo">
        <div className="logo-mark">
          <LogoMark size={30} />
        </div>
        <h1>NEXO</h1>
      </div>
      <Spinner />
      <span className="t-faint">{label}</span>
    </div>
  );
}
