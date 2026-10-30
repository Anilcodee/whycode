import { Record as Neo4jRecord } from 'neo4j-driver';
import {
  asNumber,
  asString,
  Neo4jConnection,
} from './neo4j-connection.js';
import {
  GraphEdge,
  GraphNode,
  GraphReader,
  GraphSubgraph,
  RawEvidence,
  ResolvedEntity,
} from './graph-reader.js';
import { fileNodeId, pullRequestId } from '../../domain/graph-ids.js';

// Caps evidence volume; individual Cypher LIMIT clauses bound each traversal lane.
const MAX_EVIDENCE = 24;

const RESOLVE_FILES = `
  MATCH (f:File { repositoryId: $repositoryId })
  WITH f, reduce(score = 0, t IN $tokens | score + CASE
    WHEN toLower(f.path) CONTAINS t THEN 6
    WHEN any(symbol IN coalesce(f.symbols, []) WHERE toLower(symbol) = t) THEN 8
    WHEN f.current = true AND size(t) >= 4 AND toLower(coalesce(f.content, '')) CONTAINS t THEN 1
    ELSE 0 END) AS score
  WHERE score > 0
  RETURN f.id AS id, f.path AS title, score
  ORDER BY score DESC, title LIMIT 5
`;

const RESOLVE_COMMITS = `
  MATCH (c:ScopedCommit { repositoryId: $repositoryId })
  WHERE any(t IN $tokens WHERE (toLower(c.message) CONTAINS t OR (size(t) >= 7 AND c.sha STARTS WITH t)))
  WITH c, size([t IN $tokens WHERE (toLower(c.message) CONTAINS t OR (size(t) >= 7 AND c.sha STARTS WITH t))]) AS score
  RETURN c.sha AS id, left(c.message, 140) AS title, score
  ORDER BY score DESC LIMIT 5
`;

const RESOLVE_DISCUSSIONS = `
  MATCH (d:Discussion { repositoryId: $repositoryId })
  WHERE any(t IN $tokens WHERE toLower(d.title) CONTAINS t OR toLower(coalesce(d.body, '')) CONTAINS t OR toString(d.number) = t)
  WITH d, size([t IN $tokens WHERE toLower(d.title) CONTAINS t OR toLower(coalesce(d.body, '')) CONTAINS t OR toString(d.number) = t]) AS score
  RETURN d.id AS id, d.title AS title, score
  ORDER BY score DESC LIMIT 5
`;

const RESOLVE_DISCUSSIONS_BY_COMMENT = `
  MATCH (m:Comment { repositoryId: $repositoryId })-[:ON]->(d:Discussion { repositoryId: $repositoryId })
  WHERE any(t IN $tokens WHERE toLower(m.body) CONTAINS t)
  WITH DISTINCT d, count(m) AS score
  RETURN d.id AS id, d.title AS title, CASE WHEN score < 3 THEN score ELSE 3 END AS capped
  ORDER BY capped DESC LIMIT 3
`;

const COMMITS_FOR_FILES = `
  MATCH (f:File)-[change:CHANGED]-(c:ScopedCommit)
  WHERE f.id IN $fileIds AND c.repositoryId = $repositoryId
  RETURN DISTINCT c.sha AS sha, c.message AS message, c.authorLogin AS author,
                  c.committedAt AS date, c.url AS url, f.path AS path, change.status AS changeStatus, change.patch AS patch
  ORDER BY date DESC LIMIT 12
`;

const FILE_DETAILS = `
  MATCH (f:File {repositoryId: $repositoryId, current: true})
  WHERE f.id IN $fileIds
  RETURN f.id AS id, f.path AS path, f.content AS content, f.kind AS kind, f.url AS url, f.revision AS revision, f.symbols AS symbols
  LIMIT 5
`;

const COMMIT_DETAILS = `
  MATCH (c:ScopedCommit { repositoryId: $repositoryId })
  WHERE c.sha IN $shas
  RETURN c.sha AS sha, c.message AS message, c.authorLogin AS author,
         c.committedAt AS date, c.url AS url
`;

