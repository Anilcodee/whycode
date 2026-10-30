import assert from 'node:assert/strict';
import test from 'node:test';
import { Neo4jGraphReader } from './neo4j-graph-reader.js';
import { Neo4jConnection } from './neo4j-connection.js';

const repositoryId = 'github:octo/repo';
const sha = 'a'.repeat(40);
function row(properties: Record<string, unknown>) { return { get: (name: string) => properties[name] }; }
function connection() {
  return {
    session() {
      return {
        async executeRead(read: (tx: unknown) => unknown) {
          return read({ async run(query: string, parameters: Record<string, unknown>) {
            if (query.includes('f.id IN $fileIds')) return { records: [row({ sha, message: 'Bound retries\nAvoid unbounded requests.', date: '2026-01-01', author: 'octo', url: 'https://github.com/octo/repo/commit/a', path: 'client.ts', changeStatus: 'added', patch: '+retry(3)'  })] };
            if (query.includes('CONTAINS_COMMIT')) {
              assert.deepEqual(parameters.shas, [sha]);
              assert.equal(parameters.repositoryId, repositoryId);
              return { records: [row({ number: 5, title: 'Bound retries', body: 'Avoid unbounded requests.', sha, url: 'https://github.com/octo/repo/pull/5' })] };
            }
            if (query.includes('RETURN c.sha AS sha')) return { records: [row({ sha, message: 'Bound retries\nAvoid unbounded requests.', date: '2026-01-01', author: 'octo', url: 'https://github.com/octo/repo/commit/a' })] };
            return { records: [] };
          } });
        },
        async close() {},
      };
    },
  } as unknown as Neo4jConnection;
}
test('file questions expand to commits and pull requests while retaining rationale and metadata', async () => {
  const reader = new Neo4jGraphReader(connection());
  const evidence = await reader.collectEvidence(repositoryId, [{ kind: 'file', key: `${repositoryId}:file:client.ts`, title: 'client.ts', score: 1 }]);
  const commit = evidence.find(item => item.kind === 'commit')!;
  assert.equal(commit.author, 'octo');
  assert.equal(commit.date, '2026-01-01');
  assert.match(commit.url!, /github.com/);
  assert.match(commit.excerpt!, /unbounded requests/);
  assert.match(commit.excerpt!, /File client.ts: added/);
  assert.ok(commit.graphPath.includes('CHANGED'));
  const pr = evidence.find(item => item.kind === 'pull_request')!;
  assert.equal(pr.id, `${repositoryId}:pull:5`);
  assert.match(pr.excerpt!, /unbounded requests/);
});
test('direct commit matches retain source metadata and full message context', async () => {
  const reader = new Neo4jGraphReader(connection());
  const evidence = await reader.collectEvidence(repositoryId, [{ kind: 'commit', key: sha, title: 'Bound retries', score: 1 }]);
  const commit = evidence.find(item => item.kind === 'commit')!;
  assert.equal(commit.author, 'octo');
  assert.match(commit.url!, /commit/);
  assert.match(commit.excerpt!, /unbounded requests/);
});
