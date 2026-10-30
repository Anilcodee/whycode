import assert from 'node:assert/strict';
import test from 'node:test';
import { AccountWorkspaceStore } from './account-workspace-store.js';
import type { AppConfig } from '../config.js';
import type { AccountSession } from '../services/account-service.js';
import type { AskResponse } from '../domain/question.js';

const config: AppConfig = { port: 4000, clientOrigin: 'http://localhost:5173', githubApiUrl: 'https://api.github.com', accounts: { url: 'https://identity.example', key: 'public-key', providers: ['email'] } };
const session: AccountSession = { user: { id: 'user-a', email: 'a@example.com' }, accessToken: 'user-jwt', expires: Date.now() + 60_000 };
const answer = { repositoryId: 'github:owner/repo', answeredAt: '2026-01-01T00:00:00Z', question: 'Why?' } as AskResponse;

test('account storage uses the verified user token and preserves visibility and deletion filters', async () => {
  const original = globalThis.fetch;
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (init?.method === 'POST') return new Response(JSON.stringify([{ id: '11111111-1111-4111-8111-111111111111' }]));
    if (init?.method === 'DELETE') return new Response(JSON.stringify([{ id: '11111111-1111-4111-8111-111111111111' }]));
    return new Response(JSON.stringify([{ id: '11111111-1111-4111-8111-111111111111', payload: answer }]));
  };
  try {
    const store = new AccountWorkspaceStore(config);
    const id = await store.save(session, 'private', answer);
    assert.equal(id, '11111111-1111-4111-8111-111111111111');
    assert.equal((await store.list(session, 'private'))[0].savedId, id);
    await store.removeRepository(session, 'private', 'github:owner/repo');
    await store.remove(session, id);
    assert.ok(calls.every(call => (call.init?.headers as Record<string, string>).Authorization === 'Bearer user-jwt'));
    assert.ok(calls.every(call => (call.init?.headers as Record<string, string>).apikey === 'public-key'));
    assert.equal(JSON.parse(String(calls[0].init?.body)).visibility, 'private');
    assert.match(calls[2].url, /rpc\/whycode_remove_repository$/);
    assert.deepEqual(JSON.parse(String(calls[2].init?.body)), { p_visibility: 'private', p_repository_id: 'github:owner/repo' });
    await assert.rejects(store.remove(session, 'invalid&user_id=eq.other'), /INVALID_ID/);
    assert.equal(calls.length, 4);
  } finally { globalThis.fetch = original; }
});

test('account storage fails closed when Supabase is unavailable', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}', { status: 503 });
  try { await assert.rejects(new AccountWorkspaceStore(config).list(session, 'public'), /WORKSPACE_UNAVAILABLE/); }
  finally { globalThis.fetch = original; }
});

test('empty minimal responses are accepted and deleting a missing row is reported', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => init?.method === 'DELETE' ? new Response('[]') : new Response(null, { status: 201 });
  try {
    const store = new AccountWorkspaceStore(config);
    await store.addRepository(session, 'public', 'github:owner/repo', 'owner/repo');
    await assert.rejects(store.remove(session, '11111111-1111-4111-8111-111111111111'), /NOT_FOUND/);
  } finally { globalThis.fetch = original; }
});
