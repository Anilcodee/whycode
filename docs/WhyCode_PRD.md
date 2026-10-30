# WhyCode — Product Requirements Document

*Why is the code like this? | Hackathon MVP | Version 1.0 | 27 October 2026*

## 1. Product Overview

WhyCode helps engineers understand the decisions behind an unfamiliar codebase. A developer can connect a public GitHub repository, ask a question about a file, configuration option, workaround, or architectural choice, and receive an answer supported by the repository's own history.

WhyCode brings together code changes, pull requests, issues, discussions, incidents, design documents, and the people involved in them. It presents the relevant evidence, dates, and relationships instead of offering an unsupported explanation. When the repository does not contain enough information, WhyCode says so clearly.

This document describes the product experience, MVP scope, functional requirements, technical direction, and criteria for a successful demonstration. It describes the intended product and does not imply that integrations or features are already complete.

## 2. Product Summary

| Item | Description |
| --- | --- |
| Product | WhyCode |
| Tagline | Understand why a codebase works the way it does. |
| Primary audience | Developers joining or maintaining an unfamiliar codebase |
| Secondary audience | Engineering leads, maintainers, incident responders, and teams handing over ownership |
| MVP repository source | Public GitHub repositories |
| Core outcome | Reduce the time needed to understand important implementation decisions and locate the evidence and people behind them |

### Product promise

Ask a question about a codebase and get a concise, useful answer grounded in real engineering history—not a plausible guess.

## 3. Problem Statement

Code shows what a system does today, but it rarely explains why it does it. The reasoning behind a retry limit, compatibility workaround, configuration flag, migration, or architectural choice may be scattered across commits, pull requests, issue threads, incident notes, design documents, and the memories of former maintainers.

Conventional keyword and vector search can find text about a topic without showing which decision led to the current implementation. Older decisions may also look current after a later change has reversed or replaced them. As a result, developers spend time reconstructing context, repeating investigations, or making changes that unintentionally remove an important safeguard.

WhyCode turns repository history into a time-aware knowledge graph. It follows the relationships between code and the discussions around it, then uses those relationships to retrieve evidence for each answer.

## 4. Goals and Non-Goals

### Goals

- Let a user connect a public GitHub repository and index a bounded amount of its history.
- Bring together commits, changed files, pull requests, reviews and comments where available, issues and comments, and selected design documents.
- Link code entities to the decisions, discussions, incidents, and people associated with them.
- Answer natural-language questions with citations to the original GitHub sources.
- Show the date, participants, supporting evidence, confidence rationale, and later contradictory or superseding evidence when available.
- Be explicit when evidence is absent, weak, or contradictory.
- Provide a focused web experience with repository status, question-and-answer, evidence cards, a decision timeline, and a compact relationship view.
- Support English first, with optional Hindi/Hinglish responses through Sarvam without changing the evidence standard.

### Non-goals for the hackathon MVP

- Claiming knowledge of private conversations or information that is not present in the indexed sources.
- Guaranteeing complete ingestion of every GitHub object or the full history of every repository.
- Automatically changing code, opening or merging pull requests, or contacting maintainers.
- Replacing code search or becoming a general-purpose coding assistant.
- Presenting a generated explanation as fact when the repository does not support it.
- Building multi-tenant enterprise deployment, SSO, billing, or production-scale observability.

## 5. Users and Core Use Cases

### Developer onboarding to an unfamiliar repository

**Need:** A developer finds a confusing function or configuration option and wants to understand why it exists before changing it.

**WhyCode outcome:** The developer asks a question and sees the relevant code history, decision discussion, dates, and source links.

### Maintainer investigating an implementation choice

**Need:** A maintainer finds a workaround or compatibility constraint and wants to trace it to the issue, incident, or pull request that motivated it.

**WhyCode outcome:** WhyCode connects the affected code to the supporting history and identifies the people involved where the repository provides that information.

### Engineering lead preparing a handover

