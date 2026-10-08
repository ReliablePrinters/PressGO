# REBUILD.md — rebuilding PressGO from this repository

PressGO is a static web app (GitHub Pages, folder `docs/`) on top of a Supabase project (Postgres, Auth, Storage, Realtime and one Edge Function). This guide says how to recreate it from nothing.

**How to read the labels**

- **VERIFIED** means it was read from the live Supabase dashboard or database on 2026-10-07 (read-only), or proven by rebuilding the schema in a throwaway local database.
- **NOT VERIFIED** means it could not be checked. Treat it as a hint and check it yourself.
- **UNTESTED** means a procedure that has not been rehearsed yet. Rehearse it before you rely on it (see section 12).

**Never put these in this repository:** database passwords, `service_role` / secret keys, JWT secrets, connection strings, or exports of real data. The only key in the repo is the *publishable* key in `docs/config.js`, which is designed to be public.

---

## ⚠️ Settings requiring review before pilot

Four live Supabase settings need a decision before real staff use PressGO. **None of them has been changed.** Each item below uses three labels:

- **Current verified setting** is what the live dashboard showed on 2026-10-07 (read-only).
- **Recommended setting** is a suggestion for review. It is not a verified fact and nothing has been applied.
- **Not yet approved for change** means the owner has not approved any change. Do not change it until they do.

Important context: whether this Supabase project is also used by the Reliable-Printers customer app is **NOT VERIFIED** (see section 13, item 9). Auth settings apply to the whole project, so a change made for PressGO could also affect any other app that uses this project's Auth. How the customer app depends on these settings was NOT VERIFIED.

| # | Setting | Current verified setting | Recommended setting | Not yet approved for change |
|---|---|---|---|---|
| 1 | Auth → Allow new users to sign up | **ON.** `PILOT.md` says it should be OFF. | OFF for PressGO, after confirming the customer app does not rely on public sign-up. | **Do not change yet**, because it is NOT VERIFIED whether the customer app uses this project's sign-up. |
| 2 | Auth → Minimum password length | **6.** The `admin-users` function enforces 8 to 72 characters. | 8, to match the function. | **Do not change yet.** |
| 3 | Auth → URL Configuration → Site URL | **`http://localhost:3000`.** The only Redirect URL is the GitHub Pages address `https://reliableprinters.github.io/PressGO/`. | Marked for review: decide whether the Site URL should be the deployed PressGO address (this may matter for the customer app too). | **Marked for review. Do not change yet.** |
| 4 | Realtime → Allow public access to channels | **ON.** PressGO's presence channel is public, so anyone with the publishable key could join it and see display names. | Marked for security review. Turning it OFF would likely require changing how the app opens its channels (NOT VERIFIED). | **Marked for security review. Do not change yet.** |

---

## 1. Required software and accounts

| Need | Why | Status |
|---|---|---|
| A Supabase account and a new project (Free plan works; see section 13 for limits) | Database, logins, files, realtime, Edge Function | VERIFIED: live project is on the Free plan, region West US (Oregon), PostgreSQL 17.11 |
| A GitHub account with this repository | Hosts the app (GitHub Pages) and the source of truth | VERIFIED |
| A web browser | Supabase dashboard and GitHub web editor are enough; no local tools are needed to rebuild | VERIFIED (this is how the live app was built) |
| *Optional:* Supabase CLI, `psql`/`pg_dump` (PostgreSQL 16 or newer), Node 22+ | Run the local tests, take SQL exports, deploy the function from a terminal | Tests VERIFIED with PostgreSQL 16. The CLI and Node versions are NOT VERIFIED |

---

## 2. Migration order

Apply these files from `supabase/migrations/` **in this order, each exactly once** (the SQL editor in the Supabase dashboard is enough; paste the whole file and run it):

