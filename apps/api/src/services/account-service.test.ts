import assert from 'node:assert/strict';
import test from 'node:test';
import { AddressInfo } from 'node:net';
import { createApp } from '../app.js';
import { AppConfig } from '../config.js';
import { GitHubClient } from '../infrastructure/github/github-client.js';
import { InMemoryIndexingStore } from '../infrastructure/indexing/in-memory-indexing-store.js';
import { SnapshotReader } from '../infrastructure/graph/snapshot-reader.js';
import { IndexingService } from './indexing-service.js';

const headers = { 'Content-Type': 'application/json', 'X-WhyCode-Request': '1' };
const config: AppConfig = { port: 4000, clientOrigin: 'http://localhost:5173', githubApiUrl: 'https://api.github.com',
  accounts: { url: 'https://identity.example', key: 'public-test-key', providers: ['email', 'github', 'google'] },
  githubApp: { clientId: 'app-client', clientSecret: 'server-secret', slug: 'whycode-test' } };
async function fixture(run: (base: string) => Promise<void>, overrides: Partial<AppConfig> = {}) {
  const server = createApp({ ...config, ...overrides }).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try { await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); }
  finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
test('restart recovery retains job identity and bounds recovery attempts', async () => {
  const store = Object.assign(new InMemoryIndexingStore(), { recoverJobs: true });
  const seed = new IndexingService({ getRepository: async () => { throw new Error('offline'); } } as unknown as GitHubClient, store);
  await seed.start('o/recover');
  await IndexingService.waitForActiveJobs();
  const original = store.getStatus('github:o/recover')!;
  store.saveStatus({ ...original, status: 'queued' });
  let calls = 0;
  new IndexingService({ getRepository: async () => { calls++; throw new Error('offline'); } } as unknown as GitHubClient, store);
  await IndexingService.waitForActiveJobs();
  assert.equal(calls, 1);
  assert.equal(store.getStatus(original.repositoryId)?.jobId, original.jobId);
  assert.equal(store.getStatus(original.repositoryId)?.request?.recoveries, 1);
  assert.equal(store.getStatus(original.repositoryId)?.status, 'failed');
});
test('shutdown can wait for an active indexing job to finish', async () => {
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const github = { getRepository: async () => { await blocked; throw new Error('offline'); } } as unknown as GitHubClient;
  const service = new IndexingService(github, new InMemoryIndexingStore());
  await service.start('o/shutdown', { commits: 25, pullRequests: 0, issues: 0, comments: 0 });
  let finished = false;
  const draining = IndexingService.waitForActiveJobs().then(() => { finished = true; });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(finished, false);
  release();
  await draining;
  assert.equal((await service.getStatus('github:o/shutdown'))?.status, 'failed');
});
test('routine session checks do not exhaust the protected login budget', async () => fixture(async base => {
  for (let i = 0; i < 45; i++) assert.equal((await fetch(`${base}/api/account/session`)).status, 200);
  for (let i = 0; i < 5; i++) {
    const result = await fetch(`${base}/api/account/login`, { method: 'POST', headers, body: JSON.stringify({ email: 'a@example.com', password: 'test' }) });
    assert.equal(result.status, 503);
  }
  const limited = await fetch(`${base}/api/account/login`, { method: 'POST', headers, body: JSON.stringify({ email: 'a@example.com', password: 'test' }) });
  assert.equal(limited.status, 429);
}, { accounts: undefined }));
test('password reset link uses a browser-bound PKCE flow and a single-use recovery-only session', async () => {
  const original = globalThis.fetch;
  let redirect = '', challenge = '', updated = 0;
  globalThis.fetch = async (url, init) => {
    const value = String(url);
    if (!value.startsWith('https://identity.example')) return original(url, init);
    if (value.includes('/recover?')) {
      redirect = new URL(value).searchParams.get('redirect_to')!;
      const body = JSON.parse(String(init?.body)); challenge = body.code_challenge;
      assert.equal(body.code_challenge_method, 's256');
      return json({});
    }
    if (value.includes('/token?grant_type=pkce')) {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.auth_code, 'recovery-code');
      const { createHash } = await import('node:crypto');
      assert.equal(createHash('sha256').update(body.code_verifier).digest('base64url'), challenge);
      return json({ access_token: 'recovery-provider-secret' });
    }
    if (value.endsWith('/user') && init?.method === 'PUT') { updated++; return json({}); }
    if (value.endsWith('/user')) return json({ id: 'user-a', email: 'a@example.com', email_confirmed_at: '2026-01-01' });
    return json({});
  };
  try { await fixture(async base => {
    const start = await fetch(`${base}/api/account/recover`, { method: 'POST', headers, body: JSON.stringify({ email: 'a@example.com' }) });
    assert.equal(start.status, 200);
    assert.match((await start.json()).message, /link/);
    const flowCookie = start.headers.get('set-cookie')!.split(';')[0];
    const flow = new URL(redirect).searchParams.get('flow');
    assert.ok(flow);
    const callback = `${base}/api/account/callback?flow=${encodeURIComponent(flow!)}&code=recovery-code`;
    const denied = await fetch(callback, { redirect: 'manual' });
    assert.match(denied.headers.get('location')!, /account=failed/);
    const response = await fetch(callback, { redirect: 'manual', headers: { Cookie: flowCookie } });
    assert.match(response.headers.get('location')!, /account=recovery/);
    const recoveryCookie = response.headers.getSetCookie().find(cookie => cookie.startsWith('whycode_account_recovery='))!;
    assert.match(recoveryCookie, /HttpOnly/i);
    const cookie = recoveryCookie.split(';')[0];
    const state = await fetch(`${base}/api/account/session`, { headers: { Cookie: cookie } }).then(r => r.json());
    assert.equal(state.user, null);
    const reset = () => fetch(`${base}/api/account/reset-password`, { method: 'POST', headers: { ...headers, Cookie: cookie }, body: JSON.stringify({ password: 'a-new-secure-password' }) });
    assert.equal((await reset()).status, 200);
    assert.equal((await reset()).status, 400);
    assert.equal(updated, 1);
    assert.match((await fetch(callback, { redirect: 'manual', headers: { Cookie: flowCookie } })).headers.get('location')!, /account=failed/);
  }); } finally { globalThis.fetch = original; }
});
test('accounts are visibly unavailable when unconfigured and private routes deny guests', async () => fixture(async base => {
  const state = await fetch(`${base}/api/account/session`).then(r => r.json()); assert.equal(state.configured, false);
  assert.equal((await fetch(`${base}/api/private/repositories`)).status, 403);
  assert.equal((await fetch(`${base}/api/account/login`, { method: 'POST', headers, body: JSON.stringify({ email: 'a@example.com', password: 'test' }) })).status, 503);
}, { accounts: undefined }));

