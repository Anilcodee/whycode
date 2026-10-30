// QA audit API test harness — runs against the LIVE local server.
// Non-destructive: uses isolated guest-session cookies, public test repo only,
// negative-only auth tests, and never deletes pre-existing records.
const BASE = 'http://127.0.0.1:4000';
const results = [];
const section = { current: 'general' };
const jarStore = new Map();

function jar(name = 'default') {
  if (!jarStore.has(name)) jarStore.set(name, new Map());
  return jarStore.get(name);
}

async function req(method, path, opts = {}) {
  // Transient Upstash blips cause 503 RATE_LIMIT_UNAVAILABLE; retry briefly before failing the check.
  let out = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    out = await rawReq(method, path, opts);
    const code = out.json?.error?.code;
    if (out.status !== 503 || code !== 'RATE_LIMIT_UNAVAILABLE') break;
    await new Promise(r => setTimeout(r, 2500));
  }
  return out;
}
async function rawReq(method, path, { body, headers = {}, jar: jarName, raw } = {}) {
  const started = Date.now();
  const h = { ...headers };
  const j = jarName ? jar(jarName) : null;
  if (j && j.size) h.Cookie = [...j.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  if (body !== undefined) {
    h['Content-Type'] = h['Content-Type'] ?? 'application/json';
    h['X-WhyCode-Request'] = h['X-WhyCode-Request'] ?? '1';
  }
  const res = await fetch(`${BASE}${path}`, {
    method, headers: h,
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
    signal: AbortSignal.timeout(300_000),
  });
  const setCookies = res.headers.getSetCookie?.() ?? [];
  if (j) for (const sc of setCookies) {
    const [pair] = sc.split(';');
    const eq = pair.indexOf('=');
    const name = pair.slice(0, eq).trim(), value = pair.slice(eq + 1).trim();
    if (value === '' || /Expires=Thu, 01 Jan 1970/.test(sc)) j.delete(name); else j.set(name, value);
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, headers: res.headers, setCookies, text, json, timeMs: Date.now() - started, raw };
}

let passCount = 0, failCount = 0;
function record(id, name, ok, detail) {
  if (ok) passCount++; else failCount++;
  results.push({ id, section: section.current, name, ok, detail: detail ?? null });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${name}${detail && !ok ? ` — ${JSON.stringify(detail).slice(0, 400)}` : ''}`);
}
function expect(id, name, cond, detail) { record(id, name, Boolean(cond), detail); }
function eq(id, name, actual, expected) {
  record(id, name, actual === expected, { actual, expected });
}
function inSet(id, name, actual, expectedSet) {
  record(id, name, expectedSet.includes(actual), { actual, expected: expectedSet });
}

// ---------- S1: health & discovery ----------
section.current = 'S1-health';
{
  const h = await req('GET', '/healthz');
  eq('T1.1', 'GET /healthz returns 200 ok', h.status, 200);
  eq('T1.2', '/healthz body is "ok"', h.text, 'ok');

  const hp = await req('GET', '/api/health');
  eq('T1.3', 'GET /api/health returns 200', hp.status, 200);
  eq('T1.4', 'health reports database connected', hp.json?.dependencies?.database, 'connected');
  const hpText = hp.text;
  expect('T1.5', 'health response leaks no secrets', !/(api[_-]?key|sk-|ghu_|Bearer |password|secret)/i.test(hpText), { snippet: hpText.slice(0, 300) });

  const s = await req('GET', '/api/auth/session');
  eq('T1.6', 'GET /api/auth/session returns 200', s.status, 200);
  eq('T1.7', 'auth session reports authenticated:true (public mode)', s.json?.authenticated, true);

  const as = await req('GET', '/api/account/session');
  eq('T1.8', 'GET /api/account/session returns 200', as.status, 200);
  expect('T1.9', 'account session hides user when logged out', as.json?.user === null, as.json);
  expect('T1.10', 'account session lists providers', Array.isArray(as.json?.providers) && as.json.providers.length > 0, as.json);
}

// ---------- S2: security headers ----------
section.current = 'S2-headers';
{
  const r = await req('GET', '/api/health');
  const hd = r.headers;
  const must = {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
  };
  for (const [k, v] of Object.entries(must)) eq(`T2.${k}`, `header ${k}=${v}`, hd.get(k), v);
  const csp = hd.get('content-security-policy') ?? '';
  expect('T2.csp', 'CSP present with default-src self, object-src none, frame-ancestors none',
    csp.includes("default-src 'self'") && csp.includes("object-src 'none'") && csp.includes("frame-ancestors 'none'"), csp);
  expect('T2.permissions', 'Permissions-Policy present', Boolean(hd.get('permissions-policy')), hd.get('permissions-policy'));
  expect('T2.xreqid', 'X-Request-Id present', Boolean(hd.get('x-request-id')));
  expect('T2.cache', 'Cache-Control no-store on /api', (hd.get('cache-control') ?? '').includes('no-store'), hd.get('cache-control'));
  expect('T2.hsts-dev', 'HSTS correctly absent in dev (only set in production)', hd.get('strict-transport-security') === null, hd.get('strict-transport-security'));
  expect('T2.powered', 'X-Powered-By hidden', hd.get('x-powered-by') === null, hd.get('x-powered-by'));
}

// ---------- S3: CSRF / origin / host enforcement ----------
section.current = 'S3-csrf';
{
  // Missing custom header on mutation
  const noHeader = await fetch(`${BASE}/api/repositories/validate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repository: 'octocat/Hello-World' }),
  });
  eq('T3.1', 'POST without X-WhyCode-Request rejected 403', noHeader.status, 403);
  const nh = await noHeader.json().catch(() => null);
  eq('T3.2', 'rejection code REQUEST_REJECTED', nh?.error?.code, 'REQUEST_REJECTED');

  // Foreign Origin header on mutation
  const badOrigin = await req('POST', '/api/repositories/validate', { body: { repository: 'octocat/Hello-World' }, headers: { Origin: 'https://evil.example' } });
  eq('T3.3', 'POST with foreign Origin rejected 403', badOrigin.status, 403);
  eq('T3.4', 'rejection code ORIGIN_REJECTED', badOrigin.json?.error?.code, 'ORIGIN_REJECTED');

  // cross-site Sec-Fetch-Site
  const crossSite = await req('POST', '/api/repositories/validate', { body: { repository: 'octocat/Hello-World' }, headers: { 'Sec-Fetch-Site': 'cross-site' } });
  eq('T3.5', 'POST with Sec-Fetch-Site=cross-site rejected 403', crossSite.status, 403);

  // Non-JSON content type on mutation
  const wrongCT = await req('POST', '/api/repositories/validate', { body: { repository: 'octocat/Hello-World' }, headers: { 'Content-Type': 'text/plain' } });
  eq('T3.6', 'POST with text/plain rejected 403', wrongCT.status, 403);

  // Bad Host header is verified separately via curl (undici strips user-supplied Host headers).

  // GET requests are allowed without the custom header
  const okGet = await req('GET', '/api/repositories');
  eq('T3.8', 'GET /api/repositories needs no custom header', okGet.status, 200);
}

