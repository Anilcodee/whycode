import {
  IndexedComment,
  IndexedCommit,
  IndexedCommitFiles,
  IndexedIssue,
  IndexedPullRequest,
  IndexedSource,
} from '../../domain/indexing.js';
import { discussionNumberFromApiUrl } from '../../domain/graph-ids.js';

// Collects the per-commit changed paths plus the union of paths touched by the fetched commits.
export interface ChangedFilesResult {
  files: string[];
  commitFiles: IndexedCommitFiles[];
  limited: boolean;
}

interface GitHubRepositoryResponse {
  full_name: string;
  html_url: string;
  default_branch: string;
  private: boolean;
}

interface GitHubCommitResponse {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author?: { name?: string; date?: string };
  };
  author?: { login?: string };
}

interface GitHubCommitDetailResponse extends GitHubCommitResponse {
  files?: Array<{ filename: string; status?: string; patch?: string }>;
}

interface GitHubPullRequestResponse {
  number: number;
  title: string;
  body?: string | null;
  state: string;
  user?: { login?: string };
  created_at: string;
  merged_at?: string | null;
  merge_commit_sha?: string | null;
  html_url: string;
}

interface GitHubIssueResponse {
  number: number;
  title: string;
  body?: string | null;
  state: string;
  user?: { login?: string };
  created_at: string;
  closed_at?: string | null;
  html_url: string;
  pull_request?: unknown;
}

interface GitHubCommentResponse {
  id: number;
  body: string;
  user?: { login?: string };
  created_at: string;
  html_url: string;
  issue_url?: string;
  pull_request_url?: string;
}

// Caps detail requests so public GitHub rate limits remain usable during demos.
const MAX_COMMIT_DETAIL_REQUESTS = 50;

// Represents failures returned by GitHub with enough detail for user-facing errors.
export class GitHubApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

// Encapsulates GitHub REST access and keeps provider details out of indexing logic.
export class GitHubClient {
  constructor(
    private readonly apiUrl: string,
    private readonly token?: string,
    private readonly allowPrivate = false,
  ) {}

  // Confirms that the repository exists and returns its canonical metadata.
  async getRepository(repository: string): Promise<GitHubRepositoryResponse> {
    const result = await this.request<GitHubRepositoryResponse>(`/repos/${repository}`);
    if (result.private && !this.allowPrivate) {
      throw new GitHubApiError('Only public GitHub repositories are supported.', 400, false);
    }
    return result;
  }

  // Fetches bounded commit summaries and normalizes them for the application domain.
  async listCommits(repository: string, limit: number): Promise<IndexedCommit[]> {
    const records = await this.list<GitHubCommitResponse>(`/repos/${repository}/commits`, limit);
    return records.map((record) => ({
      sha: record.sha,
      message: record.commit.message,
      authorLogin: record.author?.login,
      committedAt: record.commit.author?.date,
      url: record.html_url,
    }));
  }

  // Pin every page to the same head so new commits cannot shift a continuation window.
  async listCommitWindow(repository: string, limit: number, cursor?: { head: string; offset: number }) {
    const head = cursor?.head ?? (await this.request<Array<{ sha: string }>>(`/repos/${repository}/commits?per_page=1`).catch(error => {
      if (error instanceof GitHubApiError && error.status === 409) {
        throw new GitHubApiError('This repository may be empty. Add a file and create the first commit on GitHub, then retry.', 409, false);
      }
      throw error;
    }).then(value => {
      const first = value[0];
      return first?.sha ?? '';
    }));
    if (!head) return { commits: [] as IndexedCommit[], history: { head: '', offset: 0, hasMore: false } };
    const offset = cursor?.offset ?? 0;
    const records: GitHubCommitResponse[] = [];
    let position = offset;
    let hasMore = false;
    while (records.length <= limit) {
      const page = Math.floor(position / 100) + 1;
      const batch = await this.request<GitHubCommitResponse[]>(`/repos/${repository}/commits?sha=${encodeURIComponent(head)}&per_page=100&page=${page}`);
      const available = batch.slice(position % 100);
      records.push(...available);
      position = page * 100;
      if (batch.length < 100 || records.length > limit) break;
    }
    hasMore = records.length > limit;
    const selected = records.slice(0, limit);
    const commits = selected.map(record => ({ sha: record.sha, message: record.commit.message, authorLogin: record.author?.login,
      committedAt: record.commit.author?.date, url: record.html_url }));
    return { commits, history: { head, offset: offset + commits.length, hasMore,
      newestAt: commits[0]?.committedAt, oldestAt: commits.at(-1)?.committedAt } };
  }

