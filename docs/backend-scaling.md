# WhyCode backend runtime

The configured backend uses PostgreSQL for central runtime state, Redis REST for request limits, and Neo4j for the public evidence graph. Central storage is shared by API instances; access remains scoped to the browser or signed-in account. All runtime SQL migrations are checked into supabase/migrations and have been applied to the current project.

## Stored data and ownership

| Data | Storage and access |
| --- | --- |
| Account investigations | Existing Supabase account tables, accessed with the verified user's token and row-level security |
| Login sessions | Encrypted PostgreSQL runtime records, opaque browser cookies, provider verification and expiry |
| OAuth / password recovery | Encrypted, browser-bound PostgreSQL records, consumed once atomically |
| Guest workspaces | Encrypted temporary PostgreSQL records keyed by hashed browser cookies; eight-hour expiry |
| Public indexes | Central public status and snapshot records; workspace membership controls API visibility |
| Private indexes | Separate encrypted PostgreSQL table, scoped to the current account and GitHub connection; valid session, GitHub connection and expiry required |
| Request limits | Atomic Redis counters with separate named budgets |
| Daily answer budget | One atomic PostgreSQL reservation counter per deployment and UTC day |

The server-only whycode_runtime schema is inaccessible to browser anon/authenticated roles. Database credentials and encryption keys stay on the API. Private source payloads never enter the public snapshot table or Neo4j. Private repository identifiers remain server-side metadata; source/status payloads are encrypted. Sessions expire with provider tokens, at most eight hours; automatic token refresh is not implemented.

## Indexing coordination and recovery

A PostgreSQL admission row serializes job claims. Across public and private jobs, at most two leases are active per deployment namespace. Each repository job has an expiring two-minute lease, renewed every 30 seconds, a unique job ID and a monotonically increasing generation. All status/snapshot writes require current ownership and an unexpired lease. Same-process starts are also bounded and deduplicated.

Public workers scan expired jobs every five seconds and retry at most three times. Recovery compares the original job ID, preventing two workers from both recovering the same interrupted run. If a snapshot was already saved, recovery repairs its graph/status rather than appending or fetching the same batch again. If collection was incomplete, the original limits and continuation base are reused. Changed continuation bases stop with visible refresh guidance. Normal provider errors remain visible failures rather than entering an endless retry loop.

Private recovery is triggered by an authenticated workspace request. It rechecks current GitHub repository permission before claiming work. Private source reads and writes also require a live central session and the same GitHub connection scope. Sign-out, disconnect and expiry hide data immediately through these checks; background cleanup removes inactive records. Physical storage/backups may retain deleted bytes until their own retention process completes.

Neo4j writes each snapshot in one transaction. A repository write lock and generation comparison reject stale snapshots, and an unfenced local writer cannot replace a centrally fenced snapshot. Rows are still submitted in bounded batches inside the transaction; readers see either the old committed graph or the new committed graph. Use a separate Neo4j database for each deployment namespace.

On graceful shutdown, recovery timers stop, the API stops accepting requests, and active work is given up to 30 seconds to finish before PostgreSQL/Neo4j connections close. After a forced exit, leases expire and recovery can take over.

## Migration and deletion safety

Existing public file-store snapshots are imported without overwriting central records. Existing encrypted session vaults and private indexes have transactional one-time import markers, so subsequent startup cannot restore sessions or indexes that were deleted after migration. Backups remain available; do not manually re-import stale backups over active runtime data.

Removing a repository from an account or guest workspace removes that workspace's references and investigations. It does not delete a public source index used by other workspaces or change GitHub. Private-index removal is scoped to its session/connection. Account sign-out does not delete saved account investigations.

When PostgreSQL is absent, the earlier single-server file/memory implementations remain available for development. Do not run multiple instances in fallback mode or mount the same local data directory on several API processes. Rollback to local authentication must require fresh sign-in rather than loading a stale session vault.

## Required configuration

Use identical DATABASE_URL, DATABASE_SSL_CA_FILE, SESSION_ENCRYPTION_KEY, RATE_LIMIT_NAMESPACE, DAILY_ANSWER_LIMIT and Redis settings across instances of the same deployment. Keep namespaces separate between development, staging and production. PostgreSQL uses certificate and hostname verification. The Docker configuration forwards these settings and includes the public CA certificate.

Configured central-storage failures do not switch to stale local session copies. Redis calls have one bounded retry; read endpoints on an explicit allowlist can temporarily use per-instance limits for 60 seconds, with a warning event and degraded response header. Login, OAuth callbacks, account changes, ingestion and model calls still require shared protection and return retryable errors during an outage. Health probes use a separate local limit and cache concurrent Neo4j checks for 15 seconds. The existing index/resource limits remain in force; horizontal storage support does not imply unlimited capacity.

## Verification

- npm run check: API tests, frontend tests, TypeScript checks and production builds.
- node --import tsx scripts/verify-shared-sessions.mjs: two API instances, login/logout, OAuth callback and replay rejection, using real PostgreSQL and a mocked identity provider.
- node --import tsx scripts/verify-guest-workspaces.mjs: browser isolation, cross-instance continuity, concurrent mutations, deletion and expiry.
- node --import tsx scripts/verify-worker-runtime.mjs: global capacity, encrypted private indexes, revocation, safe legacy import, public/private recovery and real PostgreSQL/Neo4j stale-write rejection.

Live verification uses temporary namespaces and fabricated data, then removes those records. Real Google/GitHub browser acceptance, production hosting, TLS/domain configuration, email delivery, backups and monitoring remain deployment/acceptance tasks. No production deployment has been performed.
