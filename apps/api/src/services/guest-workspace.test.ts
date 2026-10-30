import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { GuestWorkspaces } from './guest-workspace.js';
import { createRepositoryRouter } from '../routes/repository-routes.js';
import type { IndexingService } from './indexing-service.js';
import type { GraphReader } from '../infrastructure/graph/graph-reader.js';
import type { AskResponse } from '../domain/question.js';

test('guest workspaces isolate repository membership and history while sharing source indexes', async () => {
  const guests = new GuestWorkspaces(false, async req => {
    const id = req.get('X-Test-Account');
    return id ? { id } : undefined;
  });
  const records = new Map<string, { repositoryId: string; jobId: string; status: 'complete'; repository: string }>();
  const indexing = {
    listStatuses: () => [...records.values()],
    getStatus: (id: string) => records.get(id),
    start: (repository: string) => {
      const result = { repositoryId: `github:${repository}`, repository, jobId: 'job', status: 'complete' as const };
      records.set(result.repositoryId, result); return result;
    },
  } as unknown as IndexingService;
  const reader = { getSubgraph: async () => ({ nodes: [], edges: [] }) } as unknown as GraphReader;
  const app = express(); app.use(express.json()); app.use(guests.middleware);
  app.use('/repositories', createRepositoryRouter(indexing, reader, guests));
  app.get('/history', (req, res) => res.json(guests.history(req)));
  app.post('/save', (req, res) => res.json({ saved: guests.save(req, req.body as AskResponse) }));
  app.post('/remove-answer', (req, res) => res.json({ removed: guests.removeAnswer(req, req.body.repositoryId, req.body.answeredAt) }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const a = await fetch(`${base}/repositories`), b = await fetch(`${base}/repositories`);
    const cookieA = a.headers.get('set-cookie')!.split(';')[0], cookieB = b.headers.get('set-cookie')!.split(';')[0];
    assert.notEqual(cookieA, cookieB);
    assert.match(a.headers.get('set-cookie')!, /HttpOnly/i);
    const post = (path: string, cookie: string, body: unknown) => fetch(`${base}${path}`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    await post('/repositories/ingest', cookieA, { repository: 'owner/repo' });
    assert.equal((await fetch(`${base}/repositories`, { headers: { Cookie: cookieA } }).then(r => r.json())).repositories.length, 1);
    assert.equal((await fetch(`${base}/repositories`, { headers: { Cookie: cookieB } }).then(r => r.json())).repositories.length, 0);
    assert.equal((await fetch(`${base}/repositories/github%3Aowner%2Frepo/status`, { headers: { Cookie: cookieB } })).status, 404);
    assert.equal((await fetch(`${base}/repositories/github%3Aowner%2Frepo/graph`, { headers: { Cookie: cookieB } })).status, 404);
    const answer = { repositoryId: 'github:owner/repo', answeredAt: '2026-01-01', question: 'Why?' };
    assert.equal((await post('/save', cookieA, answer).then(r => r.json())).saved, true);
    assert.equal((await post('/save', cookieB, answer).then(r => r.json())).saved, false);
    assert.deepEqual(await fetch(`${base}/history`, { headers: { Cookie: cookieB } }).then(r => r.json()), []);
    await post('/repositories/ingest', cookieB, { repository: 'owner/repo' });
    assert.equal((await post('/repositories/github%3Aowner%2Frepo/remove', cookieA, {}).then(r => r.json())).removed, true);
    assert.deepEqual(await fetch(`${base}/history`, { headers: { Cookie: cookieA } }).then(r => r.json()), []);
    assert.equal((await fetch(`${base}/repositories`, { headers: { Cookie: cookieB } }).then(r => r.json())).repositories.length, 1);
    assert.equal(records.has('github:owner/repo'), true);
    const accountHeaders = { 'X-Test-Account': 'user-a', 'Content-Type': 'application/json', Cookie: cookieB };
    assert.equal((await fetch(`${base}/repositories`, { headers: accountHeaders }).then(r => r.json())).repositories.length, 0);
    assert.deepEqual(await fetch(`${base}/history`, { headers: accountHeaders }).then(r => r.json()), []);
    await fetch(`${base}/repositories/ingest`, { method: 'POST', headers: accountHeaders, body: JSON.stringify({ repository: 'owner/repo' }) });
    await fetch(`${base}/save`, { method: 'POST', headers: accountHeaders, body: JSON.stringify(answer) });
    const otherAccount = { ...accountHeaders, 'X-Test-Account': 'user-b' };
    assert.equal((await fetch(`${base}/repositories`, { headers: otherAccount }).then(r => r.json())).repositories.length, 0);
    assert.deepEqual(await fetch(`${base}/history`, { headers: otherAccount }).then(r => r.json()), []);
    assert.equal((await fetch(`${base}/history`, { headers: accountHeaders }).then(r => r.json())).length, 1);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
