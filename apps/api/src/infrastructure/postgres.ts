import { Pool } from 'pg';
import { readFileSync } from 'node:fs';

export function createPostgresPool(connectionString: string, caFile: string): Pool {
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Invalid PostgreSQL URL');
  // pg URL SSL parameters override explicit TLS options; use one verified configuration.
  for (const name of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'ssl']) url.searchParams.delete(name);
  const pool = new Pool({ connectionString: url.href, ssl: { rejectUnauthorized: true, ca: readFileSync(caFile, 'utf8') },
    max: 5, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000, query_timeout: 15_000, statement_timeout: 15_000 });
  pool.on('error', () => console.error('A background PostgreSQL connection failed.'));
  return pool;
}
