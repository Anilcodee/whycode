# WhyCode — Comprehensive QA & Security Audit Report

**Auditor:** Senior QA / Security / Automation review (ZCode agent)
**Date:** 2026-10-30
**Target:** Local development environment (`http://localhost:5173` web, `http://127.0.0.1:4000` API)
**Code changes made during audit:** None (audit-only pass; fixes pending approval)
**Test artifacts:** `qa-audit/` (api-tests.mjs, lifecycle-tests.mjs, db-readonly-check.mjs, api-results.json, lifecycle-results.json, gui-test-screenshots/)

---

## A. Application Overview

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite 6 SPA, custom pushState routing, no UI framework |
| Backend | Express 4 + TypeScript (tsx watch), bound to 127.0.0.1:4000 in dev |
| Graph DB | **Neo4j Aura (cloud)** — `neo4j+s://…databases.neo4j.io` |
| Relational DB | **Supabase Postgres (cloud)** — runtime tables in `whycode_runtime` schema (budgets, sessions, auth flows, guest workspaces, central index) |
| Auth | Supabase-managed accounts (email/Google/GitHub), PKCE OAuth, opaque httpOnly session cookies, server-side session store; optional GitHub App for private repos |
| Integrations | GitHub REST (authenticated), Gemini (answer + separate review pass), Sarvam (Hindi/Hinglish), SerpAPI (secondary web context), Upstash Redis (shared rate limits) |
| Tests shipped | Node built-in test runner — 15 API suites + web suites; verify-live/evaluate scripts; Docker/Caddy deploy config |

Architecture notes (verified in code + live):
- Mutations require `X-WhyCode-Request: 1` + JSON content-type + same-origin — a custom CSRF defense layered on `Sec-Fetch-Site` and Origin checks.
- Guests get cookie-scoped workspaces (8 h TTL, 30 repos, 20 history items) backed by encrypted-at-rest shared storage; accounts get Supabase-backed persistence.
- Private-repo mode re-verifies GitHub authorization on every read/write; revoked access hides data; consent gate before private excerpts reach the model.
- LLM pipeline: exact-quotation validation + a separate independent review model call; unsupported claims are withheld (abstention supported).

## B. Testing Summary

| Metric | Count | Evidence |
|---|---|---|
| Pages/views exercised | 7 (home, help, account sign-in, signup, recovery, repository workspace, investigation result) | GUI screenshots `qa-audit/gui-test-screenshots/` |
| API endpoints tested | 29 routes across health/account/workspace/repositories/ask/private | api-tests.mjs + lifecycle-tests.mjs |
| Automated API checks executed | **126** (106 suite + 20 lifecycle) | api-results.json, lifecycle-results.json |
| Unit tests executed | **107** (71 API + 36 web) — **107 passed / 0 failed** | `npm test` output |
| Typecheck | Clean (both workspaces) | `npm run typecheck` |
| Dependency audit | **0 vulnerabilities** (`npm audit --omit=dev` and full) | audit output |
| Automated checks failed | 21 raw → **20 self-inflicted artifacts** (my test volume tripping documented rate limits) + 1 harness-invalidated check (later verified PASS via curl) | analysis below |
| Responsive breakpoints | 8 (320/375/425/768/1024/1280/1440/1920) — **0 horizontal overflow** | geometry sweep + screenshots |
| Browser E2E test points | ~20 (all major flows) — **1 real defect** (F-04) | screenshots |
| Real LLM answer generated through UI | 1 (correct, cited, saved to history) | t9 screenshot |
| Database verification | Read-only; Postgres tables + Neo4j counts consistent with index status | db-readonly-check.mjs output |

