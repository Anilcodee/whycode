import { buildGraphPayloads } from '../../domain/graph-payloads.js';
import { IndexedSnapshot } from '../../domain/indexing.js';
import { GraphStore, GraphWriteSummary } from './graph-store.js';
import { Neo4jConnection } from './neo4j-connection.js';

// Keeps individual transactions bounded so one large repository cannot create oversized writes.
const BATCH_SIZE = 200;

// Stable identity constraints so repeated indexing runs upsert instead of duplicating.
const SCHEMA_STATEMENTS = [
  'CREATE CONSTRAINT repository_id IF NOT EXISTS FOR (r:Repository) REQUIRE r.repositoryId IS UNIQUE',
  'CREATE CONSTRAINT file_id IF NOT EXISTS FOR (f:File) REQUIRE f.id IS UNIQUE',
  'CREATE CONSTRAINT scoped_commit_id IF NOT EXISTS FOR (c:ScopedCommit) REQUIRE c.id IS UNIQUE',
  'CREATE INDEX scoped_commit_repository IF NOT EXISTS FOR (c:ScopedCommit) ON (c.repositoryId)',
  'CREATE CONSTRAINT pull_request_id IF NOT EXISTS FOR (p:PullRequest) REQUIRE p.id IS UNIQUE',
  'CREATE CONSTRAINT issue_id IF NOT EXISTS FOR (i:Issue) REQUIRE i.id IS UNIQUE',
  'CREATE CONSTRAINT comment_id IF NOT EXISTS FOR (m:Comment) REQUIRE m.id IS UNIQUE',
  'CREATE CONSTRAINT person_login IF NOT EXISTS FOR (p:Person) REQUIRE p.login IS UNIQUE',
  'CREATE INDEX discussion_number IF NOT EXISTS FOR (d:Discussion) ON (d.repositoryId, d.number)',
];

const UPSERT_REPOSITORY = `
  MERGE (r:Repository { repositoryId: $repositoryId })
  SET r.fullName = $fullName,
      r.url = $url,
      r.defaultBranch = $defaultBranch
`;

const UPSERT_PEOPLE = `
  UNWIND $rows AS row
  MERGE (p:Person { login: row.login })
`;

const UPSERT_FILES = `
  UNWIND $rows AS row
  MATCH (r:Repository { repositoryId: $repositoryId })
  MERGE (f:File { id: row.id })
  SET f.path = row.path, f.repositoryId = $repositoryId
  SET f += row.props
  MERGE (r)-[:CONTAINS]->(f)
`;

const UPSERT_COMMITS = `
  UNWIND $rows AS row
  MATCH (r:Repository { repositoryId: $repositoryId })
  MERGE (c:ScopedCommit { id: row.props.id })
  SET c.sha = row.sha
  SET c += row.props
  MERGE (r)-[:CONTAINS]->(c)
`;

const UPSERT_PULL_REQUESTS = `
  UNWIND $rows AS row
  MATCH (r:Repository { repositoryId: $repositoryId })
  MERGE (p:PullRequest:Discussion { id: row.id })
  SET p += row.props
  MERGE (r)-[:CONTAINS]->(p)
`;

const UPSERT_ISSUES = `
  UNWIND $rows AS row
  MATCH (r:Repository { repositoryId: $repositoryId })
  MERGE (i:Issue:Discussion { id: row.id })
  SET i += row.props
  MERGE (r)-[:CONTAINS]->(i)
`;

const UPSERT_COMMENTS = `
  UNWIND $rows AS row
  MATCH (r:Repository { repositoryId: $repositoryId })
  MERGE (m:Comment { id: row.id })
  SET m += row.props
  MERGE (r)-[:CONTAINS]->(m)
`;

const LINK_AUTHORED_COMMITS = `
  UNWIND $rows AS row
  MATCH (p:Person { login: row.login })
  MATCH (c:ScopedCommit { repositoryId: $repositoryId, sha: row.sha })
  MERGE (p)-[:AUTHORED]->(c)
`;

const LINK_AUTHORED_PULL_REQUESTS = `
  UNWIND $rows AS row
  MATCH (p:Person { login: row.login })
  MATCH (pr:PullRequest { id: row.id })
  MERGE (p)-[:AUTHORED]->(pr)
`;

const LINK_AUTHORED_ISSUES = `
  UNWIND $rows AS row
  MATCH (p:Person { login: row.login })
  MATCH (i:Issue { id: row.id })
  MERGE (p)-[:AUTHORED]->(i)
`;

const LINK_AUTHORED_COMMENTS = `
  UNWIND $rows AS row
  MATCH (p:Person { login: row.login })
  MATCH (m:Comment { id: row.id })
  MERGE (p)-[:AUTHORED]->(m)
`;

const LINK_CHANGED_FILES = `
  UNWIND $rows AS row
  MATCH (c:ScopedCommit { repositoryId: $repositoryId, sha: row.sha })
  MATCH (f:File { id: row.fileId })
  MERGE (c)-[change:CHANGED]->(f)
  SET change.status = row.status, change.patch = row.patch
`;

const LINK_PULL_REQUEST_COMMITS = `
  UNWIND $rows AS row
  MATCH (p:PullRequest { id: row.id })
  MATCH (c:ScopedCommit { repositoryId: $repositoryId, sha: row.sha })
  MERGE (p)-[:CONTAINS_COMMIT]->(c)
`;

const LINK_COMMIT_REFERENCES = `
  UNWIND $rows AS row
  MATCH (c:ScopedCommit { repositoryId: $repositoryId, sha: row.sha })
  MATCH (i:Issue { id: row.issueId })
  MERGE (c)-[ref:REFERENCES]->(i)
  ON CREATE SET ref.extractionMethod = 'commit_message_reference', ref.confidence = 'low'
`;

