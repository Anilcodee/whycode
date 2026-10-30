import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clearWorkspaceHistory, isSavedAnswer, restoreWorkspaceHistory, saveWorkspaceHistory, WORKSPACE_STORAGE_KEY } from '../src/lib/workspace-history';
import type { Answer } from '../src/types/workspace';

const answer: Answer = {
  repositoryId: 'github:example/repo', question: 'What changed?', answer: 'A file changed.', abstained: false,
  evidence: [{ id: 'a', type: 'commit', title: 'Change', relationToAnswer: 'Recorded change', graphPath: [] }],
  citedEvidenceIds: ['a'], confidence: { label: 'supported', reason: 'Source matches.' }, temporalStatus: 'historical',
  answeredAt: '2026-10-29T00:00:00Z', warnings: [], decisionTimeline: [],
};
function storage(initial: string | null = null) {
  let content = initial;
  return {
    getItem(key: string) { assert.equal(key, WORKSPACE_STORAGE_KEY); return content; },
    setItem(key: string, value: string) { assert.equal(key, WORKSPACE_STORAGE_KEY); content = value; },
    removeItem(key: string) { assert.equal(key, WORKSPACE_STORAGE_KEY); content = null; },
  };
}

test('public history preserves the existing key, selection and records, and can be cleared', () => {
  const target = storage();
  saveWorkspaceHistory(false, answer.repositoryId, [answer], target);
  assert.deepEqual(restoreWorkspaceHistory(false, target), { selected: answer.repositoryId, history: [answer] });
  clearWorkspaceHistory(target);
  assert.equal(restoreWorkspaceHistory(false, target), null);
});

test('private history never accesses storage, even when browser storage is absent', () => {
  const blocked = {
    getItem() { throw new Error('must not read'); }, setItem() { throw new Error('must not write'); },
    removeItem() { throw new Error('must not clear'); },
  };
  assert.equal(restoreWorkspaceHistory(true, blocked), null);
  saveWorkspaceHistory(true, answer.repositoryId, [answer], blocked);
  assert.equal(restoreWorkspaceHistory(true), null);
  saveWorkspaceHistory(true, answer.repositoryId, [answer]);
});

test('malformed nested records are discarded while valid history survives', () => {
  const malformed = [
    { ...answer, answer: {} }, { ...answer, confidence: {} }, { ...answer, evidence: [null] },
    { ...answer, evidence: [{ ...answer.evidence[0], title: {} }] },
    { ...answer, decisionTimeline: [{ title: 'Missing identity' }] },
    { ...answer, validation: { status: 'checked', reason: 'reviewed', claims: [{ text: 'claim', evidenceIds: [], quotes: [null] }] } },
    { ...answer, externalContext: [{ title: 'Incomplete link' }] }, null,
  ];
  for (const item of malformed) assert.equal(isSavedAnswer(item), false);
  assert.deepEqual(restoreWorkspaceHistory(false, storage(JSON.stringify({ history: [...malformed, answer] })))?.history, [answer]);
});

test('history bounds prevent oversized writes from replacing a valid snapshot', () => {
  const target = storage();
  saveWorkspaceHistory(false, null, Array.from({ length: 30 }, () => answer), target);
  assert.equal(restoreWorkspaceHistory(false, target)?.history.length, 20);
  const previous = target.getItem(WORKSPACE_STORAGE_KEY);
  assert.throws(() => saveWorkspaceHistory(false, null, [{ ...answer, answer: 'x'.repeat(2_000_000) }], target), /storage budget/);
  assert.equal(target.getItem(WORKSPACE_STORAGE_KEY), previous);
  assert.equal(restoreWorkspaceHistory(false, storage('x'.repeat(2_000_000))), null);
});

test('malformed containers cannot become workspace state', () => {
  for (const content of [null, '', 'null', '[]', 'true']) assert.equal(restoreWorkspaceHistory(false, storage(content)), null);
  assert.deepEqual(restoreWorkspaceHistory(false, storage('{"selected":{},"history":{}}')), { selected: null, history: [] });
  assert.throws(() => restoreWorkspaceHistory(false, storage('{broken')));
});

test('storage failures propagate to the existing UI recovery notices', () => {
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('blocked'); } };
  assert.throws(() => restoreWorkspaceHistory(false, blocked), /blocked/);
  assert.throws(() => saveWorkspaceHistory(false, null, [], blocked), /quota/);
  assert.throws(() => clearWorkspaceHistory(blocked), /blocked/);
});