const PULL_REQUESTS_FOR_COMMITS = `
  MATCH (p:PullRequest)-[:CONTAINS_COMMIT]->(c:ScopedCommit)
  WHERE c.sha IN $shas AND p.repositoryId = $repositoryId
  RETURN DISTINCT p.number AS number, p.title AS title, p.state AS state,
                  p.authorLogin AS author, p.createdAt AS date, p.url AS url, p.body AS body, c.sha AS sha
  ORDER BY date DESC LIMIT 8
`;

const DISCUSSION_DETAILS = `
  MATCH (d:Discussion)
  WHERE d.id IN $discussionIds
  RETURN d.id AS id, d.number AS number, d.title AS title, d.state AS state,
         d.authorLogin AS author, d.createdAt AS date, d.url AS url, d.body AS body,
         'PullRequest' IN labels(d) AS isPullRequest
`;

const ISSUES_REFERENCED_BY_COMMITS = `
  MATCH (c:ScopedCommit)-[r:REFERENCES]->(i:Issue)
  WHERE (c.sha IN $shas OR i.id IN $issueIds) AND i.repositoryId = $repositoryId AND c.repositoryId = $repositoryId
  RETURN DISTINCT c.sha AS sha, c.message AS commitMessage, c.authorLogin AS commitAuthor, c.committedAt AS commitDate, c.url AS commitUrl, i.number AS number, i.title AS title, i.state AS state,
                  i.authorLogin AS author, i.createdAt AS date, i.url AS url, i.body AS body,
                  r.extractionMethod AS method, i.id AS issueId
  LIMIT 8
`;

const ISSUES_REFERENCED_BY_PULL_REQUESTS = `
  MATCH (p:PullRequest)-[r:REFERENCES]->(i:Issue)
  WHERE p.id IN $prIds OR i.id IN $issueIds
  RETURN DISTINCT p.number AS prNumber, i.number AS number, i.title AS title, i.state AS state,
                  i.authorLogin AS author, i.createdAt AS date, i.url AS url, i.body AS body,
                  r.extractionMethod AS method, i.id AS issueId
  LIMIT 8
`;

const COMMENTS_FOR_DISCUSSIONS = `
  MATCH (m:Comment)-[:ON]->(d:Discussion)
  WHERE d.id IN $discussionIds
  RETURN DISTINCT m.id AS id, m.body AS body, m.authorLogin AS author, m.createdAt AS date,
                  m.url AS url, d.id AS discussionId, d.title AS discussionTitle
  ORDER BY date DESC LIMIT 10
`;

// One hop around a focused node; Persons are repo-agnostic and allowed as neighbors.
const SUBGRAPH_EDGES = `
  MATCH (n)-[rel]-(m)
  WHERE (n.repositoryId = $repositoryId OR (n:Person AND EXISTS {
      MATCH (n)-[:AUTHORED]->(owned) WHERE owned.repositoryId = $repositoryId
    }))
    AND ((n:ScopedCommit AND n.sha = $key) OR (n.id = $key)
      OR (n:Repository AND n.repositoryId = $key) OR (n:Person AND n.login = $key))
    AND (m.repositoryId = $repositoryId OR m:Person)
  RETURN n, rel, m
  LIMIT 60
`;

const SUBGRAPH_FOCUS_NODE = `
  MATCH (n)
  WHERE (n.repositoryId = $repositoryId OR (n:Person AND EXISTS {
      MATCH (n)-[:AUTHORED]->(owned) WHERE owned.repositoryId = $repositoryId
    }))
    AND ((n:ScopedCommit AND n.sha = $key) OR (n.id = $key)
      OR (n:Repository AND n.repositoryId = $key) OR (n:Person AND n.login = $key))
  RETURN n
  LIMIT 1
`;

