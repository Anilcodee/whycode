import assert from 'node:assert/strict';
import test from 'node:test';
import {
  discussionNumberFromApiUrl,
  extractIssueReferences,
  fileNodeId,
  issueId,
  pullRequestId,
  truncateBody,
} from './graph-ids.js';
import { buildGraphPayloads } from './graph-payloads.js';
import { IndexedSnapshot } from './indexing.js';

// Verifies that graph node identities are stable and scoped to their repository.
test('builds stable, repository-scoped graph identifiers', () => {
  assert.equal(pullRequestId('github:octo/repo', 42), 'github:octo/repo:pull:42');
  assert.equal(issueId('github:octo/repo', 7), 'github:octo/repo:issue:7');
  assert.equal(fileNodeId('github:octo/repo', 'src/app.ts'), 'github:octo/repo:file:src/app.ts');
});

// Verifies issue reference extraction stays bounded and free of duplicates.
test('extracts bounded, unique issue references from text', () => {
  assert.deepEqual(extractIssueReferences('fixes #12 and closes #7 (#12 again)'), [12, 7]);
  assert.deepEqual(extractIssueReferences('no references here'), []);
  assert.deepEqual(extractIssueReferences('#1 #2 #3', 2), [1, 2]);
});

// Verifies discussion numbers parse from GitHub API and HTML URLs.
test('reads discussion numbers from API URLs', () => {
  assert.equal(discussionNumberFromApiUrl('https://api.github.com/repos/o/r/issues/12'), 12);
  assert.equal(discussionNumberFromApiUrl('https://api.github.com/repos/o/r/pulls/34'), 34);
  assert.equal(discussionNumberFromApiUrl('https://github.com/o/r/pull/9#discussion_r1'), 9);
  assert.equal(discussionNumberFromApiUrl(undefined), undefined);
});

// Verifies oversized comment bodies are capped with an explicit truncation flag.
test('truncates oversized comment bodies', () => {
  assert.deepEqual(truncateBody('short'), { body: 'short', bodyTruncated: false });
  const long = truncateBody('a'.repeat(4_100), 4_000);
  assert.equal(long.body.length, 4_000);
  assert.equal(long.bodyTruncated, true);
});

// Builds a representative snapshot covering every relationship the graph should store.
function sampleSnapshot(): IndexedSnapshot {
  return {
    repositoryId: 'github:octo/repo',
    repository: 'octo/repo',
    indexedAt: '2026-10-28T00:00:00.000Z',
    counts: { commits: 2, files: 2, pullRequests: 1, issues: 2, comments: 1, documents: 0 },
    fullName: 'octo/repo',
    repositoryUrl: 'https://github.com/octo/repo',
    defaultBranch: 'main',
    commits: [
      { sha: 'a'.repeat(40), message: 'fix crash on empty input (#1)', authorLogin: 'octo', committedAt: '2026-01-01T00:00:00Z', url: 'https://github.com/octo/repo/commit/a' },
      { sha: 'b'.repeat(40), message: 'add retry limit', authorLogin: 'dev', committedAt: '2026-01-02T00:00:00Z', url: 'https://github.com/octo/repo/commit/b' },
    ],
    pullRequests: [
      { number: 5, title: 'Fix #1: crash on empty input', state: 'closed', authorLogin: 'octo', createdAt: '2026-01-01T01:00:00Z', mergedAt: '2026-01-01T02:00:00Z', mergeCommitSha: 'b'.repeat(40), url: 'https://github.com/octo/repo/pull/5' },
    ],
    issues: [
      { number: 1, title: 'Crash on empty input', state: 'closed', authorLogin: 'tester', createdAt: '2025-12-31T00:00:00Z', closedAt: '2026-01-01T03:00:00Z', url: 'https://github.com/octo/repo/issues/1' },
      { number: 2, title: 'Add telemetry', state: 'open', createdAt: '2026-01-03T00:00:00Z', url: 'https://github.com/octo/repo/issues/2' },
    ],
    comments: [
      { id: 900, body: 'The retry limit matters because requests would grow without bound.'.repeat(200), authorLogin: 'octo', createdAt: '2026-01-01T04:00:00Z', url: 'https://github.com/octo/repo/issues/1#issuecomment-900', sourceType: 'issue_comment', parentNumber: 1 },
    ],
    files: ['src/app.ts', 'README.md'],
    commitFiles: [
      { sha: 'a'.repeat(40), files: ['src/app.ts'] },
      { sha: 'b'.repeat(40), files: ['src/app.ts', 'README.md'] },
    ],
  };
}

