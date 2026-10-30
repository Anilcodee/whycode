import { IndexingStore } from '../indexing/indexing-store.js';
import { IndexedSnapshot } from '../../domain/indexing.js';
import { GraphReader, GraphSubgraph, RawEvidence, ResolvedEntity } from './graph-reader.js';
import { fileNodeId, issueId, pullRequestId } from '../../domain/graph-ids.js';

// Private evidence stays in its authenticated session, never in the shared graph database.
export class SnapshotReader implements GraphReader {
  constructor(private readonly store: IndexingStore) {}
  private records(snapshot: IndexedSnapshot): RawEvidence[] {
    const id = snapshot.repositoryId;
    return [
      ...(snapshot.sources ?? []).map(source => ({ kind: source.kind, id: fileNodeId(id, source.path), title: source.path,
        excerpt: source.content.slice(0, 8000), url: source.url, current: true, revision: source.revision,
        relation: 'Pinned source snapshot matching the question', graphPath: [fileNodeId(id, source.path)] })),
      ...snapshot.commits.map(commit => ({ kind: 'commit' as const, id: `commit:${commit.sha}`, title: commit.message.split('\n')[0],
        excerpt: commit.message.slice(0, 4000), url: commit.url, author: commit.authorLogin, date: commit.committedAt,
        relation: 'Commit matching the question', graphPath: [`commit:${commit.sha}`] })),
      ...snapshot.pullRequests.map(pr => ({ kind: 'pull_request' as const, id: pullRequestId(id, pr.number), title: pr.title,
        excerpt: pr.body?.slice(0, 4000), url: pr.url, author: pr.authorLogin, date: pr.createdAt, state: pr.state,
        relation: 'Pull request matching the question', graphPath: [pullRequestId(id, pr.number)] })),
      ...snapshot.issues.map(issue => ({ kind: 'issue' as const, id: issueId(id, issue.number), title: issue.title,
        excerpt: issue.body?.slice(0, 4000), url: issue.url, author: issue.authorLogin, date: issue.createdAt, state: issue.state,
        relation: 'Issue matching the question', graphPath: [issueId(id, issue.number)] })),
      ...snapshot.comments.map(comment => ({ kind: 'comment' as const, id: `${id}:comment:${comment.id}`, title: `Discussion comment by ${comment.authorLogin ?? 'contributor'}`,
        excerpt: comment.body.slice(0, 4000), url: comment.url, author: comment.authorLogin, date: comment.createdAt,
        relation: 'Comment matching the question', graphPath: [`${id}:comment:${comment.id}`] })),
    ];
  }
  async resolveEntities(id: string, tokens: string[]): Promise<ResolvedEntity[]> {
    const snapshot = await this.store.getSnapshot(id); if (!snapshot || !tokens.length) return [];
    return this.records(snapshot).map(record => ({ kind: record.kind === 'file' || record.kind === 'document' ? 'file' as const : record.kind === 'commit' ? 'commit' as const : 'discussion' as const,
      key: record.id, title: record.title, matchedTerms: tokens,
      score: tokens.reduce((score, token) => score + (record.title.toLowerCase().includes(token) ? 6 : record.id.toLowerCase().includes(token) ? 3 : record.excerpt?.toLowerCase().includes(token) ? 1 : 0), 0) }))
      .filter(entity => entity.score > 0).sort((a, b) => b.score - a.score).slice(0, 10);
  }
  async collectEvidence(id: string, entities: ResolvedEntity[]): Promise<RawEvidence[]> {
    const snapshot = await this.store.getSnapshot(id); if (!snapshot) return [];
    const records = this.records(snapshot), selected = new Map<string, RawEvidence>();
    for (const entity of entities) { const record = records.find(item => item.id === entity.key); if (record) selected.set(record.id, record); }
    const add = (key: string, relation: string, graphPath: string[]) => {
      const record = records.find(item => item.id === key); if (record && !selected.has(key)) selected.set(key, { ...record, relation, graphPath });
    };
    for (const file of snapshot.commitFiles) for (const path of file.files) {
      const fileId = fileNodeId(id, path), commitId = `commit:${file.sha}`;
      if (selected.has(fileId)) add(commitId, `Commit touching ${path}`, [fileId, 'CHANGED', commitId]);
      if (selected.has(commitId)) add(fileId, `Current source for a changed path (${path})`, [commitId, 'CHANGED', fileId]);
    }
    for (const link of snapshot.commitPullRequests ?? []) {
      const prId = pullRequestId(id, link.number), commitId = `commit:${link.sha}`;
      if (selected.has(commitId)) add(prId, 'GitHub associates this pull request with the commit', [commitId, 'CONTAINS_COMMIT', prId]);
    }
    for (const comment of snapshot.comments) {
      const parent = records.find(item => (item.kind === 'issue' || item.kind === 'pull_request') && item.id.endsWith(`:${comment.parentNumber}`));
      if (parent && selected.has(parent.id)) add(`${id}:comment:${comment.id}`, 'Comment on the matching discussion', [parent.id, 'ON', `${id}:comment:${comment.id}`]);
    }
    return [...selected.values()].slice(0, 24);
  }
  async getSubgraph(id: string, focus?: string): Promise<GraphSubgraph> {
    const snapshot = await this.store.getSnapshot(id); if (!snapshot) return { nodes: [], edges: [] };
    const records = this.records(snapshot);
    const selected = focus ? await this.collectEvidence(id, [{ kind: 'file', key: focus, title: '', score: 1 }]) : records.slice(0, 60);
    const nodes: GraphSubgraph['nodes'] = [{ id, type: 'repository', label: snapshot.repository }, ...selected.map(record => ({ id: record.id,
      type: record.kind === 'document' ? 'file' as const : record.kind, label: record.title, url: record.url }))];
    return { nodes, edges: selected.map(record => ({ from: id, to: record.id, type: 'CONTAINS' })), focus };
  }
}
