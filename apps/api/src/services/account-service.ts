import { createHash, randomBytes } from 'node:crypto';
import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { AppConfig } from '../config.js';
import { rateLimit } from '../middleware/security.js';
import { SessionVault } from '../infrastructure/session-vault.js';
import { SharedAuthFlows } from '../infrastructure/shared-auth-flows.js';
import { SharedSessions } from '../infrastructure/shared-sessions.js';

export interface AccountSession {
  user: { id: string; email: string };
  accessToken: string;
  expires: number;
  github?: { token: string; expires: number; login: string };
}
type Flow = { verifier: string; expires: number; kind: 'account' | 'github' | 'recovery'; session?: string };
const digest = (value: string) => createHash('sha256').update(value).digest('base64url');
const random = () => randomBytes(32).toString('base64url');
const credentials = z.object({ email: z.email().max(254), password: z.string().min(1).max(128) });

// The identity provider owns passwords and verification. Browser cookies contain only opaque IDs.
export class AccountService {
  readonly router = Router();
  private sessions = new Map<string, AccountSession>();
  private readonly vault?: SessionVault<AccountSession>;
  private readonly revisions = new WeakMap<Request, number>();
  private readonly sessionEndListeners = new Set<(session: AccountSession) => void>();
  onSessionEnd(listener: (session: AccountSession) => void) { this.sessionEndListeners.add(listener); }
  private endPrivateSession(session: AccountSession) { for (const listener of this.sessionEndListeners) listener(session); }
  private flows = new Map<string, Flow>();
  private recoveries = new Map<string, { token: string; email: string; expires: number }>();
  private readonly origin: string;
  private readonly cookie: string;
  constructor(private readonly config: AppConfig, private readonly sharedFlows?: SharedAuthFlows, private readonly sharedSessions?: SharedSessions) {
    if (config.sessionStorage && !sharedSessions) {
      this.vault = new SessionVault(config.sessionStorage.directory, config.sessionStorage.key);
      this.sessions = this.vault.load();
      this.prune();
    }
    this.origin = config.publicOrigin ?? config.clientOrigin;
    this.cookie = config.production ? '__Host-whycode-account' : 'whycode_account';
    const router = this.router;
    // Routine session checks have their own budget; they must not consume the
    // much smaller budget protecting account actions such as login and OAuth.
    router.get('/session', rateLimit(120, 60_000, config.sharedRateLimits, 'session'), async (req, res) => {
      const session = await this.authenticate(req);
      res.json({ configured: Boolean(config.accounts), providers: config.accounts?.providers ?? [],
        user: session?.user ?? null, github: session?.github && session.github.expires > Date.now() ? { login: session.github.login } : null,
        privateEnabled: Boolean(config.accounts && config.githubApp),
        installUrl: config.githubApp ? `https://github.com/apps/${encodeURIComponent(config.githubApp.slug)}/installations/new` : null });
    });
    router.use(rateLimit(40, 15 * 60_000, config.sharedRateLimits, 'account'));
    router.post('/login', rateLimit(5, 15 * 60_000, config.sharedRateLimits, 'login'), this.handle(async (req, res) => {
      this.requireProvider('email');
      const data = credentials.parse(req.body);
      const tokens = await this.auth('/token?grant_type=password', data);
      await this.issue(req, res, tokens); res.json({ ok: true });
    }));
    router.post('/signup', rateLimit(5, 60 * 60_000, config.sharedRateLimits, 'signup'), this.handle(async (req, res) => {
      this.requireProvider('email');
      const data = credentials.extend({ password: z.string().min(12).max(128) }).parse(req.body);
      const { state, verifier } = await this.flow(res, 'account');
      await this.auth(`/signup?redirect_to=${encodeURIComponent(this.callback(state))}`, {
        ...data, code_challenge: digest(verifier), code_challenge_method: 's256',
      });
      // Always require confirmation; never create a local session from an unconfirmed signup response.
      res.json({ message: 'Check your email to verify your account, then sign in. If you already have an account, use sign in or password recovery.' });
    }));
    router.post('/recover', rateLimit(5, 60 * 60_000, config.sharedRateLimits, 'recover'), this.handle(async (req, res) => {
      this.requireProvider('email');
      const { email } = credentials.pick({ email: true }).parse(req.body);
      const { state, verifier } = await this.flow(res, 'recovery');
      await this.auth(`/recover?redirect_to=${encodeURIComponent(this.callback(state))}`, { email, code_challenge: digest(verifier), code_challenge_method: 's256' });
      res.json({ message: 'If an account exists, a password reset link has been emailed. Open it in this browser.' });
    }));
    router.post('/reset-password', rateLimit(5, 15 * 60_000, config.sharedRateLimits, 'reset'), this.handle(async (req, res) => {
      this.requireProvider('email');
      const data = z.object({ password: z.string().min(12).max(128) }).parse(req.body);
      this.prune();
      const key = digest(this.readCookie(req, `${this.cookie}_recovery`));
      const recovery = this.sharedFlows ? await this.sharedFlows.read<{ token: string; email: string; expires: number }>('recovery', key, true) : this.recoveries.get(key);
      if (!recovery || recovery.expires <= Date.now()) throw new Error('AUTH_FAILED');
      this.recoveries.delete(key);
      res.clearCookie(`${this.cookie}_recovery`, this.cookieOptions());
      await this.auth('/user', { password: data.password }, recovery.token, 'PUT');
      if (this.sharedSessions) {
        const user = await this.auth('/user', undefined, recovery.token);
        if (typeof user.id !== 'string') throw new Error('AUTH_FAILED');
        await this.sharedSessions.revokeUser(user.id);
      }
      await this.auth('/logout?scope=global', {}, recovery.token).catch(() => {});
      for (const [id, session] of this.sessions) if (session.user.email === recovery.email) { this.endPrivateSession(session); session.expires = 0; session.github = undefined; this.sessions.delete(id); }
      this.persist();
      res.json({ message: 'Password updated. Sign in with your new password.' });
    }));
    router.post('/oauth', this.handle(async (req, res) => {
      const provider = z.enum(['google', 'github']).parse(req.body?.provider); this.requireProvider(provider);
      const { state, verifier } = await this.flow(res, 'account');
      const url = new URL(`${config.accounts!.url}/auth/v1/authorize`);
      url.search = new URLSearchParams({ provider, redirect_to: this.callback(state), code_challenge: digest(verifier), code_challenge_method: 's256' }).toString();
      res.json({ url: url.href });
    }));
    router.get('/callback', this.handle(async (req, res) => {
      const state = typeof req.query.flow === 'string' ? req.query.flow : '';
      const pending = this.sharedFlows ? await this.sharedFlows.read<Flow>('flow', digest(state)) : this.flows.get(digest(state));
      const kind = pending?.kind === 'recovery' ? 'recovery' : 'account';
      const flow = await this.consume(req, res, kind);
      const code = z.string().min(1).max(2048).parse(req.query.code);
      const tokens = await this.auth('/token?grant_type=pkce', { auth_code: code, code_verifier: flow.verifier });
      if (kind === 'recovery') {
        if (typeof tokens.access_token !== 'string') throw new Error('AUTH_FAILED');
        const user = await this.auth('/user', undefined, tokens.access_token);
        if (typeof user.email !== 'string' || !user.email_confirmed_at) throw new Error('AUTH_FAILED');
        this.prune(); if (this.recoveries.size >= 1000) throw new Error('BUSY');
        const token = random();
        const recovery = { token: tokens.access_token, email: user.email, expires: Date.now() + 10 * 60_000 };
        if (this.sharedFlows) await this.sharedFlows.put('recovery', digest(token), recovery);
        else this.recoveries.set(digest(token), recovery);
        res.cookie(`${this.cookie}_recovery`, token, { ...this.cookieOptions(), maxAge: 10 * 60_000 });
        res.redirect(`${this.origin}/?account=recovery`); return;
      }
      await this.issue(req, res, tokens); res.redirect(`${this.origin}/?account=connected`);
    }));
    router.post('/logout', this.handle(async (req, res) => {
      const id = digest(this.readCookie(req, this.cookie)); const session = await this.loadSession(req, id);
      await this.sharedSessions?.remove(id);
      this.sessions.delete(id);
      this.persist();
      if (session) { this.endPrivateSession(session); session.expires = 0; session.github = undefined; }
      res.clearCookie(this.cookie, this.cookieOptions());
      if (session) await this.auth('/logout?scope=local', {}, session.accessToken).catch(() => {});
      res.json({ ok: true });
    }));
    router.post('/github/connect', this.handle(async (req, res) => {
      const session = await this.authenticate(req);
      if (!session || !config.githubApp) { res.status(401).json(error('Sign in and configure the GitHub App before connecting repositories.')); return; }
      const { state, verifier } = await this.flow(res, 'github', session);
      const url = new URL('https://github.com/login/oauth/authorize');
      url.search = new URLSearchParams({ client_id: config.githubApp.clientId, redirect_uri: `${this.origin}/api/account/github/callback`,
        state, code_challenge: digest(verifier), code_challenge_method: 'S256' }).toString();
      res.json({ url: url.href });
    }));
    router.get('/github/callback', this.handle(async (req, res) => {
      const flow = await this.consume(req, res, 'github'); const session = await this.authenticate(req);
      if (!session || digest(session.user.id + ':' + session.accessToken) !== flow.session || !config.githubApp) throw new Error('AUTH_FAILED');
      const code = z.string().min(1).max(2048).parse(req.query.code);
      const response = await fetch('https://github.com/login/oauth/access_token', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: config.githubApp.clientId, client_secret: config.githubApp.clientSecret, code,
          code_verifier: flow.verifier, redirect_uri: `${this.origin}/api/account/github/callback` }), signal: AbortSignal.timeout(15000) });
      const token = await response.json() as { access_token?: string; expires_in?: number };
      // Reject traditional broad-scope OAuth tokens: only GitHub App user tokens are accepted.
      if (!response.ok || !token.access_token?.startsWith('ghu_')) throw new Error('AUTH_FAILED');
      const user = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) });
      if (!user.ok) throw new Error('AUTH_FAILED');
      const profile = await user.json() as { login: string };
      session.github = { token: token.access_token, login: profile.login, expires: Math.min(session.expires, Date.now() + Math.min(token.expires_in ?? 3600, 28800) * 1000) };
      await this.saveSharedSession(req, session);
      this.persist();
      res.redirect(`${this.origin}/?account=github`);
    }));
    router.post('/github/disconnect', this.handle(async (req, res) => {
      const session = await this.authenticate(req); if (session) { this.endPrivateSession(session); session.github = undefined; }
      if (session) await this.saveSharedSession(req, session);
      this.persist();
      res.json({ ok: true });
    }));
  }
  async authenticate(req: Request): Promise<AccountSession | undefined> {
    this.prune();
    const key = digest(this.readCookie(req, this.cookie));
    try {
      const session = await this.loadSession(req, key);
      if (!session || !this.config.accounts) return undefined;
      const user = await this.auth('/user', undefined, session.accessToken);
      if (user.id !== session.user.id || !user.email_confirmed_at) { await this.sharedSessions?.remove(key); this.endPrivateSession(session); session.expires = 0; session.github = undefined; this.sessions.delete(key); this.persist(); return undefined; }
      return session;
    } catch { return undefined; }
  }
  private requireProvider(provider: string) { if (!this.config.accounts?.providers.includes(provider)) throw new Error('NOT_CONFIGURED'); }
  private cookieOptions() { return { httpOnly: true, secure: Boolean(this.config.production), sameSite: 'lax' as const, path: '/' }; }
  private readCookie(req: Request, name: string) { return req.get('cookie')?.split(';').map(item => item.trim()).find(item => item.startsWith(`${name}=`))?.slice(name.length + 1) ?? ''; }
  hasSessionCookie(req: Request) { return Boolean(this.readCookie(req, this.cookie)); }
  clearSessionCookie(res: Response) { res.clearCookie(this.cookie, this.cookieOptions()); }
  async workspaceIdentity(req: Request): Promise<{ id: string } | null | undefined> {
    if (!this.hasSessionCookie(req)) return undefined;
    this.prune();
    const key = digest(this.readCookie(req, this.cookie));
    const session = await this.loadSession(req, key);
    if (!session || !this.config.accounts) return null;
    // Let provider outages propagate, rather than silently switching accounts to guest mode.
    const user = await this.auth('/user', undefined, session.accessToken);
    if (user.id !== session.user.id || !user.email_confirmed_at) {
      await this.sharedSessions?.remove(key);
      this.endPrivateSession(session); session.expires = 0; session.github = undefined; this.sessions.delete(key); this.persist(); return null;
    }
    return { id: session.user.id };
  }
  private callback(state: string) { return `${this.origin}/api/account/callback?flow=${state}`; }
  private prune() {
    let changed = false;
    for (const [id, session] of this.sessions) if (session.expires <= Date.now()) { this.endPrivateSession(session); this.sessions.delete(id); changed = true; }
    if (changed) this.persist();
    for (const [id, recovery] of this.recoveries) if (recovery.expires <= Date.now()) this.recoveries.delete(id);
    for (const [id, flow] of this.flows) if (flow.expires <= Date.now()) this.flows.delete(id);
  }
  private persist() { this.vault?.save(this.sessions); }
  private async loadSession(req: Request, key: string): Promise<AccountSession | undefined> {
    if (!this.sharedSessions) return this.sessions.get(key);
    if (!this.hasSessionCookie(req)) return undefined;
    const record = await this.sharedSessions.get(key);
    const cached = this.sessions.get(key);
    if (!record) {
      if (cached) { this.endPrivateSession(cached); cached.expires = 0; cached.github = undefined; this.sessions.delete(key); }
      return undefined;
    }
    // Keep object identity for private-context ownership, but refresh all authorization state.
    const session = cached ?? record.session;
    if (cached && cached.github?.token !== record.session.github?.token) this.endPrivateSession(cached);
    Object.assign(session, record.session, { github: record.session.github });
    this.sessions.set(key, session);
    this.revisions.set(req, record.revision);
    return session;
  }
  private async saveSharedSession(req: Request, session: AccountSession) {
    if (this.sharedSessions) await this.sharedSessions.update(digest(this.readCookie(req, this.cookie)), session, this.revisions.get(req) ?? -1);
  }
  private async flow(res: Response, kind: Flow['kind'], session?: AccountSession) {
    this.prune(); if (this.flows.size >= 1000) throw new Error('BUSY');
    const state = random(), verifier = random();
    const flow = { kind, verifier, session: session ? digest(session.user.id + ':' + session.accessToken) : undefined, expires: Date.now() + 60 * 60_000 };
    if (this.sharedFlows) await this.sharedFlows.put('flow', digest(state), flow);
    else this.flows.set(digest(state), flow);
    res.cookie(`${this.cookie}_flow`, state, { ...this.cookieOptions(), maxAge: 60 * 60_000 });
    return { state, verifier };
  }
  private async consume(req: Request, res: Response, kind: Flow['kind']) {
    const state = kind === 'github' ? req.query.state : req.query.flow;
    if (typeof state !== 'string' || state !== this.readCookie(req, `${this.cookie}_flow`)) throw new Error('AUTH_FAILED');
    const key = digest(state), flow = this.sharedFlows ? await this.sharedFlows.read<Flow>('flow', key, true) : this.flows.get(key); this.flows.delete(key);
    res.clearCookie(`${this.cookie}_flow`, this.cookieOptions());
    if (!flow || flow.kind !== kind || flow.expires <= Date.now()) throw new Error('AUTH_FAILED');
    return flow;
  }
  private async issue(req: Request, res: Response, tokens: Record<string, unknown>) {
    if (typeof tokens.access_token !== 'string') throw new Error('AUTH_FAILED');
    const user = await this.auth('/user', undefined, tokens.access_token);
    if (typeof user.id !== 'string' || typeof user.email !== 'string' || !user.email_confirmed_at) throw new Error('AUTH_FAILED');
    this.prune(); if (this.sessions.size >= 1000) throw new Error('BUSY');
    const oldKey = digest(this.readCookie(req, this.cookie)), oldSession = await this.loadSession(req, oldKey);
    await this.sharedSessions?.remove(oldKey);
    if (oldSession) { this.endPrivateSession(oldSession); oldSession.expires = 0; oldSession.github = undefined; }
    this.sessions.delete(oldKey);
    const token = random(); const lifetime = Math.min(Math.max(Number(tokens.expires_in) || 3600, 1), 28800) * 1000;
    const session: AccountSession = { user: { id: user.id, email: user.email }, accessToken: tokens.access_token, expires: Date.now() + lifetime };
    await this.sharedSessions?.create(digest(token), session);
    this.sessions.set(digest(token), session);
    this.persist();
    res.cookie(this.cookie, token, { ...this.cookieOptions(), maxAge: lifetime });
  }
  private async auth(path: string, body?: unknown, token?: string, method?: string): Promise<Record<string, unknown>> {
    if (!this.config.accounts || !this.config.accounts.url.startsWith('https://')) throw new Error('NOT_CONFIGURED');
    const response = await fetch(`${this.config.accounts.url}/auth/v1${path}`, { method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: { apikey: this.config.accounts.key, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(response.status === 429 ? 'BUSY' : 'AUTH_FAILED');
    return response.status === 204 ? {} : response.json() as Promise<Record<string, unknown>>;
  }
  private handle(action: (req: Request, res: Response) => Promise<void>) {
    return (req: Request, res: Response) => { void action(req, res).catch(reason => {
      if (req.method === 'GET' && req.path.includes('callback')) { res.redirect(`${this.origin}/?account=failed`); return; }
      const message = reason instanceof z.ZodError ? 'Enter a valid email and password. New passwords need at least 12 characters.'
        : reason?.message === 'NOT_CONFIGURED' ? 'Account access is not configured on this server yet.'
        : reason?.message === 'BUSY' ? 'Too many attempts. Please wait before retrying.'
        : 'Sign-in or verification failed. Check your details and email verification, then retry.';
      res.status(reason?.message === 'NOT_CONFIGURED' ? 503 : reason?.message === 'BUSY' ? 429 : 400).json(error(message));
    }); };
  }
}
function error(message: string) { return { error: { code: 'ACCOUNT_ERROR', message, retryable: false } }; }