// Overview: the repository, its latest commits, their authors, and touched files.
const SUBGRAPH_OVERVIEW = `
  MATCH (r:Repository { repositoryId: $repositoryId })
  MATCH (c:ScopedCommit { repositoryId: $repositoryId })
  WITH r, c ORDER BY c.committedAt DESC LIMIT 8
  OPTIONAL MATCH (p:Person)-[:AUTHORED]->(c)
  OPTIONAL MATCH (c)-[:CHANGED]->(f:File)
  RETURN r, c, p, f
`;

// Reads evidence paths out of the stored graph with single-hop, bounded traversals.
export class Neo4jGraphReader implements GraphReader {
  constructor(private readonly connection: Neo4jConnection) {}

  // Matches question tokens against file paths, commit messages, discussions, and comment bodies.
  async resolveEntities(repositoryId: string, tokens: string[]): Promise<ResolvedEntity[]> {
    if (tokens.length === 0) {
      return [];
    }

    // Each query uses its own session; Neo4j sessions allow one open transaction at a time.
    const [files, commits, discussions, byComment] = await Promise.all([
      this.runRead(RESOLVE_FILES, { repositoryId, tokens }),
      this.runRead(RESOLVE_COMMITS, { repositoryId, tokens }),
      this.runRead(RESOLVE_DISCUSSIONS, { repositoryId, tokens }),
      this.runRead(RESOLVE_DISCUSSIONS_BY_COMMENT, { repositoryId, tokens }),
    ]);

    const entities: ResolvedEntity[] = [
      ...files.map((record) => ({
        kind: 'file' as const,
        matchedTerms: tokens,
        key: asString(record.get('id')) ?? '',
        title: asString(record.get('title')) ?? '',
        score: asNumber(record.get('score')) ?? 0,
      })),
      ...commits.map((record) => ({
        kind: 'commit' as const,
        key: asString(record.get('id')) ?? '',
        title: firstLine(asString(record.get('title')) ?? ''),
        score: asNumber(record.get('score')) ?? 0,
      })),
      ...discussions.map((record) => ({
        kind: 'discussion' as const,
        key: asString(record.get('id')) ?? '',
        title: asString(record.get('title')) ?? '',
        score: asNumber(record.get('score')) ?? 0,
      })),
      ...byComment.map((record) => ({
        kind: 'discussion' as const,
        key: asString(record.get('id')) ?? '',
        title: asString(record.get('title')) ?? '',
        score: asNumber(record.get('capped')) ?? 0,
      })),
    ];

    return entities
      .filter((entity, index, all) => entity.key.length > 0 && all.findIndex(item => item.kind === entity.kind && item.key === entity.key) === index)
      .sort((left, right) => right.score - left.score)
      .slice(0, 10);
  }

