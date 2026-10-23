# Feature update: avatars, personal look, pasted pictures, deleting jobs

**Status: written and tested locally, committed and pushed on the branch `feature/profile-look-paste-delete`. NOT applied to the live database, NOT merged into `main`, NOT deployed.**
Nothing in this update has touched the production Supabase project (the only live access so far was read-only: backups and drift checks). Three new migrations (`0015`, `0016`, `0017`) are waiting to be applied by the owner, and the web app changes in `docs/` are not published.

**Which checklist counts?** The release runbook below and **Parts A, B and C** of the manual checklist further down are the authoritative ones. The shorter "Manual test checklist" under "Tests" is the original, kept only as a summary.

## What changed

| # | Feature | Where it lives |
|---|---|---|
| 1 | **Profile pictures** | `supabase/migrations/0015_avatars.sql`, `docs/profile.js`, `docs/chat.js` (`avatar()`), `docs/style.css` |
| 2 | **Personal look** (appearance + accent colour) | `supabase/migrations/0016_preferences.sql`, `docs/prefs.js`, `docs/profile.js`, `docs/style.css` |
| 3 | **Paste a picture into a job's files** | `docs/pastefile.js`, `docs/app.js` (upload form) — no database change |
| 4 | **Delete a job** | `supabase/migrations/0017_delete_job.sql`, `docs/app.js` (job page) |

### 1. Profile pictures
- Sidebar → **My profile** → choose a JPEG, PNG or WebP. The browser crops it to a square, re-draws it at 256 × 256 (which also removes hidden photo data such as location) and uploads a small JPEG.
- Stored in a new **private** bucket `avatars`, in the person's own folder (`<employee id>/<random name>.jpg`). Bucket limits: 2 MB, JPEG / PNG / WebP only.
- Shown wherever the app already shows a person's circle: chat, job list and detail, history, home, Staff, sidebar. **Without a picture the existing coloured-initials circle is the default avatar.**
- Security: `set_avatar()` / `remove_avatar()` have no "who" argument, so they can only ever act on the signed-in person. Nobody else (managers included) can change someone's picture. Storage policy: any active staff member can read; you can only upload into, or delete from, **your own folder**; nobody can overwrite. Direct table writes stay closed (migration 0013 rule).
- When a picture is replaced or removed the app deletes the old file (best effort).