test('verified provider identity creates opaque revocable cookies; credentials never reach browser storage responses', async () => {
  const original = globalThis.fetch;
  let verified = true;
  globalThis.fetch = async (url, init) => {
    const value = String(url);
    if (!value.startsWith('https://identity.example')) return original(url, init);
    if (value.includes('/token?')) return json({ access_token: 'provider-secret', expires_in: 3600 });
    if (value.endsWith('/user')) return json({ id: 'user-a', email: 'a@example.com', email_confirmed_at: verified ? '2026-01-01' : null });
    return json({});
  };
  try { await fixture(async base => {
    const login = () => fetch(`${base}/api/account/login`, { method: 'POST', headers, body: JSON.stringify({ email: 'a@example.com', password: 'a-test-password' }) });
    const response = await login(); assert.equal(response.status, 200);
    assert.doesNotMatch(await response.text(), /provider-secret|access_token/);
    const cookie = response.headers.get('set-cookie')!; assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Lax/); assert.doesNotMatch(cookie, /provider-secret/);
    const token = cookie.split(';')[0];
    assert.equal((await fetch(`${base}/api/account/session`, { headers: { Cookie: token } }).then(r => r.json())).user.id, 'user-a');
    assert.equal((await fetch(`${base}/api/private/repositories`, { headers: { Cookie: token } })).status, 403);
    await fetch(`${base}/api/account/logout`, { method: 'POST', headers: { ...headers, Cookie: token }, body: '{}' });
    assert.equal((await fetch(`${base}/api/account/session`, { headers: { Cookie: token } }).then(r => r.json())).user, null);
    verified = false; assert.equal((await login()).status, 400);
  }); } finally { globalThis.fetch = original; }
});

