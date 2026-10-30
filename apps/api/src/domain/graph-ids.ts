// Builds stable graph identifiers so repeated indexing runs upsert instead of duplicating.
export function pullRequestId(repositoryId: string, number: number): string {
  return `${repositoryId}:pull:${number}`;
}

// Issues and pull requests share a number space scoped to their repository.
export function issueId(repositoryId: string, number: number): string {
  return `${repositoryId}:issue:${number}`;
}

// File paths are only unique inside a repository, so the ID carries the repository identity.
export function fileNodeId(repositoryId: string, path: string): string {
  return `${repositoryId}:file:${path}`;
}

// Extracts issue numbers from free text such as "fixes #42" while staying bounded for safety.
export function extractIssueReferences(text: string, limit = 20): number[] {
  const references: number[] = [];
  const pattern = /#(\d+)/g;

  for (const match of text.matchAll(pattern)) {
    const number = Number(match[1]);
    if (Number.isInteger(number) && number > 0 && !references.includes(number)) {
      references.push(number);
    }
    if (references.length >= limit) {
      break;
    }
  }

  return references;
}

// Reads the discussion number out of GitHub API URLs such as .../issues/12 or .../pulls/12.
export function discussionNumberFromApiUrl(url: string | undefined): number | undefined {
  if (!url) {
    return undefined;
  }

  const match = url.match(/\/(?:issues|pulls?)\/(\d+)/);
  return match ? Number(match[1]) : undefined;
}

// Keeps stored discussion bodies bounded so one oversized comment cannot bloat the graph.
export function truncateBody(body: string, maxLength = 4_000): { body: string; bodyTruncated: boolean } {
  if (body.length <= maxLength) {
    return { body, bodyTruncated: false };
  }

  return { body: body.slice(0, maxLength), bodyTruncated: true };
}
