# WhyCode UI and codebase audit

Date: 2026-10-29. Scope: source review, live homepage accessibility structure, production build, and existing automated tests. No product implementation changes were made. This is not a completed visual regression, mobile-device, load, or penetration test.

## Assessment

The product has an identifiable visual direction and a useful backend architecture. It is a credible prototype/pilot foundation. It is not yet consistently organized or operationally prepared for a large production team. Passing tests establish useful behavior, not complete UI consistency or security certification.

## Prioritized findings

### High: Styling needs a single source of truth

App.tsx imports styles.css, refinement.css, experience.css, scroll-experience.css, palette.css, analysis-workspace.css, and workspace-overlays.css, in addition to component styles. Repeated selectors and successive overrides make the final appearance depend on import order. This makes regressions in hover colors, contrast, spacing, and typography more likely.

Consolidate shared color, typography, spacing, focus, and surface tokens. Give buttons, tabs, dialogs, badges, and drawers one authoritative style owner. Remove superseded rules while preserving the current approved appearance. Check all interaction states on both dark and light surfaces.

### High: Frontend responsibilities are concentrated

apps/web/src/App.tsx combines API access, domain types, account and repository state, polling, local history, investigation flow, result views, source inspection, and overlays. Dense single-line JSX further raises review cost.

Extract feature components and focused hooks incrementally: repository workspace, investigation results, source inspector, account state, and API client. Share API contracts deliberately. This does not require microservices or a framework rewrite.

### High before multi-server deployment: Persistence and sessions are single-process

apps/api/src/infrastructure/indexing/file-indexing-store.ts explicitly implements a single-process store using synchronous filesystem reads and writes. apps/api/src/services/account-service.ts keeps sessions and authorization flows in Maps; middleware/security.ts keeps sessions and rate limits in Maps.

Independent server replicas would not share these records or limits. File read-modify-write budgets are not distributed transactions. Large synchronous snapshots can block the Node event loop. Before horizontal scaling, introduce shared persistence, shared session/rate-limit state, and durable indexing jobs with coordinated workers. Keep the existing interfaces as migration boundaries.

### Medium: Quality gates do not cover the whole frontend

Root npm test runs only API tests. The 11 frontend logic tests pass when invoked separately, but are not included in that command. No repository CI configuration, lint/format gate, or browser end-to-end/visual regression suite was found.

Add a combined check command and CI. Cover URL entry, indexing states, answer/source inspection, overlays, keyboard focus, tree selection/drag/zoom, narrow screens, and account configuration states. Add targeted accessibility and contrast checks.

### Medium: Animation performs continuous work

apps/web/src/components/BranchCompanion.tsx continually schedules requestAnimationFrame while visible, including repository pages where the branch trail is absent. It reads page geometry and updates the companion even when pointer movement has settled. It does pause when the document is hidden and respects reduced motion.

Cache geometry and stop or reduce frame work when idle, restarting on pointer/scroll changes. Keep the intended homepage orbit. Confirm the benefit with a browser performance recording; CPU impact was not measured in this audit.

### Medium: Asset and graph readability budgets need definition

Production output is 157.63 kB CSS (31.07 kB gzip) and 310.93 kB JavaScript (96.26 kB gzip). These sizes alone are not a performance failure, but the CSS cascade offers cleanup opportunities. Fonts use multiple TTF families/weights; use WOFF2 and retain only needed faces. The document preloads Instrument Serif; verify that this is the most useful critical font.

The repository graph supports a fitted overview, dragging, zooming, and selection. Fitting a dense graph into a fixed area inherently reduces text size, especially on narrow screens. Establish a minimum readable scale and clear overview/detail behavior. A bounded overview should not be presented as every record in an arbitrarily large repository.

## Existing strengths

- Backend domain, service, infrastructure, and middleware boundaries with injectable dependencies.
- Strict TypeScript and focused tests for security, indexing, validation, retrieval, and graph behavior.
- Existing origin checks, request validation, production security headers, rate limits, and private-repository access controls.
- Homepage labels, heading hierarchy, skip link, and explicit descriptions for illustrated examples.
- Local fonts, reduced-motion handling, and a reusable graph layout implementation.

## Verification

- Root production build: passed (API TypeScript and web TypeScript/Vite).
- Backend tests: 56 passed, 0 failed. The local loopback integration fixture required execution outside the restricted sandbox.
- Frontend logic tests: 11 passed, 0 failed.
- Live homepage accessibility structure: inspected.
- Every authenticated/error/mobile state, measured Core Web Vitals, distributed load, and penetration testing: not verified in this audit.

## Recommended sequence

1. Consolidate design tokens and shared interaction states; capture visual baselines.
2. Extract frontend features and API/state hooks without changing behavior.
3. Wire existing tests into one CI gate; add focused browser/accessibility coverage.
4. Measure animation and font costs, then optimize demonstrated hotspots.
5. Replace process-local operational state before multi-server production deployment.