**Need:** Ownership is changing and important decisions should remain discoverable after the original team moves on.

**WhyCode outcome:** The team can use the repository's history as a searchable record of decisions, dates, and supporting sources.

### Reviewer checking whether an old decision still applies

**Need:** A reviewer wants to know whether later work changed, replaced, or contradicted an earlier decision.

**WhyCode outcome:** WhyCode presents the original decision alongside later evidence and marks the current status as current, historical, superseded, or unresolved when the evidence supports that conclusion.

## 6. MVP Scope and Priorities

**P0** features are required for the demo. **P1** features are valuable additions if time permits. **P2** features are future opportunities.

### P0 — Required

- Accept a public GitHub URL or `owner/repository` name.
- Ingest a bounded history of commits, changed paths, pull requests, reviews and comments where available, issues and comments, and selected in-repository design documents.
- Store repository entities and their relationships in Neo4j AuraDB or a local Neo4j instance.
- Accept a natural-language question about the indexed repository.
- Retrieve evidence through graph relationships, with optional full-text or vector retrieval as a supplement.
- Return an answer with citations, dates, known participants, a confidence label, and an explicit abstention when the evidence is insufficient.
- Show evidence cards with working source links and a compact decision timeline.
- Make ingestion limits, unsupported source types, warnings, and failures visible.

### P1 — Valuable if time permits

- Hindi/Hinglish answers using the Sarvam API, with a graceful fallback to English.
- A visual graph explorer for the entities and relationships behind an answer.
- Candidate detection for decisions that may have been superseded, based on explicit references, changed implementation, and later decision evidence.

### P2 — Future work

- Multiple repositories and private repository authorization.
- Team accounts, scheduled refreshes, access controls, and analytics.
- IDE, Slack, or Microsoft Teams integrations.

## 7. Product Principles

1. **Evidence before fluency.** A confident-sounding answer without support is not a successful answer.
2. **Relationships must matter.** The knowledge graph should influence retrieval, not merely store data that the answer ignores.
3. **Time matters.** A historical decision is not automatically the current decision.
4. **Uncertainty should be useful.** When confidence is low, explain what is missing or contradictory.
5. **Every claim should be traceable.** Repository-specific factual claims should link to one or more original sources.
6. **Users should be able to verify the result.** The retrieved evidence and the path connecting it to the code should be inspectable.

## 8. Primary User Journey

1. The user opens WhyCode.
2. The user enters a public GitHub repository URL or repository name.
3. The user starts indexing and sees progress, source counts, warnings, and failures.
4. WhyCode normalizes repository objects and identifies candidate entities and decision statements.
5. WhyCode stores entities, evidence, and relationships in Neo4j while preserving source IDs, timestamps, and canonical URLs.
6. The user asks a question such as “Why does this client retry three times?” or “Was this migration decision reversed?”
7. WhyCode identifies the likely code or configuration entities, follows relevant graph relationships, retrieves source excerpts, and checks for later evidence.
8. The answer-generation service creates a concise response using only the retrieved evidence.
9. The interface shows the answer, confidence, evidence chain, relevant people and dates, contradictory or superseding evidence, and an abstention message when necessary.

## 9. Functional Requirements

### FR-01 — Repository input

- Accept a GitHub URL or `owner/repository` string for public repositories.
- Validate the input and show a clear error for malformed or unsupported URLs.
- Do not ask users to paste a personal access token into a question or chat field. If a token is needed for rate limits, configure it on the server.

### FR-02 — Repository indexing

- Fetch bounded data with configurable limits and pagination.
- Record indexing status, counts, timestamps, warnings, and errors.
- Make repeated indexing idempotent: existing objects should be updated rather than duplicated.
- Preserve a canonical GitHub URL and source identifier for every indexed object.
- Handle API rate limits and partial failures without reporting false success.

### FR-03 — Entity and decision extraction

