import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRepositoryTree, repositoryPath } from '../src/lib/repository-tree';

const graph = { nodes: [
  { id: 'repo', type: 'repository', label: 'Repository' },
  { id: 'commit', type: 'commit', label: 'First change' },
  { id: 'file', type: 'file', label: 'README' },
  { id: 'author', type: 'person', label: 'Author' },
], edges: [
  { from: 'repo', to: 'commit', type: 'CONTAINS' },
  { from: 'author', to: 'commit', type: 'AUTHORED' },
  { from: 'commit', to: 'file', type: 'CHANGED' },
] };
test('highlights the entire root-to-file route without removing other sources', () => {
  const tree = buildRepositoryTree(graph);
  assert.deepEqual(repositoryPath(tree, 'file'), { ids: ['repo', 'commit', 'file'], edges: [0, 2], rooted: true });
  assert.equal(tree.positions.size, 4);
  const before = [...tree.positions];
  repositoryPath(tree, 'author');
  assert.deepEqual([...tree.positions], before);
});
test('connects authors through reverse traversal without changing relationship direction', () => {
  const tree = buildRepositoryTree(graph);
  assert.deepEqual(repositoryPath(tree, 'author').ids, ['repo', 'commit', 'author']);
  assert.equal(tree.parent.get('author')?.edge, 1);
  assert.equal(graph.edges[1].from, 'author');
});
test('cycles and dangling edges cannot duplicate positions or cause an infinite path', () => {
  const tree = buildRepositoryTree({ ...graph, edges: [...graph.edges,
    { from: 'file', to: 'repo', type: 'RELATED' }, { from: 'repo', to: 'missing', type: 'CONTAINS' }] });
  assert.equal(tree.positions.size, 4);
  assert.ok(repositoryPath(tree, 'file').ids.length <= 4);
});
test('disconnected sources stay visible without inventing a repository connection', () => {
  const tree = buildRepositoryTree({ ...graph, nodes: [...graph.nodes, { id: 'isolated', type: 'issue', label: 'Unlinked' }] });
  assert.equal(tree.positions.size, 5);
  assert.equal(repositoryPath(tree, 'isolated').rooted, false);
  const rectangles = [...tree.positions.values()];
  for (let i = 0; i < rectangles.length; i++) for (let j = i + 1; j < rectangles.length; j++) {
    assert.ok(Math.abs(rectangles[i].x - rectangles[j].x) >= 210 || Math.abs(rectangles[i].y - rectangles[j].y) >= 90);
  }
});
