# WhyCode Technical Architecture

## Architectural goal

Keep the MVP simple to run while ensuring that repository relationships genuinely influence the answers users receive.

## System components

### Web application

Provides repository setup, indexing status, question input, answers, evidence cards, timelines, and the optional relationship view.

### API service

Validates requests, manages indexing jobs, resolves questions to repository entities, retrieves evidence, and returns stable response shapes.

### GitHub connector

Fetches bounded repository history through the GitHub REST API. It handles pagination, rate limits, canonical URLs, source identifiers, and partial failures.

### Graph repository

Stores normalized entities and explicit relationships in Neo4j. It provides idempotent upserts, relationship traversal, and bounded subgraphs for the interface.

### Retrieval service

Combines entity matching, graph traversal, source excerpts, and optional full-text or vector search. Graph relationships are required for the primary retrieval path.

### Answer provider

Uses a configurable server-side model to turn the retrieved evidence into a concise response. It may suggest candidate decisions or synthesize language, but it cannot create source IDs, timestamps, relationships, or citations.

### Optional language provider

Sarvam can translate or generate Hindi/Hinglish output after the English evidence-backed response has been prepared.

## Request flow

```text
Browser
  → API route
  → request validation
  → entity resolution
  → graph traversal and evidence retrieval
  → temporal and contradiction checks
  → evidence-constrained answer generation
  → citation validation
  → response
  → interface
```

## Recommended stack

- React, Vite, TypeScript, and custom CSS for the interface.
- Node.js, TypeScript, and Express for the API.
- GitHub REST API for repository data.
- Neo4j AuraDB or local Neo4j for the graph.
- Parameterized Cypher queries.
- Schema validation for request and response payloads.
- Provider adapters for answer generation and optional language support.

## Reliability expectations

- Indexing is bounded and resumable where possible.
- Repeated indexing is idempotent.
- Partial failures are recorded and visible.
- Rate limits use bounded retries and backoff.
- Every source record retains a canonical URL and stable identifier.
- Answer citations are validated against retrieved records before they reach the user.
- Provider or database failures result in a clear error or evidence-only fallback.

## Security boundaries

- Tokens and provider keys stay on the server.
- Repository content is treated as untrusted input.
- User-provided repository names and questions are validated and bounded.
- Cypher queries are parameterized.
- Logs exclude secrets and unnecessary full source content.

## Operational limits for the MVP

- Public repositories only.
- One active investigation at a time, with up to 30 saved public repository indexes.
- Bounded commits, pull requests, issues, comments, and documents.
- Bounded graph traversal depth and answer context size.
- Manual refresh rather than scheduled synchronization.

## Implemented reliability and security

A single-process atomic file store retains index jobs, normalized source snapshots, and daily answer budgets. Browser investigations are stored locally and can be cleared. New graph commits use repository-scoped identities; old graph nodes remain intact. Code/document retrieval is pinned to a default-branch revision and records visible coverage limits.

Answer generation produces atomic claims and verbatim quotations, followed by deterministic quotation matching and a separate entailment-review model pass. Only reviewed claim text is rendered. Model review is fallible and labeled accordingly. Temporal classifications require evidence beyond dates.

The local API binds to loopback. Production requires a workspace password and HTTPS origin; cookies, origin checks, CSP, input bounds, request limits, quotas, and concurrency caps protect the single-owner workspace. See [security-and-reliability.md](security-and-reliability.md) and [deployment.md](deployment.md) for the implementation boundaries.