- Recognize repositories, files and paths, commits, pull requests, issues, comments and reviews, people, candidate decisions, candidate incidents, configuration keys, and design documents when the evidence supports them.
- Store extracted statements as candidates with their provenance. Uncertain inferences must not be silently treated as verified facts.
- Link files to the commits that changed them, commits to pull requests where available, discussions to related issues and pull requests, and decisions to their supporting sources.

### FR-04 — Knowledge graph

- Use Neo4j as the primary relationship store.
- Give entities stable identifiers and retain source URLs, created and updated timestamps, and extraction provenance.
- Use explicit, queryable relationship types rather than placing all context in one unstructured text field.
- Include graph traversal in the answer retrieval path and make the relevant path visible in the evidence view.

### FR-05 — Question answering

- Accept a natural-language question and an optional language preference.
- Resolve likely code or repository entities, traverse relevant graph relationships, and retrieve supporting excerpts.
- Optionally use full-text or vector similarity to supplement graph retrieval.
- Bound the number and size of excerpts sent to the answer-generation service.
- Separate supported facts, interpretation, and unknowns in the answer.
- Include source links and dates for supported claims.
- Return an explicit abstention when the evidence is insufficient instead of inventing a rationale.

### FR-06 — Decision status and time

- Represent decision status as proposed, accepted, superseded, reversed, rejected, or unknown when the evidence permits.
- Use explicit later statements, linked follow-up pull requests or issues, and relevant temporal evidence to identify possible supersession.
- Label an inferred reversal as a candidate or possible supersession rather than a confirmed fact.
- Show the historical decision and later evidence together when they conflict.

### FR-07 — Confidence

- Use a transparent, rule-based confidence assessment based on source quality, directness, the number of independent supporting sources, graph-path relevance, and contradiction or recency checks.
- Show a High, Medium, or Low label with a short explanation.
- Do not present the label as a statistically calibrated probability unless it has been calibrated against a measured evaluation set.

### FR-08 — User interface

- Show repository status, indexing progress, source counts, warnings, question history, answers, evidence cards, and a timeline.
- Evidence cards must include source type, title or summary, author when known, date, and a clickable canonical URL.
- Distinguish direct evidence, inferred relationships, and missing evidence.

### FR-09 — Language option

- English must work without Sarvam credentials.
- Sarvam is an optional adapter for Hindi/Hinglish response generation or translation.
- Language transformation must not change evidence URLs, source dates, or the meaning supported by the evidence.
- If the language service fails, fall back gracefully to English.

### FR-10 — Health and error handling

- Return understandable errors for missing configuration, provider outages, rate limits, invalid repositories, and database failures.
- Never expose secrets or raw environment values in client responses or logs.

## 10. Information Architecture and Experience

### A. Repository setup

- Repository URL or name field.
- Index button.
- Language preference.
- Indexing progress and current status.
- Counts by source type.
- Warnings and errors.

### B. Ask Why workspace

- Question input with prompts such as:
  - “Why does this flag exist?”
  - “What incident led to this workaround?”
  - “Was this decision reversed?”
  - “Who approved this change?”
- Answer panel with the direct answer, temporal status, confidence label, and confidence rationale.
- Evidence panel with commit, pull request, issue, comment, and document cards.
- Decision timeline showing older and newer evidence.
- Optional graph mini-view showing the shortest useful path between the code entity and the supporting decision evidence.

### C. Empty, loading, and failure states

- **Before indexing:** Explain that a repository must be indexed before questions can be answered.
- **During indexing:** Show progress and partial counts so the user knows what is still processing.
- **No evidence:** Say clearly that the indexed history did not provide enough evidence.
- **Conflicting evidence:** Show both sides and mark the status as unresolved.
- **Provider or database error:** Show actionable setup or recovery guidance without exposing secrets.

## 11. Technical Direction

The MVP should be straightforward to run locally and easy to demonstrate. The following stack is recommended, while equivalent choices are acceptable when they preserve the product behavior.

