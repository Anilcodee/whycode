import {
  IndexedSnapshot,
} from './indexing.js';
import {
  extractIssueReferences,
  fileNodeId,
  issueId,
  pullRequestId,
  truncateBody,
} from './graph-ids.js';

// Provenance labels recorded on inferred relationships per the data model.
const COMMIT_REFERENCE_METHOD = 'commit_message_reference';
const PULL_REQUEST_REFERENCE_METHOD = 'pull_request_title_reference';
const INFERRED_CONFIDENCE = 'low';

export interface GraphPayloads {
  repository: {
    repositoryId: string;
    fullName: string;
    url?: string;
    defaultBranch?: string;
  };
  people: Array<{ login: string }>;
  files: Array<{ id: string; path: string; props: Record<string, string | boolean | string[] | undefined> }>;
  commits: Array<{ sha: string; props: Record<string, string | undefined> }>;
  pullRequests: Array<{ id: string; props: Record<string, string | number | boolean | undefined> }>;
  issues: Array<{ id: string; props: Record<string, string | number | boolean | undefined> }>;
  comments: Array<{ id: string; props: Record<string, string | number | boolean | undefined> }>;
  authoredCommits: Array<{ login: string; sha: string }>;
  authoredPullRequests: Array<{ login: string; id: string }>;
  authoredIssues: Array<{ login: string; id: string }>;
  authoredComments: Array<{ login: string; id: string }>;
  changedFiles: Array<{ sha: string; fileId: string; status?: string; patch?: string }>;
  pullRequestCommits: Array<{ id: string; sha: string }>;
  commitReferences: Array<{ sha: string; issueId: string }>;
  pullRequestReferences: Array<{ id: string; issueId: string }>;
  commentParents: Array<{ id: string; parentNumber: number }>;
}

