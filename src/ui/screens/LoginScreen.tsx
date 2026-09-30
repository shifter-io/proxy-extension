import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { GitHubIcon, GoogleIcon, Icon } from '../components/Icon';
import { Screen, Spinner, Wordmark } from '../components/primitives';
import { useApp } from '../state/AppState';
import { openExternal, SHIFTER_URLS } from '../links';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Error copy is identical to shifter.io/login so users see one voice. */
const FLOW_ERRORS: Record<string, string> = {
  rate_limited: 'Too many attempts. Wait a few minutes and try again.',
  undeliverable_email: "We couldn't verify this email address. Please try a different email.",
  invalid_email: "That email doesn't look right. Please check for a typo or try a different email.",
};

export function LoginScreen() {
  const { push } = useApp();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e?: FormEvent, override?: string) {
    e?.preventDefault();
    const value = (override ?? email).trim();
    if (!EMAIL_RE.test(value)) {
      setError('Enter a valid email address.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await api.checkEmail(value);
      if (res.flow === 'magic_link_sent' && res.requestId) {
        push({ name: 'magic', email: value, requestId: res.requestId });
      } else {
        setError(FLOW_ERRORS[res.flow] ?? FLOW_ERRORS.invalid_email ?? null);
      }
    } catch {
      setError('Network hiccup. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen atmosphere="default" bodyClassName="flex flex-col">
      <div className="flex-1 flex flex-col px-6 pt-7 pb-5">
        <Wordmark height={26} />

        <div className="mt-8 animate-sf-slide-up">
          <span className="sf-eyebrow">Proxy &amp; VPN</span>
          <h1 className="mt-4 text-[22px] leading-tight font-semibold" style={{ letterSpacing: '-0.025em' }}>
            Sign in to Shifter
          </h1>
          <p className="mt-2 text-[13px] leading-relaxed text-sf-text-tertiary">
            Use the email on your Shifter account. We'll send a sign-in link and load your memberships.
          </p>
        </div>

        <div className="mt-6 flex flex-col gap-3">
          {/* OAuth maps to chrome.identity.launchWebAuthFlow in the API phase. */}
          <button type="button" className="sf-oauth-btn" onClick={() => submit(undefined, 'demo@example.invalid')}>
            <GoogleIcon />
            <span>Continue with Google</span>
          </button>
          <button type="button" className="sf-oauth-btn" onClick={() => submit(undefined, 'demo@example.invalid')}>
            <GitHubIcon />
            <span>Continue with GitHub</span>
          </button>
        </div>

        <div className="flex items-center gap-3 my-5">
          <span className="flex-1 h-px bg-sf-border-subtle" />
          <span className="text-[10.5px] tracking-[0.18em] uppercase text-sf-text-muted">or with email</span>
          <span className="flex-1 h-px bg-sf-border-subtle" />
        </div>

        <form onSubmit={submit} noValidate>
          <input
            type="email"
            className="sf-input sf-input--borderless"
            placeholder="demo@example.invalid"
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!!error}
          />
          {error && <p className="mt-2 text-[12.5px] text-[#fca5a5]">{error}</p>}
          <button type="submit" className="sf-btn sf-btn-primary sf-btn-lg w-full mt-4" disabled={busy} style={busy ? { opacity: 0.85 } : undefined}>
            <span>Continue</span>
            {busy ? <Spinner size={14} tone="white" /> : <Icon name="arrowRight" size={14} strokeWidth={2.2} />}
          </button>
        </form>

        <p className="mt-auto pt-5 text-center text-[12.5px] text-sf-text-muted">
          Trouble signing in?{' '}
          <button type="button" className="sf-link-btn" onClick={() => openExternal(SHIFTER_URLS.support)}>
            Talk to us
          </button>
        </p>
      </div>
    </Screen>
  );
}
