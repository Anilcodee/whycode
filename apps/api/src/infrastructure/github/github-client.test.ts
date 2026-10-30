import assert from 'node:assert/strict';
import test from 'node:test';
import { GitHubClient, GitHubApiError, isIndexablePath, extractSymbols } from './github-client.js';

test('a conflict fetching initial commits explains that the repository may be empty', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}', { status: 409 });
  try {
    await assert.rejects(new GitHubClient('https://api.github.com').listCommitWindow('owner/repo', 25),
      (error: unknown) => error instanceof GitHubApiError && error.status === 409 && /first commit/.test(error.message));
  } finally { globalThis.fetch = original; }
});

test('rejects private repositories before any history is collected', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ private: true, full_name: 'owner/private', default_branch: 'main', html_url: 'https://github.com/owner/private' }));
  try {
    await assert.rejects(new GitHubClient('https://api.github.com').getRepository('owner/private'), (error: unknown) => error instanceof GitHubApiError && error.status === 400);
  } finally { globalThis.fetch = original; }
});
test('retains pull request and issue descriptions for rationale retrieval', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify([{ number: 1, title: 'Bound retries', body: 'Prevent unbounded requests', state: 'closed', created_at: '2026-01-01', html_url: 'https://github.com/o/r/issues/1' }]));
  try {
    const client = new GitHubClient('https://api.github.com');
    assert.equal((await client.listIssues('o/r', 1))[0].body, 'Prevent unbounded requests');
    assert.equal((await client.listPullRequests('o/r', 1))[0].body, 'Prevent unbounded requests');
  } finally { globalThis.fetch = original; }
});

test('source indexing excludes credential and generated paths and extracts symbol hints', () => {
  for (const path of ['.env', 'config/secrets.yaml', 'node_modules/lib/app.js', 'dist/app.js', 'key.pem', 'bundle.min.js', '.aws/credentials']) assert.equal(isIndexablePath(path), false, path);
  assert.equal(isIndexablePath('src/client.ts'), true); assert.equal(isIndexablePath('docs/architecture.md'), true);
  assert.deepEqual(extractSymbols('export function retry() {} class Client {} const timeout = 3;'), ['retry', 'Client', 'timeout']);
});