  // Expands resolved entities into history records using one-hop traversals only.
  async collectEvidence(repositoryId: string, entities: ResolvedEntity[]): Promise<RawEvidence[]> {
    const commitEntities = entities.filter((entity) => entity.kind === 'commit');
    const fileIds = entities.filter((entity) => entity.kind === 'file').map((entity) => entity.key);
    const shas = commitEntities.map((entity) => entity.key);
    const resolvedDiscussions = entities.filter((entity) => entity.kind === 'discussion');
    const discussionIds = resolvedDiscussions.map((entity) => entity.key);
    const issueIds = discussionIds.filter((id) => id.includes(':issue:'));

    const empty = async (): Promise<Neo4jRecord[]> => [];

    const fileCommits = fileIds.length > 0 ? await this.runRead(COMMITS_FOR_FILES, { fileIds, repositoryId }) : await empty();
    for (const record of fileCommits) {
      const sha = asString(record.get('sha'));
      if (sha && !shas.includes(sha)) shas.push(sha);
    }
    const [prRows, commitDetails] = await Promise.all([
      shas.length > 0 ? this.runRead(PULL_REQUESTS_FOR_COMMITS, { shas, repositoryId }) : empty(),
      shas.length > 0 ? this.runRead(COMMIT_DETAILS, { shas, repositoryId }) : empty(),
    ]);

    const evidence: RawEvidence[] = [];
    const fileDetails = fileIds.length > 0 ? await this.runRead(FILE_DETAILS, { fileIds, repositoryId }) : [];
    for (const record of fileDetails) {
      const path = asString(record.get('path')) ?? '';
      const content = asString(record.get('content')) ?? '';
      if (!content) continue;
      const terms = entities.find(entity => entity.key === record.get('id'))?.matchedTerms ?? [];
      const symbols = record.get('symbols') as string[] | undefined;
      const term = terms.find(item => symbols?.some(symbol => symbol.toLowerCase() === item)) ?? terms.find(item => content.toLowerCase().includes(item));
      const start = Math.max(0, (term ? content.toLowerCase().indexOf(term) : 0) - 1000);
      const snippet = content.slice(start, start + 8000);
      const firstLine = content.slice(0, start).split('\n').length;
      const lastLine = firstLine + snippet.split('\n').length - 1;
      evidence.push({ kind: record.get('kind') === 'document' ? 'document' : 'file', id: asString(record.get('id')) ?? '',
        title: path, excerpt: snippet, url: `${asString(record.get('url')) ?? ''}#L${firstLine}-L${lastLine}`,
        revision: asString(record.get('revision')), current: true,
        relation: 'Source snapshot pinned to the indexed default-branch revision', graphPath: [asString(record.get('id')) ?? ''] });
    }

    for (const record of fileCommits) {
      const sha = asString(record.get('sha')) ?? '';
      const path = asString(record.get('path')) ?? '';
      evidence.push({
        kind: 'commit',
        id: `commit:${sha}`,
        title: firstLine(asString(record.get('message')) ?? ''),
        excerpt: excerpt(`${asString(record.get('message')) ?? ''}\nFile ${path}: ${asString(record.get('changeStatus')) ?? 'changed'}.\n${asString(record.get('patch')) ?? ''}`, 2400),
        date: asString(record.get('date')),
        author: asString(record.get('author')),
        url: asString(record.get('url')),
        relation: `Commit touching ${path}`,
        graphPath: [fileNodeId(repositoryId, path), 'CHANGED', `commit:${sha}`],
      });
    }
    for (const record of commitDetails) {
      const sha = asString(record.get('sha')) ?? '';
      const message = asString(record.get('message')) ?? '';
      evidence.push({
        kind: 'commit',
        id: `commit:${sha}`,
        title: firstLine(message),
        excerpt: excerpt(message, 1200),
        date: asString(record.get('date')),
        author: asString(record.get('author')),
        url: asString(record.get('url')),
        relation: 'Commit matching the question',
        graphPath: [`commit:${sha}`],
      });
    }

    const discoveredPrIds: string[] = [];
    for (const record of prRows) {
      const number = asNumber(record.get('number'));
      if (number === undefined) {
        continue;
      }
      const id = pullRequestId(repositoryId, number);
      discoveredPrIds.push(id);
      const viaSha = asString(record.get('sha')) ?? '';
      evidence.push({
        kind: 'pull_request',
        id,
        title: asString(record.get('title')) ?? `Pull request #${number}`,
        excerpt: excerpt(asString(record.get('body')) ?? '', 1200),
        date: asString(record.get('date')),
        author: asString(record.get('author')),
        url: asString(record.get('url')),
        state: asString(record.get('state')),
        relation: `Pull request containing commit ${viaSha.slice(0, 7)}`,
        graphPath: [`commit:${viaSha}`, 'CONTAINS_COMMIT', id],
      });
    }

    const allDiscussionIds = [...new Set([...discussionIds, ...discoveredPrIds])];

    const [discussionRows, commitRefRows, prRefRows, commentRows] = await Promise.all([
      allDiscussionIds.length > 0 ? this.runRead(DISCUSSION_DETAILS, { discussionIds: allDiscussionIds }) : empty(),
      this.runRead(ISSUES_REFERENCED_BY_COMMITS, { shas, issueIds, repositoryId }),
      allDiscussionIds.length > 0 || issueIds.length > 0
        ? this.runRead(ISSUES_REFERENCED_BY_PULL_REQUESTS, { prIds: allDiscussionIds, issueIds })
        : empty(),
      allDiscussionIds.length > 0 ? this.runRead(COMMENTS_FOR_DISCUSSIONS, { discussionIds: allDiscussionIds }) : empty(),
    ]);

    for (const record of discussionRows) {
      const id = asString(record.get('id')) ?? '';
      const number = asNumber(record.get('number'));
      const isPullRequest = record.get('isPullRequest') === true;
      evidence.push({
        kind: isPullRequest ? 'pull_request' : 'issue',
        id,
        title: asString(record.get('title')) ?? `#${number}`,
        excerpt: excerpt(asString(record.get('body')) ?? '', 1200),
        date: asString(record.get('date')),
        author: asString(record.get('author')),
        url: asString(record.get('url')),
        state: asString(record.get('state')),
        relation: resolvedDiscussions.some((entity) => entity.key === id)
          ? 'Record matching the question'
          : 'Reached through the commit history',
        graphPath: [id],
      });
    }

    for (const record of commitRefRows) {
      const sha = asString(record.get('sha'));
      const issueIdValue = asString(record.get('issueId')) ?? '';
      if (sha) {
        evidence.push({
          kind: 'commit',
          id: `commit:${sha}`,
          title: firstLine(asString(record.get('commitMessage')) ?? ''),
          excerpt: excerpt(asString(record.get('commitMessage')) ?? '', 1200),
          author: asString(record.get('commitAuthor')),
          date: asString(record.get('commitDate')),
          url: asString(record.get('commitUrl')),
          relation: `Mentions issue #${asNumber(record.get('number'))}`,
          graphPath: [`commit:${sha}`, 'REFERENCES', issueIdValue],
        });
      }
      evidence.push({
        kind: 'issue',
        id: issueIdValue,
        title: asString(record.get('title')) ?? `Issue #${asNumber(record.get('number'))}`,
        excerpt: excerpt(asString(record.get('body')) ?? '', 1200),
        date: asString(record.get('date')),
        author: asString(record.get('author')),
        url: asString(record.get('url')),
        state: asString(record.get('state')),
        relation: `Referenced by commit message (${asString(record.get('method')) ?? 'inferred'})`,
        graphPath: [`commit:${sha ?? ''}`, 'REFERENCES', issueIdValue],
      });
    }

    for (const record of prRefRows) {
      const issueIdValue = asString(record.get('issueId')) ?? '';
      evidence.push({
        kind: 'issue',
        id: issueIdValue,
        title: asString(record.get('title')) ?? `Issue #${asNumber(record.get('number'))}`,
        excerpt: excerpt(asString(record.get('body')) ?? '', 1200),
        date: asString(record.get('date')),
        author: asString(record.get('author')),
        url: asString(record.get('url')),
        state: asString(record.get('state')),
        relation: `Referenced by pull request #${asNumber(record.get('prNumber'))} (${asString(record.get('method')) ?? 'inferred'})`,
        graphPath: [pullRequestId(repositoryId, asNumber(record.get('prNumber')) ?? 0), 'REFERENCES', issueIdValue],
      });
    }

    for (const record of commentRows) {
      const id = asString(record.get('id'));
      const discussionId = asString(record.get('discussionId')) ?? '';
      if (id === undefined) {
        continue;
      }
      evidence.push({
        kind: 'comment',
        id: `comment:${id}`,
        title: asString(record.get('discussionTitle')) ?? 'Discussion comment',
        excerpt: excerpt(asString(record.get('body')) ?? ''),
        date: asString(record.get('date')),
        author: asString(record.get('author')),
        url: asString(record.get('url')),
        relation: `Comment on ${asString(record.get('discussionTitle')) ?? 'discussion'}`,
        graphPath: [`comment:${id}`, 'ON', discussionId],
      });
    }

    return dedupeById(evidence).filter(item => item.title && item.url).slice(0, MAX_EVIDENCE);
  }