- **Frontend:** React, Vite, TypeScript, and Tailwind CSS.
- **Backend:** Node.js, TypeScript, and Express, with repository and provider logic kept in separate modules.
- **GitHub integration:** GitHub REST API with pagination, bounded indexing, and an optional `GITHUB_TOKEN` environment variable.
- **Graph store:** Neo4j AuraDB, with local Neo4j supported for development. Use parameterized Cypher queries.
- **Retrieval:** Graph traversal supported by Neo4j full-text or vector retrieval when configured. Vector similarity is supplementary and must not replace graph relationships.
- **Answer generation:** A provider adapter with a configurable model and server-side credentials.
- **Language service:** An optional Sarvam adapter configured by `SARVAM_API_KEY` and the model settings documented by the current provider.
- **Validation:** Schema validation for API inputs and outputs, with tests for extraction, retrieval, confidence, citation validation, and supersession rules.

### Request flow

Browser → API route → validate question → resolve entities → traverse the graph and retrieve evidence → collect excerpts and dates → check temporal conflicts → generate an evidence-constrained answer → validate citations → return the response → render the result.

### Important product constraint

The answer-generation model is not the database. It may help identify decision candidates and write a response, but source IDs, timestamps, relationships, and citations must come from indexed repository records.

## 12. Knowledge Graph Model

The exact labels may change during implementation, but the following entities and relationships define the product's intended meaning.

### Entities

- `Repository { id, fullName, url, defaultBranch }`
- `File { id, path, repositoryId }`
- `Commit { sha, message, authorLogin, committedAt, url }`
- `PullRequest { number, title, state, authorLogin, createdAt, mergedAt, url }`
- `Issue { number, title, state, authorLogin, createdAt, closedAt, url }`
- `Comment { id, body, authorLogin, createdAt, url, sourceType }`
- `Person { login, displayName }`
- `Decision { id, statement, status, decisionDate, confidence, extractionMethod }`
- `Incident { id, title, occurredAt, url }`
- `DesignDocument { id, path, title, url, updatedAt }`
- `ConfigKey { id, name, filePath }`

### Relationships

- `Repository -[:CONTAINS]-> File`
- `Person -[:AUTHORED]-> Commit / PullRequest / Issue / Comment`
- `Commit -[:CHANGED]-> File`
- `PullRequest -[:CONTAINS_COMMIT]-> Commit`
- `PullRequest -[:REFERENCES]-> Issue`
- `PullRequest -[:HAS_COMMENT]-> Comment`
- `Issue -[:HAS_COMMENT]-> Comment`
- `Decision -[:SUPPORTED_BY]-> Commit / PullRequest / Issue / Comment / DesignDocument`
- `Decision -[:AFFECTS]-> File / ConfigKey / service or module entity`
- `Decision -[:SUPERSEDES]-> Decision`
- `Incident -[:MOTIVATED]-> Decision or Commit`, only when evidence supports the link

Every inferred relationship must carry provenance, including the source ID, extraction method, and confidence. Similar dates alone are not enough to conclude that an incident caused a code change.

## 13. API Surface

The following interfaces describe the expected MVP behavior. They are proposed contracts and should remain versionable as the implementation evolves.

- `POST /api/repositories/ingest` — accepts `{ repository: string, limits?: { commits, pullRequests, issues, comments } }` and returns a repository or job ID with its initial status.
- `GET /api/repositories/:id/status` — returns indexing status, counts, warnings, and the last-updated time.
- `POST /api/ask` — accepts `{ repositoryId: string, question: string, language?: 'en'|'hi'|'hinglish' }` and returns the answer, confidence, evidence, timeline, graph path, abstention state, and warnings.
- `GET /api/repositories/:id/graph` — returns a bounded subgraph for visualization.
- `GET /api/health` — returns service and dependency health without secrets.

## 14. Answer Response

An answer should provide the following information, whether it is rendered directly in the UI or returned through the API:

