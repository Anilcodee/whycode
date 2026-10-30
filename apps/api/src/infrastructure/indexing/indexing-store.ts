import { IndexStatus, IndexedSnapshot } from '../../domain/indexing.js';

// Defines the persistence boundary for indexing status and normalized source records.
export interface IndexingStore {
  readonly recoverJobs?: boolean;
  listStatuses(): IndexStatus[] | Promise<IndexStatus[]>;
  getStatus(repositoryId: string): IndexStatus | undefined | Promise<IndexStatus | undefined>;
  saveStatus(status: IndexStatus): void | Promise<void>;
  getSnapshot(repositoryId: string): IndexedSnapshot | undefined | Promise<IndexedSnapshot | undefined>;
  saveSnapshot(snapshot: IndexedSnapshot, jobId?: string): void | Promise<void>;
  claimJob?(status: IndexStatus, expectedJobId?:string): Promise<boolean>;
  renewJob?(id: string, jobId: string): Promise<void>;
  recoverableJobs?(): Promise<IndexStatus[]>;
  readonly recoveryEnabled?: boolean;
}