  // Returns a bounded subgraph around one entity, or a repository overview when unfocused.
  async getSubgraph(repositoryId: string, focus?: string): Promise<GraphSubgraph> {
    if (!focus) {
      const rows = await this.runRead(SUBGRAPH_OVERVIEW, { repositoryId });
      return overviewSubgraph(rows, repositoryId);
    }

    const key = focusKey(focus);
    const [focusRows, edgeRows] = await Promise.all([
      this.runRead(SUBGRAPH_FOCUS_NODE, { repositoryId, key }),
      this.runRead(SUBGRAPH_EDGES, { repositoryId, key }),
    ]);

    if (focusRows.length === 0) {
      return { nodes: [], edges: [], focus };
    }

    const nodes = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];

    const focusNode = graphNode(focusRows[0].get('n'), repositoryId);
    if (focusNode) {
      nodes.set(focusNode.id, focusNode);
    }

    for (const record of edgeRows) {
      const source = graphNode(record.get('n'), repositoryId);
      const target = graphNode(record.get('m'), repositoryId);
      const type = asString(record.get('rel')?.type) ?? 'RELATED';
      if (!source || !target) {
        continue;
      }
      nodes.set(source.id, source);
      nodes.set(target.id, target);
      const edge = directedEdge(source, target, type);
      if (!edges.some((candidate) => candidate.from === edge.from && candidate.to === edge.to && candidate.type === edge.type)) {
        edges.push(edge);
      }
    }

