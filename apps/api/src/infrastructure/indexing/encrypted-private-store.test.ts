import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EncryptedPrivateStore } from './encrypted-private-store.js';
import type { IndexStatus } from '../../domain/indexing.js';

test('private indexes recover only for the same session; disposal prevents late writes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'whycode-private-test-'));
  try {
    const key = randomBytes(32).toString('base64'), expires = Date.now() + 60_000;
    const a = new EncryptedPrivateStore(directory, key, 'account-a:token-a', expires);
    const status: IndexStatus = { repositoryId: 'github:o/private', repository: 'o/private', jobId: 'j', status: 'running', counts: { commits: 0, files: 0, pullRequests: 0, issues: 0, comments: 0, documents: 0 }, progress: { phase: 'Fetching', completed: 1, total: 6 }, warnings: [], errors: [] };
    a.saveStatus(status);
    assert.equal(new EncryptedPrivateStore(directory, key, 'account-b:token-b', expires).listStatuses().length, 0);
    const reopened = new EncryptedPrivateStore(directory, key, 'account-a:token-a', expires);
    assert.equal(reopened.getStatus(status.repositoryId)?.status, 'failed');
    a.dispose();
    a.saveStatus({ ...status, status: 'complete' });
    assert.equal(new EncryptedPrivateStore(directory, key, 'account-a:token-a', expires).listStatuses().length, 0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