// ---------- S4: input validation ----------
section.current = 'S4-validation';
{
  // validate: happy paths
  const v1 = await req('POST', '/api/repositories/validate', { body: { repository: 'octocat/Hello-World' } });
  eq('T4.1', 'validate owner/repo → 200', v1.status, 200);
  eq('T4.2', 'validate normalizes to github id', v1.json?.repository, 'octocat/hello-world');

  const v2 = await req('POST', '/api/repositories/validate', { body: { repository: 'https://github.com/octocat/Hello-World' } });
  eq('T4.3', 'validate full GitHub URL → 200', v2.status, 200);
  eq('T4.4', 'URL normalized', v2.json?.repository, 'octocat/hello-world');

  // validate: negative
  for (const [i, bad] of [
    '', 'justonepart', 'owner/', '/repo', 'owner/repo/extra', 'o r/g', '../../../etc/passwd',
    'owner/repo?x=1', 'octocat/Hello-World/../../other', '<script>alert(1)</script>', "'; DROP TABLE users;--",
    'a'.repeat(201), 'git@github.com:octocat/Hello-World.git#evil', 'https://evil.github.com/octocat/hello-world',
  ].entries()) {
    const r = await req('POST', '/api/repositories/validate', { body: { repository: bad } });
    eq(`T4.5.${i}`, `validate rejects ${JSON.stringify(bad.slice(0, 40))} → 400`, r.status, 400);
  }

  // missing body / malformed JSON / wrong shape
  const noBody = await req('POST', '/api/repositories/validate', { body: JSON.stringify(null), headers: { 'Content-Type': 'application/json' } });
  inSet('T4.6', 'validate null body → 400', noBody.status, [400]);
  const badJson = await req('POST', '/api/repositories/validate', { body: '{invalid json', headers: { 'Content-Type': 'application/json' } });
  eq('T4.7', 'malformed JSON → 400', badJson.status, 400);
  eq('T4.8', 'malformed JSON code INVALID_REQUEST', badJson.json?.error?.code, 'INVALID_REQUEST');

  // ingest with invalid limits
  const bigLimits = await req('POST', '/api/repositories/ingest', { body: { repository: 'octocat/Hello-World', limits: { commits: 99999 } }, jar: 'main' });
  eq('T4.9', 'ingest commits>500 → 400', bigLimits.status, 400);
  const negLimits = await req('POST', '/api/repositories/ingest', { body: { repository: 'octocat/Hello-World', limits: { commits: -5 } }, jar: 'main' });
  eq('T4.10', 'ingest negative commits → 400', negLimits.status, 400);
  const floatLimits = await req('POST', '/api/repositories/ingest', { body: { repository: 'octocat/Hello-World', limits: { commits: 1.5 } }, jar: 'main' });
  eq('T4.11', 'ingest float commits → 400', floatLimits.status, 400);

  // ask validation (no LLM call — validation fails first)
  const a1 = await req('POST', '/api/ask', { body: { repositoryId: 'github:octocat/hello-world', question: 'x'.repeat(501) }, jar: 'main' });
  inSet('T4.12', 'ask question>500 chars → 400/404 (workspace membership checked first)', a1.status, [400, 404]);
  const a2 = await req('POST', '/api/ask', { body: { repositoryId: 'github:octocat/hello-world', question: 'ok?', language: 'fr' }, jar: 'main' });
  inSet('T4.13', 'ask invalid language enum → 400/404 (workspace membership checked first)', a2.status, [400, 404]);
  const a3 = await req('POST', '/api/ask', { body: { repositoryId: 'not-a-repo', question: 'ok?' }, jar: 'main' });
  inSet('T4.14', 'ask invalid repositoryId → 400/404', a3.status, [400, 404]);
  const a4 = await req('POST', '/api/ask', { body: {}, jar: 'main' });
  eq('T4.15', 'ask empty body → 400', a4.status, 400);

  // oversized body > 32KB
  const big = await req('POST', '/api/repositories/validate', { body: { repository: 'o/'.padEnd(34000, 'a') }, headers: { 'Content-Type': 'application/json' } });
  eq('T4.16', 'body >32KB → 413', big.status, 413);
}

