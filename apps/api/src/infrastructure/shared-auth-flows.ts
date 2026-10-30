import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';

/** Only hashed browser-bound identifiers enter the database; payloads use AES-256-GCM. */
export class SharedAuthFlows {
  private readonly key: Buffer;
  constructor(private readonly pool: Pick<Pool, 'query'>, private readonly namespace: string, key: string) {
    this.key = Buffer.from(key, 'base64');
    if (this.key.length !== 32) throw new Error('Invalid auth-flow encryption key');
  }
  async put(kind: 'flow' | 'recovery', id: string, value: { expires: number }): Promise<void> {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    const payload = Buffer.concat([iv, cipher.getAuthTag(), body]);
    await this.pool.query('DELETE FROM whycode_runtime.auth_flows WHERE namespace=$1 AND expires_at <= now()', [this.namespace]);
    await this.pool.query('INSERT INTO whycode_runtime.auth_flows(namespace,kind,id,payload,expires_at) VALUES($1,$2,$3,$4,$5)', [this.namespace, kind, id, payload, new Date(value.expires)]);
  }
  async read<T>(kind: 'flow' | 'recovery', id: string, consume = false): Promise<T | undefined> {
    const sql = consume
      ? 'DELETE FROM whycode_runtime.auth_flows WHERE namespace=$1 AND kind=$2 AND id=$3 AND expires_at > now() RETURNING payload'
      : 'SELECT payload FROM whycode_runtime.auth_flows WHERE namespace=$1 AND kind=$2 AND id=$3 AND expires_at > now()';
    const result = await this.pool.query(sql, [this.namespace, kind, id]);
    if (!result.rows.length) return undefined;
    const data = result.rows[0].payload as Buffer;
    const decipher = createDecipheriv('aes-256-gcm', this.key, data.subarray(0,12));
    decipher.setAuthTag(data.subarray(12,28));
    return JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8')) as T;
  }
}