```text
{
  "answer": "The evidence-supported answer...",
  "abstained": false,
  "confidence": {
    "label": "medium",
    "reason": "One direct pull request discussion and one related commit support this."
  },
  "temporalStatus": "current | historical | superseded | unresolved | unknown",
  "evidence": [
    {
      "type": "pull_request",
      "title": "...",
      "url": "https://github.com/...",
      "date": "ISO-8601",
      "author": "...",
      "excerpt": "...",
      "relationToAnswer": "direct support"
    }
  ],
  "decisionTimeline": [],
  "graphPath": [],
  "warnings": []
}
```

Evidence URLs must be real URLs returned or constructed from validated GitHub source identifiers. The product must never fabricate a pull request number, commit hash, author, date, or link.

## 15. Confidence and Abstention

WhyCode should use a transparent first version rather than an uncalibrated numeric probability.

- **High:** At least one direct, explicit source states the rationale; the source identity and date are known; and no unresolved later contradiction was found.
- **Medium:** The evidence supports the explanation indirectly, or several sources jointly imply it. The answer must state its limitations.
- **Low:** The evidence is weak, ambiguous, stale, or conflicting. For a “why” question without direct support, abstention is usually preferable.
- **Abstain:** There is no relevant evidence, no trustworthy connection to the affected code, only generic documentation, or an unresolved contradiction prevents a reliable conclusion.

Confidence is a product signal based on the evidence retrieved. It is not a claim that the model has a calibrated understanding of its own certainty. The rules should be tested and refined against a manually reviewed evaluation set.

## 16. Temporal and Supersession Rules

- Store event dates separately: authored, committed, pull request opened, pull request merged or closed, issue created or closed, comment created, and decision date when explicitly stated.
- Do not treat the newest timestamp as proof of the current decision.
- Mark a later decision as superseding an earlier one only when explicit evidence supports the relationship or a clearly documented rule justifies a candidate link.
- Keep historical decisions even after they are superseded.
- If supersession is inferred but unconfirmed, show “possible supersession” and cite the supporting evidence.
- If sources conflict without a clear resolution, mark the status as unresolved and show both sources.

## 17. Security, Privacy, and Reliability

- Support public repositories only for the MVP unless private-repository authorization is deliberately added.
- Store tokens and provider keys only in server-side environment variables. Never bundle them into frontend assets or commit them to source control.
- Use least-privilege GitHub tokens and respect API rate limits and repository terms.
- Treat repository text, comments, issue bodies, and documents as untrusted input. Repository content must not change application rules or trigger unauthorized actions.
- Use parameterized Cypher queries. Validate inputs and cap question length, graph traversal depth, result counts, and answer context size.
- Avoid storing unnecessary personal data. Display public GitHub usernames only when they are relevant to attribution.
- Log operational errors without logging secrets or unnecessarily duplicating full source content.
- If an external answer or language provider is unavailable, show a clear error or an evidence-only fallback rather than inventing an answer.

## 18. Success Criteria and Acceptance Tests

The MVP is ready for demonstration when the following checks pass against at least one real public repository:

- **AC-01:** A valid public GitHub repository can be indexed, and the interface shows its status and source counts.
- **AC-02:** Re-running indexing does not create duplicate graph entities for the same source IDs.
- **AC-03:** A changed file can be traced to its commit and associated pull request when one exists.
- **AC-04:** Every substantive repository-specific rationale claim in an answer includes at least one real, clickable source.
- **AC-05:** Evidence cards show the correct source type, title, date, and URL.
- **AC-06:** A question with no relevant evidence produces an explicit abstention.
- **AC-07:** Conflicting or later decision evidence is shown as historical, superseded, or unresolved only when the evidence supports that status.
- **AC-08:** Each answer explains why its confidence is High, Medium, or Low.
- **AC-09:** Hindi/Hinglish output works when Sarvam is configured, while English remains available without Sarvam.
- **AC-10:** API, database, and provider errors are actionable and do not leak secrets.
- **AC-11:** The interface shows at least one graph path used during retrieval, demonstrating that graph relationships affect the answer.

