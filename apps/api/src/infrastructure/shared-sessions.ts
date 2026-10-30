import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import type { AccountSession } from '../services/account-service.js';
import { EncryptedPayload } from './encrypted-payload.js';

export class SharedSessions {
  private readonly codec: EncryptedPayload;
  private scope(session: AccountSession) { return createHash('sha256').update(session.user.id+':'+session.accessToken+':'+(session.github?.token??'')).digest('hex'); }
  constructor(private readonly pool: Pool, private readonly namespace: string, key: string) { this.codec = new EncryptedPayload(key); }
  async get(id: string) {
    const result = await this.pool.query('SELECT payload,revision,private_scope FROM whycode_runtime.sessions WHERE namespace=$1 AND id=$2 AND expires_at > now()', [this.namespace,id]);
    if(!result.rows[0])return undefined;
    const session=this.codec.decode<AccountSession>(result.rows[0].payload);
    if(!result.rows[0].private_scope) await this.pool.query('UPDATE whycode_runtime.sessions SET private_scope=$3,github_enabled=$4 WHERE namespace=$1 AND id=$2 AND revision=$5',[this.namespace,id,this.scope(session),Boolean(session.github),result.rows[0].revision]);
    return {session,revision:result.rows[0].revision as number};
  }
  async create(id: string, session: AccountSession) {
    await this.pool.query('DELETE FROM whycode_runtime.sessions WHERE namespace=$1 AND expires_at<=now()', [this.namespace]);
    await this.pool.query('INSERT INTO whycode_runtime.sessions(namespace,id,user_id,payload,expires_at,private_scope,github_enabled) VALUES($1,$2,$3,$4,$5,$6,$7)', [this.namespace,id,session.user.id,this.codec.encode(session),new Date(session.expires),this.scope(session),Boolean(session.github)]);
  }
  async update(id: string, session: AccountSession, revision: number) {
    const result = await this.pool.query('UPDATE whycode_runtime.sessions SET payload=$3,revision=revision+1,private_scope=$5,github_enabled=$6 WHERE namespace=$1 AND id=$2 AND revision=$4 AND expires_at>now() RETURNING revision', [this.namespace,id,this.codec.encode(session),revision,this.scope(session),Boolean(session.github)]);
    if (!result.rows.length) throw new Error('AUTH_FAILED');
  }
  async remove(id: string) { await this.pool.query('DELETE FROM whycode_runtime.sessions WHERE namespace=$1 AND id=$2',[this.namespace,id]); }
  async revokeUser(id: string) { await this.pool.query('DELETE FROM whycode_runtime.sessions WHERE namespace=$1 AND user_id=$2',[this.namespace,id]); }
  async importLegacy(sessions: Map<string,AccountSession>) {
    if (!sessions.size) return;
    const hash = createHash('sha256').update(JSON.stringify([...sessions])).digest('hex');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const marker = await client.query('INSERT INTO whycode_runtime.session_imports(namespace,source_hash) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING source_hash',[this.namespace,hash]);
      if (marker.rows.length) for (const [id,session] of sessions) if (session.expires>Date.now()) {
        await client.query('INSERT INTO whycode_runtime.sessions(namespace,id,user_id,payload,expires_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[this.namespace,id,session.user.id,this.codec.encode(session),new Date(session.expires)]);
      }
      await client.query('COMMIT');
    } catch { await client.query('ROLLBACK'); throw new Error('Session migration failed'); }
    finally { client.release(); }
  }
}
