# Development setup

## Prerequisites

Node.js 20+ and npm, plus Neo4j for repository evidence. The supplied production container uses Node.js 24. Configure a currently available Gemini model explicitly. GitHub authentication is recommended; Sarvam and SerpAPI are optional.

```sh
npm install
npm run dev
```

The web app runs at http://localhost:5173 and the API at http://localhost:4000. Use `npm.cmd` in PowerShell when `npm.ps1` is blocked by execution policy.

## Configuration

Copy the root `.env.example` to `.env`. Required for the full flow:

- `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`; optional `NEO4J_DATABASE`.
- `LLM_PROVIDER=gemini`, `LLM_API_KEY`, `LLM_MODEL`; optional `LLM_FALLBACK_MODEL`.
- Recommended `GITHUB_TOKEN` with read access to public repositories. Private repositories are always rejected.
- Optional `SARVAM_API_KEY`, `SARVAM_MODEL=sarvam-105b` for Hindi/Hinglish.
- Optional `SERPAPI_API_KEY` for separate web background reading.
- Public repositories need no shared password. `APP_PASSWORD` is obsolete and ignored. Personal account sign-in and GitHub permissions protect private repositories.

No provider key is sent to the browser. Local API binding is `127.0.0.1`; do not publish development ports.

## Persistence and recovery

The ignored `.whycode` directory stores source snapshots, job status, and the UTC daily answer counter. `DATA_DIRECTORY` overrides it. Writes use atomic file replacement. Back up this directory together with Neo4j. Completed indexes remain usable after API restart. Interrupted queued/running jobs become visible failures that can be retried; retries create a fresh bounded snapshot rather than claiming byte-level resume.

The browser stores up to 20 investigations locally. The sidebar can clear that history. No passwords/session tokens are kept in localStorage. Password sessions expire after eight hours and are revoked by logout or server restart.

## Source coverage

History depth is selectable (25, 75, or 200 commits in the UI). Changed paths/status/diffs are collected from up to 50 commits (10 without a GitHub token). Direct commit-to-PR associations cover up to 10 commits (3 without a token). Up to 80 eligible text snapshots are pinned to a default-branch SHA (10 without a token), with 32 KB per file and 500 KB total. Coverage counts and omissions are visible in the UI. Symbol hints use lexical extraction. No AST completeness is claimed.

## Verification

```sh
npm run typecheck
npm test
npm run build
npm run verify:live
npm run evaluate
```

Live verification and evaluation require the API to be running and integrations configured. They use public source history and consume model/translation/search requests. Public APIs do not require a shared password; these verification scripts target loopback development mode.

## Production

```sh
npm run build
npm start
```

The API serves `apps/web/dist`. Set `NODE_ENV=production`, an HTTPS `PUBLIC_ORIGIN`. Enable `TRUST_PROXY=1` only behind an isolated single trusted TLS proxy. See [deployment.md](deployment.md).
