// Run from the repository root: node --import tsx scripts/verify-shared-sessions.mjs
// Uses temporary DB namespaces and a mocked identity provider, never a real user login.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import { createApp } from '../apps/api/src/app.ts';
import { createPostgresPool } from '../apps/api/src/infrastructure/postgres.ts';
import { SharedSessions } from '../apps/api/src/infrastructure/shared-sessions.ts';
import { SharedAuthFlows } from '../apps/api/src/infrastructure/shared-auth-flows.ts';

const env = dotenv.parse(readFileSync('.env'));
const namespace = `session-integration-${randomUUID()}`;
const pools = [0,1].map(() => createPostgresPool(env.DATABASE_URL, env.DATABASE_SSL_CA_FILE));
const originalFetch = globalThis.fetch;
const servers = [];
const headers = { 'Content-Type': 'application/json', 'X-WhyCode-Request': '1' };
const config = { port: 4000, clientOrigin: 'http://localhost:5173', githubApiUrl: 'https://api.github.com',
  accounts: { url: 'https://mock-identity.example', key: 'mock-key', providers: ['email','google'] } };
const cookie = response => response.headers.getSetCookie().find(item => item.startsWith('whycode_account='))?.split(';')[0];
try {
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith(config.accounts.url)) return originalFetch(url, init);
    const data = String(url).includes('/token?') ? { access_token: 'mock-test-token', expires_in: 3600 }
      : { id: 'mock-user', email: 'mock@example.com', email_confirmed_at: '2026-01-01' };
    return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const bases = [];
  for (const pool of pools) {
    const server = createApp(config, { sessions: new SharedSessions(pool,namespace,env.SESSION_ENCRYPTION_KEY),
      authFlows: new SharedAuthFlows(pool,namespace,env.SESSION_ENCRYPTION_KEY) }).listen(0,'127.0.0.1');
    servers.push(server);
    await new Promise(resolve => server.once('listening',resolve));
    bases.push(`http://127.0.0.1:${server.address().port}`);
  }
  const login = await fetch(`${bases[0]}/api/account/login`, { method:'POST', headers, body:JSON.stringify({email:'mock@example.com',password:'mock-password'}) });
  assert.equal(login.status,200);
  const loginCookie = cookie(login); assert.ok(loginCookie);
  assert.equal((await fetch(`${bases[1]}/api/account/session`,{headers:{Cookie:loginCookie}}).then(r=>r.json())).user.id,'mock-user');
  assert.equal((await fetch(`${bases[1]}/api/account/logout`,{method:'POST',headers:{...headers,Cookie:loginCookie},body:'{}'})).status,200);
  assert.equal((await fetch(`${bases[0]}/api/account/session`,{headers:{Cookie:loginCookie}}).then(r=>r.json())).user,null);
  const oauth = await fetch(`${bases[0]}/api/account/oauth`,{method:'POST',headers,body:JSON.stringify({provider:'google'})});
  const flowCookie = oauth.headers.getSetCookie().find(item=>item.startsWith('whycode_account_flow='))?.split(';')[0];
  const callback = new URL(new URL((await oauth.json()).url).searchParams.get('redirect_to'));
  const path = callback.pathname+callback.search+'&code=mock-code';
  const finish = await fetch(bases[1]+path,{headers:{Cookie:flowCookie},redirect:'manual'});
  assert.match(finish.headers.get('location'),/account=connected/);
  const oauthCookie = cookie(finish); assert.ok(oauthCookie);
  assert.equal((await fetch(`${bases[0]}/api/account/session`,{headers:{Cookie:oauthCookie}}).then(r=>r.json())).user.id,'mock-user');
  assert.match((await fetch(bases[0]+path,{headers:{Cookie:flowCookie},redirect:'manual'})).headers.get('location'),/account=failed/);
  console.log('PASS: cross-instance login, logout, OAuth callback and replay rejection.');
} catch {
  console.error('Shared-session integration failed; connection credentials and provider tokens withheld.');
  process.exitCode=1;
} finally {
  globalThis.fetch=originalFetch;
  await Promise.all(servers.map(server=>new Promise(resolve=>server.close(resolve))));
  for (const table of ['sessions','auth_flows','session_imports']) await pools[0].query(`DELETE FROM whycode_runtime.${table} WHERE namespace=$1`,[namespace]).catch(()=>{});
  await Promise.all(pools.map(pool=>pool.end()));
}
