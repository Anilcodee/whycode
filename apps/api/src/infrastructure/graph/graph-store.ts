import { IndexedSnapshot } from '../../domain/indexing.js';

// Reports the volume written during one snapshot save for status and demo visibility.
export interface GraphWriteSummary {
  nodesWritten: number;
  relationshipsWritten: number;
  durationMs: number;
}

// Defines the graph persistence boundary for normalized repository history.
export interface GraphStore {
  // Upserts one snapshot's entities and relationships idempotently, keyed by stable source IDs.
  saveRepositoryHistory(snapshot: IndexedSnapshot, generation?: number): Promise<GraphWriteSummary>;
}