**Blocked / not tested (with reasons):**
- Wrong-password login *through the UI*: the 5-logins/15-min limit was consumed by earlier API negative tests; API-level equivalent verified (400 + generic message, no user enumeration). UI error propagation for 429 verified instead.
- Browser console log capture: in-app browser runtime exposes no console listener; relied on visible error manifestations + Vite overlay (none appeared).
- Safari/Firefox/Edge matrix: only the Chromium-based in-app browser was available; app uses standard React 19/DOM APIs — no known engine-specific code paths.
- OWASP ZAP, Lighthouse: not installed; not added per "no unnecessary dependencies" rule. Covered by targeted header/CSP checks, bundle analysis, FPS/geometry measurement, and manual a11y checks.
- Hindi/Hinglish translation & SerpAPI lanes: configured but not exercised (avoids consuming paid provider quota); unit tests cover the translator.
- File upload/download: the application has no such features (N/A).

## C. Category-wise Results

### 1. Functional — PASS (with 1 defect, F-04)
Verified live: connect repo (form + example shortcut), validation errors, indexing status polling, graph view, real ask (answer + citations + evidence/timeline/connections tabs), history save/remove/clear, duplicate-ingest dedup (same jobId), concurrent ingest dedup, account views (sign-in, create account, forgot password — no-enumeration message), guest workspace isolation across sessions, unauthorized-access gating (401/403 shapes), private mode gating (GITHUB_REQUIRED, CONSENT_REQUIRED paths at API level).

### 2. UI/UX — PASS
No broken layouts, overlaps, or broken images observed at any size. Error alerts (`role=alert`), notices (`role=status`), disabled states ("Connecting…", "Find the answer" disabled while empty), loading skeletons, empty states ("Ask your first question") all present and correct. Cosmetic note F-09.

### 3. Responsive — PASS
Zero horizontal overflow at 320/375/425/768/1024/1280/1440/1920 on home and workspace views. Off-canvas drawer works at 320px with scrim; repository list persists across tabs via guest cookie.

### 4. API — PASS (with F-01, F-02)
Correct status codes across 126 checks: 200/202/400/401/403/404/409/413/429/503 all exercised and appropriate. Validation rejects: malformed JSON (400 INVALID_REQUEST), >32 KB bodies (413), invalid enums, path traversal, oversized/numeric-violating limits. Method abuse (PUT/DELETE/PATCH) → 404. Unknown routes → stable 404 JSON. No stack traces or internal details in any response.

### 5. Database — PASS
Read-only verification: all 9 `whycode_runtime` tables present; answer_budget tracks (namespace, day, used); guest workspaces TTL-bound; Neo4j counts exactly match reported index status (3 commits / 1 file / 26 PRs / 24 issues / 50 comments); no duplicate graph entities after re-index. Deletion via app APIs removes only the caller's own workspace references (verified). Test records created during the audit: guest-workspace rows only (TTL 8 h, self-cleaning); nothing pre-existing was modified or deleted.

### 6. Security — PASS with 1 High (availability, F-01)
- **Headers:** nosniff, X-Frame-Options DENY, Referrer-Policy no-referrer, Permissions-Policy, strong CSP (`default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`; `unsafe-inline` only in dev by design); HSTS correctly dev-absent/production-set. `X-Powered-By` removed.
- **CSRF:** mutation without custom header → 403; foreign Origin → 403; `Sec-Fetch-Site: cross-site` → 403; wrong content-type → 403. Cookies: guest `HttpOnly; SameSite=strict`; account cookie httpOnly + opaque ID only; flows PKCE + state.
- **Host/origin allowlist:** forged `Host:` → 403 HOST_REJECTED (verified via curl).
- **XSS:** invalid-repo payload `<script>alert(1)</script>` rendered inert; React-escaped rich text; `safeHref` enforces https + no credentials; links `rel=noopener noreferrer`; CSP blocks inline script in production.
- **Injection:** all Cypher parameterized (`$repositoryId/$key/$tokens`); all Postgres parameterized ($1…$n; table names are code constants); Supabase filters via URLSearchParams; graph `focus` injection probe handled safely (T9.9b).
- **IDOR / isolation:** cross-session status/graph/ask/remove all 404 with workspace-blind messages; private routes deny without GitHub token; revoked-repo data hidden; no user enumeration in recover/login messages.
- **Secrets:** no tokens/keys in any response or error; health endpoint reports capability names only; `.env` gitignored + dockerignored (note: working copy is not a git repo — F-06).
- **Rate limiting:** global 180/min + route budgets verified engaging (429 + Retry-After); login 5/15min, signup 5/h, ingest 6/10min, ask 15/15min; in-memory cap (5000 clients) and shared-Redis mode both implemented.
- **Dependencies:** `npm audit` clean (0 vulnerabilities).