    return { nodes: Array.from(nodes.values()).slice(0, 40), edges: edges.slice(0, 60), focus };
  }

  // Runs one read query on a dedicated session so queries never share a transaction.
  private async runRead(cypher: string, parameters: Record<string, unknown>): Promise<Neo4jRecord[]> {
    const session = this.connection.session();
    try {
      const result = await session.executeRead((tx) => tx.run(cypher, parameters));
      return result.records;
    } finally {
      await session.close();
    }
  }
}

// Removes duplicate records, merging fields so the most complete view of each record wins.
function dedupeById(evidence: RawEvidence[]): RawEvidence[] {
  const byId = new Map<string, RawEvidence>();
  for (const item of evidence) {
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, item);
      continue;
    }
    byId.set(item.id, {
      ...existing,
      title: existing.title || item.title,
      excerpt: existing.excerpt ?? item.excerpt,
      url: existing.url ?? item.url,
      date: existing.date ?? item.date,
      author: existing.author ?? item.author,
      state: existing.state ?? item.state,
    });
  }
  return Array.from(byId.values());
}

// Takes the first line of a commit message for display.
function firstLine(message: string): string {
  return message.split('\n', 1)[0] ?? message;
}

// Bounds comment excerpts so the answer context stays small.
function excerpt(body: string, maxLength = 280): string {
  const normalized = body.replace(/\r?\n+/g, ' ').trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}…`;
}

// Converts an evidence-style ID into the graph key stored on the node.
function focusKey(focus: string): string {
  if (focus.startsWith('commit:')) {
    return focus.slice('commit:'.length);
  }
  for (const prefix of ['comment:', 'person:', 'repository:']) {
    if (focus.startsWith(prefix)) return focus.slice(prefix.length);
  }
  return focus;
}

// Restores the stored relationship direction that the undirected match cannot express.
function directedEdge(source: GraphNode, target: GraphNode, type: string): GraphEdge {
  const forwardByType: Record<string, string> = {
    CONTAINS: 'repository',
    AUTHORED: 'person',
    CHANGED: 'commit',
    CONTAINS_COMMIT: 'pull_request',
    ON: 'comment',
  };

  const forwardSource = forwardByType[type];
  if (forwardSource !== undefined) {
    return source.type === forwardSource
      ? { from: source.id, to: target.id, type }
      : { from: target.id, to: source.id, type };
  }

  if (type === 'REFERENCES') {
    const sourceIsOrigin = source.type === 'commit' || source.type === 'pull_request';
    return sourceIsOrigin
      ? { from: source.id, to: target.id, type }
      : { from: target.id, to: source.id, type };
  }

  return { from: source.id, to: target.id, type };
}

// Builds one display node from a driver record, or null for unsupported labels.
function graphNode(node: unknown, repositoryId: string): GraphNode | undefined {
  const asNeo4jNode = node as { labels?: string[]; properties?: Record<string, unknown> } | undefined;
  const labels = asNeo4jNode?.labels ?? [];
  const properties = asNeo4jNode?.properties ?? {};

  if (labels.includes('ScopedCommit')) {
    const sha = asString(properties.sha) ?? '';
    return {
      id: `commit:${sha}`,
      type: 'commit',
      label: firstLine(asString(properties.message) ?? sha).slice(0, 60),
      url: asString(properties.url),
    };
  }
  if (labels.includes('PullRequest')) {
    return {
      id: asString(properties.id) ?? '',
      type: 'pull_request',
      label: `PR #${asNumber(properties.number)} ${firstLine(asString(properties.title) ?? '')}`.slice(0, 60),
      url: asString(properties.url),
    };
  }
  if (labels.includes('Issue')) {
    return {
      id: asString(properties.id) ?? '',
      type: 'issue',
      label: `Issue #${asNumber(properties.number)} ${firstLine(asString(properties.title) ?? '')}`.slice(0, 60),
      url: asString(properties.url),
    };
  }
  if (labels.includes('File')) {
    return {
      id: asString(properties.id) ?? '',
      type: 'file',
      label: asString(properties.path) ?? '',
    };
  }
  if (labels.includes('Comment')) {
    return {
      id: `comment:${asString(properties.id) ?? ''}`,
      type: 'comment',
      label: `${asString(properties.authorLogin) ?? 'someone'}: ${excerpt(asString(properties.body) ?? '', 40)}`,
      url: asString(properties.url),
    };
  }
  if (labels.includes('Person')) {
    return {
      id: `person:${asString(properties.login) ?? ''}`,
      type: 'person',
      label: asString(properties.login) ?? '',
    };
  }
  if (labels.includes('Repository')) {
    return {
      id: `repository:${repositoryId}`,
      type: 'repository',
      label: asString(properties.fullName) ?? repositoryId,
      url: asString(properties.url),
    };
  }

  return undefined;
}