test('OAuth has PKCE, browser-bound one-time state and rejects forged callbacks without exchanging a code', async () => {
  const original = globalThis.fetch; let exchanges = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://identity.example')) { exchanges++; return json({}); }
    return original(url, init);
  };
  try { await fixture(async base => {
    const response = await fetch(`${base}/api/account/oauth`, { method: 'POST', headers, body: JSON.stringify({ provider: 'google' }) });
    const url = new URL((await response.json()).url); assert.equal(url.searchParams.get('code_challenge_method'), 's256');
    assert.equal(url.searchParams.get('code_challenge')?.length, 43); assert.doesNotMatch(url.href, /server-secret|code_verifier/);
    const flow = new URL(url.searchParams.get('redirect_to')!).searchParams.get('flow');
    const forged = await fetch(`${base}/api/account/callback?flow=${flow}&code=stolen`, { redirect: 'manual' });
    assert.equal(forged.status, 302); assert.match(forged.headers.get('location')!, /account=failed/); assert.equal(exchanges, 0);
    const cookie = response.headers.get('set-cookie')!.split(';')[0];
    await fetch(`${base}/api/account/callback?flow=${flow}&code=valid`, { headers: { Cookie: cookie }, redirect: 'manual' });
    assert.equal(exchanges, 1);
    await fetch(`${base}/api/account/callback?flow=${flow}&code=replay`, { headers: { Cookie: cookie }, redirect: 'manual' }); assert.equal(exchanges, 1);
    assert.equal((await fetch(`${base}/api/account/oauth`, { method: 'POST', headers: { ...headers, Origin: 'https://attacker.example' }, body: '{"provider":"google"}' })).status, 403);
  }); } finally { globalThis.fetch = original; }
});

test('commit continuation crosses partial pages without gaps and stays pinned to the original head', async () => {
  const original = globalThis.fetch; const urls: string[] = [];
  const records = Array.from({ length: 247 }, (_, index) => ({ sha: `sha-${index}`, commit: { message: `commit ${index}`, author: { date: '2026-01-01' } }, html_url: `https://github.com/o/r/commit/${index}` }));
  globalThis.fetch = async url => {
    const parsed = new URL(String(url)); urls.push(parsed.href);
    const size = Number(parsed.searchParams.get('per_page')), page = Number(parsed.searchParams.get('page') ?? 1);
    return json(records.slice((page - 1) * size, page * size));
  };
  try {
    const client = new GitHubClient('https://api.github.com');
    const first = await client.listCommitWindow('o/r', 75); assert.equal(first.history.hasMore, true);
    const second = await client.listCommitWindow('o/r', 200, first.history);
    assert.equal(second.commits.length, 172); assert.equal(second.history.hasMore, false);
    assert.equal(new Set([...first.commits, ...second.commits].map(c => c.sha)).size, 247);
    assert.ok(urls.filter(url => new URL(url).searchParams.has('page')).every(url => new URL(url).searchParams.get('sha') === 'sha-0'));
  } finally { globalThis.fetch = original; }
});

test('older history appends snapshots without dropping earlier commits or sources', async () => {
  let window = 0;
  let failNext = false;
  const github = {
    getRepository: async () => ({ full_name: 'o/r', html_url: 'https://github.com/o/r', default_branch: 'main' }),
    listCommitWindow: async () => { if (failNext) { failNext = false; throw new Error('offline'); } window++; return { commits: [{ sha: `sha-${window}`, message: 'change', url: 'https://github.com/o/r' }], history: { head: 'sha-1', offset: window, hasMore: window < 2 } }; },
    listChangedFiles: async () => ({ files: [`file-${window}.ts`], commitFiles: [{ sha: `sha-${window}`, files: [`file-${window}.ts`] }], limited: false }),
    listPullRequests: async () => [], listIssues: async () => [], listComments: async () => [],
    listSources: async () => ({ sources: [], revision: 'sha-1', totalFiles: 2, truncatedTree: false }),
  } as unknown as GitHubClient;
  const store = new InMemoryIndexingStore(), service = new IndexingService(github, store);
  const limits = { commits: 25, pullRequests: 0, issues: 0, comments: 0 };
  async function wait() { for (let n = 0; n < 100 && !['complete', 'partial', 'failed'].includes((await service.getStatus('github:o/r'))!.status); n++) await new Promise(resolve => setTimeout(resolve, 2)); }
  await service.start('o/r', limits); await wait();
  failNext = true; await service.start('o/r', limits, true); await wait();
  assert.equal((await service.getStatus('github:o/r'))!.status, 'partial'); assert.equal(store.getSnapshot('github:o/r')!.commits.length, 1);
  await service.start('o/r', limits, true); await wait();
  const snapshot = store.getSnapshot('github:o/r')!;
  assert.equal(snapshot.commits.length, 2); assert.equal(snapshot.commitFiles.length, 2); assert.deepEqual(snapshot.files, ['file-1.ts', 'file-2.ts']);
  assert.equal(snapshot.history?.hasMore, false); await assert.rejects(() => service.start('o/r', limits, true), /HISTORY_LIMIT/);
  const privateStore = new InMemoryIndexingStore();
  assert.equal((await new SnapshotReader(privateStore).resolveEntities('github:o/r', ['change'])).length, 0);
  assert.equal((await new SnapshotReader(store).resolveEntities('github:o/r', ['change'])).length, 2);
});

