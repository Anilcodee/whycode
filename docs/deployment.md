# Deployment

## Single-owner deployment

The included `compose.yaml` starts one API process, a private Neo4j database, and Caddy as the only public entry point. The API and database have no published host ports. Caddy terminates HTTPS on ports 80/443. Public exploration is anonymous, without a shared password. Public indexes remain shared and bounded; private account access is separate. This remains a single-process deployment, not a complete multi-tenant service.

1. Install Docker/Compose on the target host and point a domain's DNS to it.
2. Configure an uncommitted `.env`: `DOMAIN`, `NEO4J_PASSWORD`, `LLM_API_KEY`, `LLM_MODEL`, and optionally GitHub/Sarvam/SerpAPI credentials.
3. Review provider account budgets, the `DAILY_ANSWER_LIMIT` (default 100 attempts), and backup/retention requirements.
4. Run on the deployment host:

```sh
docker compose config --quiet
docker compose up --build -d
```

5. Open `https://your-domain` and explore without a shared password. Confirm the application reports services connected and a public repository indexes successfully.

`TRUST_PROXY=1` is safe here only because the application port is private behind Caddy. If adapting the topology, explicitly revisit proxy trust, forwarded headers, and network access. Do not expose the API container directly. Do not use the Vite development server for production.

## Persistent data

Volumes `workspace_data` and `graph_data` retain index status/snapshots/quotas and Neo4j history. Back up both to restore a consistent workspace. `caddy_data` retains TLS certificates. Never use `docker compose down -v` unless deleting the data is intentional and separately approved. The API runs as a non-root user. If using bind mounts, provision correct ownership/permissions before starting the container.

## Health and monitoring

`/healthz` is a minimal unauthenticated liveness probe. `/api/health` reports dependency readiness without shared-password authentication. The container health check tests liveness; it is not a guarantee that every external provider is currently available. Capture structured stdout/stderr logs and alert on health failures, elevated 429/5xx responses, disk usage, and provider account spend using the host's monitoring stack. Logs deliberately omit questions, source excerpts, bodies, cookies, and secrets.

## Updates and recovery

Run tests, build, and dependency audit before updating. Back up persistent volumes. Rebuild/restart the single API instance; completed indexes survive. Interrupted jobs become visible failures and can be retried. Server restart expires login sessions. Repository refresh is manual. Do not scale the API to multiple replicas without replacing file-backed coordination, quota storage, and in-memory sessions with shared stores.

The graph expansion uses repository-scoped `ScopedCommit` nodes while preserving legacy `Commit` data. No old graph data is deleted. See [security-and-reliability.md](security-and-reliability.md) for compatibility/rollback behavior.

## Verification status

The TypeScript build, automated security/regression tests, local live integrations, and browser flows have been exercised. Docker is not available in the current workspace, so the container build and real TLS/domain deployment have not been executed here. Validate the Compose configuration and container startup on the intended Docker host before publishing.
