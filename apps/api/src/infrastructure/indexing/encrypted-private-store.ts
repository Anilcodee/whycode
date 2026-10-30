import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { SessionVault } from '../session-vault.js';
import { InMemoryIndexingStore } from './in-memory-indexing-store.js';
import type { IndexStatus, IndexedSnapshot } from '../../domain/indexing.js';

type State = { expires: number; statuses: IndexStatus[]; snapshots: IndexedSnapshot[] };

/** Private snapshots are encrypted and scoped to one account session, never shared publicly. */
export class EncryptedPrivateStore extends InMemoryIndexingStore {
  static pruneExpired(directory: string, key: string) {
    const path = join(directory, 'private-indexes');
    if (!existsSync(path)) return;
    for (const name of readdirSync(path).filter(name => /^[a-f0-9]{64}\.enc$/.test(name))) {
      const vault = new SessionVault<State>(path, key, name);
      const state = vault.load().get('state');
      if (!state || state.expires <= Date.now()) vault.remove();
    }
  }
  static removeSession(directory: string, key: string, sessionId: string) {
    const filename = createHash('sha256').update(sessionId).digest('hex') + '.enc';
    new SessionVault<State>(join(directory, 'private-indexes'), key, filename).remove();
  }
  private readonly vault: SessionVault<State>;
  private disposed = false;
  constructor(directory: string, key: string, sessionId: string, private readonly expires: number) {
    super();
    const filename = createHash('sha256').update(sessionId).digest('hex') + '.enc';
    this.vault = new SessionVault(join(directory, 'private-indexes'), key, filename);
    const saved = this.vault.load().get('state');
    if (saved && saved.expires > Date.now()) {
      for (const snapshot of saved.snapshots) super.saveSnapshot(snapshot);
      for (const status of saved.statuses) super.saveStatus(['running', 'queued'].includes(status.status)
        ? { ...status, status: 'failed', errors: ['Private indexing was interrupted. Refresh to retry after authorization.'] }
        : status);
    } else if (saved) this.vault.remove();
  }
  private persist() {
    if (this.disposed) return;
    if (Date.now() >= this.expires) { this.dispose(); return; }
    const statuses = super.listStatuses();
    const snapshots = statuses.map(status => super.getSnapshot(status.repositoryId)).filter((item): item is IndexedSnapshot => Boolean(item));
    this.vault.save(new Map([['state', { expires: this.expires, statuses, snapshots }]]));
  }
  override saveStatus(status: IndexStatus) { if (this.disposed) return; super.saveStatus(status); this.persist(); }
  override saveSnapshot(snapshot: IndexedSnapshot) { if (this.disposed) return; super.saveSnapshot(snapshot); this.persist(); }
  override removeRepository(id: string) { const removed = super.removeRepository(id); this.persist(); return removed; }
  dispose() { this.disposed = true; this.vault.remove(); }
}