// ---------- S5: method abuse & unknown routes ----------
section.current = 'S5-methods';
{
  for (const [i, m] of ['PUT', 'DELETE', 'PATCH'].entries()) {
    const r = await req(m, '/api/repositories/validate', { body: { repository: 'octocat/Hello-World' } });
    eq(`T5.${i}`, `${m} /api/repositories/validate → 404/403/405`, r.status, r.status === 403 ? 403 : 404);
  }
  const nf = await req('GET', '/api/definitely-not-a-route');
  expect('T5.3', 'unknown route → 404 stable shape', nf.status === 404 && nf.json?.error?.code === 'NOT_FOUND', nf.json);
  const nf2 = await req('GET', '/api/account/../../etc/passwd');
  inSet('T5.4', 'path traversal normalized → 404', nf2.status, [404, 400]);
}

// ---------- S6: guest workspace isolation (IDOR) ----------
section.current = 'S6-isolation';
{
  const emptyA = await req('GET', '/api/repositories', { jar: 'A' });
  expect('T6.1', 'fresh guest sees zero repositories', Array.isArray(emptyA.json?.repositories) && emptyA.json.repositories.length === 0, emptyA.json);
  expect('T6.2', 'guest cookie issued (httpOnly)', emptyA.setCookies.some(c => c.startsWith('whycode_guest=') && /HttpOnly/i.test(c)), emptyA.setCookies);
  const gc = emptyA.setCookies.find(c => c.startsWith('whycode_guest='));
  expect('T6.3', 'guest cookie SameSite=strict', /SameSite=strict/i.test(gc ?? ''), gc);
  const histA = await req('GET', '/api/workspace/history', { jar: 'A' });
  expect('T6.4', 'fresh guest history empty + temporary', histA.json?.persistence === 'temporary' && histA.json?.history?.length === 0, histA.json);

  // Session B must not see anything of session A (nothing indexed by A yet, but probe access patterns)
  const st = await req('GET', `/api/repositories/${encodeURIComponent('github:octocat/hello-world')}/status`, { jar: 'B' });
  eq('T6.5', 'status of repo outside workspace → 404', st.status, 404);
  const gr = await req('GET', `/api/repositories/${encodeURIComponent('github:octocat/hello-world')}/graph`, { jar: 'B' });
  eq('T6.6', 'graph of repo outside workspace → 404', gr.status, 404);
  const rm = await req('POST', `/api/repositories/${encodeURIComponent('github:octocat/hello-world')}/remove`, { body: {}, jar: 'B' });
  eq('T6.7', 'remove repo outside workspace → 404', rm.status, 404);
  const askOther = await req('POST', '/api/ask', { body: { repositoryId: 'github:octocat/hello-world', question: 'hello?' }, jar: 'B' });
  eq('T6.8', 'ask on repo outside workspace → 404', askOther.status, 404);
  const histRm = await req('POST', '/api/workspace/history/remove', { body: { repositoryId: 'github:octocat/hello-world', answeredAt: '2026-01-01T00:00:00.000Z' }, jar: 'B' });
  eq('T6.9', 'remove nonexistent history entry → 404', histRm.status, 404);
}