  // Fetches changed paths for each bounded commit so file-to-commit relationships are available.
  async listChangedFiles(repository: string, commits: IndexedCommit[]): Promise<ChangedFilesResult> {
    const files = new Set<string>();
    const detailCommits = commits.slice(0, this.token ? MAX_COMMIT_DETAIL_REQUESTS : 10);
    const details = await this.mapWithConcurrency(detailCommits, 5, (commit) => (
      this.request<GitHubCommitDetailResponse>(`/repos/${repository}/commits/${commit.sha}`)
    ));

    const commitFiles: IndexedCommitFiles[] = [];
    for (const [index, detail] of details.entries()) {
      const changedPaths = (detail.files ?? []).map((file) => file.filename);
      for (const file of changedPaths) {
        files.add(file);
      }
      commitFiles.push({ sha: detailCommits[index].sha, files: changedPaths, changes: (detail.files ?? []).map(file => ({ path: file.filename, status: file.status ?? 'modified', patch: file.patch?.slice(0, 2400) })) });
    }

    return {
      files: [...files].sort(),
      commitFiles,
      limited: commits.length > detailCommits.length,
    };
  }

  // Fetches pull request summaries needed to connect commits and discussions.
  async listPullRequests(repository: string, limit: number): Promise<IndexedPullRequest[]> {
    const records = await this.list<GitHubPullRequestResponse>(`/repos/${repository}/pulls?state=all&sort=updated&direction=desc`, limit);
    return records.map((record) => ({
      number: record.number,
      title: record.title,
      body: record.body ?? undefined,
      state: record.state,
      authorLogin: record.user?.login,
      createdAt: record.created_at,
      mergedAt: record.merged_at ?? undefined,
      mergeCommitSha: record.merge_commit_sha ?? undefined,
      url: record.html_url,
    }));
  }

  async listCommitAssociations(repository: string, commits: IndexedCommit[]): Promise<{ pullRequests: IndexedPullRequest[]; links: Array<{ sha: string; number: number }> }> {
    const selected = commits.slice(0, this.token ? 10 : 3);
    const results = await this.mapWithConcurrency(selected, 3, async commit => {
      const records = await this.request<GitHubPullRequestResponse[]>(`/repos/${repository}/commits/${commit.sha}/pulls?per_page=5`);
      return { sha: commit.sha, records };
    });
    const pullRequests = new Map<number, IndexedPullRequest>();
    const links: Array<{ sha: string; number: number }> = [];
    for (const result of results) for (const record of result.records) {
      links.push({ sha: result.sha, number: record.number });
      pullRequests.set(record.number, { number: record.number, title: record.title, body: record.body ?? undefined,
        state: record.state, authorLogin: record.user?.login, createdAt: record.created_at,
        mergedAt: record.merged_at ?? undefined, mergeCommitSha: record.merge_commit_sha ?? undefined, url: record.html_url });
    }
    return { pullRequests: [...pullRequests.values()], links };
  }

  // Fetches issue records while excluding pull requests represented by the pull request endpoint.
  async listIssues(repository: string, limit: number): Promise<IndexedIssue[]> {
    const records = await this.list<GitHubIssueResponse>(`/repos/${repository}/issues?state=all&sort=updated&direction=desc`, limit * 2);
    return records
      .filter((record) => !record.pull_request)
      .slice(0, limit)
      .map((record) => ({
        number: record.number,
        title: record.title,
        body: record.body ?? undefined,
        state: record.state,
        authorLogin: record.user?.login,
        createdAt: record.created_at,
        closedAt: record.closed_at ?? undefined,
        url: record.html_url,
      }));
  }

  // Fetches issue and pull request review comments under one bounded application limit.
  async listComments(repository: string, limit: number): Promise<IndexedComment[]> {
    const issueComments = await this.list<GitHubCommentResponse>(`/repos/${repository}/issues/comments?sort=updated&direction=desc`, limit);
    const comments: IndexedComment[] = issueComments.map((record) => ({
      id: record.id,
      body: record.body,
      authorLogin: record.user?.login,
      createdAt: record.created_at,
      url: record.html_url,
      sourceType: 'issue_comment',
      parentNumber: discussionNumberFromApiUrl(record.issue_url ?? record.pull_request_url),
    }));

    if (comments.length >= limit) {
      return comments.slice(0, limit);
    }

    const remaining = limit - comments.length;
    const reviewComments = await this.list<GitHubCommentResponse>(`/repos/${repository}/pulls/comments?sort=updated&direction=desc`, remaining);
    return comments.concat(reviewComments.map((record) => ({
      id: record.id,
      body: record.body,
      authorLogin: record.user?.login,
      createdAt: record.created_at,
      url: record.html_url,
      sourceType: 'review_comment' as const,
      parentNumber: discussionNumberFromApiUrl(record.issue_url ?? record.pull_request_url),
    })));
  }

