# QA finding fixes

Follow-up to QA-REPORT.md. The original report is preserved as audit evidence.

| Finding | Result |
| --- | --- |
| F-01 Redis outage availability | One bounded retry; 60-second local fallback only for explicitly allowed GET reads. Login, callbacks, writes and model calls remain fail-closed. Fallback emits a warning and response header. Health works independently of Redis, under its own local request limit, and reports the last observed Redis status. |
| F-02 Health latency | Per-application 15-second Neo4j connectivity cache with concurrent-probe coalescing. |
| F-03 Crawler files | robots.txt served in development and production; valid sitemap XML for home/help uses the configured production origin. Private workspace/account/API paths are excluded. Production SPA routes now explicitly serve /workspace and /help on refresh. |
| F-04 Drawer focus | Post-commit focus scheduling retries while the drawer becomes focusable; scheduled work is cancelled on close. Verified in the live browser at 375px: close button receives focus, Escape restores the trigger, no horizontal overflow. |
| F-05 Code splitting | Connections/tree code loads on demand in a separate JS chunk with an accessible loading state. Initial JS build: 312.64 kB / 96.35 kB gzip; connections chunk: 12.12 kB / 5.05 kB gzip. |
| F-09 Example input | The example repository replaces stale input immediately when connection starts. |

F-06 (version-control setup), F-07 (expiry-bound audit data) and F-08 (shared-IP login quota) remain informational. No audit-created cloud rows were manually purged, no repository was initialized, and login protection was not loosened.

Verification includes the complete test/build gate, a mocked Redis outage with bounded retries and strict-write rejection, concurrent health-probe caching, crawler response checks and live desktop/mobile drawer interaction. Mobile focus proof: drawer-focus-fixed.png. Redis outage simulation does not disconnect the real Redis database or consume model quota.
