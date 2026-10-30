import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { FileIndexingStore } from './file-indexing-store.js';
import { IndexStatus, IndexedSnapshot } from '../../domain/indexing.js';
function temporary() { return mkdtempSync(join(tmpdir(), 'whycode-test-')); }
function cleanup(path: string) { assert.ok(resolve(path).startsWith(resolve(tmpdir()) + sep)); rmSync(path, { recursive: true, force: true }); }
const status: IndexStatus = { repositoryId: 'github:o/r', repository: 'o/r', jobId: 'job', status: 'complete', counts: { commits: 1, files: 1, pullRequests: 0, issues: 0, comments: 0, documents: 0 }, progress: { phase: 'Complete', completed: 6, total: 6 }, warnings: [], errors: [] };
test('completed indexes and snapshots survive reopening the store', () => {
  const directory = temporary();
  try {
    const first = new FileIndexingStore(directory); first.saveStatus(status);
    const snapshot: IndexedSnapshot = { repositoryId: status.repositoryId, repository: status.repository, indexedAt: new Date().toISOString(), counts: status.counts, commits: [], files: [], commitFiles: [], pullRequests: [], issues: [], comments: [] };
    first.saveSnapshot(snapshot); const second = new FileIndexingStore(directory);
    assert.deepEqual(second.getStatus(status.repositoryId), status); assert.deepEqual(second.getSnapshot(status.repositoryId), snapshot);
  } finally { cleanup(directory); }
});
test('interrupted jobs become retryable failures after a restart', () => {
  const directory = temporary();
  try { new FileIndexingStore(directory).saveStatus({ ...status, status: 'running' }); const reopened = new FileIndexingStore(directory); assert.equal(reopened.getStatus(status.repositoryId)?.status, 'failed'); assert.match(reopened.getStatus(status.repositoryId)!.errors[0], /interrupted/); }
  finally { cleanup(directory); }
});
test('answer budget persists across restarts', () => {
  const directory = temporary();
  try { assert.equal(new FileIndexingStore(directory).reserveAnswer(1), true); assert.equal(new FileIndexingStore(directory).reserveAnswer(1), false); }
  finally { cleanup(directory); }
});
test('restart requeues recorded jobs but stops recovery after three attempts', () => {
  const directory = temporary();
  try {
    const request = { limits: { commits: 25, pullRequests: 0, issues: 0, comments: 0 }, append: false, recoveries: 0 };
    new FileIndexingStore(directory).saveStatus({ ...status, status: 'running', request });
    const reopened = new FileIndexingStore(directory);
    assert.equal(reopened.getStatus(status.repositoryId)?.status, 'queued');
    reopened.saveStatus({ ...status, status: 'running', request: { ...request, recoveries: 3 } });
    assert.equal(new FileIndexingStore(directory).getStatus(status.repositoryId)?.status, 'failed');
  } finally { cleanup(directory); }
});

test('status cache isolates caller mutations and keeps durable records consistent', () => {
  const directory = temporary();
  try {
    const store = new FileIndexingStore(directory);
    const input = structuredClone(status);
    store.saveStatus(input);
    input.errors.push('Mutated input');
    store.getStatus(status.repositoryId)!.errors.push('Mutated read');
    store.listStatuses()[0].counts.commits = 999;
    assert.deepEqual(store.getStatus(status.repositoryId), status);
    assert.deepEqual(new FileIndexingStore(directory).getStatus(status.repositoryId), status);
    assert.equal(store.getStatus('missing'), undefined);
  } finally { cleanup(directory); }
});

test('status index sorts newest first and updates existing entries without duplication', () => {
  const directory = temporary();
  try {
    const store = new FileIndexingStore(directory);
    store.saveStatus({ ...status, startedAt: '2026-01-01' });
    store.saveStatus({ ...status, repositoryId: 'github:o/new', startedAt: '2026-02-01' });
    store.saveStatus({ ...status, startedAt: '2026-03-01' });
    assert.deepEqual(store.listStatuses().map(item => item.repositoryId), [status.repositoryId, 'github:o/new']);
    assert.equal(store.listStatuses().length, 2);
  } finally { cleanup(directory); }
});
