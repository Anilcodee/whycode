import type { Pool } from 'pg';
import type { IndexStatus, IndexedSnapshot } from '../../domain/indexing.js';
import type { IndexingStore } from './indexing-store.js';
import { EncryptedPayload } from '../encrypted-payload.js';

type PrivateScope = { id: string; expires: number; key: string };
/** Public snapshots or encrypted private snapshots; all access stays server-side. */
export class CentralIndexStore implements IndexingStore {
  private readonly table:string;
  private readonly codec?:EncryptedPayload;
  private disposed=false;
  get recoveryEnabled() { return !this.scope; }
  constructor(private readonly pool:Pool,private readonly namespace:string,private readonly scope?:PrivateScope) {
    this.table=scope?'whycode_runtime.private_indexes':'whycode_runtime.repository_indexes';
    if(scope)this.codec=new EncryptedPayload(scope.key);
  }
  private encode(value:unknown) { return this.codec?this.codec.encode(value).toString('base64'):value; }
  private decode<T>(value:unknown):T { return this.codec?this.codec.decode<T>(Buffer.from(value as string,'base64')):value as T; }
  private params(id?:string):unknown[] { return [this.namespace,id??null,...(this.scope?[this.scope.id]:[])]; }
  private get filter() { return this.scope?' AND scope=$3 AND expires_at>now() AND EXISTS(SELECT 1 FROM whycode_runtime.sessions s WHERE s.namespace=$1 AND s.private_scope=$3 AND s.github_enabled AND s.expires_at>now())':''; }
  private get index() { return this.scope?4:3; }
  async importLegacy(source:IndexingStore,legacyId?:string) {
    const records=await source.listStatuses();
    if(this.scope && records.length) {
      const client=await this.pool.connect();
      try {
        await client.query('BEGIN');
        const marker=await client.query('INSERT INTO whycode_runtime.private_index_imports(namespace,legacy_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING legacy_id',[this.namespace,legacyId??this.scope.id]);
        if(marker.rows.length) for(const original of records) {
          const status=['running','queued'].includes(original.status)?{...original,status:'failed',errors:['Refresh to restart this migrated job.']}:original;
          const snapshot=await source.getSnapshot(original.repositoryId);
          await client.query(`INSERT INTO ${this.table}(namespace,repository_id,job_id,status,snapshot,scope,expires_at) SELECT $1,$2,$3,$4,$5,$6,$7 WHERE EXISTS(SELECT 1 FROM whycode_runtime.sessions WHERE namespace=$1 AND private_scope=$6 AND github_enabled AND expires_at>now()) ON CONFLICT DO NOTHING`,[this.namespace,original.repositoryId,original.jobId,JSON.stringify(this.encode(status)),snapshot?JSON.stringify(this.encode(snapshot)):null,this.scope.id,new Date(this.scope.expires)]);
        }
        await client.query('COMMIT');
      } catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();}
      return;
    }
    for(const original of records) {
      const status=['running','queued'].includes(original.status)?{...original,status:'failed',errors:['Refresh to restart this migrated job.']}:original;
      const snapshot=await source.getSnapshot(original.repositoryId);
      if(this.scope) {
        await this.pool.query(`INSERT INTO ${this.table}(namespace,repository_id,job_id,status,snapshot,scope,expires_at) SELECT $1,$2,$3,$4,$5,$6,$7 WHERE EXISTS(SELECT 1 FROM whycode_runtime.sessions WHERE namespace=$1 AND private_scope=$6 AND github_enabled AND expires_at>now()) ON CONFLICT DO NOTHING`,[this.namespace,original.repositoryId,original.jobId,JSON.stringify(this.encode(status)),snapshot?JSON.stringify(this.encode(snapshot)):null,this.scope.id,new Date(this.scope.expires)]);
      } else await this.pool.query(`INSERT INTO ${this.table}(namespace,repository_id,job_id,status,snapshot) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,[this.namespace,original.repositoryId,original.jobId,status,snapshot??null]);
    }
  }
  private visible(row:{status:unknown;lease_until:Date|null;generation:number}):IndexStatus {
    const status={...this.decode<IndexStatus>(row.status),generation:row.generation};
    return ['running','queued'].includes(status.status)&&(!row.lease_until||row.lease_until.getTime()<=Date.now())?{...status,status:'failed',errors:['Worker interrupted; eligible public jobs will recover automatically.']}:status;
  }
  async listStatuses():Promise<IndexStatus[]> {
    if(this.disposed)return [];
    const result=await this.pool.query(`SELECT status,lease_until,generation FROM ${this.table} WHERE namespace=$1 AND $2::text IS NULL ${this.filter}`,this.params());
    return result.rows.map(row=>this.visible(row));
  }
  async getStatus(id:string):Promise<IndexStatus|undefined> {
    if(this.disposed)return undefined;
    const result=await this.pool.query(`SELECT status,lease_until,generation FROM ${this.table} WHERE namespace=$1 AND repository_id=$2 ${this.filter}`,this.params(id));
    return result.rows[0]?this.visible(result.rows[0]):undefined;
  }
  async getSnapshot(id:string):Promise<IndexedSnapshot|undefined> {
    if(this.disposed)return undefined;
    const result=await this.pool.query(`SELECT snapshot FROM ${this.table} WHERE namespace=$1 AND repository_id=$2 ${this.filter}`,this.params(id));
    return result.rows[0]?.snapshot?this.decode<IndexedSnapshot>(result.rows[0].snapshot):undefined;
  }
  async claimJob(status:IndexStatus,expectedJobId?:string):Promise<boolean> {
    if(this.disposed)return false;
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO whycode_runtime.worker_gate(namespace) VALUES($1) ON CONFLICT DO NOTHING',[this.namespace]);
      await client.query('SELECT namespace FROM whycode_runtime.worker_gate WHERE namespace=$1 FOR UPDATE',[this.namespace]);
      const used=await client.query(`SELECT (SELECT count(*) FROM whycode_runtime.repository_indexes WHERE namespace=$1 AND lease_until>now())+(SELECT count(*) FROM whycode_runtime.private_indexes WHERE namespace=$1 AND lease_until>now() AND expires_at>now()) AS count`,[this.namespace]);
      if(Number(used.rows[0].count)>=2) { await client.query('COMMIT');return false; }
      if(this.scope) {
        const allowed=await client.query('SELECT 1 FROM whycode_runtime.sessions WHERE namespace=$1 AND private_scope=$2 AND github_enabled AND expires_at>now()',[this.namespace,this.scope.id]);
        if(!allowed.rows.length) { await client.query('COMMIT');return false; }
      }
      const columns=this.scope?',scope,expires_at':'',values=this.scope?',$5,$6':'';
      const conflict=this.scope?'namespace,scope,repository_id':'namespace,repository_id';
      const expectedIndex=this.scope?7:5;
      const result=await client.query(`INSERT INTO ${this.table} AS item(namespace,repository_id,job_id,status,lease_until${columns}) VALUES($1,$2,$3,$4,now()+interval '2 minutes'${values}) ON CONFLICT(${conflict}) DO UPDATE SET job_id=excluded.job_id,status=excluded.status,lease_until=excluded.lease_until,generation=item.generation+1 WHERE (item.lease_until IS NULL OR item.lease_until<=now()) AND ($${expectedIndex}::text IS NULL OR item.job_id=$${expectedIndex}) RETURNING generation`,[this.namespace,status.repositoryId,status.jobId,JSON.stringify(this.encode(status)),...(this.scope?[this.scope.id,new Date(this.scope.expires)]:[]),expectedJobId??null]);
      if(result.rows[0])status.generation=result.rows[0].generation;
      await client.query('COMMIT');return result.rows.length===1;
    } catch(error) { await client.query('ROLLBACK');throw error; } finally { client.release(); }
  }
  async renewJob(id:string,jobId:string):Promise<void> {
    const result=await this.pool.query(`UPDATE ${this.table} SET lease_until=now()+interval '2 minutes' WHERE namespace=$1 AND repository_id=$2 ${this.filter} AND job_id=$${this.index} AND lease_until>now() RETURNING job_id`,[...this.params(id),jobId]);
    if(!result.rows.length||this.disposed)throw new Error('INDEX_LEASE_LOST');
  }
  async saveStatus(status:IndexStatus):Promise<void> {
    const n=this.index,active=['running','queued'].includes(status.status);
    const result=await this.pool.query(`UPDATE ${this.table} SET status=$${n+1},lease_until=CASE WHEN $${n+2} THEN now()+interval '2 minutes' ELSE NULL END WHERE namespace=$1 AND repository_id=$2 ${this.filter} AND job_id=$${n} AND lease_until>now() RETURNING job_id`,[...this.params(status.repositoryId),status.jobId,JSON.stringify(this.encode(status)),active]);
    if(!result.rows.length||this.disposed)throw new Error('INDEX_LEASE_LOST');
  }
  async saveSnapshot(snapshot:IndexedSnapshot,jobId?:string):Promise<void> {
    const result=await this.pool.query(`UPDATE ${this.table} SET snapshot=$${this.index+1} WHERE namespace=$1 AND repository_id=$2 ${this.filter} AND job_id=$${this.index} AND lease_until>now() RETURNING job_id`,[...this.params(snapshot.repositoryId),jobId,JSON.stringify(this.encode(snapshot))]);
    if(!result.rows.length||this.disposed)throw new Error('INDEX_LEASE_LOST');
  }
  async recoverableJobs():Promise<IndexStatus[]> {
    if(this.scope) {
      const result=await this.pool.query(`SELECT status,generation FROM ${this.table} WHERE namespace=$1 AND $2::text IS NULL ${this.filter} AND lease_until<=now()`,this.params());
      return result.rows.map(row=>({...this.decode<IndexStatus>(row.status),generation:row.generation})).filter(status=>['running','queued'].includes(status.status));
    }
    await this.pool.query('DELETE FROM whycode_runtime.private_indexes p WHERE p.namespace=$1 AND (p.expires_at<=now() OR NOT EXISTS(SELECT 1 FROM whycode_runtime.sessions s WHERE s.namespace=p.namespace AND s.private_scope=p.scope AND s.github_enabled AND s.expires_at>now()))',[this.namespace]);
    const result=await this.pool.query(`SELECT status,generation FROM ${this.table} WHERE namespace=$1 AND lease_until<=now() AND status->>'status' IN ('running','queued')`,[this.namespace]);
    return result.rows.map(row=>({...row.status,generation:row.generation}));
  }
  async removeRepository(id:string):Promise<boolean> {
    if(!this.scope)throw new Error('Cannot remove a public shared index');
    return Boolean((await this.pool.query(`DELETE FROM ${this.table} WHERE namespace=$1 AND repository_id=$2 AND scope=$3`,this.params(id))).rowCount);
  }
  async dispose():Promise<void> {
    if(!this.scope)return;
    this.disposed=true;
    await this.pool.query(`DELETE FROM ${this.table} WHERE namespace=$1 AND scope=$2`,[this.namespace,this.scope.id]);
  }
}
