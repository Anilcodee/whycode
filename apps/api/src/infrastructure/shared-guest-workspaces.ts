import type { Pool } from 'pg';
import type { AskResponse } from '../domain/question.js';
import { EncryptedPayload } from './encrypted-payload.js';

export type GuestState = { repositories: string[]; history: AskResponse[]; expires: number };
export type GuestChange = { type: 'add' | 'remove'; id: string } | { type: 'save'; answer: AskResponse }
  | { type: 'clear' } | { type: 'removeAnswer'; id: string; at: string };

export class SharedGuestWorkspaces {
  private readonly codec: EncryptedPayload;
  constructor(private readonly pool: Pool, private readonly namespace: string, key: string) { this.codec = new EncryptedPayload(key); }
  async get(id: string): Promise<GuestState | undefined> {
    const result = await this.pool.query('SELECT payload FROM whycode_runtime.guest_workspaces WHERE namespace=$1 AND id=$2 AND expires_at>now()',[this.namespace,id]);
    return result.rows[0] ? this.codec.decode<GuestState>(result.rows[0].payload) : undefined;
  }
  /** Apply operations under a row lock so two tabs/replicas cannot overwrite each other. */
  async commit(id: string, initial: GuestState, changes: GuestChange[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM whycode_runtime.guest_workspaces WHERE namespace=$1 AND expires_at<=now()',[this.namespace]);
      await client.query('INSERT INTO whycode_runtime.guest_workspaces(namespace,id,payload,expires_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[this.namespace,id,this.codec.encode(initial),new Date(initial.expires)]);
      const result = await client.query('SELECT payload FROM whycode_runtime.guest_workspaces WHERE namespace=$1 AND id=$2 FOR UPDATE',[this.namespace,id]);
      const state = this.codec.decode<GuestState>(result.rows[0].payload);
      for (const change of changes) {
        if (change.type==='add' && !state.repositories.includes(change.id)) state.repositories.push(change.id);
        if (change.type==='remove') { state.repositories=state.repositories.filter(id=>id!==change.id); state.history=state.history.filter(item=>item.repositoryId!==change.id); }
        if (change.type==='clear') state.history=[];
        if (change.type==='removeAnswer') state.history=state.history.filter(item=>item.repositoryId!==change.id||item.answeredAt!==change.at);
        if (change.type==='save' && state.repositories.includes(change.answer.repositoryId)) state.history=[change.answer,...state.history.filter(item=>item.repositoryId!==change.answer.repositoryId||item.answeredAt!==change.answer.answeredAt)].slice(0,20);
      }
      if (state.repositories.length>100 || JSON.stringify(state).length>2_000_000) throw new Error('Guest workspace capacity reached');
      await client.query('UPDATE whycode_runtime.guest_workspaces SET payload=$3 WHERE namespace=$1 AND id=$2',[this.namespace,id,this.codec.encode(state)]);
      await client.query('COMMIT');
    } catch { await client.query('ROLLBACK'); throw new Error('Guest workspace storage unavailable'); }
    finally { client.release(); }
  }
}