### Evaluation set

Prepare 10–20 manually reviewed questions covering direct rationale, code-to-pull-request tracing, temporal and supersession questions, ambiguous questions, and questions with no supporting evidence. Record the expected evidence IDs and whether WhyCode should answer or abstain. Report observed results honestly and do not claim a performance metric before measuring it.

## 19. Demonstration Flow

The complete demo should take three to five minutes:

1. Select a repository with meaningful pull request and issue discussions, and index a bounded history before the live demonstration.
2. Ask a direct question about a file, configuration key, or workaround. Open the cited pull request or commit to show that the evidence is real.
3. Ask whether the decision later changed. Show the timeline and later source, or clearly state that reliable supersession evidence was not found.
4. Ask a question for which the indexed history has no evidence. Show the honest abstention.
5. Repeat one question in Hinglish if the Sarvam integration is enabled.

Any seeded examples used for interface development must be clearly labeled as demo fixtures and kept separate from real GitHub data.

## 20. Delivery Plan

### Phase 1 — Foundation

- Set up the application structure, configuration validation, health endpoint, Neo4j connection, and a minimal interface.
- Implement GitHub repository validation and bounded indexing for commits, files, pull requests, issues, and comments.

### Phase 2 — Knowledge graph

- Define stable identifiers, constraints and indexes, idempotent upserts, graph relationships, and source provenance.
- Add checks for duplicate handling, malformed data, rate limits, and partial indexing.

### Phase 3 — Retrieval and answers

- Implement entity resolution, graph traversal, source excerpt collection, temporal conflict checks, and answer generation.
- Validate every citation against retrieved evidence and implement abstention and confidence rationale.

### Phase 4 — Demonstration experience

- Build repository status, question-and-answer, evidence cards, timeline, and compact graph-path views.
- Add the optional Sarvam integration only after English evidence retrieval works reliably.

### Phase 5 — Evaluation

- Run the evaluation set, review failures, fix graph and retrieval issues, and rehearse the three core demonstration scenarios.

This sequence reflects dependencies rather than a fixed schedule. Each phase should leave a usable vertical slice of the product.

## 21. Environment Configuration

Provide a `.env.example` containing names and safe placeholders only. Provider model names and request formats must be verified against the current provider documentation.

```text
PORT=4000
NODE_ENV=development
GITHUB_TOKEN=
NEO4J_URI=neo4j+s://<your-instance>.databases.neo4j.io
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=
LLM_PROVIDER=
LLM_API_KEY=
LLM_MODEL=
SARVAM_API_KEY=
SARVAM_MODEL=
CLIENT_ORIGIN=http://localhost:5173
```

Where possible, the application should start with optional providers disabled and explain which capabilities are unavailable. Real credentials must never appear in this document or in source control.

## 22. Release Checklist

- README with prerequisites, setup, environment variables, local run commands, architecture, limitations, and troubleshooting.
- `.env.example` and `.gitignore` with safe defaults.
- License notices where relevant.
- Development, test, and lint scripts.
- Database schema and constraint setup.
- Repeatable indexing instructions.
- Tests for graph mapping, confidence rules, citation validation, and abstention.
- A manual test checklist and sample questions.
- Clear separation between the interface, API, GitHub connector, graph repository, retrieval, and provider layers.
- No claim of completion until the acceptance criteria have been tested against real external services.

## 23. Risks and Mitigations

- **Sparse pull request discussions:** Check repository quality early and narrow the demonstration claims or choose a better repository.
- **GitHub rate limits:** Use bounded indexing, pagination, retries with backoff, and an optional token.
- **Incorrect decision extraction:** Store candidates with provenance and require direct support for strong claims.
- **Incorrect supersession:** Distinguish confirmed status from possible status and show both sources when uncertain.
- **Generated explanations that go beyond the evidence:** Constrain the context, validate citations, and abstain when evidence is insufficient.
- **Graph complexity:** Start with a small explicit schema and a bounded relationship path.
- **Provider changes:** Isolate provider integrations and keep models configurable.
- **Limited hackathon time:** Prioritize indexing, graph relationships, evidence-backed answers, and abstention before visual polish or language integration.

