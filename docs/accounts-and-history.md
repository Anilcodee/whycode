# Accounts, private repositories, and history

## What is available

Public exploration requires no personal account or shared password, including in production. Personal account sign-in and GitHub authorization are required for private repositories.

The account dialog supports Google, GitHub, and email/password through Supabase Auth. Email verification is required. Password creation requires 12–128 characters and confirmation. Recovery uses a browser-bound PKCE email link and a short-lived, single-use recovery-only cookie. Passwords are never stored by WhyCode; provider tokens stay on the server. OAuth uses PKCE and a browser-bound, single-use flow cookie. The browser receives an opaque HttpOnly cookie (Secure with a `__Host-` name in production). Sessions end when the provider access token expires, with an eight-hour maximum; reconnect rather than silently storing refresh tokens.

Sign-in does not authorize repository access. A separate GitHub App connection uses a GitHub App user access token, whose access is the intersection of the user's access and the app's selected repositories. Broad-scope traditional OAuth repository tokens are rejected.

Private indexes are held in a separate memory store per authenticated session. They do not enter the public file store, Neo4j database, or browser history. Private evidence retrieval is lexical and uses pinned source snapshots and explicit commit/file/PR associations; its relationship view is an overview rather than the public Neo4j traversal. Authorization is checked against GitHub on every repository operation, including answers and source graphs. Signing out, disconnecting, token expiry, or restarting discards access to that private workspace. In-flight work may finish in memory. Private questions require explicit consent to send retrieved excerpts to the configured answer model; external search and translation are disabled for that path.

## Enable the providers

1. Create a Supabase project and configure the email, Google, and GitHub identity providers. Keep email confirmation enabled. Configure provider client IDs/secrets in Supabase, not in the browser. Enable the provider's password protections and configure production SMTP delivery.
2. Set server variables `SUPABASE_URL` and `SUPABASE_ANON_KEY` (the project public/anon key, **not** the service-role key). Set `ACCOUNT_PROVIDERS` to only the providers actually enabled. No `VITE_` secrets are needed.
3. In Supabase, set the site URL to the application's origin and allow the callback `http://localhost:5173/api/account/callback**` for local work, or the corresponding exact production origin/path with flow query parameters. Do not allow arbitrary external redirect origins. The default recovery email link works with the PKCE callback. Open signup and recovery links in the same browser that initiated the flow.
4. Register a **GitHub App** for repository access (separate from Supabase's GitHub social-login OAuth app). Request only Metadata, Contents, Pull requests, and Issues **read** permissions. Disable write permissions, webhooks, and unnecessary organization permissions. Allow user authorization and set the callback URL to `http://localhost:5173/api/account/github/callback` (or the HTTPS production equivalent). Set `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, and `GITHUB_APP_SLUG` on the server.
5. Restart the API. Sign in, open Account, choose repositories on GitHub, and connect GitHub. Installing an app is an explicit user action on GitHub; this implementation does not automatically grant new permissions. Then select Private repository on the entry form.
6. Use HTTPS in production, set `PUBLIC_ORIGIN`, configure only the trusted reverse proxy. Provider callbacks must use the same origin as the browser session.

Actual Google/GitHub authorization and email delivery require registered providers and credentials. Automated tests mock those providers and prove local security boundaries; they do not establish that an external registration or SMTP configuration works.

## Repositories with more than 200 commits

Choose an initial window of 25, 75, 200, or 500 commits under History options. A completed new index reports its date range and whether older commits remain. Load older history fetches another batch using the selected window size, retaining previously indexed commits and changed paths. GitHub pages are pinned to the initial head SHA, so concurrent pushes cannot shift offsets or introduce paging gaps. Source files remain pinned to that same revision. Refresh starts a new window at the latest head; it replaces the saved snapshot. Old indexes without continuation metadata need one refresh before older-history loading becomes available.

Each index has a 5,000-commit safety limit. This is deliberately bounded, not a claim to ingest every branch or an arbitrarily large history. PRs/issues/comments, file contents, changed-file details, and direct commit-to-PR associations have separate budgets; loading more commit summaries does not imply complete rationale coverage. When a limit is reached, the interface says so.

## Scaling boundary

This is a runnable **single-process first slice**, not a completed multi-instance account service. Opaque sessions, OAuth flows, and private indexes are held in memory. The process permits 10 active private workspace contexts, two concurrent indexes, and two concurrent answer generations. Public storage remains bounded and shared. Before a multi-instance deployment, replace session/flow storage with a shared TTL store, persist private indexes with per-user/tenant authorization and encryption, introduce a durable job queue and per-user quotas, and validate deletion, revocation, backup, and retention behavior. Do not switch private storage to the existing shared Neo4j or file store.

## References

- [Supabase PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow)
- [Supabase Auth API contract](https://github.com/supabase/auth/blob/master/openapi.yaml)
- [GitHub App user authorization and permission intersection](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