const LINK_PULL_REQUEST_REFERENCES = `
  UNWIND $rows AS row
  MATCH (p:PullRequest { id: row.id })
  MATCH (i:Issue { id: row.issueId })
  MERGE (p)-[ref:REFERENCES]->(i)
  ON CREATE SET ref.extractionMethod = 'pull_request_title_reference', ref.confidence = 'low'
`;

const LINK_COMMENT_PARENTS = `
  UNWIND $rows AS row
  MATCH (m:Comment { id: row.id })
  MATCH (d:Discussion { repositoryId: $repositoryId, number: row.parentNumber })
  MERGE (m)-[:ON]->(d)
`;

// Implements the graph store against Neo4j using parameterized, batched, idempotent Cypher.
export class Neo4jGraphStore implements GraphStore {
  private schemaEnsured = false;

  constructor(private readonly connection: Neo4jConnection) {}

  // Upserts every entity and relationship from one snapshot using stable source identifiers.
  async saveRepositoryHistory(snapshot: IndexedSnapshot, generation?: number): Promise<GraphWriteSummary> {
    const startedAt = Date.now();

    await this.ensureSchema();

    const payloads = buildGraphPayloads(snapshot);
    let nodesWritten = 0;
    let relationshipsWritten = 0;

    const session = this.connection.session();
    try {
      await session.executeWrite(async tx => {
      nodesWritten=0; relationshipsWritten=0;
      const guard=await tx.run(`MERGE (r:Repository {repositoryId: $repositoryId})
        SET r.writeLock = coalesce(r.writeLock,0)+1
        WITH r WHERE ($generation IS NULL AND coalesce(r.generation,0)=0) OR ($generation IS NOT NULL AND coalesce(r.generation,0) <= $generation)
        SET r.generation = coalesce($generation,r.generation,0) RETURN r.repositoryId AS id`, {repositoryId:snapshot.repositoryId,generation:generation??null});
      if(!guard.records.length)throw new Error('STALE_GRAPH_GENERATION');
      await tx.run(UPSERT_REPOSITORY, payloads.repository);

      // The graph must describe this snapshot, including retained continuation batches,
      // rather than silently keeping history excluded by a fresh window.
      const retainedIds = [...payloads.files.map(row => row.id), ...payloads.commits.map(row => row.props.id),
        ...payloads.pullRequests.map(row => row.id), ...payloads.issues.map(row => row.id), ...payloads.comments.map(row => row.id)];
      await tx.run(`MATCH (r:Repository {repositoryId: $repositoryId})-[:CONTAINS]->(n)
        WHERE n.repositoryId = $repositoryId AND NOT n.id IN $retainedIds DETACH DELETE n`, { repositoryId: snapshot.repositoryId, retainedIds });

      await tx.run('MATCH (f:File {repositoryId: $repositoryId}) SET f.current = false', { repositoryId: snapshot.repositoryId });
      const batches: Array<{ query: string; rows: object[]; countsNodes: boolean }> = [
        { query: UPSERT_PEOPLE, rows: payloads.people, countsNodes: true },
        { query: UPSERT_FILES, rows: payloads.files, countsNodes: true },
        { query: UPSERT_COMMITS, rows: payloads.commits, countsNodes: true },
        { query: UPSERT_PULL_REQUESTS, rows: payloads.pullRequests, countsNodes: true },
        { query: UPSERT_ISSUES, rows: payloads.issues, countsNodes: true },
        { query: UPSERT_COMMENTS, rows: payloads.comments, countsNodes: true },
        { query: LINK_AUTHORED_COMMITS, rows: payloads.authoredCommits, countsNodes: false },
        { query: LINK_AUTHORED_PULL_REQUESTS, rows: payloads.authoredPullRequests, countsNodes: false },
        { query: LINK_AUTHORED_ISSUES, rows: payloads.authoredIssues, countsNodes: false },
        { query: LINK_AUTHORED_COMMENTS, rows: payloads.authoredComments, countsNodes: false },
        { query: LINK_CHANGED_FILES, rows: payloads.changedFiles, countsNodes: false },
        { query: LINK_PULL_REQUEST_COMMITS, rows: payloads.pullRequestCommits, countsNodes: false },
        { query: LINK_COMMIT_REFERENCES, rows: payloads.commitReferences, countsNodes: false },
        { query: LINK_PULL_REQUEST_REFERENCES, rows: payloads.pullRequestReferences, countsNodes: false },
        { query: LINK_COMMENT_PARENTS, rows: payloads.commentParents, countsNodes: false },
      ];

      for (const batch of batches) {
        for (const rows of chunk(batch.rows, BATCH_SIZE)) {
          const result = await tx.run(batch.query, { rows, repositoryId: snapshot.repositoryId });
          const updates = result.summary.counters.updates();
          nodesWritten += batch.countsNodes ? updates.nodesCreated ?? 0 : 0;
          relationshipsWritten += updates.relationshipsCreated ?? 0;
        }
      }
      }, { timeout:60000 });
    } finally {
      await session.close();
    }

    return {
      nodesWritten,
      relationshipsWritten,
      durationMs: Date.now() - startedAt,
    };
  }

  // Creates identity constraints once per process; the statements are idempotent themselves.
  private async ensureSchema(): Promise<void> {
    if (this.schemaEnsured) {
      return;
    }

    const session = this.connection.session();
    try {
      for (const statement of SCHEMA_STATEMENTS) {
        await session.executeWrite((tx) => tx.run(statement));
      }
      this.schemaEnsured = true;
    } finally {
      await session.close();
    }
  }
}

// Splits rows into fixed-size batches for transaction-safe writes.
function chunk<T>(rows: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    batches.push(rows.slice(index, index + size));
  }
  return batches;
}
