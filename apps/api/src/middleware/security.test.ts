import assert from 'node:assert/strict';
import test from 'node:test';
import { AddressInfo } from 'node:net';
import { request as httpRequest } from 'node:http';
import { createApp, type AppDependencies } from '../app.js';
import { AppConfig } from '../config.js';
const config: AppConfig = { port: 4000, clientOrigin: 'http://localhost:5173', githubApiUrl: 'https://api.github.com' };
async function fixture(run: (base: string) => Promise<void>, overrides: Partial<AppConfig> = {}, dependencies:AppDependencies={}) {
  const server = createApp({ ...config, ...overrides },dependencies).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try { await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); }
  finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
const headers = { 'Content-Type': 'application/json', 'X-WhyCode-Request': '1' };

test('health coalesces concurrent graph probes and caches their result', async () => {
  let probes=0;
  const neo4j={verifyConnectivity:async()=>{probes++;await new Promise(resolve=>setTimeout(resolve,20));}} as NonNullable<AppDependencies['neo4j']>;
  await fixture(async base=> {
    const results=await Promise.all(Array.from({length:6},()=>fetch(`${base}/api/health`).then(r=>r.json())));
    assert.ok(results.every(result=>result.dependencies.database==='connected'));
    await fetch(`${base}/api/health`);
    assert.equal(probes,1);
  },{}, {neo4j});
});

test('crawler endpoints return directives and XML rather than the application shell', async()=>fixture(async base=> {
  const robots=await fetch(`${base}/robots.txt`);assert.match(robots.headers.get('content-type')!,/text\/plain/);
  assert.match(await robots.text(),/Disallow: \/workspace/);
  const sitemap=await fetch(`${base}/sitemap.xml`);assert.match(sitemap.headers.get('content-type')!,/application\/xml/);
  const xml=await sitemap.text();assert.match(xml,/<loc>http:\/\/localhost:5173\/help<\/loc>/);assert.doesNotMatch(xml,/<loc>[^<]*\/workspace/);
}));

test('replicas share login limits while session checks keep a separate budget', async () => {
  const original = globalThis.fetch;
  const counters = new Map<string, number>();
  globalThis.fetch = async (url, init) => {
    if (String(url) !== 'https://limits.example/') return original(url, init);
    const command = JSON.parse(String(init?.body)) as string[];
    assert.equal(command[0], 'EVAL');
    assert.ok(!command[3].includes('127.0.0.1'));
    const count = (counters.get(command[3]) ?? 0) + 1;
    counters.set(command[3], count);
    return new Response(JSON.stringify({ result: [count, 60000] }), { status: 200 });
  };
  const sharedRateLimits = { url: 'https://limits.example/', token: 'test-secret', namespace: 'test' };
  try {
    await fixture(async first => fixture(async second => {
      for (const base of [first, second, first, second, first]) {
        assert.equal((await fetch(`${base}/api/account/login`, { method: 'POST', headers, body: JSON.stringify({ email: 'a@example.com', password: 'test' }) })).status, 503);
      }
      assert.equal((await fetch(`${second}/api/account/login`, { method: 'POST', headers, body: JSON.stringify({ email: 'a@example.com', password: 'test' }) })).status, 429);
      assert.equal((await fetch(`${second}/api/account/session`)).status, 200);
    }, { sharedRateLimits }), { sharedRateLimits });
    let failedCalls=0;
    globalThis.fetch = async (url, init) => {
      if(String(url)!=='https://limits.example/')return original(url,init);
      failedCalls++;return new Response('',{status:503});
    };
    await fixture(async base => {
      const read=await fetch(`${base}/api/account/session`);
      assert.equal(read.status,200);assert.equal(read.headers.get('x-whycode-rate-limit'),'degraded');
      assert.equal(failedCalls,4);
      assert.equal((await fetch(`${base}/api/account/session`)).status,200);assert.equal(failedCalls,4);
      assert.equal((await fetch(`${base}/api/account/login`,{method:'POST',headers,body:'{}'})).status,503);
      assert.equal((await fetch(`${base}/api/account/callback?code=fake`)).status,503);
      const health=await fetch(`${base}/api/health`);assert.equal(health.status,200);
      assert.equal((await health.json()).dependencies.rateLimitStore,'unreachable');
      assert.equal(failedCalls,8);
    }, { sharedRateLimits });
  } finally { globalThis.fetch = original; }
});

test('public repositories need no shared credential and legacy password configuration cannot enable a gate', async () => fixture(async base => {
  assert.equal((await fetch(`${base}/api/repositories`)).status, 200);
  const session = await fetch(`${base}/api/auth/session`);
  assert.deepEqual(await session.json(), { required: false, authenticated: true });
  assert.equal(session.headers.get('set-cookie'), null);
}, { ...({ password: 'obsolete-workspace-password' } as object) }));

test('shared login/logout endpoints are removed while private repositories still require account access', async () => fixture(async base => {
  for (const path of ['/api/auth/login', '/api/auth/logout']) {
    assert.equal((await fetch(`${base}${path}`, { method: 'POST', headers, body: '{}' })).status, 404);
  }
  assert.equal((await fetch(`${base}/api/private/repositories`)).status, 403);
  assert.equal((await fetch(`${base}/api/private/ask`, { method: 'POST', headers, body: '{}' })).status, 403);
}));

test('rejects cross-site mutations, missing request headers, and rebound hosts', async () => fixture(async base => {
  assert.equal((await fetch(`${base}/api/repositories/validate`, { method: 'POST', headers: { ...headers, Origin: 'https://attacker.example' }, body: '{}' })).status, 403);
  assert.equal((await fetch(`${base}/api/repositories/validate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  const rebound = await new Promise<number>(resolve => { const req = httpRequest(`${base}/api/health`, { headers: { Host: 'attacker.example' } }, response => { response.resume(); resolve(response.statusCode!); }); req.end(); });
  assert.equal(rebound, 403);
}));

test('returns safe JSON errors for malformed and oversized input', async () => fixture(async base => {
  const malformed = await fetch(`${base}/api/repositories/validate`, { method: 'POST', headers, body: '{broken' }); assert.equal(malformed.status, 400); assert.ok((await malformed.json()).error.message);
  const oversized = await fetch(`${base}/api/repositories/validate`, { method: 'POST', headers, body: JSON.stringify({ repository: 'x'.repeat(40_000) }) }); assert.equal(oversized.status, 413); assert.ok((await oversized.json()).error.message);
}));

test('anonymous public access retains request limits and security headers', async () => fixture(async base => {
  const health = await fetch(`${base}/api/health`);
  assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(health.headers.get('x-frame-options'), 'DENY');
  assert.match(health.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
  assert.equal(health.headers.get('x-powered-by'), null);
  for (let n = 0; n < 180; n++) assert.equal((await fetch(`${base}/api/repositories`)).status, 200);
  const limited = await fetch(`${base}/api/repositories`);
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get('retry-after'));
}));

test('production requires HTTPS but does not require a shared password', async () => fixture(async base => {
  assert.equal((await fetch(`${base}/api/auth/session`)).status, 426);
  const response = await new Promise<{ status: number; hsts?: string; body: string }>(resolve => {
    const req = httpRequest(`${base}/api/auth/session`, { headers: { Host: 'workspace.example', 'X-Forwarded-Proto': 'https' } }, res => {
      let body = ''; res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode!, hsts: res.headers['strict-transport-security'], body }));
    }); req.end();
  });
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), { required: false, authenticated: true });
  assert.ok(response.hsts);
}, { production: true, publicOrigin: 'https://workspace.example', trustProxy: true }));
