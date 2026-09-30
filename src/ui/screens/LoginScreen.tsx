import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError } from '@/lib/api';
import { Icon } from '../components/Icon';
import { Screen, Spinner, Wordmark } from '../components/primitives';
import { openExternal, SHIFTER_URLS } from '../links';
import { useApp } from '../state/AppState';

type Phase = 'idle' | 'verifying' | 'verified';

/** Panel keys are 64 alphanumerics (Str::random(64)); accept anything plausible and let the server decide. */
const KEY_RE = /^[A-Za-z0-9]{32,128}$/;

/**
 * Sign in with the panel API key (Profile → API Key). The key is verified
 * as soon as it is pasted or submitted; on success the app routes straight
 * on (memberships list, or Connect when there is a single plan).
 */
export function LoginScreen() {
  const { signIn } = useApp();
  const [key, setKey] = useState('');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const inputRef = useRef<HTMLInputElement>(null);

  // Chrome often ignores autoFocus in action popups (the window gets focus
  // after first paint), so focus again once the popup has settled.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, []);

  async function verify(raw: string) {
    const value = raw.trim();
    if (!value) {
      setError('Paste your API key to continue.');
      return inputRef.current?.focus();
    }
    if (!KEY_RE.test(value)) {
      setError("That doesn't look like a Shifter API key. Copy it again from your dashboard.");
      return inputRef.current?.focus();
    }
    setError(null);
    setPhase('verifying');
    try {
      const session = await api.verifyApiKey(value);
      setPhase('verified');
      setTimeout(() => void signIn(session), 600);
    } catch (err) {
      setPhase('idle');
      setError(
        err instanceof ApiError && err.code === 'unauthorized'
          ? 'This API key is not valid. It may have been regenerated. Copy the current one from your dashboard.'
          : 'Network hiccup. Try again.',
      );
      inputRef.current?.select();
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void verify(key);
  }

  async function pasteFromClipboard() {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) return;
      setKey(text);
      void verify(text);
    } catch {
      inputRef.current?.focus();
    }
  }

  const busy = phase !== 'idle';

  return (
    <Screen atmosphere="default" surface="card" bodyClassName="flex flex-col">
      <div className="flex-1 flex flex-col px-6 pt-7 pb-5">
        <Wordmark height={26} />

        <div className="mt-8 animate-sf-slide-up">
          <span className="sf-eyebrow">Proxy &amp; VPN</span>
          <h1 className="mt-4 text-[22px] leading-tight font-semibold" style={{ letterSpacing: '-0.025em' }}>
            Connect your Shifter account
          </h1>
          <p className="mt-2.5 text-[13px] leading-relaxed text-sf-text-tertiary">
            Paste your API key to load your Residential and ISP plans.
          </p>
        </div>

        <form onSubmit={submit} noValidate className="mt-7">
          <div className="relative">
            <input
              ref={inputRef}
              type="text"
              name="shifter-api-key"
              aria-label="API key"
              className={`sf-input sf-input--borderless !pr-[76px] ${reveal ? '' : 'sf-input--masked'}`}
              placeholder="Enter your API key"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              // Keep password managers from decorating / offering to save the key.
              data-1p-ignore
              data-lpignore="true"
              data-bwignore
              data-form-type="other"
              autoFocus
              value={key}
              disabled={busy}
              onChange={(e) => {
                setKey(e.target.value);
                setError(null);
              }}
              // Verify instantly when a whole key is pasted.
              onPaste={(e) => {
                const text = e.clipboardData.getData('text').trim();
                if (KEY_RE.test(text)) {
                  e.preventDefault();
                  setKey(text);
                  void verify(text);
                }
              }}
              aria-invalid={!!error}
              style={error ? { borderColor: 'rgba(239,68,68,0.55)' } : undefined}
            />
            <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
              <button type="button" className="sf-icon-btn !w-8 !h-8" onClick={() => setReveal((r) => !r)} aria-label={reveal ? 'Hide key' : 'Show key'} disabled={busy}>
                <Icon name={reveal ? 'eyeOff' : 'eye'} size={15} />
              </button>
              <button type="button" className="sf-icon-btn !w-8 !h-8" onClick={pasteFromClipboard} aria-label="Paste from clipboard" disabled={busy}>
                <Icon name="clipboard" size={15} />
              </button>
            </div>
          </div>

          <div className="mt-2 flex items-start gap-3">
            <p className="flex-1 text-[12.5px] leading-relaxed text-[#fca5a5]">{error}</p>
            <button type="button" className="sf-link-btn text-[12.5px] shrink-0 leading-relaxed" onClick={() => openExternal(SHIFTER_URLS.apiKey)}>
              Where do I find it?
            </button>
          </div>

          <button
            type="submit"
            className={`sf-btn sf-btn-lg w-full mt-3 ${phase === 'verified' ? '!bg-[#22C55E] text-white' : 'sf-btn-primary'}`}
            disabled={busy}
            style={busy ? { opacity: 1 } : undefined}
          >
            {phase === 'idle' && (
              <>
                <span>Continue</span>
                <Icon name="arrowRight" size={14} strokeWidth={2.2} />
              </>
            )}
            {phase === 'verifying' && (
              <>
                <span>Verifying key</span>
                <Spinner size={14} tone="white" />
              </>
            )}
            {phase === 'verified' && (
              <>
                <Icon name="check" size={15} strokeWidth={3} className="animate-sf-pop" />
                <span>Verified</span>
              </>
            )}
          </button>
        </form>

        <div className="flex items-center gap-3 mt-10 mb-6">
          <span className="flex-1 h-px bg-sf-border-subtle" />
          <span className="text-[10.5px] tracking-[0.18em] uppercase text-sf-text-muted">New to Shifter?</span>
          <span className="flex-1 h-px bg-sf-border-subtle" />
        </div>

        <button type="button" className="sf-oauth-btn" onClick={() => openExternal(SHIFTER_URLS.register)}>
          <span>Create a free account</span>
          <Icon name="external" size={14} className="text-sf-text-tertiary" />
        </button>
        <p className="mt-3 text-center text-[12px] leading-relaxed text-sf-text-muted">
          Sign up, then copy your key from Profile → API Key.
        </p>

        <p className="mt-auto pt-4 flex items-center justify-center gap-1.5 text-[11.5px] text-sf-text-muted">
          <Icon name="lock" size={12} />
          Your key is stored only in this browser.
        </p>
      </div>
    </Screen>
  );
}
