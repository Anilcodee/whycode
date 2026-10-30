import { createHash, randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { AskResponse } from '../domain/question.js';
import { SharedGuestWorkspaces, type GuestChange, type GuestState } from '../infrastructure/shared-guest-workspaces.js';

type Guest = { repositories: Set<string>; history: AskResponse[]; expires: number };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const lifetime = 8 * 60 * 60 * 1000;

/** Guest workspaces own references, not the shared public source index. */
export class GuestWorkspaces {
  private readonly sessions = new Map<string, Guest>();
  private readonly requests = new WeakMap<Request, Guest>();
  private readonly cookie: string;
  private readonly changes = new WeakMap<Request, GuestChange[]>();
  constructor(private readonly production: boolean, private readonly resolveAccount?: (request: Request) => Promise<{ id: string } | null | undefined>, private readonly clearExpiredAccount?: (response: Response) => void, private readonly shared?: SharedGuestWorkspaces) {
    this.cookie = production ? '__Host-whycode-guest' : 'whycode_guest';
  }
  middleware = async (req: Request, res: Response, next: NextFunction) => {
    let account: { id: string } | null | undefined;
    try { account = await this.resolveAccount?.(req); }
    catch { res.status(503).json({ error: { code: 'ACCOUNT_UNAVAILABLE', message: 'Account verification is unavailable. Please retry.', retryable: true } }); return; }
    const expiredAccount = account === null;
    if (expiredAccount) { this.clearExpiredAccount?.(res); account = undefined; }
    const now = Date.now();
    for (const [key, session] of this.sessions) if (session.expires <= now) this.sessions.delete(key);
    const token = expiredAccount ? undefined : req.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${this.cookie}=`))?.slice(this.cookie.length + 1);
    let key = account ? `account:${digest(account.id)}` : token ? `guest:${digest(token)}` : undefined;
    let session: Guest | undefined;
    try {
      if (this.shared && key) { const stored = await this.shared.get(key); if (stored) session = { ...stored, repositories: new Set(stored.repositories) }; }
      else session = key ? this.sessions.get(key) : undefined;
    } catch { res.status(503).json({ error: { code: 'WORKSPACE_UNAVAILABLE', message: 'Workspace storage is temporarily unavailable. Please retry.', retryable: true } }); return; }
    const existed = Boolean(session);
    if (!session) {
      if (this.sessions.size >= 5000) { res.status(429).json({ error: { code: 'BUSY', message: 'Guest workspaces are at capacity. Please retry later.', retryable: true } }); return; }
      const fresh = randomBytes(32).toString('base64url');
      session = { repositories: new Set(), history: [], expires: now + lifetime };
      key = account ? `account:${digest(account.id)}` : `guest:${digest(fresh)}`;
      if (!this.shared) this.sessions.set(key, session);
      if (!account) res.cookie(this.cookie, fresh, { httpOnly: true, secure: this.production, sameSite: 'strict', path: '/', maxAge: lifetime });
    }
    this.requests.set(req, session);
    if (this.shared && key) {
      const changes: GuestChange[] = []; this.changes.set(req, changes);
      const initial: GuestState = { repositories: [...session.repositories], history: [...session.history], expires: session.expires };
      const json = res.json.bind(res), shared = this.shared, workspaceKey = key;
      res.json = ((body: unknown) => {
        if (res.statusCode>=400 || (existed && !changes.length)) return json(body);
        void shared.commit(workspaceKey, initial, changes).then(()=>json(body)).catch(()=> {
          res.status(503); json({ error: { code: 'WORKSPACE_UNAVAILABLE', message: 'Workspace changes could not be saved. Please retry.', retryable: true } });
        });
        return res;
      }) as typeof res.json;
    }
    next();
  };
  includes(req: Request, id: string) { return this.requests.get(req)?.repositories.has(id) ?? false; }
  add(req: Request, id: string) { this.requests.get(req)?.repositories.add(id); this.changes.get(req)?.push({type:'add',id}); }
  remove(req: Request, id: string) {
    const guest = this.requests.get(req);
    if (!guest || !guest.repositories.delete(id)) return false;
    guest.history = guest.history.filter(item => item.repositoryId !== id);
    this.changes.get(req)?.push({type:'remove',id});
    return true;
  }
  history(req: Request) { return this.requests.get(req)?.history ?? []; }
  save(req: Request, answer: AskResponse) {
    const guest = this.requests.get(req);
    if (!guest || !guest.repositories.has(answer.repositoryId)) return false;
    const next = [answer, ...guest.history].slice(0, 20);
    if (JSON.stringify(next).length >= 2_000_000) return false;
    guest.history = next;
    this.changes.get(req)?.push({type:'save',answer});
    return true;
  }
  removeAnswer(req: Request, repositoryId: string, answeredAt: string) {
    const guest = this.requests.get(req);
    if (!guest) return false;
    const before = guest.history.length;
    guest.history = guest.history.filter(item => item.repositoryId !== repositoryId || item.answeredAt !== answeredAt);
    this.changes.get(req)?.push({type:'removeAnswer',id:repositoryId,at:answeredAt});
    return guest.history.length < before;
  }
  clearHistory(req: Request) { const guest = this.requests.get(req); if (guest) guest.history = []; this.changes.get(req)?.push({type:'clear'}); }
  async guestData(req: Request) {
    const token = req.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${this.cookie}=`))?.slice(this.cookie.length + 1);
    const guest = token ? this.shared ? await this.shared.get(`guest:${digest(token)}`) : this.sessions.get(`guest:${digest(token)}`) : undefined;
    if (!guest || guest.expires <= Date.now()) return { repositories: [] as string[], history: [] as AskResponse[] };
    return { repositories: [...guest.repositories], history: [...guest.history] };
  }
}