test('private indexing stays isolated across accounts, rechecks revoked access, and requires model consent', async () => {
  const original = globalThis.fetch; let permitted = true;
  globalThis.fetch = async (url, init) => {
    const value = String(url);
    if (value.startsWith('https://identity.example')) {
      if (value.includes('/token?')) { const input = JSON.parse(String(init?.body)); return json({ access_token: input.email, expires_in: 3600 }); }
      if (value.endsWith('/user')) {
        const token = (init?.headers as Record<string, string>).Authorization.replace('Bearer ', '');
        return json({ id: token, email: token, email_confirmed_at: '2026-01-01' });
      }
      return json({});
    }
    if (value.startsWith('https://github.com/login/oauth/access_token')) return json({ access_token: 'ghu_session_test', expires_in: 3600 });
    if (value === 'https://api.github.com/user') return json({ login: 'reader' });
    if (value.startsWith('https://api.github.com/repos/o/private')) {
      const path = new URL(value).pathname;
      if (path === '/repos/o/private') return permitted ? json({ private: true, full_name: 'o/private', default_branch: 'main', html_url: 'https://github.com/o/private' }) : json({}, 403);
      if (path === '/repos/o/private/commits') return json([{ sha: 'abc123', commit: { message: 'private implementation rationale', author: { date: '2026-01-01' } }, html_url: 'https://github.com/o/private/commit/abc123' }]);
      if (path.endsWith('/commits/abc123')) return json({ sha: 'abc123', files: [] });
      if (path.includes('/git/trees/')) return json({ tree: [] });
      return json([]);
    }
    return original(url, init);
  };
  try { await fixture(async base => {
    const post = (path: string, body: unknown, cookie = '') => fetch(`${base}${path}`, { method: 'POST', headers: { ...headers, Cookie: cookie }, body: JSON.stringify(body) });
    async function login(email: string) {
      const response = await post('/api/account/login', { email, password: 'a-test-password' }); assert.equal(response.status, 200);
      return response.headers.get('set-cookie')!.split(';')[0];
    }
    async function connect(cookie: string) {
      const response = await post('/api/account/github/connect', {}, cookie);
      const url = new URL((await response.json()).url); assert.equal(url.searchParams.get('code_challenge_method'), 'S256'); assert.equal(url.searchParams.has('scope'), false);
      const flowCookie = response.headers.get('set-cookie')!.split(';')[0];
      const callback = await fetch(`${base}/api/account/github/callback?state=${url.searchParams.get('state')}&code=valid`, { headers: { Cookie: `${cookie}; ${flowCookie}` }, redirect: 'manual' });
      assert.match(callback.headers.get('location')!, /account=github/);
    }
    const a = await login('a@example.com'), b = await login('b@example.com'); await connect(a); await connect(b);
    const started = await post('/api/private/repositories/ingest', { repository: 'o/private' }, a); assert.equal(started.status, 202);
    let status;
    for (let n = 0; n < 50; n++) {
      status = await fetch(`${base}/api/private/repositories/github%3Ao%2Fprivate/status`, { headers: { Cookie: a } }).then(r => r.json());
      if (['complete', 'partial', 'failed'].includes(status.status)) break;
      await new Promise(resolve => setTimeout(resolve, 2));
    }
    assert.equal(status.status, 'complete');
    assert.equal((await fetch(`${base}/api/repositories`).then(r => r.json())).repositories.length, 0);
    assert.equal((await fetch(`${base}/api/private/repositories/github%3Ao%2Fprivate/status`, { headers: { Cookie: b } })).status, 404);
    assert.equal((await fetch(`${base}/api/private/repositories/github%3Ao%2Fprivate/status`)).status, 403);
    const question = { repositoryId: 'github:o/private', question: 'unmatchedspecialword' };
    assert.equal((await post('/api/private/ask', question, a)).status, 403);
    assert.equal((await post('/api/private/ask', { ...question, allowPrivateModel: true }, a)).status, 200);
    permitted = false;
    assert.equal((await fetch(`${base}/api/private/repositories/github%3Ao%2Fprivate/status`, { headers: { Cookie: a } })).status, 403);
    assert.equal((await fetch(`${base}/api/private/repositories/`, { headers: { Cookie: a } }).then(r => r.json())).repositories.length, 0);
    await post('/api/account/logout', {}, a);
    assert.equal((await fetch(`${base}/api/private/repositories`, { headers: { Cookie: a } })).status, 403);
  }); } finally { globalThis.fetch = original; }
});