## 24. Product Decisions for the MVP

### 24.1 MVP success measures

The first release should be evaluated using measurable product outcomes rather than feature count:

- **Answer usefulness:** A developer can find a useful, evidence-backed answer to a supported question without manually searching the repository history first.
- **Citation accuracy:** Every substantive repository-specific claim points to the correct source.
- **Abstention quality:** Questions without adequate evidence are rejected clearly instead of receiving an invented explanation.
- **Indexing reliability:** A supported public repository can be indexed repeatedly without duplicate entities or silent data loss.
- **Response speed:** Repository status should appear within 3 seconds, and a typical question should return within 10–15 seconds after indexing.

These are initial targets for the hackathon evaluation and should be measured against the evaluation set before being treated as achieved results.

### 24.2 Initial demonstration repository

The demonstration should use one public repository with meaningful pull request discussions, issue history, and documented implementation decisions. The selected repository should be recorded in the demonstration notes along with:

- Why it represents the intended user problem.
- Which files, decisions, pull requests, and issues are used in the demo.
- Which questions have direct evidence.
- Which questions intentionally demonstrate uncertainty or abstention.

### 24.3 Priority question types

The MVP should optimize first for these questions:

1. Why does this file, function, or configuration option exist?
2. What change introduced this behavior?
3. Which issue or pull request motivated the change?
4. Is the original decision still current?
5. Who participated in or approved the decision?

Questions outside these categories may be supported when the evidence is strong, but they should not expand the MVP before the priority questions work reliably.

### 24.4 Evidence quality order

Evidence should be ranked by how directly it explains the decision:

1. An explicit explanation in a pull request, issue, review, or design document.
2. A commit message that directly describes the rationale.
3. Related comments, linked discussions, or documentation that support the explanation.
4. A relationship inferred from changed files, references, or graph connections.
5. Date, filename, wording, or similarity alone.

The last category is not sufficient evidence for a decision claim. Inferred relationships must be labeled as inferred and should lower confidence.

### 24.5 Freshness and re-indexing

The MVP will use manual refresh rather than scheduled synchronization. Each repository view should show:

- The time of the last successful indexing run.
- Whether the latest run completed, partially completed, or failed.
- The number of new and updated objects found during a refresh.
- Any source types or history ranges that were not included.

Where practical, a refresh should request only changes since the last successful run while retaining idempotent behavior.

### 24.6 Product boundaries

The central MVP promise is:

> WhyCode explains one confusing code decision using real repository evidence.

English evidence-backed answers are the only mandatory product path. Hindi/Hinglish output, graph visualization, vector retrieval, and other enhancements remain optional until the core flow is reliable.

### 24.7 Accessibility and responsive behavior

The MVP interface should support keyboard navigation, readable color contrast, visible focus states, accessible labels, and clickable source links. The primary experience should work on common laptop screen sizes without requiring a mobile-specific application.

### 24.8 Open product decisions

The following decisions should be resolved before a production-oriented release:

- Whether one session can contain multiple repositories.
- Whether users can share an answer or repository view.
- How long indexed source excerpts are retained.
- Whether anonymous users can use the public demonstration.
- Which answer-generation provider is the default.
- The largest repository and history range supported by the product.
- Whether refresh remains manual or becomes scheduled.

## 25. Definition of Done

The MVP is complete when a developer can index one real public repository, ask a question about why the code is the way it is, receive a concise answer supported by clickable source evidence, inspect the graph path behind that answer, see temporal conflicts or possible supersession handled honestly, and receive an explicit abstention when the indexed history cannot support a conclusion.

Optional Sarvam language support must not weaken any of these guarantees.
