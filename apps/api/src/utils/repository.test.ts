import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeRepository, repositoryFromId, repositoryIdFor } from './repository.js';

// Verifies that the supported repository input formats normalize consistently.
test('normalizes owner/repository values and GitHub URLs', () => {
  assert.equal(normalizeRepository('octocat/Hello-World'), 'octocat/hello-world');
  assert.equal(normalizeRepository('https://github.com/octocat/Hello-World.git'), 'octocat/hello-world');
  assert.equal(normalizeRepository('https://gitlab.com/octocat/Hello-World'), null);
  assert.equal(normalizeRepository('octocat'), null);
});

// Verifies that repository IDs remain reversible for status polling.
test('round trips stable repository IDs', () => {
  const id = repositoryIdFor('octocat/hello-world');
  assert.equal(repositoryFromId(encodeURIComponent(id)), 'octocat/hello-world');
});

test('rejects encoded path/query injection and malformed repository IDs', () => {
  for (const value of ['owner/../repo', 'owner/repo?token=x', 'owner/repo#issue', 'owner/%2e%2e', 'owner/repo%3fsecret', 'owner/..']) assert.equal(normalizeRepository(value), null);
  assert.equal(repositoryFromId('%zz'), null);
  assert.equal(normalizeRepository('github.com/Octocat/Hello-World'), 'octocat/hello-world');
});