| # | File | Adds |
|---|---|---|
| 1 | `0001_foundation.sql` | `pressgo` schema, employees, departments, conversations, messages, jobs, audit trail, access rules, invitations, seed departments (Front Desk, Novelty, Bindery, Managers) and channels (General, Urgent Jobs, one per department) |
| 2 | `0002_job_core.sql` | Job creation, assignment, status moves |
| 3 | `0003_files_holds_handoffs.sql` | Job files (private bucket `job-files`), artwork approval, problems, handoffs |
| 4 | `0004_usernames.sql` | `username` column and the `service_role` grants the `admin-users` function needs |
| 5 | `0005_chat.sql` | Chat, unread tracking, adds `pressgo.messages` to the realtime publication |
| 6 | `0006_group_messages.sql` | Private group messages |
| 7 | `0007_tasks_alerts.sql` | Tasks and alerts |
| 8 | `0008_assigned_jobs_only.sql` | People only see jobs meant for them |
| 9 | `0009_chat_images.sql` | Pictures in chat (private bucket `chat-files`) |
| 10 | `0010_delete_messages.sql` | Deleting messages |
| 11 | `0011_approve_pictures.sql` | Approving pictures |
| 12 | `0012_break_status.sql` | "On break" status |
| 13 | `0013_close_direct_writes.sql` | Removes direct table writes for signed-in and anonymous users; all changes go through the checked functions |

**There is no migration-tracking table.** Nothing in the database records which files were applied. Keep a note of the last file you ran.