// Converts one normalized snapshot into batched rows for parameterized Cypher upserts.
// Node properties are grouped under `props` so MERGE keys stay separate from writable fields.
export function buildGraphPayloads(snapshot: IndexedSnapshot): GraphPayloads {
  const people = new Set<string>();
  const trackedAuthors = Array.from(new Set([
    ...snapshot.commits.map((commit) => commit.authorLogin),
    ...snapshot.pullRequests.map((pullRequest) => pullRequest.authorLogin),
    ...snapshot.issues.map((issue) => issue.authorLogin),
    ...snapshot.comments.map((comment) => comment.authorLogin),
  ].filter((login): login is string => Boolean(login))));
  for (const login of trackedAuthors) {
    people.add(login);
  }

  const indexedIssueNumbers = new Set(snapshot.issues.map((issue) => issue.number));

  const files = snapshot.files.map((path) => ({
    id: fileNodeId(snapshot.repositoryId, path),
    path,
    props: (() => {
      const source = snapshot.sources?.find(item => item.path === path);
      return source ? { content: source.content, url: source.url, revision: source.revision, kind: source.kind, symbols: source.symbols, current: true } : { current: false };
    })(),
  }));

  const commits = snapshot.commits.map((commit) => ({
    sha: commit.sha,
    props: defined({
      repositoryId: snapshot.repositoryId,
      id: `${snapshot.repositoryId}:commit:${commit.sha}`,
      message: commit.message,
      authorLogin: commit.authorLogin,
      committedAt: commit.committedAt,
      url: commit.url,
    }),
  }));

  const pullRequests = snapshot.pullRequests.map((pullRequest) => ({
    id: pullRequestId(snapshot.repositoryId, pullRequest.number),
    props: defined({
      repositoryId: snapshot.repositoryId,
      number: pullRequest.number,
      title: pullRequest.title,
      ...truncateBody(pullRequest.body ?? ''),
      state: pullRequest.state,
      authorLogin: pullRequest.authorLogin,
      createdAt: pullRequest.createdAt,
      mergedAt: pullRequest.mergedAt,
      mergeCommitSha: pullRequest.mergeCommitSha,
      url: pullRequest.url,
    }),
  }));

  const issues = snapshot.issues.map((issue) => ({
    id: issueId(snapshot.repositoryId, issue.number),
    props: defined({
      repositoryId: snapshot.repositoryId,
      number: issue.number,
      title: issue.title,
      ...truncateBody(issue.body ?? ''),
      state: issue.state,
      authorLogin: issue.authorLogin,
      createdAt: issue.createdAt,
      closedAt: issue.closedAt,
      url: issue.url,
    }),
  }));

  const comments = snapshot.comments.map((comment) => ({
    id: String(comment.id),
    props: defined({
      repositoryId: snapshot.repositoryId,
      ...truncateBody(comment.body),
      authorLogin: comment.authorLogin,
      createdAt: comment.createdAt,
      url: comment.url,
      sourceType: comment.sourceType,
      parentNumber: comment.parentNumber,
    }),
  }));

  const changedFiles = snapshot.commitFiles.flatMap((commitFiles) => (
    commitFiles.files.map((path) => ({
      sha: commitFiles.sha,
      fileId: fileNodeId(snapshot.repositoryId, path),
      status: commitFiles.changes?.find(change => change.path === path)?.status,
      patch: commitFiles.changes?.find(change => change.path === path)?.patch,
    }))
  ));

  // Only merged pull requests whose merge commit was fetched can be linked to commits.
  const indexedCommitShas = new Set(snapshot.commits.map((commit) => commit.sha));
  const pullRequestCommits = snapshot.pullRequests
    .filter((pullRequest) => pullRequest.mergeCommitSha && indexedCommitShas.has(pullRequest.mergeCommitSha))
    .map((pullRequest) => ({
      id: pullRequestId(snapshot.repositoryId, pullRequest.number),
      sha: pullRequest.mergeCommitSha as string,
    }));

  for (const link of snapshot.commitPullRequests ?? []) {
    const id = pullRequestId(snapshot.repositoryId, link.number);
    if (indexedCommitShas.has(link.sha) && snapshot.pullRequests.some(pr => pr.number === link.number)
      && !pullRequestCommits.some(item => item.id === id && item.sha === link.sha)) pullRequestCommits.push({ id, sha: link.sha });
  }

  // Commit messages and pull request titles may reference issues; only indexed issues are linked.
  const commitReferences = snapshot.commits.flatMap((commit) => (
    extractIssueReferences(commit.message)
      .filter((number) => indexedIssueNumbers.has(number))
      .map((number) => ({
        sha: commit.sha,
        issueId: issueId(snapshot.repositoryId, number),
      }))
  ));

  const pullRequestReferences = snapshot.pullRequests.flatMap((pullRequest) => (
    extractIssueReferences(pullRequest.title)
      .filter((number) => indexedIssueNumbers.has(number))
      .map((number) => ({
        id: pullRequestId(snapshot.repositoryId, pullRequest.number),
        issueId: issueId(snapshot.repositoryId, number),
      }))
  ));

  const discussionNumbers = new Set([...indexedIssueNumbers, ...snapshot.pullRequests.map((pr) => pr.number)]);
  const commentParents = snapshot.comments.flatMap((comment) => (
    comment.parentNumber !== undefined && discussionNumbers.has(comment.parentNumber)
      ? [{ id: String(comment.id), parentNumber: comment.parentNumber }]
      : []
  ));

  return {
    repository: defined({
      repositoryId: snapshot.repositoryId,
      fullName: snapshot.fullName ?? snapshot.repository,
      url: snapshot.repositoryUrl,
      defaultBranch: snapshot.defaultBranch,
    }),
    people: Array.from(people).map((login) => ({ login })),
    files,
    commits,
    pullRequests,
    issues,
    comments,
    authoredCommits: snapshot.commits
      .filter((commit) => commit.authorLogin)
      .map((commit) => ({ login: commit.authorLogin as string, sha: commit.sha })),
    authoredPullRequests: snapshot.pullRequests
      .filter((pullRequest) => pullRequest.authorLogin)
      .map((pullRequest) => ({ login: pullRequest.authorLogin as string, id: pullRequestId(snapshot.repositoryId, pullRequest.number) })),
    authoredIssues: snapshot.issues
      .filter((issue) => issue.authorLogin)
      .map((issue) => ({ login: issue.authorLogin as string, id: issueId(snapshot.repositoryId, issue.number) })),
    authoredComments: snapshot.comments
      .filter((comment) => comment.authorLogin)
      .map((comment) => ({ login: comment.authorLogin as string, id: String(comment.id) })),
    changedFiles,
    pullRequestCommits,
    commitReferences,
    pullRequestReferences,
    commentParents,
  };
}

// Drops undefined keys so the driver never receives unset property values.
function defined<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, propertyValue]) => propertyValue !== undefined),
  ) as T;
}
