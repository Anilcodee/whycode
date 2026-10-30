# WhyCode

A source-backed workspace for understanding why code exists. Connect a public GitHub repository, ask a focused question, and inspect the code, history, discussion, and quotations behind the answer.

## Run

```sh
npm install
npm run dev
```

Open http://localhost:5173. On Windows PowerShell, use `npm.cmd` when execution policy blocks `npm.ps1`.

Copy `.env.example` to `.env` and configure Neo4j plus a Gemini API key/model. GitHub authentication increases the indexing budget. Sarvam translation and SerpAPI background reading are optional. Credentials remain on the server.

## Included

- A focused investigation interface with an on-demand Archive, saved browser history, answer/evidence/timeline views, an animated connection map, and a numbered source reader.
- Pinned code and document snapshots, lexical symbol hints, GitHub file-change status/diffs, and direct commit-to-PR associations.
- Exact quotation validation followed by a separate model review of every claim. Unsupported or unreviewed explanations are withheld.
- Conservative temporal classification: dates alone cannot establish a current or superseded decision.
- Durable index status/snapshots, restart recovery for interrupted jobs, manual retries, and visible coverage limits.
- Loopback-only local operation; anonymous public exploration, private account sessions, HTTPS enforcement, origin/request checks, safe errors, request limits, concurrency caps, and a persistent daily answer budget for deployment.

## Checks

```sh
npm run typecheck
npm test
npm run build
npm run verify:live
npm run evaluate
npm audit --omit=dev
```

The live checks require the app and integrations to be running and consume provider requests. Results are in [live-verification.json](docs/live-verification.json) and [evaluation-results.json](docs/evaluation-results.json). The evaluation covers eight questions across Hello-World and Express; it is not a statistically representative human accuracy benchmark.

## Deploy

```sh
npm run build
npm start
```

Production requires `NODE_ENV=production`, `PUBLIC_ORIGIN=https://your-domain`, and a trusted TLS reverse proxy. The included Docker/Caddy configuration is documented in [deployment.md](docs/deployment.md). Do not expose the development server publicly.

## Practical limits

History depth is selectable and bounded. Source indexing reads at most 80 eligible text files, 32 KB per file, and 500 KB total; unauthenticated GitHub access uses smaller budgets. Files outside the window, oversized/binary files, generated output, credential-like paths, external documents, and other branches are not covered. Symbol extraction is lexical rather than a full language parser.

Model review can miss semantic errors. Check primary sources before making consequential code changes. WhyCode is a single-owner, single-process workspace, not a multi-tenant service. See [security-and-reliability.md](docs/security-and-reliability.md) for the threat model, retention, migration, and limitations.