**Proof the files alone rebuild the schema (VERIFIED):** applying 0001–0013 to an empty PostgreSQL 16 database (with `supabase/tests/local_stub.sql` standing in for Supabase's `auth`/`storage`) produces exactly what the live database has: 17 tables, 29 policies, 20 triggers, 48 functions, row-level security on every table, 4 departments, and no write privileges for the `authenticated` / `anon` roles.

---

## 3. Supabase project setup

1. Create a new project (any name; region close to your users; set a strong database password and store it in a password manager, **not** in the repo).
2. Apply migrations 0001–0013 (section 2).
3. Do the dashboard settings in sections 4–7. Several are **not** created by migrations (section 13 lists them).
4. Make sure the Data API exposes the `pressgo` schema (section 13). Without it the app cannot reach any table or function.

---

## 4. Auth configuration

PressGO uses email + password sign-in with a *fake* address: username `jane` signs in as `jane@pressgo.example.com`. Nothing is ever emailed to it. Settings below are what the live project had on 2026-10-07 (VERIFIED, read-only).

| Setting (dashboard path) | Live value |
|---|---|
| Sign In / Providers → Email provider | Enabled |
| All other providers (Phone, Google, GitHub, SAML, …) | Disabled |
| Allow new users to sign up | **ON** (see warning below) |
| Confirm email | **ON** |
| Allow anonymous sign-ins | OFF |
| Allow manual linking | OFF |
| Secure email change | ON |
| Secure password change | OFF |
| Require current password when updating | OFF |
| Prevent use of leaked passwords | OFF (Pro plan feature) |
| Minimum password length | 6 |
| Password requirements (character classes) | None selected |
| Email OTP expiration / length | 3600 seconds / 8 digits |
| URL Configuration → Site URL | `http://localhost:3000` (the default; never changed) |
| URL Configuration → Redirect URLs | `https://reliableprinters.github.io/PressGO/` (1 entry) |
| Sessions: JWT (access token) expiry | 3600 seconds |
| Sessions: refresh-token reuse detection / reuse interval | On / 10 seconds |
| Sessions: single session per user, time-box, inactivity timeout | Off / 0 / 0 (these are Pro-plan settings) |
| Rate limits (per hour unless noted) | Emails 2, SMS 30, token refresh 150 per 5 min, verifications 30 per 5 min, anonymous 30, OTP 30, Web3 30 |
| Attack Protection → CAPTCHA | Disabled |
| Multi-Factor → TOTP | Enabled (up to 10 factors per user); the app does not use it. Phone MFA disabled |
| Auth Hooks | None |
| Emails → custom SMTP | Disabled (Supabase's built-in sender, limited to 2 emails per hour) |

**Warnings for a rebuild (these are what the live project does today, not recommendations I applied):**

- **Public sign-up is ON.** `PILOT.md` says to turn it off. Anyone who learns the project URL and publishable key can create an Auth account. They would have no `pressgo.employees` row, so they cannot see PressGO data, but the setting should be reviewed.
- **The minimum password length is 6**, while the `admin-users` function enforces 8 to 72 characters for passwords managers set. A person can change their own password to 6 characters.
- Email templates were **not** inspected (NOT VERIFIED). They are unused, since PressGO never emails anyone.

---

## 5. Storage configuration

Both buckets are created by the migrations, so a rebuild gets them automatically. Live values (VERIFIED):

| Bucket | Created by | Public | Size limit | Allowed types |
|---|---|---|---|---|
| `job-files` | `0003` | No (private) | 100 MB | Any |
| `chat-files` | `0009` | No (private) | 10 MB | `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `image/heic` |

Storage policies (all on `storage.objects`, role `authenticated`, VERIFIED; there are no update or delete policies, so uploads are permanent):

- `pressgo job files read` / `pressgo job files add`: allowed when `pressgo.can_view_job(pressgo._job_from_path(name))` (the first folder in the file path is the job id).
- `pressgo chat files read` / `pressgo chat files add`: allowed when `pressgo.can_read_conversation(pressgo._conv_from_path(name))` (the first folder is the chat id).

Other storage settings (VERIFIED): global file size limit **50 MB** (fixed on the Free plan, so the 100 MB `job-files` limit cannot actually be reached), image transformation off.

---

## 6. Realtime configuration

- **Database publication:** `supabase_realtime` contains only `pressgo.messages` (added by `0005`). VERIFIED.
- `pressgo.employee_status` (online/break marks) is **not** in the publication. The app listens for changes on it but also re-reads every 60 seconds, so break marks can lag up to a minute. VERIFIED (observation only).
- **Presence and typing** use Realtime channels created by the browser: a presence channel `presence-all` (online/offline) and broadcast channels `typing:<chat id>`. They need no database setup.
- Dashboard → Realtime → Settings (VERIFIED): Realtime enabled; **Allow public access to channels: ON** (the app's channels are public, so anyone with the publishable key could join the presence channel and see display names); database pool 2; Postgres Changes pool 2; max concurrent clients 200; max events per second 100; max presence events per second 20; max payload 256 KB (several of these are locked on the Free plan).

---

## 7. Edge Functions

One function: **`admin-users`** (source: `supabase/functions/admin-users/index.ts`). It is the only thing that can create logins, reset passwords and disable people. It checks that the caller is a signed-in, active manager.

Deploy it (dashboard path VERIFIED as the way the live one was made; CLI NOT VERIFIED):

1. Dashboard → Edge Functions → create a function named exactly `admin-users` and paste the contents of `index.ts`.
2. Live setting (VERIFIED): **Verify JWT with legacy secret: ON.** The dashboard recommends OFF for functions that do their own authentication, which this one does. Keep it as live unless you test the alternative.
3. The function URL is `https://<PROJECT-REF>.supabase.co/functions/v1/admin-users`. The app builds this from `docs/config.js`.

The deployed copy matched `index.ts` in this repository byte for byte on 2026-10-07.

---

## 8. Secrets (names only)

**There are no custom secrets** (VERIFIED: the Secrets page says "No custom secrets created"). The function uses only the secrets Supabase injects into every function:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` (shown as DEPRECATED in the dashboard)
- `SUPABASE_SERVICE_ROLE_KEY` (shown as DEPRECATED in the dashboard)

Other default names the dashboard lists: `SUPABASE_DB_URL`, `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS`, `SUPABASE_JWKS`, `SB_REGION`, `SB_EXECUTION_ID`, `DENO_DEPLOYMENT_ID`. **No values are recorded anywhere in this repository.** If Supabase stops injecting the deprecated names, `index.ts` will need updating (NOT VERIFIED when or whether that happens).

---

## 9. Creating the first administrator

Managers create everyone else from the app's **Staff** screen (it calls `admin-users`). The very first manager has to be created by hand, because no manager exists yet to call the function.

1. Supabase → Authentication → Users → **Add user** → *Create new user*. Email: `<username>@pressgo.example.com` (for example `boss@pressgo.example.com`). Set a password (8+ characters). Tick **Auto Confirm User**.
2. Supabase → SQL Editor, run (change the values):

   ```sql
   insert into pressgo.employees (email, display_name, manager_role, front_desk)
   values ('boss@pressgo.example.com', 'Boss', true, true);
   ```

3. Open the app and sign in with the username (`boss`) and that password. The app calls `accept_invitation()`, which attaches the login to the row. It only attaches a login whose email is confirmed, which is why step 1 needs *Auto Confirm*.
4. Open **Staff** and add everyone else (username, name, first password of 8+ characters, departments, Front Desk / Manager flags).

A database rule refuses to disable or demote the last active manager, so keep at least one. (This procedure matches the live setup described in `README.md`; the exact insert above was proven in the local tests but not re-run on a fresh Supabase project.)

---

## 10. Deploying PressGO

1. Edit `docs/config.js`: set `url` to `https://<PROJECT-REF>.supabase.co` and `key` to the project's **publishable** key (dashboard → Settings → API Keys). Never use a secret / `service_role` key here.
2. Commit and push to the `main` branch. GitHub Pages serves the `docs/` folder, so the app appears at `https://<owner>.github.io/<repo>/`. (Live setting "Pages from `main` / `docs`": NOT VERIFIED today, because the repository settings page was not visible to the browser session used. It is how the live site behaves.)
3. In Supabase → Authentication → URL Configuration, add the site address as a **Redirect URL** (and ideally set it as the **Site URL**).
4. The page loads `@supabase/supabase-js@2` from a CDN (jsDelivr), unpinned. `docs/sw.js` caches only the app's own files (cache name `pressgo-shell-v1`); it never caches Supabase data.

---

## 11. Verifying a rebuilt database

Run in the SQL editor of the new project. Expected values come from the live database and from a clean local rebuild (both VERIFIED):

```sql
select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'pressgo' and c.relkind = 'r';                       -- 17
select count(*) from pg_policies where schemaname = 'pressgo';          -- 29
select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'pressgo' and not t.tgisinternal;                    -- 20
select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'pressgo';                                           -- 48
select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'pressgo' and c.relkind = 'r' and not c.relrowsecurity;   -- no rows
select count(*) from information_schema.role_table_grants
 where table_schema = 'pressgo' and grantee in ('authenticated', 'anon', 'PUBLIC')
   and privilege_type <> 'SELECT';                                      -- 0
select id, public, file_size_limit from storage.buckets order by id;    -- chat-files and job-files, both public = false
select pubname, schemaname, tablename from pg_publication_tables
 where pubname = 'supabase_realtime';                                   -- pressgo.messages
select name from pressgo.departments order by name;                     -- Bindery, Front Desk, Managers, Novelty
```

Also check:

- Dashboard → Integrations → Data API: `pressgo` is in the exposed schemas.
- Sign in as the first administrator, open **Staff**, create a test person, sign in as them, then disable the test person.
- A signed-out request must not read data: `https://<PROJECT-REF>.supabase.co/rest/v1/` with only the publishable key and `Accept-Profile: pressgo` must not return any rows.

Automated checks from a terminal (local PostgreSQL 16 or newer, no Supabase needed):

- `bash supabase/tests/run_local.sh` runs every permission test against a throwaway database (look for the `PASSED` lines and no `FAILED`/`ERROR`).
- `node --experimental-strip-types supabase/tests/functions/run_admin_users_test.mjs` runs the `admin-users` rules against a fake backend (Node version requirement NOT VERIFIED).
- These tests stub `auth` and `storage`, so storage policies are **not** tested locally; check them in the live dashboard.

---

## 12. Export and recovery procedure

Labels: **VERIFIED** = actually done and checked. **UNTESTED** = written down but never run. **NOT VERIFIED** = not checked.

**Overall status of the restore procedure: PARTIALLY VERIFIED — local PostgreSQL 16 only.** Only the database part (12.3, steps 1 to 7) was rehearsed, on a scratch PostgreSQL 16 on 2026-10-08. Nothing has been restored on Supabase. The live database is **PostgreSQL 17.11**, so PostgreSQL 17 restore behavior is **NOT VERIFIED**.

**Backups.** The 2026-10-08 backup was created **manually** (dashboard-only method, 12.1). Whether Supabase provides automatic backups for this project is **NOT VERIFIED here**: it depends on the current Supabase plan, which can change. Confirm automatic backup coverage against the current Supabase plan and the dashboard before relying on it, and until then treat the live database as the only copy of the data. Keep every export **outside Supabase and outside this repository** (this repository is public), and repeat it regularly (for example weekly).

### 12.1 Taking a backup

**Dashboard-only method (VERIFIED, done manually on 2026-10-08).** No password, no pg_dump, nothing changed. Read each non-empty `pressgo` table with the SQL editor and save it as JSON and CSV; list the Auth users (id, email, dates, flags, never hashes); download each Storage file and compare its size and MD5 with the Storage `etag`; record the dashboard settings; download the GitHub main ZIP; write SHA-256 hashes and a MANIFEST. The 2026-10-08 backup of 10 tables (64 rows), 4 Auth users and 3 chat files was taken this way.

**pg_dump method (UNTESTED, never used).** Needs the database password from the dashboard's *Connect* button; use the session-pooler connection string and keep it in an environment variable, never in a file you commit:

```bash
pg_dump "$DATABASE_URL" --schema=pressgo --no-owner --no-privileges -Fc -f pressgo_$(date +%F).dump
```

The live database is PostgreSQL 17.11, so pg_dump should be version 17 or newer (the sandbox used for the rehearsal only had version 16). Using it and restoring from its output are both UNTESTED.

### 12.2 What a backup does not contain

- **Logins.** Password hashes and sessions live in the `auth` schema and are not exported. Recreate each login with the **Staff** screen or `admin-users` (new passwords), then re-link by email (12.3, step 7).
- **Files.** The database contains references/metadata for stored files, while the actual Storage objects are separate files and must be backed up separately. Download both buckets.
- **Dashboard settings.** Re-apply sections 4 to 7 and 13 by hand.
- Empty tables, sequence values, Auth email templates.

### 12.3 Restore — PARTIALLY VERIFIED — local PostgreSQL 16 only

Steps 1 to 7 were run on a scratch **PostgreSQL 16** on 2026-10-08. The live database is **PostgreSQL 17.11**; **PostgreSQL 17 restore behavior is NOT VERIFIED.** Steps 8 and 9 and everything on a real Supabase project are **UNTESTED**. Rehearse only in a scratch database or a separate scratch project, **never in the live project**.

1. Create the empty database / new project and run migrations 0001-0013 in order. VERIFIED locally (PostgreSQL 16): gives 17 tables, 29 policies, 20 triggers, 48 functions, 0 tables without RLS.
2. **Remove the seed rows the migrations create.** They have random ids that clash with the backup. Delete in this order: `pressgo.conversations`, `pressgo.departments`, `pressgo.audit_events`. VERIFIED locally. The audit delete is blocked by the immutability trigger, so it needs step 3.
3. **Switch triggers off for the load.** See the warning box below. VERIFIED locally only, as a superuser.
4. Load the tables in this order: `departments`, `employees`, `department_memberships`, `jobs`, `conversations`, `conversation_members`, `conversation_reads`, `messages`, `employee_status`, `audit_events`. VERIFIED locally with `insert ... select ... from jsonb_populate_recordset(...)` from the JSON backup, with these exceptions:
   - leave out `employees.username` (generated column, recomputed from the email);
   - insert `audit_events` with `overriding system value` (generated-always id).
5. **Reset the counters** after loading. VERIFIED locally:

   ```sql
   select setval('pressgo.job_number_seq', (select max(job_number) from pressgo.jobs));
   select setval(pg_get_serial_sequence('pressgo.audit_events','id'), (select max(id) from pressgo.audit_events));
   ```

   Without this, the next job gets a number that already exists.
6. Triggers return to normal when the transaction ends. VERIFIED locally: all 20 enabled afterwards. Then run the checks in section 11.
7. Recreate each login, then re-link by email. VERIFIED locally against fake users only (it adds one audit row per employee changed):

   ```sql
   update pressgo.employees e set auth_user_id = u.id
     from auth.users u where lower(u.email) = lower(e.email) and e.auth_user_id is distinct from u.id;
   ```

   The restored employees keep the OLD `auth_user_id` values until this runs, so nobody can sign in meaningfully before it.
8. Upload the Storage files to the same bucket and path, and compare size and MD5 with the backup's `storage-objects.txt`. UNTESTED.
9. Re-apply the dashboard settings and redeploy the `admin-users` function and the app. UNTESTED.

#### Trigger bypass (step 3): NOT VERIFIED on Supabase

> **`session_replication_role` has NOT been verified on Supabase.**
> - **What was verified:** `set local session_replication_role = replica;` inside one transaction worked on a **local PostgreSQL 16 scratch server, as a superuser**.
> - **What failed:** a plain non-superuser was refused in the same sandbox (`permission denied to set parameter "session_replication_role"`).
> - **What is unknown (NOT VERIFIED):** whether Supabase allows its `postgres` role to set it, on PostgreSQL 17.11 or any other version.
> - **Untried alternative (UNTESTED):** `alter table ... disable trigger user` on each table, as the table owner.
> - **Rule:** test this **only in a separate scratch Supabase project, never in the live database.** Do not try it against the live project to find out whether it works.

### 12.4 What has and has not been rehearsed

| Item | Status |
|---|---|
| Migrations rebuild the schema (17/29/20/48) | VERIFIED locally (PostgreSQL 16 only) |
| Load all 10 tables from the JSON backup (64 rows, row-for-row match) | VERIFIED locally (PostgreSQL 16 only) |
| Seed clash, audit immutability, generated columns, counter reset | VERIFIED locally (problems found and fixed in steps 2-5) |
| Login re-link SQL | VERIFIED locally against fake users (PostgreSQL 16 only) |
| PostgreSQL 17 / 17.11 restore behavior | NOT VERIFIED (rehearsal used PostgreSQL 16; live is 17.11) |
| `session_replication_role` on Supabase (`postgres` role) | NOT VERIFIED |
| `alter table ... disable trigger user` as an alternative | UNTESTED |
| Real Auth accounts, passwords, Staff screen / admin-users | UNTESTED |
| Storage restore (3 chat images, policies, paths in the app) | UNTESTED |
| Realtime, dashboard settings, Edge Function, deployed app | UNTESTED |
| Restore from the CSV files | UNTESTED |
| pg_dump export and `pg_restore` | UNTESTED |
| Automatic Supabase backup coverage for this project | NOT VERIFIED (confirm against the current plan) |

---

## 13. Dashboard-only settings (not created by any migration)

These exist only in the Supabase dashboard (or GitHub), so they are lost in a rebuild unless re-applied by hand:

1. **Data API → Exposed schemas must include `pressgo`.** Live: `graphql_public`, `pressgo`, `public` (VERIFIED). Also live: max rows 1000; extra search path `public`, `extensions`; "Automatically expose new tables" ON. (The page also says "0 of 17 tables exposed" and "0 of 48 functions exposed"; what that wording means was NOT VERIFIED, since the app works and table access is governed by the grants and policies in the migrations.)
2. All Auth settings in section 4, especially: email provider on, Confirm email, redirect URL.
3. Realtime settings in section 6 (public channel access must stay ON for the app's presence channel as currently built).
4. The `admin-users` Edge Function and its *Verify JWT* setting (section 7).
5. The Storage global limit (50 MB on the Free plan) and image transformation (off).
6. `docs/config.js` pointing at the right project, and GitHub Pages serving `docs/` from `main`.
7. The first administrator (section 9) and all staff accounts.
8. Project members: the live project is shared by 2 organization members (one Owner, one Administrator). VERIFIED.
9. **Customer app relationship: NOT VERIFIED.** The live `public` schema is empty (VERIFIED 2026-10-08, read-only: no tables, views, functions, policies or triggers), and the only Storage buckets and the only Edge Function in this project belong to PressGO. This guide therefore does **not** claim that the Reliable-Printers customer app stores anything in this project's `public` schema. Whether the customer app uses this project at all (for example its Auth accounts) has not been verified. One Auth account exists that is not a PressGO employee (unconfirmed, never signed in, created 2026-10-07; its origin is unknown). Until the relationship is confirmed, treat project-wide Auth changes with care and make any backup of this project cover the Auth user list as well as the `pressgo` schema.

Things not checked at all (NOT VERIFIED): email templates, database network restrictions and SSL enforcement, connection-pooler settings, the contents of Vault (the extension is installed), JWT signing-key settings and the API keys page (deliberately not opened, so no key values were seen), project pause rules on the Free plan, and the GitHub Pages and branch-protection settings.

**Installed Postgres extensions (VERIFIED):** `pgcrypto` (needed by `0001`; `0001` creates it if missing), `uuid-ossp`, `pg_stat_statements`, `supabase_vault`, `plpgsql`.
