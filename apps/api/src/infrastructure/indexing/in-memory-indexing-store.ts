import { IndexStatus, IndexedSnapshot } from '../../domain/indexing.js';
import { IndexingStore } from './indexing-store.js';

// Provides a deterministic local store until the Neo4j repository adapter is connected.
export class InMemoryIndexingStore implements IndexingStore {
  private readonly statuses = new Map<string, IndexStatus>();

  private readonly snapshots = new Map<string, IndexedSnapshot>();

  listStatuses(): IndexStatus[] { return [...this.statuses.values()]; }

  // Returns the latest indexing status for a stable repository ID.
  getStatus(repositoryId: string): IndexStatus | undefined {
    return this.statuses.get(repositoryId);
  }

  // Replaces status atomically so polling always receives a complete object.
  saveStatus(status: IndexStatus): void {
    this.statuses.set(status.repositoryId, status);
  }

  // Returns the latest normalized source snapshot for future retrieval work.
  getSnapshot(repositoryId: string): IndexedSnapshot | undefined {
    return this.snapshots.get(repositoryId);
  }

  // Uses repository identity as the upsert key to prevent duplicate snapshots.
  saveSnapshot(snapshot: IndexedSnapshot): void {
    this.snapshots.set(snapshot.repositoryId, snapshot);
  }

  removeRepository(repositoryId: string): boolean {
    if (!this.statuses.has(repositoryId)) return false;
    this.statuses.delete(repositoryId);
    this.snapshots.delete(repositoryId);
    return true;
  }
}