// Builds the overview subgraph: repository, latest commits, authors, and touched files.
function overviewSubgraph(records: Neo4jRecord[], repositoryId: string): GraphSubgraph {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  for (const record of records) {
    const repository = graphNode(record.get('r'), repositoryId);
    const commit = graphNode(record.get('c'), repositoryId);
    if (repository && commit) {
      nodes.set(repository.id, repository);
      nodes.set(commit.id, commit);
      edges.push({ from: repository.id, to: commit.id, type: 'CONTAINS' });
    }

    const person = record.has('p') ? graphNode(record.get('p'), repositoryId) : undefined;
    if (person && commit) {
      nodes.set(person.id, person);
      edges.push({ from: person.id, to: commit.id, type: 'AUTHORED' });
    }

    const file = record.has('f') ? graphNode(record.get('f'), repositoryId) : undefined;
    if (file && commit) {
      nodes.set(file.id, file);
      edges.push({ from: commit.id, to: file.id, type: 'CHANGED' });
    }
  }

  const uniqueEdges = edges.filter((edge, index, all) => (
    all.findIndex((candidate) => candidate.from === edge.from && candidate.to === edge.to && candidate.type === edge.type) === index
  ));

  return { nodes: Array.from(nodes.values()), edges: uniqueEdges };
}