### 7. Performance — PASS with notes
- Production build: **JS 323.26 kB (gzip 100.20 kB), CSS 166.06 kB (gzip 32.94 kB)**, single chunk (F-05), builds in ~2.1 s.
- `/healthz` instant; `/api/health` ~620–695 ms per call (Neo4j Aura round trip each request — F-02).
- Page FPS 60+ on animated workspace view; 6 CSS animations, no canvas thrash.
- Answer latency (real Gemini ask, evidence-backed): ~60 s through UI (matches product expectations; budget/timeout guards exist server-side: 15 s headers / 30 s request, 45 s LLM timeout with fallback model).
- Local dev caveat: Vite dev serving (unminified, per-module) is slower than the production build measured above; production expectations should use the gzip figures.

### 8. Browser compatibility — PASS (single-engine caveat)
Chromium-based in-app browser only (see Blocked). Layout verified at 8 widths; standard web platform APIs used; web tests cover engine-adjacent edge cases (storage failures, media queries).

### 9. Accessibility & SEO — PASS with 1 defect (F-04)
- Skip link present and first in DOM; Tab navigation advances correctly (verified from a known focus point); Escape closes the drawer; focus is restored to the trigger on drawer close; drawer uses `role=dialog`/`aria-modal`; tabs implement ARIA tablist with arrow/Home/End handling (code + unit tests); inputs labeled (`aria-label`, `htmlFor`); `prefers-reduced-motion` respected (motion pause path).
- SEO: `lang=en`, title, meta description, theme-color, font preload all present. **Missing robots.txt and sitemap.xml** — both URLs return the SPA HTML via fallback (F-03).

## D. Bugs & Vulnerabilities

### F-01 · Cloud rate-limit store fails closed and takes the whole API down — **HIGH (availability)**
- **Module:** `apps/api/src/middleware/security.ts` (`rateLimit` shared mode) + `apps/api/src/infrastructure/shared-rate-limit.ts`
- **Observed:** during a ~2-minute Upstash connectivity blip (verified independently: TCP-unreachable from this machine while GitHub/Supabase were fine), **every** API request — including `GET /api/health` and simple GETs — returned `503 {"error":{"code":"RATE_LIMIT_UNAVAILABLE"...}}`. The app recovered when Upstash returned.
- **Root cause:** `sharedRateLimit()` throws on any Redis error; `rateLimit()` maps that to 503 for all requests. Fail-closed is a defensible security choice, but there is no retry, no short-lived in-memory fallback, and the health endpoint sits behind the limiter — monitoring cannot distinguish "Redis down" from "app down".
- **Reproduce:** block network access to `*.upstash.io`, call `GET /api/health` → 503.
- **Suggested fix (small, behavior-preserving):** (a) one bounded retry (e.g., 250 ms) before failing; (b) on failure, fall back to the existing in-memory limiter for a short TTL (e.g., 60 s) with a logged warning — still rate-limited, no open gate; (c) register `/api/health` before the shared limiter (or mark it exempt) so it always reports real status.

### F-02 · `/api/health` pays a Neo4j round trip per call — **MEDIUM**
- **Module:** `apps/api/src/app.ts` (`databaseHealth`), called on every request.
- **Observed:** 620–695 ms per call (10-sample curl), vs 9 ms for `/` and instant `/healthz`.
- **Impact:** monitoring probes are slow; a probe flood also multiplies Aura load.
- **Suggested fix:** cache the connectivity result for 15–30 s (or make the DB check opt-in via `?deep=1`), keeping `/healthz` as the fast liveness probe.

