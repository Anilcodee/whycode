# WhyCode database migrations

Additional server-runtime migrations (apply in filename order after the account migration):

- `20261031_runtime_answer_budget.sql`: server-only atomic daily answer counters.
- `20261031_shared_auth_flows.sql`: encrypted OAuth/PKCE and password-recovery records with atomic consumption.
- `20261031_shared_sessions.sql`: shared encrypted login sessions, revisions and one-time local-vault import markers.
- `20261031_guest_workspaces.sql`: encrypted temporary guest workspaces with browser isolation and transactional updates.
- `20261031_repository_indexes.sql`: central public repository statuses/snapshots with job leases and fenced writes.
- `20261031_worker_coordination.sql`: global indexing admission, encrypted private indexes, one-time private import markers and graph generations.

These runtime migrations have been applied to the current project and live-tested with temporary records. Keep these files for setting up another environment. The runtime schema must never be exposed to browser roles through the Data API.

`20261030_account_investigations.sql` creates the account-owned repository references and investigation history used by WhyCode. It enables row-level security so authenticated users can access only their own records, and defines the function used to remove a user's repository and its investigations together. It does not store GitHub tokens or repository indexes.

For a new Supabase project, review the SQL, then run it in **SQL Editor → New query**. The owner of the current project has already run this migration; it does not need to be run again as part of normal development. Do not modify an already-applied migration for future database changes: add a new dated SQL migration instead.

The app uses the project's publishable/anon key and each signed-in user's access token. Never put a service-role or secret key in the browser. Before deploying future migrations, back up the database and verify access and rollback for the change.
