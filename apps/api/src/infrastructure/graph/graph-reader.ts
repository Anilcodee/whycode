// A repository record the question text matched during entity resolution.
export interface ResolvedEntity {
  kind: 'file' | 'commit' | 'discussion';
  key: string;
  title: string;
  score: number;
  matchedTerms?: string[];
}

// One retrieved history record with the provenance of how it was reached in the graph.
export interface RawEvidence {
  kind: 'commit' | 'pull_request' | 'issue' | 'comment' | 'file' | 'document';
  revision?: string;
  current?: boolean;
  id: string;
  title: string;
  excerpt?: string;
  date?: string;
  author?: string;
  url?: string;
  state?: string;
  relation: string;
  graphPath: string[];
}

// One node in a bounded subgraph returned for the relationship view.
export interface GraphNode {
  id: string;
  type: 'repository' | 'person' | 'file' | 'commit' | 'pull_request' | 'issue' | 'comment';
  label: string;
  url?: string;
}

// One relationship in a bounded subgraph returned for the relationship view.
export interface GraphEdge {
  from: string;
  to: string;
  type: string;
}

// A bounded set of nodes and edges centered on one entity, or a repository overview.
export interface GraphSubgraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  focus?: string;
}

// Defines the read side of the graph: entity resolution, bounded evidence traversal, and subgraphs.
export interface GraphReader {
  resolveEntities(repositoryId: string, tokens: string[]): Promise<ResolvedEntity[]>;
  collectEvidence(repositoryId: string, entities: ResolvedEntity[]): Promise<RawEvidence[]>;
  getSubgraph(repositoryId: string, focus?: string): Promise<GraphSubgraph>;
}