### F-03 · Missing robots.txt / sitemap.xml — **LOW**
- **Observed:** `/robots.txt` and `/sitemap.xml` return 200 with `index.html` (SPA fallback) on both 5173 and the built app at 4000.
- **Impact:** crawlers receive HTML instead of robots directives; production SEO suffers.
- **Suggested fix:** add `apps/web/public/robots.txt` (and optionally a minimal sitemap) — static files are served automatically.

### F-04 · Mobile drawer does not move focus when opened — **MEDIUM (a11y)**
- **Module:** `apps/web/src/App.tsx` (drawer open effect, `drawerCloseRef`)
- **Observed:** after opening the drawer (real click), `document.activeElement` remains `BODY` even though the code intends `drawerCloseRef.current?.focus()`. The symmetric close path works (focus returns to the archive button, verified live). Keyboard/AT users therefore land nowhere when the `aria-modal` dialog opens.
- **Likely root cause:** the `requestAnimationFrame` focus call races the sidebar's `inert` attribute removal (focus() on an inert-descendant silently fails), or the focus is set before the element is focusable during the open transition.
- **Suggested fix:** focus the close button after the inert state is guaranteed applied — e.g., double rAF, or focus in the effect with `setTimeout(0)`, or verify `!sidebar.hasAttribute('inert')` before focusing.

### F-05 · No code splitting — **LOW**
Single 323 kB JS chunk (100 kB gzip). Acceptable at this scale; route-level lazy loading would cut initial payload when the app grows.

### F-06 · Working copy is not a git repository — **LOW (process)**
`.gitignore` is correct (`.env` excluded) but there is no `.git` — no rollback safety for any fixes. Recommended before making changes.

### F-07 · Audit-created guest workspace rows in shared cloud DB — **LOW (hygiene)**
~15 guest-workspace rows (my cookie-jar sessions) live in the shared Supabase `guest_workspaces` table; they carry an 8 h TTL and self-clean. Nothing pre-existing was touched.

### F-08 · Login limiter vs shared egress IPs — **LOW (UX consideration)**
5 logins/15 min per IP. Correct and verified, but NAT'd offices will feel it. Informational only; the error message is clear and the limit resets.

### F-09 · Repository input retains invalid text when using the example shortcut — **LOW (cosmetic)**
Clicking "Try octocat/Hello-World" while the input holds invalid text keeps that text (disabled) during connection. Clears on success.

## E. Fixes Implemented

**None** — per the product owner's decision ("No fixes — report only", 2026-10-30). The application source is untouched by this audit. Findings F-01–F-04 are documented above with reproduction steps and suggested solutions so they can be addressed independently.

## F. Remaining Issues / Not Tested

See "Blocked / not tested" in section B (browser matrix, ZAP/Lighthouse, translation lanes, wrong-password UI path). F-01–F-04 are open pending fix approval; F-05–F-09 are informational.

## G. Final Production Readiness Verdict

## ✅ READY WITH MINOR ISSUES

**Justification (evidence-based):**
- 107/107 unit tests, clean typecheck, 0 vulnerable dependencies, 0 failed automated API checks after artifact resolution (126 executed), 0 XSS/injection/CSRF/IDOR successes across ~40 targeted security probes, consistent DB state, zero layout overflow at 8 breakpoints, and a complete verified user journey (connect → index → ask → cited answer → evidence → history) including a real model-generated, review-gated answer.
- The blocking-class work before public deployment is **operational, not functional**: F-01 (rate-store fallback + health exemption) is the one High item and is a small, contained change; F-02/F-03/F-04 are low-risk quick wins. None involve architectural change.
- Security posture is notably strong for a hackathon-scale project (custom-header CSRF defense, PKCE, opaque sessions, encrypted private stores, review-gated LLM output, conservative abstention).
