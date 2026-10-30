import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { IndexStatus, IndexedSnapshot } from '../../domain/indexing.js';
import { IndexingStore } from './indexing-store.js';

// Single-process durable store. Atomic replacement keeps the previous file intact on crash.
export class FileIndexingStore implements IndexingStore {
  readonly recoverJobs = true;
  private readonly statuses = new Map<string, IndexStatus>();
  constructor(private readonly directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    for (const name of readdirSync(directory).filter(name => name.endsWith('.status.json'))) {
      const status = this.read<IndexStatus>(name);
      if (status) this.statuses.set(status.repositoryId, status);
    }
    for (const status of this.listStatuses()) {
      if (status.status === 'queued' || status.status === 'running') {
        if (status.request && status.request.recoveries < 3) {
          this.saveStatus({ ...status, status: 'queued', progress: { ...status.progress, phase: 'Waiting for restart recovery' } });
          continue;
        }
        this.saveStatus({ ...status, status: 'failed', completedAt: new Date().toISOString(),
          progress: { ...status.progress, phase: 'Interrupted' },
          errors: ['Indexing was interrupted by a server restart. Retry to resume with a fresh snapshot.'] });
      }
    }
  }
  private key(id: string) { return createHash('sha256').update(id).digest('hex'); }
  private read<T>(name: string): T | undefined {
    const path = join(this.directory, name);
    if (!existsSync(path)) return undefined;
    try { return JSON.parse(readFileSync(path, 'utf8')) as T; }
    catch { throw new Error('Saved workspace data could not be read. Restore the data directory from backup.'); }
  }
  private write(name: string, value: unknown) {
    const destination = join(this.directory, name);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
    renameSync(temporary, destination);
  }
  listStatuses(): IndexStatus[] {
    return [...this.statuses.values()].map(status => structuredClone(status))
      .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
  }
  getStatus(id: string) {
    const status = this.statuses.get(id);
    return status ? structuredClone(status) : undefined;
  }
  saveStatus(status: IndexStatus) {
    // Publish in memory only after the durable replacement succeeds.
    const saved = structuredClone(status);
    this.write(`${this.key(saved.repositoryId)}.status.json`, saved);
    this.statuses.set(saved.repositoryId, saved);
  }
  getSnapshot(id: string) { return this.read<IndexedSnapshot>(`${this.key(id)}.snapshot.json`); }
  saveSnapshot(snapshot: IndexedSnapshot) { this.write(`${this.key(snapshot.repositoryId)}.snapshot.json`, snapshot); }
  reserveAnswer(limit: number): boolean {
    const date = new Date().toISOString().slice(0, 10);
    const previous = this.read<{ date: string; count: number }>('usage.json');
    const count = previous?.date === date ? previous.count : 0;
    if (count >= limit) return false;
    this.write('usage.json', { date, count: count + 1 });
    return true;
  }
}
