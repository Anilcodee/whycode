# Frontend maintenance

Run `npm run check` from the repository root. It runs API tests, frontend tests, and both production builds. GitHub Actions uses the same command. Tests use local HTTP fixtures, with no provider credentials required.

## Ownership

- `src/types/workspace.ts`: existing frontend workspace response contracts.
- `src/lib/api.ts`: same-origin requests, write headers, timeouts, errors, and unauthorized notifications.
- `src/components/Icon.tsx`: shared UI icon set.
- `src/components/Brand.tsx`: wordmark and home navigation behavior.
- `src/components/SiteFooter.tsx`: footer content and provider links.
- `src/components/AnswerView.tsx`: explanation, citations, evidence checks, translation, and supporting claims.
- `src/components/SourceInspector.tsx`: selected source, source navigation, metadata, and excerpts.
- `src/components/SourcePresentation.tsx`: citation markup, safe external links, dates, and source labels.
- `src/components/SourceCode.tsx`: escaped source snapshot with line numbers.
- `src/components/EvidenceView.tsx`, `TimelineView.tsx`, and `ConnectionsView.tsx`: remaining investigation panels.
- `src/hooks/useRepositoryPolling.ts`: React lifecycle for indexing status updates.
- `src/lib/repository-polling.ts`: sequential requests, capped retry delays, and disposal of stale results.
- `src/hooks/useAccount.ts`: account status refresh, dialog visibility, callback handling, and stale-response protection.
- `src/lib/account-policy.ts`: existing public/private mode and consent reset rules, covered by focused tests.
- `src/types/account.ts`: shared account and workspace-session types; AccountDialog re-exports Account for compatibility.
- `src/lib/workspace-history.ts`: public browser history, nested record validation, size bounds, and clearing.
- `src/hooks/useWorkspacePersistence.ts`: saves only authenticated, hydrated public workspaces. Private mode returns before accessing storage.
- `src/hooks/useWorkspaceLoading.ts`: applies repository/health snapshots and restores valid public history.
- `src/lib/workspace-loading.ts`: parallel scoped reads with generation checks to suppress stale snapshots.
- `src/tokens.css`: shared brand colors, preserving existing computed values.

`src/styles/index.css` is the sole stylesheet entry point, loaded in `main.tsx`. It declares the complete cascade order, including component styles. Component modules must not import CSS independently: moving a component must not reorder the cascade. The former styles.css, refinement.css, and experience.css now live in `src/styles/foundation.css`, expanded into readable rules with their original order preserved.

Historical overrides still exist within foundation and feature styles. Do not append a global override file for a local fix. Edit the existing owner and shared tokens. Future deduplication needs computed-style or visual comparisons across the affected breakpoints; combining files alone does not eliminate the underlying overrides.

Consolidation verification: the production stylesheet before and after the entry-point migration was byte-identical (`index-BF62HywK.css`, 158,356 bytes). All 22 frontend tests passed and the web production build passed. This verifies cascade/output preservation, not a reduction in CSS size or removal of every historical override.

The companion keeps the homepage orbit animated. On repository pages its JavaScript frame loop sleeps once the cursor follower settles and resumes on mouse movement, scroll, resize, or visibility changes. Page geometry is refreshed during layout rather than read on every frame.

## Next boundaries

The investigation panels, repository polling, and account-status lifecycle are extracted. Presentation tests cover evidence, timelines, answers, and the source inspector. Polling tests cover retry caps, recovery, terminal states, and late responses after disposal. Account policy tests cover authorization loss, locked workspace access, preserving explicit mode selection, and callback results. Workspace loading is extracted. The shared-password gate and its login/logout hook have been removed; public access is anonymous. Remaining frontend boundaries include session bootstrap, the repository composer, and global overlay effects. Preserve request failures, private-history rules, stale-response protection, and overlay focus behavior. Server-rendered tests cover markup and escaping, not focus/click behavior; automated browser regression coverage is still needed before changing shared interaction styles.

Shared sessions, rate limits, and a durable indexing queue remain prerequisites for multiple API replicas. This cleanup does not make the single-process store distributed.