  // Fetch a pinned revision; never index binaries, credentials, generated output, or unbounded blobs.
  async listSources(repository: string, branch: string): Promise<{ sources: IndexedSource[]; revision: string; totalFiles: number; truncatedTree: boolean }> {
    const head = await this.request<{ sha: string }>(`/repos/${repository}/commits/${encodeURIComponent(branch)}`);
    const tree = await this.request<{ tree: Array<{ path: string; type: string; size?: number; sha: string }>; truncated?: boolean }>(`/repos/${repository}/git/trees/${head.sha}?recursive=1`);
    const files = tree.tree.filter(item => item.type === 'blob');
    const permitted = files.filter(item => isIndexablePath(item.path) && (item.size ?? Infinity) <= 32_000)
      .sort((a, b) => Number(isDocument(b.path)) - Number(isDocument(a.path)) || a.path.localeCompare(b.path));
    let bytes = 0;
    const selected = permitted.filter(item => {
      if (bytes + (item.size ?? 0) > 500_000) return false;
      bytes += item.size ?? 0; return true;
    }).slice(0, this.token ? 80 : 10);
    const sources = await this.mapWithConcurrency(selected, 4, async (file): Promise<IndexedSource> => {
      const blob = await this.request<{ content: string; encoding: string }>(`/repos/${repository}/git/blobs/${file.sha}`);
      const content = blob.encoding === 'base64' ? Buffer.from(blob.content, 'base64').toString('utf8') : '';
      return { path: file.path, content, revision: head.sha, kind: isDocument(file.path) ? 'document' : 'file',
        url: `https://github.com/${repository}/blob/${head.sha}/${file.path.split('/').map(encodeURIComponent).join('/')}`,
        symbols: extractSymbols(content), truncated: false };
    });
    return { sources, revision: head.sha, totalFiles: files.length, truncatedTree: Boolean(tree.truncated) };
  }

  // Paginates GitHub responses without requesting more records than the caller needs.
  private async list<T>(path: string, limit: number): Promise<T[]> {
    if (limit <= 0) {
      return [];
    }

    const pageSize = Math.min(limit, 100);
    const records: T[] = [];
    let page = 1;

    while (records.length < limit) {
      const separator = path.includes('?') ? '&' : '?';
      const batch = await this.request<T[]>(`${path}${separator}per_page=${pageSize}&page=${page}`);
      records.push(...batch);

      if (batch.length < pageSize) {
        break;
      }

      page += 1;
    }

    return records.slice(0, limit);
  }

  // Limits concurrent detail requests so indexing stays responsive and rate-limit aware.
  private async mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = [];
    let nextIndex = 0;

    async function worker(): Promise<void> {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await mapper(items[currentIndex]);
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
    return results;
  }

  // Performs an authenticated or public GitHub request with consistent error handling.
  private async request<T>(path: string): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'WhyCode/0.1.0',
    };

    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    let response: Response;
    try {
      response = await fetch(`${this.apiUrl}${path}`, { headers, signal: AbortSignal.timeout(20_000) });
    } catch {
      throw new GitHubApiError('GitHub could not be reached or did not respond in time. Try indexing again.', 503, true);
    }

    if (!response.ok) {
      const retryable = response.status === 429 || response.status === 403;
      const message = response.status === 404
        ? this.allowPrivate ? 'The repository was not found or your GitHub App no longer has access.' : 'The GitHub repository was not found or is not public.'
        : response.status === 403
          ? this.allowPrivate ? 'GitHub access is limited or unavailable. Check the app permissions or wait before retrying.' : 'GitHub rate limits were reached. Add GITHUB_TOKEN and try again.'
          : `GitHub returned HTTP ${response.status}.`;
      throw new GitHubApiError(message, response.status, retryable);
    }

    return response.json() as Promise<T>;
  }
}

export function isDocument(path: string): boolean {
  return /(?:^|\/)(?:readme|changelog|contributing|architecture|adr)(?:\.|$)/i.test(path) || /\.(md|mdx|rst|txt)$/i.test(path);
}
export function isIndexablePath(path: string): boolean {
  if (/(?:^|\/)(?:\.git|node_modules|vendor|dist|build|coverage|\.next|\.env[^/]*|secrets?|credentials?)(?:\/|$)/i.test(path)) return false;
  if (/\.(?:pem|key|p12|pfx|lock|min\.js|map)$/i.test(path) || /(?:^|\/)(?:secrets?|credentials?)[._-]/i.test(path)) return false;
  return isDocument(path) || /\.(?:tsx?|jsx?|mjs|cjs|py|go|rs|java|cs|rb|php|c|cpp|h|sql|ya?ml|toml)$/i.test(path);
}
// Lexical symbol hints aid retrieval; these do not claim full semantic/AST coverage.
export function extractSymbols(content: string): string[] {
  const symbols = new Set<string>();
  const patterns = [/(?:function|class|def|func|fn)\s+([A-Za-z_$][\w$]*)/g, /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g];
  for (const pattern of patterns) for (const match of content.matchAll(pattern)) {
    symbols.add(match[1]); if (symbols.size >= 150) return [...symbols];
  }
  return [...symbols];
}
