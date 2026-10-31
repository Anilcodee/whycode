import { FormEvent, useEffect, useState } from 'react';

import type { Account } from '../types/account';
import { ProviderLogo } from './ProviderLogo';
import { LoadingIndicator } from './LoadingIndicator';
export type { Account } from '../types/account';

type Request = <T>(path: string, body?: unknown) => Promise<T>;
export function AccountDialog({ open, account, recovery, request, onClose, onChange, onResetComplete }: {
  open: boolean; account: Account | null; recovery: boolean; request: Request; onClose: () => void; onChange: () => Promise<void>; onResetComplete: () => void;
}) {
  const [mode, setMode] = useState<'login' | 'signup' | 'recover' | 'reset'>('login');
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState('');
  useEffect(() => { if (recovery) setMode('reset'); }, [recovery]);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  useEffect(() => { if (!open) { setPassword(''); setConfirmation(''); setError(''); setMessage(''); if (!recovery) setMode('login'); } }, [open, recovery]);
  async function run(action: () => Promise<void>) { if (busy) return; setBusy(true); setError(''); setMessage(''); try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Please retry.'); } finally { setBusy(false); } }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if ((mode === 'signup' || mode === 'reset') && password !== confirmation) { setError('The passwords do not match.'); return; }
    await run(async () => {
      const result = await request<{ message?: string }>(`/account/${mode === 'reset' ? 'reset-password' : mode}`, { email, password });
      setPassword(''); setConfirmation('');
      if (mode === 'login') { await onChange(); onClose(); }
      else { setMessage(result.message ?? 'Check your email.'); if (mode === 'reset') { await onChange(); onClose(); onResetComplete(); } else if (mode !== 'recover') setMode('login'); }
    });
  }
  async function redirect(path: string, body: unknown) { await run(async () => { const result = await request<{ url: string }>(path, body); window.location.assign(result.url); }); }
  function changeMode(next: typeof mode) { setMode(next); setPassword(''); setConfirmation(''); setError(''); setMessage(''); }
  return <section className="account-dialog account-page-card" aria-labelledby="account-title">
    {busy && <LoadingIndicator>Processing your account request…</LoadingIndicator>}
    <span className="account-eyebrow">YOUR WHYCODE ACCOUNT</span>
    <h2 id="account-title">{recovery ? 'Reset your password' : account?.user ? 'Your account' : mode === 'signup' ? 'A place for your curiosity.' : mode === 'recover' || mode === 'reset' ? 'Reset your password' : 'Welcome to WhyCode'}</h2>
    {!account ? <p role="status">Checking account access…</p> : !account.configured ? <div className="account-unavailable"><p>Account sign-in is not available on this server yet.</p><p>You can explore public repositories now. Private access becomes available after the account provider and GitHub App are connected.</p><button className="primary" onClick={onClose}>Explore public repositories</button></div> : account.user && !recovery ? <>
      <p className="account-email">{account.user.email}</p>
      <section className="github-connection"><h3>GitHub repository access</h3><p>{account.github ? `Connected as ${account.github.login}. Only repositories selected for the WhyCode GitHub App are accessible.` : 'Sign-in and repository permission are separate. Choose which repositories WhyCode can read.'}</p>
      {!account.privateEnabled ? <p className="account-hint">Private access is awaiting GitHub App configuration.</p> : <div className="account-actions">{account.installUrl && <a className="secondary" href={account.installUrl} target="_blank" rel="noopener noreferrer">Choose repositories on GitHub ↗</a>}
      <button className="primary" disabled={busy} onClick={() => void redirect('/account/github/connect', {})}>{account.github ? 'Reconnect GitHub' : 'Connect GitHub'}</button>
      {account.github && <button className="text-button" disabled={busy} onClick={() => void run(async () => { await request('/account/github/disconnect', {}); await onChange(); })}>Disconnect</button>}</div>}
      <small>Read-only. Private indexes last for this session and are discarded on sign-out or expiry. Restart recovery depends on server storage configuration.</small></section>
      <button className="secondary account-signout" disabled={busy} onClick={() => void run(async () => { await request('/account/logout', {}); await onChange(); onClose(); })}>Sign out</button>
    </> : <>
      <p className="account-intro">{mode === 'signup' ? 'Create an account to connect repositories you have permission to read.' : mode === 'recover' ? 'We’ll email a password reset link. Open it in this browser.' : mode === 'reset' ? 'Choose a new password for your account.' : 'Sign in to connect your own GitHub repositories.'}</p>
      {(mode === 'login' || mode === 'signup') && <><div className="social-signin">{(['github', 'google'] as const).filter(provider => account.providers.includes(provider)).map(provider => <button className="secondary" key={provider} disabled={busy} onClick={() => void redirect('/account/oauth', { provider })}><span><ProviderLogo provider={provider} /></span>Continue with {provider === 'github' ? 'GitHub' : 'Google'}</button>)}</div>{account.providers.includes('email') && <div className="account-divider"><span>or use email</span></div>}</>}
      {account.providers.includes('email') && <form onSubmit={submit} className="account-form">
        {mode !== 'reset' && <><label htmlFor="account-email">Email address</label><input id="account-email" name="username" type="email" autoComplete={mode === 'login' ? 'username' : 'email'} value={email} onChange={event => setEmail(event.target.value)} maxLength={254} required disabled={busy} /></>}
        {mode !== 'recover' && <><label htmlFor="account-password">{mode === 'login' ? 'Password' : 'New password'}</label><input id="account-password" name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'login' ? 1 : 12} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} required disabled={busy} />{mode !== 'login' && <><small>Use at least 12 characters. A unique passphrase works well.</small><label htmlFor="account-confirm">Confirm password</label><input id="account-confirm" type="password" autoComplete="new-password" minLength={12} maxLength={128} value={confirmation} onChange={event => setConfirmation(event.target.value)} required disabled={busy} /></>}</>}
        <button className="primary" disabled={busy}>{busy ? <><span className="spinner" aria-hidden="true" />Please wait…</> : mode === 'login' ? 'Sign in' : mode === 'signup' ? 'Create account' : mode === 'recover' ? 'Send reset link' : 'Update password'}</button>
      </form>}
      <div className="account-links">{mode === 'login' ? <><button disabled={busy} onClick={() => changeMode('signup')}>Create an account</button><button disabled={busy} onClick={() => changeMode('recover')}>Forgot password?</button></> : <button disabled={busy} onClick={() => changeMode('login')}>Back to sign in</button>}</div>
      <p className="account-hint">Email verification is required. Signing in does not grant repository access.</p>
    </>}
    {message && <p className="account-message" role="status">{message}</p>}{error && <p className="error-text" role="alert">{error}</p>}
  </section>;
}
