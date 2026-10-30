# Security and reliability

## Boundary

WhyCode is a single-owner, single-process workspace for public GitHub repositories. It does not write to GitHub, execute repository code, or clone/run dependencies. Private repositories use separate verified account/GitHub authorization and session-memory indexes. The server sends user questions and selected public source excerpts to the configured answer provider. Translation and web search are opt-in and are labeled separately. Browser investigation history stays on the device; questions are not recorded in request logs or the durable server snapshot store.

## Access and request controls

- Development binds to loopback. Production refuses to start without an HTTPS public origin.
- Public exploration uses no shared-password session. Personal account sessions use opaque HttpOnly cookies, Secure in production; private routes verify account and GitHub access.
- State-changing requests require JSON plus the custom `X-WhyCode-Request: 1` header. Exact origin checks, cross-site fetch rejection, and host validation protect against browser cross-site requests and DNS rebinding. Public endpoints allow anonymous exploration; private endpoints require account/GitHub authorization. `/healthz` is a minimal public liveness probe.
- Production rejects HTTP requests. Forwarded TLS/client information is trusted only when `TRUST_PROXY=1`; isolate that API behind the trusted proxy and never publish its port directly.
- Limits: 180 API requests/minute/IP; 6 ingest requests/10 minutes/IP; 15 asks/15 minutes/IP; account-specific sign-in limits. Daily answer attempts default to 100, persisted across restarts; failed/invalid attempts conservatively count. At most two indexing jobs and two question jobs run concurrently, and at most 30 repositories can be added.
- Request bodies are limited to 32 KB; provider operations, request uploads, idle sockets, source volume, and graph traversals are bounded. Rate-limit maps and session counts are bounded too.

## Content and credentials

Repository text, questions, and model responses are untrusted. Graph queries are parameterized; GitHub identities are canonicalized and path-safe. The UI renders escaped text and permits only HTTPS source links. It does not inject model HTML. Production CSP, frame denial, nosniff, referrer restrictions, and permissions restrictions are set. Fonts are self-hosted with their OFL licenses. Credential-like/generated/binary paths are excluded from source snapshots; public source code may still contain sensitive-looking text and should be reviewed by its repository owner.

Structured request logs contain random request IDs, route templates, status codes, and durations, not request bodies, query strings, cookies, tokens, or full source text. Errors exposed to clients omit raw database/provider response details. Provider keys and environment files are never included in Docker build context or web assets.

## Evidence checks

A generated explanation must consist of bounded atomic claims with citations and exact supporting quotations. Quotes are matched against their cited source fields. A separate generation pass reviews whether each claim is actually supported and whether it answers the question. Only reviewed claims are rendered; unsupported, malformed, or unreviewed answers are withheld. Translation must preserve citation tokens and cannot expose reasoning output. These controls reduce unsupported answers but do not guarantee semantic accuracy; model review is explicitly labeled as such.

Temporal assessments require evidence beyond dates. A current classification requires a pinned current code snapshot; supersession requires a matching explicit reversal/replacement record and reviewer support. Otherwise classifications remain historical or unresolved. These are evidence-based assessments, not a complete decision registry.

## Persistence and graph transition

The ignored `.whycode` directory stores atomic snapshots/status and daily usage. Interrupted jobs are marked failed on startup so they can be retried. Keep this directory on a persistent volume and back it up with Neo4j. Host filesystem permissions and disk encryption remain the deployer's responsibility.

New commits use `ScopedCommit` with identity `repositoryId:commit:sha`, an independent unique constraint, and repository-scoped relationships/queries. Legacy `Commit` nodes and their constraints are retained; there is no destructive data migration. Reindexing creates the scoped representation. Rollback can read preserved legacy graph data with an earlier build, but it will not include new scoped-only history; restore backups for a consistent rollback and preserve the access-control boundary. Do not run old/new writers concurrently against the same workspace store.

## Operations and limits

Deploy one API process/replica. File-backed counters, session memory, and job coordination are not distributed locks. Multi-user tenant isolation, shared distributed quotas, HA, and centralized audit retention would require an additional design; do not advertise this build as a multi-tenant service. Caddy handles public TLS in the supplied deployment. Backups, secret rotation, provider account budgets, disk monitoring, and external uptime alerting must be configured by the operator.

The dependency audit was clean after upgrading Zod to a patched 4.6.x version. Audit results change over time; rerun `npm audit --omit=dev` before deployment. Container images and infrastructure still require their own patching and security review.

References: [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [OWASP REST Security](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html).
