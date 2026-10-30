# WhyCode API Contract

These endpoints describe the core MVP contract; response shapes may include additive coverage and validation fields. They are versionable contracts as the implementation grows.

## `POST /api/repositories/ingest`

Starts indexing for a public GitHub repository.

### Request

```json
{
  "repository": "owner/repository",
  "limits": {
    "commits": 500,
    "pullRequests": 100,
    "issues": 100,
    "comments": 500
  }
}
```

### Response

```json
{
  "repositoryId": "github:owner/repository",
  "jobId": "index-job-id",
  "status": "queued"
}
```

The operation must validate the repository before creating a job and must not expose credentials.

## `GET /api/repositories/:id/status`

Returns the current indexing state.

```json
{
  "repositoryId": "github:owner/repository",
  "status": "complete",
  "startedAt": "2026-10-27T10:00:00Z",
  "completedAt": "2026-10-27T10:02:10Z",
  "lastSuccessfulIndexAt": "2026-10-27T10:02:10Z",
  "counts": {
    "commits": 320,
    "files": 180,
    "pullRequests": 80,
    "issues": 100,
    "comments": 240
  },
  "warnings": [],
  "errors": []
}
```

Supported statuses are `queued`, `running`, `partial`, `complete`, and `failed`.

## `POST /api/ask`

Answers a question using the indexed repository.

### Request

```json
{
  "repositoryId": "github:owner/repository",
  "question": "Why does the client retry three times?",
  "language": "en"
}
```

Supported languages are `en`, `hi`, and `hinglish`. English is the default.

### Response

```json
{
  "answer": "The client retries three times because...",
  "abstained": false,
  "confidence": {
    "label": "high",
    "reason": "A pull request explicitly describes the retry policy and the related commit changed the client configuration."
  },
  "temporalStatus": "current",
  "evidence": [
    {
      "type": "pull_request",
      "title": "Use bounded retries for transient requests",
      "url": "https://github.com/owner/repository/pull/42",
      "date": "2026-01-10T12:00:00Z",
      "author": "maintainer",
      "excerpt": "...",
      "relationToAnswer": "direct support"
    }
  ],
  "decisionTimeline": [],
  "graphPath": [],
  "warnings": []
}
```

When evidence is insufficient, `abstained` must be `true`, the answer must explain why, and the response must not include fabricated citations.

## `GET /api/repositories/:id/graph`

Returns a bounded subgraph for the relationship view.

```json
{
  "nodes": [
    { "id": "file:src/client.ts", "type": "file", "label": "src/client.ts" }
  ],
  "edges": [
    { "from": "commit:abc123", "to": "file:src/client.ts", "type": "CHANGED" }
  ]
}
```

The response should contain only nodes and edges relevant to the selected question or entity.

## `GET /api/health`

Returns dependency health without secrets.

```json
{
  "status": "ok",
  "dependencies": {
    "database": "ok",
    "github": "ok",
    "answerProvider": "configured"
  }
}
```

## Error format

```json
{
  "error": {
    "code": "INVALID_REPOSITORY",
    "message": "Enter a valid public GitHub repository.",
    "retryable": false
  }
}
```

Expected error codes include `INVALID_REPOSITORY`, `REPOSITORY_NOT_FOUND`, `INDEX_NOT_READY`, `RATE_LIMITED`, `PROVIDER_UNAVAILABLE`, `DATABASE_UNAVAILABLE`, and `VALIDATION_ERROR`.

## Workspace access and v0.2 additions

All state-changing requests require `Content-Type: application/json` and `X-WhyCode-Request: 1`. When `APP_PASSWORD` is set, repository, question, and dependency-health endpoints require the workspace session cookie. Authentication routes are `GET /api/auth/session`, `POST /api/auth/login` (`{password}`), and `POST /api/auth/logout`. Production cookies are Secure, HttpOnly, SameSite=Strict; the API requires HTTPS.

`GET /api/repositories` returns `{repositories: IndexStatus[]}` from durable storage. `GET /healthz` returns a minimal public liveness response. Index status includes optional `coverage` with pinned revision, indexed/total file counts, truncated-tree status, and explicit limits.

Answer evidence types include `file` and `document`, with optional `revision`/`current`. `validation` includes reviewed atomic claims and their exact source quotations; `temporalReason` explains the classification. Unreviewed or unsupported explanations return abstentions. High model confidence is conservatively capped at medium after review. Rate/budget/concurrency failures use 429, unauthorized requests use 401, rejected host/origin/request headers use 403, oversized bodies use 413, and insecure production requests use 426. Error messages omit raw upstream/database diagnostics.