// ---------- S7: auth negative tests ----------
section.current = 'S7-auth';
{
  const badLogin = await req('POST', '/api/account/login', { body: { email: 'qa-nonexistent-user@example.com', password: 'WrongPassword123!' }, jar: 'auth' });
  eq('T7.1', 'login nonexistent account → 400 (no 500)', badLogin.status, 400);
  const badEmail = await req('POST', '/api/account/login', { body: { email: 'not-an-email', password: 'x' }, jar: 'auth' });
  expect('T7.2', 'login malformed email → 400 with guidance', badEmail.status === 400 && /valid email/i.test(badEmail.json?.error?.message ?? ''), badEmail.json);
  const weakSignup = await req('POST', '/api/account/signup', { body: { email: 'qa-signup-test@example.com', password: 'short' }, jar: 'auth' });
  eq('T7.3', 'signup weak password → 400', weakSignup.status, 400);
  expect('T7.4', 'signup weak-password message mentions 12 chars', /12/.test(weakSignup.json?.error?.message ?? ''), weakSignup.json);
  const logout = await req('POST', '/api/account/logout', { body: {}, jar: 'auth' });
  expect('T7.5', 'logout without session → 200 ok (idempotent)', logout.status === 200 && logout.json?.ok === true, logout.json);
  const unauthList = [
    ['GET', '/api/account/workspace/guest-preview', undefined],
    ['POST', '/api/account/workspace/history/remove', { id: 'x' }],
    ['POST', '/api/account/workspace/history/clear', { visibility: 'public' }],
    ['POST', '/api/account/workspace/import-guest', {}],
    ['POST', '/api/account/workspace/import-browser', { answer: {} }],
  ];
  let i = 6;
  for (const [m, p, b] of unauthList) {
    const r = await req(m, p, { body: b, jar: 'auth2' });
    eq(`T7.${i}`, `${m} ${p} unauthenticated → 401`, r.status, 401);
    i++;
  }
  const clearBad = await req('POST', '/api/account/workspace/history/clear', { body: { visibility: 'everything' }, jar: 'auth' });
  eq('T7.11', 'clear with invalid visibility unauth → 401 (auth checked first)', clearBad.status, 401);
  const priv = await req('GET', '/api/private/workspace/history', { jar: 'auth' });
  eq('T7.12', 'private workspace without GitHub → 403 GITHUB_REQUIRED', priv.status === 403 && priv.json?.error?.code === 'GITHUB_REQUIRED', priv.json);
  const privAsk = await req('POST', '/api/private/ask', { body: { repositoryId: 'github:o/r', question: 'q', allowPrivateModel: true }, jar: 'auth' });
  eq('T7.13', 'private ask unauthenticated → 403', privAsk.status, 403);
  const oauthBad = await req('POST', '/api/account/oauth', { body: { provider: 'facebook' }, jar: 'auth' });
  eq('T7.14', 'oauth unknown provider → 400', oauthBad.status, 400);
  const cbBad = await req('GET', '/api/account/callback?flow=garbage&code=x', { redirect: 'manual' });
  expect('T7.15', 'callback with garbage flow → redirect to failed or 400', [302, 400].includes(cbBad.status) ? (cbBad.status === 302 ? (cbBad.headers.get('location') ?? '').includes('account=failed') : true) : false, { status: cbBad.status, loc: cbBad.headers.get('location') });
}

