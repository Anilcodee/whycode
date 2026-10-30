// Represents the lifecycle of one repository indexing job.
export type IndexingStatus = 'queued' | 'running' | 'partial' | 'complete' | 'failed';

// Controls the maximum number of GitHub records fetched in one indexing run.
export interface IndexLimits {
  commits: number;
  pullRequests: number;
  issues: number;
  comments: number;
}

// Provides safe defaults that are suitable for local development and a live demo.
export const DEFAULT_INDEX_LIMITS: IndexLimits = {
  commits: 25,
  pullRequests: 25,
  issues: 25,
  comments: 50,
};

// Reports the number of source records available after an indexing run.
export interface SourceCounts {
  commits: number;
  files: number;
  pullRequests: number;
  issues: number;
  comments: number;
  documents: number;
}

// Describes the current operation so the interface can show meaningful progress.
export interface IndexProgress {
  phase: string;
  completed: number;
  total: number;
}

// Stores the public state returned by the repository status endpoint.
export interface IndexStatus {
  generation?: number;
  request?: { limits: IndexLimits; append: boolean; baseIndexedAt?: string; recoveries: number };
  repositoryId: string;
  repository: string;
  jobId: string;
  status: IndexingStatus;
  startedAt?: string;
  completedAt?: string;
  lastSuccessfulIndexAt?: string;
  counts: SourceCounts;
  progress: IndexProgress;
  warnings: string[];
  errors: string[];
  graph?: GraphWriteReport;
  version?: number;
  history?: { head: string; offset: number; hasMore: boolean; oldestAt?: string; newestAt?: string };
  coverage?: { revision: string; indexedFiles: number; totalFiles: number; truncatedTree: boolean; limits: string[] };
}

// Retains the normalized source records needed by later graph and retrieval work.
export interface IndexedSnapshot {
  repositoryId: string;
  repository: string;
  indexedAt: string;
  counts: SourceCounts;
  commits: IndexedCommit[];
  pullRequests: IndexedPullRequest[];
  issues: IndexedIssue[];
  comments: IndexedComment[];
  files: string[];
  commitFiles: IndexedCommitFiles[];
  commitPullRequests?: Array<{ sha: string; number: number }>;
  fullName?: string;
  repositoryUrl?: string;
  defaultBranch?: string;
  revision?: string;
  sources?: IndexedSource[];
  coverage?: IndexStatus['coverage'];
  history?: IndexStatus['history'];
}

// Represents the source fields needed from a GitHub commit summary.
export interface IndexedCommit {
  sha: string;
  message: string;
  authorLogin?: string;
  committedAt?: string;
  url: string;
}

// Represents the source fields needed from a GitHub pull request.
export interface IndexedPullRequest {
  number: number;
  title: string;
  body?: string;
  state: string;
  authorLogin?: string;
  createdAt: string;
  mergedAt?: string;
  mergeCommitSha?: string;
  url: string;
}

// Represents the source fields needed from a GitHub issue.
export interface IndexedIssue {
  number: number;
  title: string;
  body?: string;
  state: string;
  authorLogin?: string;
  createdAt: string;
  closedAt?: string;
  url: string;
}

// Represents the source fields needed from a GitHub discussion comment.
export interface IndexedComment {
  id: number;
  body: string;
  authorLogin?: string;
  createdAt: string;
  url: string;
  sourceType: 'issue_comment' | 'review_comment';
  parentNumber?: number;
}

// Lists the files one commit touched so commit-to-file relationships can be stored.
export interface IndexedCommitFiles {
  sha: string;
  files: string[];
  changes?: Array<{ path: string; status: string; patch?: string }>;
}

// Reports the outcome of writing one snapshot into the graph store.
export interface GraphWriteReport {
  status: 'written' | 'skipped' | 'failed';
  nodes?: number;
  relationships?: number;
  detail?: string;
}

export interface IndexedSource {
  path: string;
  content: string;
  url: string;
  revision: string;
  kind: 'file' | 'document';
  symbols: string[];
  truncated: boolean;
}