### 2. Personal look
- **My profile** also holds two settings: **Appearance** (Match my computer / Light / Dark) and **Accent colour** (Purple = today's colours, Blue, Teal, Green, Orange, Graphite). That is all, on purpose.
- Saved per person in `employee_preferences` (only they can read or change their row) and restored at the next sign-in. A copy is kept in the browser so the page does not flash the wrong colours while loading; the server copy always wins after sign-in.
- Accessibility: every accent is checked by an automated test for WCAG contrast in light and dark (links and highlights ≥ 4.5:1 on the page and cards, white text on buttons ≥ 4.5:1, buttons ≥ 3:1 against their card). Options are real radio buttons with text labels (not colour alone) and a visible focus ring. One pre-existing value is below 4.5:1 and was left alone: the default purple's dark-mode *hover* colour (4.39:1).
- The accent changes buttons, links and highlights; the pink "GO" brand highlight and the dark sidebar are unchanged.

### 3. Paste a picture
- On a job (not closed): in **Files**, click the new **Paste a picture** box (or anywhere in the upload box), press **Ctrl+V** (⌘+V on Mac). A preview appears with **Remove**; the picture is placed in the normal file box, so the existing file picker, **Type** choice, **Upload** button, private storage upload and `register_file()` checks are all used unchanged.
- Only real pictures (PNG, JPEG, GIF, WebP, BMP, AVIF) are accepted from the clipboard; no SVG. Max 100 MB (the existing file limit). File name is generated (`pasted-image-YYYYMMDD-HHMMSS.png`) with an extension chosen by the app, never taken from the clipboard.
- Repeated paste events of the same picture within 1.5 s are ignored, a paste while an upload is running is ignored, the box holds one file, and the form ignores a second submit while an upload is running. Pasting plain text anywhere else is not affected.

### 4. Delete a job — why it is a "soft" delete
I looked at everything that points at a job before deciding:

| Linked data | Rule today | Consequence |
|---|---|---|
| `audit_events` (history) | FK to the job; update/delete blocked by trigger | A hard delete is impossible and must not be forced |
| `job_files` + files in the `job-files` bucket | FK; "cannot be changed or removed" trigger; storage is permanent | Same |
| `job_holds`, `job_handoffs` | FK; delete blocked by trigger | Same |
| job chat (`conversations`, `messages`, `deleted_messages`) | FK; messages are permanent (only hidden via `delete_message`) | Same |
| `tasks`, `notifications`, `job_access` | FK to the job | Would be orphaned |

Erasing the row would conflict with the "permanent record" rules (or orphan data), so I did **not** weaken them. Instead, deleting works the way deleting a chat message already does:

- `delete_job(job, version, reason)` marks the job deleted (`deleted_at`, `deleted_by`, `delete_reason`). It disappears from every list and screen for **everyone, managers included**, because `can_view_job()` now excludes deleted jobs, and its files, problems, handoffs, tasks and chat disappear from view with it (the stored files can no longer be opened). One thing is deliberately NOT hidden: managers can still read the job's audit-history rows (which hold copies of its details), because the existing audit rule already lets managers read all history. Plain staff cannot.
- It is **frozen**: a trigger refuses any later change (edit, assign, move, approve artwork, accept a handoff…) even if called directly. The job row can never be erased (trigger).
- **Nothing is lost**: all rows and stored files remain; the audit history gets a `job.deleted` record (who, when, why) that managers can still read through the audit table.
- **Who may delete (checked in the database):** a **manager** — any job, any status; the **person who created the job** — only while it is New, Queued or Cancelled (not yet started production). Everyone else, including Front Desk who did not create it, the assigned owner, and anyone who cannot see the job, is refused. A reason (up to 500 characters) is required. Stale screens are refused (version check). The job's owner is sent an alert (no link, since the job is gone).
- **Screen:** a red **Delete job…** button on the job page (only shown to people allowed to use it), a confirmation naming the job (`#1042 · Customer`, description, status, due date), a required reason, and typing the job number to confirm.
- **Decision for you:** the "creator only before production starts" limit is my choice to avoid accidental loss of in-progress work. To let creators delete at any status, remove the `not in ('New', 'Queued', 'Cancelled')` check in `delete_job()` and the matching status list in `docs/app.js` (`canDelete`) and in the test.

## What the owner has to do (nothing has been done yet)

1. **Back up first** (see `REBUILD.md` section 12).
2. **Apply the migrations in order, each once**, in the Supabase SQL editor: `0015_avatars.sql`, `0016_preferences.sql`, `0017_delete_job.sql`. Apply them **before** publishing the new web app (the new screens call the new functions; the *old* web app keeps working with the new database).
3. Publish the updated `docs/` (GitHub Pages). `docs/sw.js` has a new version number so people's cached copy refreshes.
4. No dashboard setting changes are needed. Migration 0015 creates the `avatars` bucket and its three storage policies itself; confirm in Storage that the bucket is **private**. The global Storage size limit (50 MB on the Free plan) does not affect 2 MB pictures.
5. Re-run the checks in `REBUILD.md` section 11. Expected after 0001–0017: **19 tables, 31 policies, 21 triggers, 54 functions**, no table without row security, **0** write privileges for `authenticated`/`anon`/`PUBLIC`, and three private buckets (`avatars`, `chat-files`, `job-files`).

### Migration safety
- `0015` / `0016` only add new tables, functions and a bucket; they change nothing that exists. They can be re-run safely (`if not exists`, `create or replace`, `drop policy if exists`).
- `0017` **changes existing behaviour**: it adds three columns to `jobs`, replaces `can_view_job()` (adds "not deleted"), replaces `check_job_assignee()` (skips the check for a job being deleted), and adds a trigger on `jobs`. It was tested against all earlier test suites (see below), and no job is deleted by applying it.
- There is no migration-tracking table; note that 0017 was the last one applied.

### Rolling back (only if needed; run as the database owner)
Ready-made files, one per migration, are in `supabase/rollbacks/` (`0015_rollback.sql`, `0016_rollback.sql`, `0017_rollback.sql`). Each runs in one transaction in the SQL editor.

**The order that matters**
1. **Put the OLD web app back first** (revert the merge on `main`; GitHub Pages republishes in a few minutes). If the database is rolled back while the new app is live, the new screens call functions that no longer exist and show errors.
2. Then roll the database back in **reverse order: `0017`, then `0016`, then `0015`**. Each file is independent, so you may roll back only the one that is at fault.
3. Take a note of what you did and why before trying again.

**Do you need to roll the database back at all?** Often not. The old web app works with the new database, so if the problem is only in the web app, reverting the merge is enough and the migrations can stay.

**What each file does, and what it leaves behind**
- `0015`: drops the three `pressgo avatars …` storage policies **first** (two of them use `_emp_from_path()`, and Postgres refuses to drop a function that a policy still uses), then the three functions, then `employee_avatars`. It cannot touch the stored pictures or the bucket (Supabase does not allow that from SQL): in the dashboard open Storage > `avatars`, empty it, then delete the bucket.
- `0016`: drops `set_preferences()` and `employee_preferences`. Everybody's saved look is lost and they get the defaults.
- `0017`: **refuses to run while any job is still marked deleted**, because without 0017's rules a deleted job would reappear for everybody. It first takes a lock on `pressgo.jobs` (reading stays possible; writing waits) and holds it until the end of its transaction, so a delete that is still in progress finishes first and is seen by the check, and nobody can delete a job between the check and the change. If it cannot get the lock within 15 seconds it stops with an error and changes nothing; run it again. If that happens, either leave `0017` in place (and just revert the web app), or restore each deleted job first with the restore SQL below, then run the file. It drops `delete_job()`, the `jobs_frozen` trigger and its function, puts back `can_view_job()` (as in `0008_assigned_jobs_only.sql`) and `check_job_assignee()` (as in `0001_foundation.sql`), then drops the `jobs_deleted_consistent` constraint and the three columns. The `job.deleted` history rows and `job_deleted` alerts that already exist are permanent records and stay; they are harmless.

**Tested** (`supabase/tests/rollback/`) through `psql` on a real PostgreSQL 17.11 server on 2026-10-21, and earlier on an in-memory PostgreSQL stand-in: the test builds the database from `0001`-`0014`, records its structure, applies `0015`-`0017` and puts data into all of it (a picture, a saved look, a deleted job), checks the `0017` rollback refuses, restores the job with the SQL below, runs the three rollback files in the order above, and requires the structure (every function with its rights, every rule, trigger, column, constraint, table right and bucket) to match the recorded one exactly. A second test (`race_setup.sql`, `race_b.sql`, run by `run_local.sh`) opens two real database sessions: one starts deleting a job and stays in its transaction for 8 seconds while the `0017` rollback starts; the rollback must wait, then refuse, leaving the job deleted and the columns in place. It runs only through `psql` on a real server (the in-memory stand-in has a single connection). It was also shown to fail when the lock is removed from the `0017` file (the job then reappears and the columns are dropped), when the `0015` file is written in the wrong order (the order this document used to give), when a function is not restored, and when a table is left behind. The real Supabase storage and the real dashboard bucket removal are not covered.

### Looking at, or restoring, a deleted job (owner only, SQL editor)
```sql
select job_number, customer_name, deleted_at, delete_reason from pressgo.jobs where deleted_at is not null;

-- restore one (the app has no "undelete" button on purpose)
alter table pressgo.jobs disable trigger jobs_frozen;
update pressgo.jobs set deleted_at = null, deleted_by = null, delete_reason = null where job_number = 1042;
alter table pressgo.jobs enable trigger jobs_frozen;
```
(If the job's owner has been disabled since, the restore will refuse until the owner is changed or re-enabled. The restore writes no history row of its own, so the `job.deleted` row is the only trace; note the date and who restored it somewhere outside the database. This SQL is exercised by the rollback test described above.)

## Tests
- **Rollback** (`supabase/tests/rollback/`, plus the files in `supabase/rollbacks/`): builds `0001`-`0014`, records the structure, applies `0015`-`0017` with data in them, rolls them back and requires the structure to be identical (details under "Rolling back"). It is part of `run_local.sh`. On 2026-10-21 the whole runner was run through `psql` on a real PostgreSQL 17.11 server (the live project's version): all 19 checks passed, and deliberately broken copies (the old `0015` order; a missing `revoke` in `0017`) were reported as failures with a non-zero exit code. See `SETUP.md` for how to run it.
- **Database** (`supabase/tests/`, run by double-clicking `RUN-TESTS.cmd` on Windows, or `bash supabase/tests/run_local.sh`; needs PostgreSQL 16 or newer, see `SETUP.md`): new `0015_avatars_test.sql`, `0016_preferences_test.sql`, `0017_delete_job_test.sql`. They cover success paths **and** authorization failures (wrong person, wrong folder, bad type/size/path, disabled login, no employee record, anonymous, direct table writes, stale version, missing reason, frozen job, hidden data, nothing lost). `local_stub.sql` gained one line (delete on `storage.objects`, which real Supabase has too) so the "tidy up your own file" policy can be tested.
- **Browser logic** (`desktop/test/`, run by `cd desktop && npm test`): `prefs-web.test.js` (contrast for every accent, CSS ↔ JS ↔ migration agree), `pastefile-web.test.js` (paste handling, duplicates, limits), `profile-web.test.js`, `delete-job-web.test.js`.
- Known gap: the screens were exercised by hand in a browser against an in-memory fake of the Supabase library (never the real project), not with automated UI tests. Real Storage and real Auth were **not** exercised: the stub in `local_stub.sql` stands in for them, so **check the three `avatars` storage policies in the live dashboard after applying 0015**.

## Short manual test list (the original summary; Parts A, B and C further down are the full, authoritative checklist)
1. **Avatar:** sign in → My profile → choose a picture → Save. Your circle changes in the sidebar, home, a chat message, the jobs list (if you own a job) and Staff. Sign in as someone else: they see your picture too. Choose a PDF or GIF → friendly refusal. Remove my picture → initials come back.
2. **Others' pictures:** as a plain staff member, try to change a colleague's picture (only possible through the API) → refused. Verify in Storage that each picture sits in its owner's folder.
3. **Look:** My profile → pick Dark + Blue → the page changes at once; Cancel → it goes back; pick again and Save; sign out and in (and from another computer) → still dark + blue. "Match my computer" follows the operating system. Tab through the options with the keyboard.
4. **Paste:** open an active job → Files → click *Paste a picture* → Ctrl+V a screenshot → preview appears → Remove → paste again → Upload. One new file appears (named `pasted-image-…`). Pressing Ctrl+V repeatedly shows one preview. Paste text into another page field: still works. Closed jobs show no upload box.
5. **Delete:** as the creator (Front Desk) of a **New** job: Delete job… → the dialog names the job → type a reason and the job number → job disappears from every list; as the assigned owner you got an alert. As the creator of a job **In Production**: no button. As a different Front Desk user or staff member: no button. As a manager: button on any job. Check `select … where deleted_at is not null` shows the row, its files and chat are still there.

## Known limitations
- Deleted jobs cannot be restored from the app (owner SQL only) and their stored files stay in storage.
- Open tasks tied to a deleted job stay on the assignee's list (without the job tag), and old alerts about the job lead to "You don't have access".
- A person's picture is looked up by display name (like the existing online dots), so two people with the same name would share a picture; names are already assumed unique.
- Picture and look changes by *other* people appear within about 5 minutes (or on reload).
- Avatars need a browser that can draw to a canvas (all current ones). Pasting needs the browser's `DataTransfer` support (all current ones); otherwise the user is told to use Choose file.
- The desktop (Electron) app loads the same web page, so it gets these features when the page is published; no desktop release is needed.
- **Known existing behaviour, NOT changed here (for a separate follow-up): `create_job` can return a job that has since been deleted.** On a retry (`create_job` called again with the same request id) it returns the job that already exists ([`0002_job_core.sql`](supabase/migrations/0002_job_core.sql) lines 56-57), and it does not check whether that job was deleted afterwards. Only someone who still holds that random request id can trigger it (in practice the creator, if a retry of their own "New job" request arrives after they deleted the job); the app would then open a job it cannot show and say "You don't have access". It reveals nothing to anyone else. `0017` deliberately does not touch `create_job`, because the live copy differs from the repository by one comment (see "Known difference on the live project" below), so replacing it belongs in its own change, with its own drift check. The fix would make the retry branch ignore jobs where `deleted_at is not null`, or answer "job not found" for them, and needs a test for each.
- `local_stub.sql` is not real Supabase: real Storage and Auth behaviour is unproven until Part B and Part C are done. No hosted test project is available (see the runbook), so the options are a local Supabase stack in Docker (real Auth, Storage and PostgreSQL on this computer, no contact with production; not set up or tried yet), or doing Parts B and C on the live project right after applying, as described below.

## Release runbook (do these in order; steps 1, 3 and 5 need the owner's Supabase access)

1. **Back up the live project first.** Follow `REBUILD.md` section 12.1. The dashboard-only method needs no password. If you use `pg_dump`, keep the connection string in an environment variable and never in a file in this repository. Download both Storage buckets too. Confirm the backup files open and have sensible sizes.
2. **Merge nothing to `main` yet.** GitHub Pages publishes `docs/` from `main`, and the new screens call database functions that do not exist until step 5. This update lives on the branch `feature/profile-look-paste-delete`.
3. **Rehearsal on a separate Supabase test project: NOT currently possible** (both free-plan project slots are in use; a second free account or a paid upgrade would be the owner's decision, see the checklist section). Without one, do these instead, in order: (a) the **pre-apply drift check** below (a read-only query on the live project, which needs the owner's explicit approval each time); (b) a **fresh backup** taken just before applying, in a quiet period; (c) apply the migrations and run Part B of the manual checklist immediately, with the rollback notes ready; (d) publish the app only if Part B passes, then do Part C. What the local stand-in cannot prove stays unproven until then: real Storage rules (own folder only), real sign-in, and deleting a job as each role.
4. Open a pull request from the branch and review the diff once more (do not merge it yet).
5. **Apply to the live project**, in the SQL editor, one file at a time and in order: `0015_avatars.sql`, `0016_preferences.sql`, `0017_delete_job.sql`. Run the section 11 checks again. The old web app keeps working at this point.
6. **Publish:** merge the pull request into `main` (GitHub Pages then serves the new `docs/`). Hard-refresh once; `docs/sw.js` has a new version so cached copies are replaced.
7. Smoke test on the live site with a manager account: set a picture, change the look, paste a picture on a test job, create and delete a test job. If anything is wrong, follow "Rolling back" above: revert the merge FIRST, then (only if needed) run the rollback files in reverse order.

## Manual checklist: real Ctrl+V, and the checks only the live system can answer

**Why this section exists.** The automated tests and the isolated browser tests (a fake in-memory backend, no Supabase) could not check three things: (1) a genuine Ctrl+V from the operating system's clipboard (the testing tool's keystroke does not trigger a paste), (2) real sign-in, and (3) real Supabase Storage permissions and server behaviour. **No separate Supabase test project is available** (both free-plan project slots are in use), so step 3 of the runbook above ("rehearse on a separate Supabase test project") cannot be done as written. Unless you choose to create one (a second free Supabase account, or a paid upgrade; both are your decision), parts B and C below are done on the live project **right after the migrations are applied and the app is published**, using clearly named test data, and a failure means "stop and roll back" (see the rollback notes above).

Fill in the Pass / Fail column as you go. To make a harmless picture: on Windows press **Windows key + Shift + S** and drag a small box over any empty part of the screen (this copies the picture to the clipboard without saving a file); on a Mac press **Command + Control + Shift + 4**. Never use a screenshot that shows customer details or passwords.

### Part A - genuine Ctrl+V (repeat in Chrome, Edge and the PressGO desktop app)
**When:** this needs the new web app, so do it after the app is published (together with Part C), not before.
Use a throw-away job (create one called `ZZ TEST - delete me`). Files uploaded to a job are kept permanently, so do this only on that test job.

| # | Do this | You should see | Pass / Fail |
|---|---|---|---|
| A1 | Open the test job and scroll to **Files**. Take a screenshot with the shortcut above. Click the dashed **Paste a picture** box once, then press **Ctrl+V** (Command+V on a Mac). | A preview of your screenshot appears under the box, titled "Pasted picture, not uploaded yet", with a file name like `pasted-image-20261020-143005.png` and a **Remove** button. The file box above also shows that name. | |
| A2 | Press **Ctrl+V** again straight away, then once more a few seconds later. | Still ONE preview and one file in the box (the box holds one file). No second picture appears. | |
| A3 | Click **Remove**. | The preview disappears and the file box says "No file chosen". | |
| A4 | Paste again, set **Type** to "Supporting Document", press **Upload** (try double-clicking it quickly). | The page reloads showing exactly ONE new file named `pasted-image-...png` under Files, with the type you chose. Click **Open**: the picture opens in the viewer and is your screenshot. | |
| A5 | Paste a picture, then choose a different file with **Choose file** instead. | The pasted preview disappears; the file you chose is the one that uploads. | |
| A6 | Copy ordinary text from anywhere (not a picture), click the paste box, press **Ctrl+V**. | Nothing happens in the upload box (no preview, no error). Pasting text in other places (for example the chat message box) still works as before. | |
| A7 | In File Explorer, copy a small picture FILE (Ctrl+C), click the paste box, press Ctrl+V. | It is staged like a screenshot (preview appears). If a browser does not allow this, write it down here; it is not a failure of the feature. | |
| A8 | Open a **Collected** or **Cancelled** job. | No upload box and no paste box at all. | |

### Part B - right after applying 0015, 0016 and 0017 (before publishing the app)
| # | Do this | You should see | Pass / Fail |
|---|---|---|---|
| B1 | In the Supabase SQL editor of the live project, run `supabase/checks/verify_release.sql` (it only reads settings; it changes nothing). | The 27 rows marked `required` all say `ok = true` (counts 19 / 31 / 21 / 54, row security everywhere, no write rights for signed-in or anonymous users, the new functions not runnable by anonymous people and running with a fixed `search_path`, the delete lock switched on, the preferences/avatars/storage rules as reviewed, 3 private buckets, avatars limited to 2 MB and JPEG/PNG/WebP). The 12 rows marked `advisory` are fingerprints of the new and replaced functions, of `_notify` and `create_job`, and of all functions and policies: `ok = true` is expected, and a `false` means "something differs from the reviewed repository: look at it before going on", not automatically a fault (a different PostgreSQL formatting can cause it). Three of those rows (the all-functions row and the `_notify` and `create_job` rows) also show a second accepted value in the `also_accepted` column: on the live project they are expected to be `ok` through that second value, because of the known comment-only difference described under "Known difference on the live project". | |
| B2 | Dashboard > Storage: open the `avatars` bucket settings and its policies. | Not public; limit 2 MB; allowed types JPEG, PNG, WebP. Policies `pressgo avatars read`, `pressgo avatars add`, `pressgo avatars tidy`, and nothing that allows UPDATE. | |
| B3 | Sign in to the OLD (not yet updated) app as a manager and as a plain staff member; open a job, send a chat message, upload a normal file. | Everything still works (the old app keeps working with the new database). | |
| B4 | Existing data is intact: run **query B4** below (read-only; counts only, no staff or job details). | The numbers equal the ones in the fresh backup's manifest (plus anything staff did since the backup, which you can see from the newest audit row), **jobs marked deleted = 0, avatars = 0, preferences = 0**. A lower number than the backup means stop and roll back. | |
| B5 | The database engine is the one the checks were reviewed on (read-only): `select version();` | A PostgreSQL 17 version (17.11 when last recorded). If the major version has changed, expect some `advisory` fingerprints in B1 to differ and look at each one before going on. | |
| B6 | The blank-reason rule works on the real engine: run **query B6** below (only constants; it reads no table; the delete function uses this same expression). | `blank_is_empty` = `true` and `real_reason_kept` = `true`. | |


**Query B4** (existing data is intact):
```sql
select 'jobs' as what, count(*) from pressgo.jobs
union all select 'jobs marked deleted', count(*) from pressgo.jobs where deleted_at is not null
union all select 'messages', count(*) from pressgo.messages
union all select 'audit_events', count(*) from pressgo.audit_events
union all select 'employees', count(*) from pressgo.employees
union all select 'job_files', count(*) from pressgo.job_files
union all select 'avatars', count(*) from pressgo.employee_avatars
union all select 'preferences', count(*) from pressgo.employee_preferences
union all select 'storage objects', count(*) from storage.objects;
```

**Query B6** (the blank-reason rule, constants only):
```sql
select
  regexp_replace(' ' || chr(9) || chr(160) || chr(8203) || chr(65279) || ' ',
    '^[[:space:]' || chr(160) || chr(8203) || chr(8204) || chr(8205) || chr(8288) || chr(65279) || ']+|[[:space:]'
    || chr(160) || chr(8203) || chr(8204) || chr(8205) || chr(8288) || chr(65279) || ']+$', '', 'g') = '' as blank_is_empty,
  regexp_replace(' ' || chr(160) || 'real reason' || chr(8203) || chr(10),
    '^[[:space:]' || chr(160) || chr(8203) || chr(8204) || chr(8205) || chr(8288) || chr(65279) || ']+|[[:space:]'
    || chr(160) || chr(8203) || chr(8204) || chr(8205) || chr(8288) || chr(65279) || ']+$', '', 'g') = 'real reason' as real_reason_kept;
```

### Part C - after the new app is published: real sign-in, storage and server rules
Create three test people on the Staff screen first (for example `zz-manager` with Manager, `zz-front` with Front Desk, `zz-staff` with no role, each in a department) and disable them afterwards. Never use real staff passwords. **These test people, the test jobs and their history rows can never be deleted** (history and jobs are permanent records by design); disabling the three people is all you can do afterwards, so name everything `zz-` / `ZZ TEST` and accept that it stays. The checks that must run as a signed-in person use the browser console on the app page (press F12, open the Console tab); the app's connection is available there as `sb` and your own record as `me`.

| # | Do this | You should see | Pass / Fail |
|---|---|---|---|
| C1 | Sign in as `zz-staff`. Sidebar > **My profile** > choose a picture > Save. | "Profile saved." Your circle shows the picture (cropped square) in the sidebar. | |
| C2 | Sign in as `zz-front` (second browser or private window) and open a chat where `zz-staff` wrote, or the Staff screen as the manager. | `zz-staff`'s picture is shown next to their name. People without a picture show coloured initials. | |
| C3 | As `zz-staff`, replace the picture, then use **Remove my picture**. | The change appears for everyone within about 5 minutes (or after a refresh); after removing, initials return. In Dashboard > Storage > `avatars` there is one folder per person (named by employee id) and the old files were tidied away. | |
| C4 | Copy a picture's address (right-click the picture > Copy image address) and paste it into a private window where you are NOT signed in. | The picture does not load (private bucket; the address also stops working after about an hour). | |
| C5 | As `zz-staff`, choose Dark + Teal and Save. Sign out. Sign in on a different browser or computer. | Dark + Teal are restored automatically. "Match my computer" follows the computer's own light or dark setting. | |
| C6 | As `zz-front`, create a job (they become its creator) and open it while it is New. | A red **Delete job...** button is visible. As `zz-staff` (not the creator), open the same job if you can see it: no Delete button. | |
| C7 | As `zz-front`, press **Delete job...** and type only spaces as the reason, with the right job number. | The dialog stays open and says "Please give a real reason". Nothing is deleted. | |
| C8 | Type a real reason and the job number, press **Delete job**. | "Job #... was deleted." and you return to the Jobs list. The job is gone from the lists of `zz-front`, `zz-staff` and the manager. If the job had an owner, the owner got an alert. | |
| C9 | As `zz-front`, create another job, move it to In Production (or ask the manager to), then open it as `zz-front`. | No Delete button for `zz-front`. As `zz-manager` the Delete button is there. | |
| C10 | In the Supabase SQL editor run this read-only query: `select job_number, customer_name, deleted_at, delete_reason from pressgo.jobs where deleted_at is not null;` | The deleted test job is listed with the reason you typed (trimmed). Its files, chat and history are still in the database. | |
| C11 | As `zz-front`, try to open the deleted job's address, or search for it. | "You don't have access", and it is not in any list. | |
| C12 | Quick regression of existing features with the three test people: send and delete a chat message, upload a normal file, approve artwork as `zz-front` (allowed) and as `zz-staff` (refused), cancel a job as the manager. | All as before the update. | |
| C13 | **The server, not the button, refuses.** As `zz-front` make a New job. As `zz-staff` (any person who is not its creator) run **snippet C13** in the Console with that job's id and version. | An error: `only the person who created this job, or a manager, can delete it` (or `job not found` if that person cannot see the job at all). The job is still in everybody else's list. | |
| C14 | As `zz-front` on their own New job, run **snippet C14** (wrong version, blank reason, a reason of only no-break and zero-width characters, a 501-character reason). | Four lines, each `refused:` with its own message (`job was changed by someone else`, `a reason is required to delete a job` twice, `that reason is too long`). The job is still there afterwards. | |
| C15 | Move a second test job of `zz-front` to In Production, then run **snippet C13** as `zz-front` with that job. Then, as `zz-manager`, delete it with the button. | `zz-front` gets `only a manager can delete a job that has started production`; the manager can delete it. | |
| C16 | As `zz-front`, cancel a third test job, then delete it with the button. | Allowed (the creator may delete New, Queued or Cancelled jobs). | |
| C17 | As `zz-manager`, upload a small file to a fifth test job and note the job's number, then delete the job. In the SQL editor run `select jf.storage_path from pressgo.job_files jf join pressgo.jobs j on j.id = jf.job_id where j.job_number = <the number>;` and, in the Console as `zz-manager`, run **snippet C17** with that path. | The path is still listed in the database (nothing is lost), but the Console call returns an error instead of a link: nobody can open a deleted job's file. | |
| C18 | In the SQL editor run `select action, reason, created_at from pressgo.audit_events where action = 'job.deleted' order by created_at desc limit 5;` | One row per test deletion above, each with the trimmed reason you typed. | |
| C19 | **Pictures: the server refuses.** As `zz-staff` (after C1 gave them a picture) run **snippet C19**. | Every line says `refused`, and the last line says `removed 0 file(s)`. Afterwards `zz-front`'s picture and `zz-staff`'s own are still shown and the `avatars` bucket holds no new files. | |
| C20 | **Signed out.** Open the app in a private window (do not sign in), open the Console and run **snippet C20**. | Both lines say `refused`. | |
| C21 | As `zz-front` and as `zz-manager`, run **snippet C21**. | Each gets 0 or 1: only their OWN saved look, not even the manager can read other people's. | |

**Console snippets for Part C.** Paste one block at a time into the Console while signed in as the person named. They only call what the app itself calls. Where a line is meant to be refused, the refusal is the PASS; a line saying `THIS IS A FAILURE` means stop and roll back. Replace each `<…>` and the version number. To find a job's id and version (as someone who can see the job): `(await sb.from('jobs').select('id, version, lifecycle_status').eq('job_number', <number>)).data`

```js
// C13 - try to delete a job you must not be allowed to delete
(await sb.rpc('delete_job', { p_job: '<job id>', p_version: 1, p_reason: 'test' })).error?.message
```

```js
// C14 - one job, four bad requests (as its creator, while it is New)
var id = '<job id>', v = 1, bad = (r) => r.error ? 'refused: ' + r.error.message : 'ACCEPTED - THIS IS A FAILURE';
console.log('stale version:', bad(await sb.rpc('delete_job', { p_job: id, p_version: v + 5, p_reason: 'test' })));
console.log('blank:', bad(await sb.rpc('delete_job', { p_job: id, p_version: v, p_reason: '   ' })));
console.log('invisible only:', bad(await sb.rpc('delete_job', { p_job: id, p_version: v, p_reason: ' \u00a0\u200b\u200d\ufeff ' })));
console.log('501 characters:', bad(await sb.rpc('delete_job', { p_job: id, p_version: v, p_reason: 'x'.repeat(501) })));
```

```js
// C17 - try to open a deleted job's file (as the manager)
(await sb.storage.from('job-files').createSignedUrl('<storage_path from the query>', 60)).error?.message ?? 'OPENED - THIS IS A FAILURE'
```

```js
// C19 - as zz-staff: every line must say refused
var refused = (label, r) => console.log(label + ':', r.error ? 'refused' : 'ACCEPTED - THIS IS A FAILURE');
var other = (await sb.from('employees').select('id').eq('display_name', 'zz-front')).data[0].id;
var jpg = (n) => new Blob([new Uint8Array(n)], { type: 'image/jpeg' });
var fname = () => crypto.randomUUID() + '.jpg';
refused("upload into someone else's folder", await sb.storage.from('avatars').upload(other + '/' + fname(), jpg(10), { contentType: 'image/jpeg' }));
var mineRow = (await sb.from('employee_avatars').select('avatar_path').eq('employee_id', me.id)).data[0];
if (mineRow) refused('overwrite my own file', await sb.storage.from('avatars').upload(mineRow.avatar_path, jpg(10), { contentType: 'image/jpeg', upsert: true }));
refused('a text file', await sb.storage.from('avatars').upload(me.id + '/' + crypto.randomUUID() + '.jpg', new Blob(['hello'], { type: 'text/plain' }), { contentType: 'text/plain' }));
refused('a file over 2 MB', await sb.storage.from('avatars').upload(me.id + '/' + fname(), jpg(2 * 1024 * 1024 + 1), { contentType: 'image/jpeg' }));
refused("claim a path in someone else's folder", await sb.rpc('set_avatar', { p_path: other + '/' + fname(), p_mime: 'image/jpeg', p_size: 10 }));
refused('claim a file that was never uploaded', await sb.rpc('set_avatar', { p_path: me.id + '/' + fname(), p_mime: 'image/jpeg', p_size: 10 }));
var theirs = (await sb.from('employee_avatars').select('avatar_path').eq('employee_id', other)).data[0];
if (theirs) { const r = await sb.storage.from('avatars').remove([theirs.avatar_path]); console.log("delete zz-front's picture: removed", (r.data || []).length, 'file(s) (must be 0)'); }
```

```js
// C20 - signed out (private window, no sign-in)
var refused = (label, r) => console.log(label + ':', r.error ? 'refused' : 'ACCEPTED - THIS IS A FAILURE');
var listed = await sb.storage.from('avatars').list('');
console.log('list the pictures:', listed.error || !(listed.data || []).length ? 'refused (nothing listed)' : 'LISTED - THIS IS A FAILURE');
refused('save a look', await sb.rpc('set_preferences', { p_theme: 'dark', p_accent: 'blue' }));
```

```js
// C21 - how many saved looks can I read? (must be 0 or 1)
(await sb.from('employee_preferences').select('employee_id')).data.length
```

**Stop and roll back if:** any row in Part B fails; a plain staff member can delete someone else's job, see a deleted job, or change another person's picture or look; pictures can be opened without signing in; or an existing feature (chat, files, job moves) stops working. Use the rollback notes above and tell whoever manages the project before trying again.

**About blank deletion reasons.** The delete dialog refuses a blank reason (`docs/reason.js`) and the database refuses one too. `0017_delete_job.sql` now trims spaces, tabs, line breaks, no-break spaces and zero-width characters, so a reason made only of those is refused even if someone calls the function directly instead of using the screen, and the reason is stored trimmed (tested in `supabase/tests/0017_delete_job_test.sql`).

### Pre-apply drift check (read-only query on the LIVE project; needs the owner's explicit approval)
`0017` replaces two existing functions (`can_view_job` and `check_job_assignee`) with `create or replace`. If either was ever edited by hand on the live project, that edit would be overwritten without any message. Before applying, compare the live versions with what the repository's migrations 0001-0014 build:

```sql
select proname, md5(regexp_replace(pg_get_functiondef(oid), '[[:space:]]+', ' ', 'g')) as fingerprint
from pg_proc where pronamespace = 'pressgo'::regnamespace and proname in ('can_view_job', 'check_job_assignee')
order by proname;
```
Expected: `can_view_job` = `34ae596ea2e3d7652256cf5dd9a8c788`, `check_job_assignee` = `3ab4bf0e0d58dba3a9f65c95b3230343`. For a wider check of everything that exists today (the live schema should equal 0001-0014 before 0015-0017 are applied), the same idea over all 48 functions and 29 policies:

```sql
select 'functions' as what, count(*) as n, md5(string_agg(x, ',' order by x collate "C")) as fingerprint from (
  select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')=' || md5(regexp_replace(pg_get_functiondef(p.oid), '[[:space:]]+', ' ', 'g')) as x
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'pressgo') f
union all
select 'policies', count(*), md5(string_agg(x, ',' order by x collate "C")) from (
  select tablename || '.' || policyname || '=' || md5(coalesce(cmd, '') || '|' || coalesce(array_to_string(roles, ','), '') || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '')) as x
  from pg_policies where schemaname = 'pressgo') p;
```
Expected on the live project (as read on 2026-10-20): functions 48 / `419cedcbba3ce2329690d5fad48bbf7f`, policies 29 / `647cec6344c5cf9bcd05eb96854eb888`. The functions value is NOT the one the repository's own text produces (`f9f387bcb090de24d5b0794aa3cf3dba`) because of one known, harmless difference described under "Known difference on the live project" below; the policies value is the same for both.

These fingerprints ignore line endings and spacing (every run of white space counts as one space): the live functions were pasted in from an editor whose line endings are not known, and a hash of the raw text would differ for that reason alone. How to read the result: a match is strong evidence the live functions and rules are the reviewed ones. A mismatch is NOT proof of tampering: these values were computed on a local in-memory PostgreSQL engine (PGlite; it reports version 18.6 when asked on 2026-10-21 and the repository values still come out the same there), while the live project runs PostgreSQL 17.11 according to `REBUILD.md` (the live copy of the 46 identical functions matched the local values exactly, which is evidence the two engines print them alike), and a different server build can print a function's text slightly differently. If anything differs, compare that function's text with the repository before applying `0017`, and do not apply until the difference is understood. These queries only read; they change nothing and read no staff or job data.

### Known difference on the live project (read on 2026-10-20; harmless, recorded so nobody mistakes it for a fault)
The read-only drift checks on the live PressGO project found 46 of its 48 functions identical to the repository and all 29 policies identical. The other two, `_notify` and `create_job`, differ in one way only: each lacks one inline `--` comment (`-- never alert people about their own actions` in `_notify`, `-- a retry: return the job that already exists` in `create_job`). Every other character of both functions is identical, so they behave the same; the comments were most likely dropped when the functions were pasted in. A fingerprint changes when a comment changes, which is why the all-functions fingerprint on the live project is `419cedcbba3ce2329690d5fad48bbf7f` and not `f9f387bcb090de24d5b0794aa3cf3dba`.

| Fingerprint (whitespace-insensitive md5) | Repository text | Live project, 2026-10-20 |
|---|---|---|
| `_notify` | `c8e0814b4b884f6fd4bcdf7a18f9a3a7` | `1b4b68aa6b0ee81fb5f2140619efee0b` |
| `create_job` | `872e0cc6083eafbcda1e60fae0cdbb80` | `4e47cf89f94561cf05e9fb87c211a07f` |
| all 48 functions combined (before `0015`-`0017`) | `f9f387bcb090de24d5b0794aa3cf3dba` | `419cedcbba3ce2329690d5fad48bbf7f` |
| all 54 functions combined (after `0015`-`0017`) | `21d2fb22088bc64681399d32daff5dbe` | `b1f514131b178b16448f359163fcf1bf` (expected, not yet observed) |

How this was confirmed (all local, nothing was changed anywhere): the repository's text with just that comment removed reproduces both live fingerprints exactly; swapping the two live fingerprints into the repository's 48 function fingerprints reproduces the live combined value `419cedcb…` exactly, which also proves the other 46 are identical; and a local database built that way (the "live-like" case in the tamper tests) passes `supabase/checks/verify_release.sql` with the three advisory rows accepted through `also_accepted`, while any other change to those functions, or to any other function, is still reported.

What to do with it: nothing is needed before applying `0015`-`0017`, because `0017` does not touch `_notify` or `create_job`. Do not "fix" the live copies just to make a fingerprint match. If a future migration replaces either function, it will bring the comment back and these three advisory rows will then match the repository value instead (the check accepts both). The all-functions row for the live project after `0015`-`0017` is an expectation computed from the numbers above; confirm it when the check is first run there, and if it shows something else, find out which function differs before going on (a read-only query that lists each function's name and fingerprint finds it; compare the result with fingerprints computed from the repository, and look at the text of any function that differs).