// ---------- S8: sensitive data & error hygiene ----------
section.current = 'S8-leakage';
{
  const paths = ['/api/health', '/api/nonexistent', '/api/repositories', '/api/account/session'];
  let i = 1;
  for (const p of paths) {
    const r = await req('GET', p);
    const leak = /(at\s+\/|node_modules|stack|C:\\\\Users|process\.env|EADDRINUSE)/i.test(r.text);
    expect(`T8.${i}`, `no stack traces in ${p}`, !leak, { snippet: r.text.slice(0, 200) });
    i++;
  }
  // Set-Cookie hygiene on guest creation
  const g = await req('GET', '/api/repositories', { jar: 'leak' });
  const guestCookie = g.setCookies.find(c => c.startsWith('whycode_guest='));
  expect('T8.5', 'guest cookie HttpOnly', /HttpOnly/i.test(guestCookie ?? ''), guestCookie);
  expect('T8.6', 'guest cookie Path=/', /Path=\//.test(guestCookie ?? ''), guestCookie);
}

// ---------- S9: repository lifecycle (real, isolated to this session) ----------
section.current = 'S9-lifecycle';
{
  const ing = await req('POST', '/api/repositories/ingest', { body: { repository: 'octocat/Hello-World' }, jar: 'main' });
  eq('T9.1', 'ingest returns 202', ing.status, 202);
  expect('T9.2', 'ingest returns repositoryId + jobId + status', ing.json?.repositoryId === 'github:octocat/hello-world' && Boolean(ing.json?.jobId) && ['queued', 'running', 'complete'].includes(ing.json?.status), ing.json);
  expect('T9.3', 'ingest response leaks no credentials', !/(token|secret|key)/i.test(ing.text), ing.json);

  // list now contains repo for this session
  const list = await req('GET', '/api/repositories', { jar: 'main' });
  expect('T9.4', 'workspace list contains ingested repo', list.json?.repositories?.some(r => r.repositoryId === 'github:octocat/hello-world'), list.json);

  // duplicate ingest of same repo (double-click protection)
  const ing2 = await req('POST', '/api/repositories/ingest', { body: { repository: 'octocat/Hello-World' }, jar: 'main' });
  expect('T9.5', 'duplicate ingest handled gracefully (202/429)', [202, 429].includes(ing2.status), { status: ing2.status, body: ing2.json });

  // poll until terminal
  let status = null, attempts = 0;
  while (attempts < 90) {
    const s = await req('GET', `/api/repositories/${encodeURIComponent('github:octocat/hello-world')}/status`, { jar: 'main' });
    if (s.status !== 200) { status = { httpError: s.status, body: s.json }; break; }
    status = s.json;
    if (['complete', 'partial', 'failed'].includes(status.status)) break;
    await new Promise(r => setTimeout(r, 2000));
    attempts++;
  }
  expect('T9.6', 'indexing reaches terminal state', status && ['complete', 'partial'].includes(status.status), { final: status?.status ?? status, attempts });
  expect('T9.7', 'counts present and numeric', status?.counts && typeof status.counts.commits === 'number', status?.counts);

  const graph = await req('GET', `/api/repositories/${encodeURIComponent('github:octocat/hello-world')}/graph`, { jar: 'main' });
  eq('T9.8', 'graph returns 200', graph.status, 200);
  expect('T9.9', 'graph has nodes+edges arrays', Array.isArray(graph.json?.nodes) && Array.isArray(graph.json?.edges), { nodes: graph.json?.nodes?.length, edges: graph.json?.edges?.length });

  // ask — real LLM call (single)
  const started = Date.now();
  const ask = await req('POST', '/api/ask', { body: { repositoryId: 'github:octocat/hello-world', question: 'What change introduced README and who authored it?' }, jar: 'main' });
  const askMs = Date.now() - started;
  eq('T9.10', 'ask returns 200', ask.status, 200);
  expect('T9.11', 'ask answer shape: answer/abstained/evidence', typeof ask.json?.answer === 'string' && typeof ask.json?.abstained === 'boolean' && Array.isArray(ask.json?.evidence), { keys: Object.keys(ask.json ?? {}) });
  if (ask.status === 200) record('T9.12', 'ask latency recorded', true, { ms: askMs, abstained: ask.json?.abstained, evidence: ask.json?.evidence?.length });

  // ask again on removed repo after removal
  const rm2 = await req('POST', `/api/repositories/${encodeURIComponent('github:octocat/hello-world')}/remove`, { body: {}, jar: 'main' });
  eq('T9.13', 'remove ingested repo → 200', rm2.status, 200);
  const listAfter = await req('GET', '/api/repositories', { jar: 'main' });
  expect('T9.14', 'repo gone from workspace list after remove', !listAfter.json?.repositories?.some(r => r.repositoryId === 'github:octocat/hello-world'), listAfter.json);
  const stAfter = await req('GET', `/api/repositories/${encodeURIComponent('github:octocat/hello-world')}/status`, { jar: 'main' });
  eq('T9.15', 'status after remove → 404 (workspace-scoped)', stAfter.status, 404);
}

// ---------- S10: rate limiting (LAST — burns the public-ingest budget) ----------
section.current = 'S10-ratelimit';
{
  const codes = [];
  for (let i = 0; i < 8; i++) {
    const r = await req('POST', '/api/repositories/ingest', { body: { repository: 'octocat/Hello-World' }, jar: 'rl' });
    codes.push(r.status);
    if (r.status === 429) {
      expect('T10.retry', 'Retry-After header present on 429', Boolean(r.headers.get('retry-after')), r.headers.get('retry-after'));
      break;
    }
  }
  expect('T10.1', 'ingest rate limit engages by 8th request (limit 6/10min)', codes.includes(429), { codes });
}

console.log(`\n==== API RESULTS: ${passCount} passed, ${failCount} failed ====`);
const { writeFile } = await import('node:fs/promises');
await writeFile(new URL('./api-results.json', import.meta.url), JSON.stringify({ testedAt: new Date().toISOString(), passCount, failCount, results }, null, 2));
process.exit(failCount > 0 ? 1 : 0);
