# Mobile layout and loading verification

Verified locally on 31 October 2026. Deploy the source changes to update Render.

## Fixes

- Removed the old positive flex order that moved the repository form beneath the footer on phones. The form, story and footer now follow document order.
- The mobile header has a logo/account row and a wrapping navigation row. Signed-in phones use a labeled avatar button rather than clipping the account label.
- Workspace cards use the available width, long repository names wrap, and headings/actions can wrap without squeezing each other.
- On small phones, answer tabs form a two-column grid and the question-submit action fills a separate row. Inputs retain 16px text to avoid focus zoom on mobile browsers.
- Tree controls use 44px mobile touch targets. Phone decoration suppression remains intact.
- Added a reusable labeled spinner for workspace/history hydration, account requests, imports/deletions, graph requests and lazy graph loading. Connecting, reindexing, older-history loading and investigations have visible spinners.
- Startup waits for the first account check, exposes account-check errors with retry, and account navigation starts at the top of its page.

## Evidence

Browser layout checks covered widths 320, 360, 390, 430, 768, 800, 844, 1024 and 1440 pixels on the signed-in homepage. The repository form stayed before the footer and all visible header controls remained inside the viewport.

Signed-in workspace and repository-answer layouts were checked at 320, 360, 390, 430, 768, 1024 and 1440 pixels, with no document-width overflow. Source inspector, help and sign-in were also checked at 320 pixels. Phone account fields reported 16px text. The mobile graph toolbar wrapped inside its viewport, and the repository drawer focused its close button when opened.

Delayed fixture requests verified `aria-busy=true`, visible 22px spinners and descriptive loading statuses while saved work arrived. The question flow displayed both an Investigating button spinner and an investigation status spinner.

The frontend gate passed 36 tests and a production build. These are browser viewport checks, not physical-device certification or a new backend security/load test.

## Repeat the UI checks

```sh
npm run build --workspace @whycode/web
node qa-audit/responsive-preview.mjs
```

Open `http://localhost:4180/qa/account` for fabricated signed-in work or `/qa/guest` for guest mode. The preview binds only to loopback, serves the production frontend with delayed sample API responses, and does not use real credentials, repositories, databases or model calls. It is an isolated UI fixture, not an alternate production authentication implementation.

The real local application was separately inspected for the guest homepage/footer. Screenshots and raw viewport results are local QA output and remain ignored by Git.

## Follow-up: desktop reveal timing

The startup account gate introduced a timing regression on the guest homepage: the reveal effect could run while the startup screen was still mounted, then fail to rerun when the account check finished. CSS left the later content transparent because it assumed an observer was attached.

Reveal setup now waits for both session and account readiness. Content is visible by default; hiding is enabled only for elements attached to an observer. Cleanup removes pending hiding, observer failure shows the content, and the intersection threshold is zero so tall sections do not depend on a minimum visible percentage.

Three regression tests cover intersection reveal, cleanup of unrevealed elements and readable fallback for reduced motion/missing or failed observers. All 39 frontend tests and the web build passed. Desktop checks included the real local homepage and an isolated guest fixture whose account response deliberately arrives after the session response. Account-page return navigation also reattaches reveal observation.
