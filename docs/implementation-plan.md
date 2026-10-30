# WhyCode Implementation Plan

## Delivery approach

Build a working vertical slice early: index a small repository, connect one file to one commit and pull request, answer one evidence-backed question, and show an abstention. Expand coverage only after that path works.

## Phase 1 — Foundation

- Establish the application structure and configuration validation.
- Add the health endpoint.
- Connect to Neo4j.
- Build the repository setup screen.
- Validate public GitHub repository input.

**Exit condition:** A user can submit a repository and receive a clear validation or indexing response.

## Phase 2 — Indexing

- Implement bounded GitHub fetching with pagination.
- Normalize repositories, files, commits, pull requests, issues, comments, and selected documents.
- Preserve source IDs, dates, authors, and canonical URLs.
- Add idempotent upserts and visible indexing status.

**Exit condition:** A real public repository can be indexed twice without duplicate entities.

## Phase 3 — Graph relationships

- Add constraints and indexes.
- Link files to commits and commits to pull requests where available.
- Link discussions, decisions, and supporting sources.
- Store provenance for inferred relationships.

**Exit condition:** A user can inspect a path from an affected file to its supporting repository history.

## Phase 4 — Retrieval and answers

- Resolve question terms to repository entities.
- Traverse the graph to find relevant evidence.
- Collect bounded excerpts and dates.
- Add temporal conflict checks.
- Generate evidence-constrained answers.
- Validate citations and implement abstention.

**Exit condition:** Direct questions produce cited answers and unsupported questions produce explicit abstentions.

## Phase 5 — UX completion

- Add evidence cards, confidence rationale, timelines, and graph-path views.
- Implement loading, empty, partial, and failure states.
- Add keyboard navigation, labels, focus states, and readable contrast.

**Exit condition:** The full investigation flow is understandable without developer assistance.

## Phase 6 — Optional enhancements

- Add Hindi/Hinglish output through Sarvam.
- Add full-text or vector retrieval as a supplement.
- Improve possible-supersession detection.

These enhancements must not delay or weaken the English evidence-backed path.

## Verification after each phase

- Run the narrowest relevant tests.
- Test against one real public repository as soon as the integration exists.
- Record warnings and limitations instead of hiding them.
- Keep the evaluation set updated as new behavior is added.
