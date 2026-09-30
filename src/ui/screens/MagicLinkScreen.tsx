import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Icon } from '../components/Icon';
import { Screen, Spinner, Wordmark } from '../components/primitives';
import { useApp } from '../state/AppState';

// Same cadence as the panel's login page polling.
const POLL_INTERVAL_MS = 2500;
const POLL_MAX_MS = 15 * 60 * 1000;

type Phase = 'waiting' | 'confirmed' | 'expired';

export function MagicLinkScreen({ email, requestId }: { email: string; requestId: string }) {
  const { back, signIn } = useApp();
  const [phase, setPhase] = useState<Phase>('waiting');
  const started = useRef(Date.now());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let alive = true;

    async function poll() {
      if (Date.now() - started.current > POLL_MAX_MS) return setPhase('expired');
      try {
        const res = await api.magicLinkStatus(requestId);
        if (!alive) return;
        if (res.status === 'confirmed') {
          setPhase('confirmed');
          setTimeout(() => void signIn(res.session), 700);
          return;
        }
        if (res.status === 'expired') return setPhase('expired');
      } catch {
        // transient network blip, retry on next tick
      }
      timer = setTimeout(poll, POLL_INTERVAL_MS);
    }

    timer = setTimeout(poll, POLL_INTERVAL_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [requestId, signIn]);

  const title = { waiting: 'Check your inbox', confirmed: 'Signed in', expired: 'Link expired' }[phase];

  return (
    <Screen atmosphere="default">
      <div className="flex flex-col h-full px-6 pt-7 pb-5">
        <Wordmark height={26} />

        <div className="mt-10 relative rounded-xl border border-sf-border-subtle p-5 animate-sf-slide-up" style={{ background: 'rgba(43,127,255,0.04)' }}>
          <div className="flex items-center gap-3 mb-2">
            <span
              className="inline-flex items-center justify-center shrink-0"
              style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(43,127,255,0.12)', border: '1px solid rgba(43,127,255,0.22)', color: '#5BA3FF' }}
            >
              <Icon name="mail" size={16} />
            </span>
            <h2 className="text-[16px] font-semibold" style={{ letterSpacing: '-0.015em' }}>{title}</h2>
            <span className="ml-auto">
              {phase === 'waiting' && <Spinner size={22} />}
              {phase === 'confirmed' && (
                <span className="inline-flex items-center justify-center w-[22px] h-[22px] rounded-full bg-[#22C55E] text-white animate-sf-pop">
                  <Icon name="check" size={14} strokeWidth={3} />
                </span>
              )}
            </span>
          </div>

          <p className="text-[13px] leading-relaxed text-sf-text-tertiary">
            {phase === 'waiting' && (
              <>
                We just sent a sign-in link to <strong className="text-sf-text-secondary font-medium">{email}</strong>. Open it on any device and this
                window signs in automatically.
              </>
            )}
            {phase === 'confirmed' && 'Loading your memberships…'}
            {phase === 'expired' && 'This sign-in link is no longer valid. Request a new one to continue.'}
          </p>

          {phase !== 'confirmed' && (
            <button type="button" className="sf-link-btn mt-3 text-[13px]" onClick={back}>
              {phase === 'expired' ? 'Send a new link' : 'Use a different email'}
            </button>
          )}
        </div>

        <p className="mt-auto text-center text-[12px] text-sf-text-muted leading-relaxed">
          Can't find it? Check your spam folder. The link is valid for 15 minutes.
        </p>
      </div>
    </Screen>
  );
}
