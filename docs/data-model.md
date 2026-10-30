# WhyCode Data Model

## Modeling principles

- Every source object has a stable identifier and canonical URL where one exists.
- Relationships are explicit and queryable.
- Extracted decisions remain distinguishable from directly sourced facts.
- Every inferred relationship records its provenance and confidence.
- Historical decisions remain available after later decisions supersede them.

## Core entities

| Entity | Purpose | Key fields |
| --- | --- | --- |
| Repository | Indexed GitHub repository | `id`, `fullName`, `url`, `defaultBranch` |
| File | Source file or path | `id`, `path`, `repositoryId` |
| ScopedCommit | A repository change | `id`, `repositoryId`, `sha`, `message`, `authorLogin`, `committedAt`, `url` |
| PullRequest | A proposed repository change | `number`, `title`, `state`, `authorLogin`, `createdAt`, `mergedAt`, `url` |
| Issue | A problem, request, or discussion | `number`, `title`, `state`, `authorLogin`, `createdAt`, `closedAt`, `url` |
| Comment | A discussion entry | `id`, `body`, `authorLogin`, `createdAt`, `url`, `sourceType` |
| Person | A repository participant | `login`, `displayName` |
| Decision | A rationale or implementation choice | `id`, `statement`, `status`, `decisionDate`, `confidence`, `extractionMethod` |
| Incident | A production or operational event | `id`, `title`, `occurredAt`, `url` |
| DesignDocument | An in-repository design source | `id`, `path`, `title`, `url`, `updatedAt` |
| ConfigKey | A configuration option | `id`, `name`, `filePath` |

## Relationships

```text
Repository -[:CONTAINS]-> File
Person -[:AUTHORED]-> Commit / PullRequest / Issue / Comment
Commit -[:CHANGED]-> File
PullRequest -[:CONTAINS_COMMIT]-> Commit
PullRequest -[:REFERENCES]-> Issue
PullRequest -[:HAS_COMMENT]-> Comment
Issue -[:HAS_COMMENT]-> Comment
Decision -[:SUPPORTED_BY]-> Commit / PullRequest / Issue / Comment / DesignDocument
Decision -[:AFFECTS]-> File / ConfigKey / service or module entity
Decision -[:SUPERSEDES]-> Decision
Incident -[:MOTIVATED]-> Decision or Commit
```

The `MOTIVATED` relationship should only be created when explicit evidence supports it. Similar timestamps are not enough.

## Provenance

Inferred entities and relationships should retain:

- Source identifier.
- Source URL.
- Extraction method.
- Confidence label.
- Extraction timestamp.
- Supporting excerpt where appropriate.

For a decision candidate, store whether it came from an explicit source statement, a structured GitHub relationship, a commit message, or an inference across multiple records.

## Decision status

Supported statuses are:

- `proposed`
- `accepted`
- `superseded`
- `reversed`
- `rejected`
- `unknown`

The status should remain `unknown` when the available evidence does not justify a stronger claim.

## Identifier and indexing rules

- Repository IDs should be stable across indexing runs.
- Commit identity is `repositoryId:commit:sha`; identical SHAs in forks are separate scoped records. Legacy `Commit` nodes are preserved for rollback.
- Pull requests and issues should be scoped to their repository.
- Comments should use the source platform's stable ID.
- Upserts must use source identifiers rather than titles or text similarity.
- Source URLs should be preserved exactly when returned by GitHub, or constructed only from validated identifiers.

## Implemented representation (v0.2)

`File` also holds a bounded pinned source snapshot (`content`, `revision`, `url`, `kind`, `symbols`, `current`). Documentation uses `kind=document` on the same File boundary; symbol names are lexical retrieval hints. `CHANGED` relationships retain GitHub change status and bounded diff excerpts. Pull requests and issues retain bounded descriptions. Direct commit-to-PR associations complement merge-SHA matching. `ScopedCommit` replaces globally owned Commit records for all new reads/writes; no legacy nodes are deleted.

Decision/Incident/ConfigKey entities and explicit SUPERSEDES relationships above describe the longer-term conceptual model; this release derives reviewed temporal assessments from retrieved sources and does not persist a complete decision registry. See [security and reliability](security-and-reliability.md).
