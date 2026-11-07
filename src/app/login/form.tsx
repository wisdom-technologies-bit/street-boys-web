'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { copy } from '../copy';

/**
 * Sign-in, on one page, as a three-step state machine.
 *
 * One page rather than three routes because the email never goes in the URL: a
 * code that belongs to an address visible in a URL ends up in a browser history,
 * a screenshot and a referrer header. The steps are components in one file for
 * the same reason.
 *
 * Nothing here reveals whether an account exists. The API does not tell us, and
 * the copy never guesses.
 */

type Step = 'email' | 'code' | 'details';
type AgeBand = 'under_18' | '18_plus';

type ApiResult = {
  ok: boolean;
  body: Record<string, unknown>;
  retryAfter: number;
};

async function postJson(path: string, payload: unknown): Promise<ApiResult> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  return {
    ok: response.ok,
    body,
    retryAfter: Number(response.headers.get('retry-after') ?? 0),
  };
}

/** Every API error a player can meet, said in plain words from copy.ts. */
function messageFor(code: string, retryAfter = 0): string {
  switch (code) {
    case 'invalid_or_expired':
      return copy.errors.invalid_or_expired;
    case 'rate_limited':
      return copy.errors.rate_limited(retryAfter);
    case 'send_failed':
      return copy.errors.send_failed;
    case 'email_not_supported':
      return copy.errors.email_not_supported;
    case 'invalid_request':
      return copy.errors.invalid_request;
    case 'unauthorized':
      return copy.errors.unauthorized;
    case 'forbidden':
      return copy.errors.forbidden;
    default:
      return copy.errors.unknown;
  }
}

export function LoginForm() {
  const router = useRouter();
  const emailId = useId();
  const codeId = useId();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [ageBand, setAgeBand] = useState<AgeBand | null>(null);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  useEffect(() => {
    if (step === 'code') codeRef.current?.focus();
  }, [step]);

  async function sendCode(): Promise<void> {
    setBusy(true);
    setError('');
    try {
      const result = await postJson('/api/auth/request-code', { email });
      if (result.ok) {
        setStep('code');
        setResendIn(result.retryAfter > 0 ? result.retryAfter : 60);
        return;
      }
      setError(messageFor(String(result.body.error ?? ''), result.retryAfter));
      if (result.body.error === 'rate_limited' && result.retryAfter > 0) {
        setResendIn(result.retryAfter);
      }
    } catch {
      setError(copy.errors.network);
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(details?: { acceptTerms: true; ageBand: AgeBand }): Promise<void> {
    setBusy(true);
    setError('');
    try {
      const result = await postJson('/api/auth/verify-code', { email, code, details });
      if (result.ok && result.body.status === 'signed_in') {
        router.replace(result.body.hasCharacter === true ? '/home' : '/create-character');
        router.refresh();
        return;
      }
      if (result.ok && result.body.status === 'details_required') {
        setStep('details');
        return;
      }
      setError(messageFor(String(result.body.error ?? ''), result.retryAfter));
    } catch {
      setError(copy.errors.network);
    } finally {
      setBusy(false);
    }
  }

  function onEmailSubmit(event: React.FormEvent): void {
    event.preventDefault();
    void sendCode();
  }

  function onCodeSubmit(event: React.FormEvent): void {
    event.preventDefault();
    void submitCode();
  }

  function onDetailsSubmit(event: React.FormEvent): void {
    event.preventDefault();
    if (!acceptedTerms || !ageBand) {
      setError(copy.errors.invalid_request);
      return;
    }
    void submitCode({ acceptTerms: true, ageBand });
  }

  function useDifferentEmail(): void {
    setStep('email');
    setCode('');
    setError('');
    setAgeBand(null);
    setAcceptedTerms(false);
  }

  return (
    <main className="page">
      <h1>{step === 'details' ? copy.auth.detailsHeading : copy.auth.signInHeading}</h1>

      <p role="alert" aria-live="polite" className="error">
        {error}
      </p>

      {step === 'email' && (
        <form className="card" onSubmit={onEmailSubmit} noValidate>
          <div className="field">
            <label htmlFor={emailId}>{copy.auth.emailLabel}</label>
            <input
              id={emailId}
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <p className="hint">{copy.auth.emailHint}</p>
          </div>
          <button type="submit" disabled={busy || email.trim().length === 0}>
            {busy ? copy.auth.sending : copy.auth.sendCode}
          </button>
        </form>
      )}

      {step === 'code' && (
        <form className="card" onSubmit={onCodeSubmit} noValidate>
          <p className="muted">{copy.auth.codeSentTo(email)}</p>
          <div className="field">
            <label htmlFor={codeId}>{copy.auth.codeLabel}</label>
            <input
              id={codeId}
              ref={codeRef}
              type="text"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              placeholder={copy.auth.codePlaceholder}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
            />
            <p className="hint">{copy.auth.codeHint}</p>
          </div>
          <button type="submit" disabled={busy || code.length !== 6}>
            {busy ? copy.auth.verifying : copy.auth.verify}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void sendCode()}
            disabled={busy || resendIn > 0}
          >
            {resendIn > 0 ? copy.auth.resendIn(resendIn) : copy.auth.resend}
          </button>
          <button type="button" className="secondary" onClick={useDifferentEmail} disabled={busy}>
            {copy.auth.differentEmail}
          </button>
        </form>
      )}

      {step === 'details' && (
        <form className="card" onSubmit={onDetailsSubmit} noValidate>
          <p className="muted">{copy.auth.detailsIntro}</p>

          <div className="field">
            <span>
              <input
                id={`${codeId}-terms`}
                type="checkbox"
                checked={acceptedTerms}
                onChange={(event) => setAcceptedTerms(event.target.checked)}
                required
              />{' '}
              <label htmlFor={`${codeId}-terms`}>
                {copy.auth.termsLabel}{' '}
                <Link href="/terms" target="_blank" rel="noreferrer">
                  {copy.auth.termsLink}
                </Link>{' '}
                <Link href="/privacy" target="_blank" rel="noreferrer">
                  {copy.auth.privacyLink}
                </Link>
              </label>
            </span>
          </div>

          <fieldset className="choices">
            <legend>{copy.auth.ageLegend}</legend>
            <div className="choice">
              <input
                id={`${codeId}-adult`}
                type="radio"
                name="ageBand"
                checked={ageBand === '18_plus'}
                onChange={() => setAgeBand('18_plus')}
              />
              <label htmlFor={`${codeId}-adult`}>{copy.auth.ageAdult}</label>
            </div>
            <div className="choice">
              <input
                id={`${codeId}-minor`}
                type="radio"
                name="ageBand"
                checked={ageBand === 'under_18'}
                onChange={() => setAgeBand('under_18')}
              />
              <label htmlFor={`${codeId}-minor`}>{copy.auth.ageMinor}</label>
            </div>
            <p className="hint">{copy.auth.ageNote}</p>
          </fieldset>

          <button type="submit" disabled={busy || !acceptedTerms || !ageBand}>
            {busy ? copy.auth.finishing : copy.auth.finish}
          </button>
        </form>
      )}
    </main>
  );
}
