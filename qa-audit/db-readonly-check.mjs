// READ-ONLY database verification. Only SELECT / MATCH queries. No writes, no deletes.
import pg from 'pg';
import neo4j from 'neo4j-driver';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(readFileSync('C:/Projects/HackFront-hackathon-project/.env', 'utf8')
  .split(/\r?\n/).filter(l => l.includes('=') && !l.trim().startsWith('#')).map(l => {
    const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }));

console.log('--- PostgreSQL (Supabase, read-only) ---');
const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.DATABASE_SSL_CA_FILE ? { ca: readFileSync(env.DATABASE_SSL_CA_FILE, 'utf8') } : undefined,
  max: 1, connectionTimeoutMillis: 15000,
});
try {
  const tables = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='whycode_runtime' ORDER BY table_name`);
  console.log('whycode_runtime tables:', tables.rows.map(r => r.table_name).join(', '));
  const ns = env.RATE_LIMIT_NAMESPACE || 'whycode-development';
  for (const t of ['answer_budget', 'auth_flows', 'guest_workspaces', 'sessions', 'repository_indexes', 'investigations', 'repositories']) {
    try {
      const c = await pool.query(`SELECT count(*)::int AS n FROM whycode_runtime.${t} WHERE namespace=$1`, [ns]);
      console.log(`  ${t}: ${c.rows[0].n} rows (namespace=${ns})`);
    } catch (e) { console.log(`  ${t}: (no namespace column or table) ${e.message.slice(0, 60)}`); }
  }
  const budget = await pool.query(`SELECT * FROM whycode_runtime.answer_budget WHERE namespace=$1 LIMIT 1`, [ns]).catch(() => null);
  if (budget?.rows?.[0]) console.log('  answer_budget sample columns:', Object.keys(budget.rows[0]).join(', '));
} finally { await pool.end(); }

console.log('\n--- Neo4j Aura (read-only) ---');
const driver = neo4j.driver(env.NEO4J_URI, neo4j.auth.basic(env.NEO4J_USERNAME, env.NEO4J_PASSWORD), { connectionTimeout: 15000 });
try {
  await driver.verifyConnectivity();
  console.log('connectivity: OK');
  const repo = 'github:octocat/hello-world';
  for (const label of ['Repository', 'ScopedCommit', 'File', 'PullRequest', 'Issue', 'Comment', 'Person', 'Discussion']) {
    const r = await driver.executeQuery(`MATCH (n:\`${label}\`) WHERE n.repositoryId = $repo OR (n:Person AND EXISTS { MATCH (n)-[:AUTHORED]->(o) WHERE o.repositoryId = $repo }) RETURN count(n) AS c`, { repo });
    console.log(`  ${label}: ${r.records[0].get('c').toNumber()} nodes (repo-scoped)`);
  }
} finally { await driver.close(); }
console.log('\nRead-only verification complete. No data was modified.');