// Verifies the snapshot converts into graph rows with correct IDs, links, and provenance candidates.
test('builds graph payloads with relationships from a snapshot', () => {
  const payloads = buildGraphPayloads(sampleSnapshot());

  assert.equal(payloads.repository.repositoryId, 'github:octo/repo');
  assert.equal(payloads.repository.defaultBranch, 'main');
  assert.deepEqual(payloads.people.map((person) => person.login).sort(), ['dev', 'octo', 'tester']);
  assert.equal(payloads.files.length, 2);
  assert.equal(payloads.commits.length, 2);
  assert.equal(payloads.pullRequests[0].id, 'github:octo/repo:pull:5');
  assert.equal(payloads.pullRequests[0].props.mergeCommitSha, 'b'.repeat(40));
  assert.equal(payloads.issues.length, 2);

  assert.equal(payloads.changedFiles.length, 3);
  assert.deepEqual(payloads.pullRequestCommits, [{ id: 'github:octo/repo:pull:5', sha: 'b'.repeat(40) }]);

  assert.deepEqual(payloads.commitReferences, [{ sha: 'a'.repeat(40), issueId: 'github:octo/repo:issue:1' }]);
  assert.deepEqual(payloads.pullRequestReferences, [{ id: 'github:octo/repo:pull:5', issueId: 'github:octo/repo:issue:1' }]);
  assert.deepEqual(payloads.commentParents, [{ id: '900', parentNumber: 1 }]);

  assert.deepEqual(payloads.authoredCommits.map((row) => row.sha).sort(), ['a'.repeat(40), 'b'.repeat(40)]);
  assert.equal(payloads.authoredComments.length, 1);

  const commentProps = payloads.comments[0].props;
  assert.equal(commentProps.bodyTruncated, true);
  assert.equal((commentProps.body as string).length, 4_000);
});

// Verifies references to issues outside the bounded index window are not linked.
test('skips references to issues that were not indexed', () => {
  const snapshot = sampleSnapshot();
  snapshot.commits[0].message = 'reverts #999 which is outside the indexed window';
  const payloads = buildGraphPayloads(snapshot);

  assert.deepEqual(payloads.commitReferences, []);
});

test('preserves bounded discussion rationale and links comments on indexed pull requests', () => {
  const snapshot = sampleSnapshot();
  snapshot.pullRequests[0].body = 'Prevent unbounded requests.';
  snapshot.issues[0].body = 'Why retries must be bounded.';
  snapshot.comments[0].parentNumber = 5;
  const payloads = buildGraphPayloads(snapshot);
  assert.equal(payloads.pullRequests[0].props.body, 'Prevent unbounded requests.');
  assert.equal(payloads.issues[0].props.body, 'Why retries must be bounded.');
  assert.deepEqual(payloads.commentParents, [{ id: '900', parentNumber: 5 }]);
});

test('identical commit SHAs in forks produce separate scoped graph identities', () => {
  const first = sampleSnapshot(); const fork = { ...first, repositoryId: 'github:fork/repo', repository: 'fork/repo' };
  const a = buildGraphPayloads(first); const b = buildGraphPayloads(fork);
  assert.equal(a.commits[0].sha, b.commits[0].sha);
  assert.notEqual(a.commits[0].props.id, b.commits[0].props.id);
  assert.equal(a.commits[0].props.repositoryId, first.repositoryId);
  assert.equal(b.commits[0].props.repositoryId, fork.repositoryId);
});

test('links non-merge commits using GitHub commit-to-PR associations', () => {
  const snapshot = sampleSnapshot(); snapshot.pullRequests[0].mergeCommitSha = undefined;
  snapshot.commitPullRequests = [{ sha: snapshot.commits[0].sha, number: 5 }];
  assert.deepEqual(buildGraphPayloads(snapshot).pullRequestCommits, [{ id: 'github:octo/repo:pull:5', sha: snapshot.commits[0].sha }]);
});
