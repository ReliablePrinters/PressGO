# Feature update: avatars, personal look, pasted pictures, deleting jobs

**Status: written and tested locally. NOT applied to the live database, NOT deployed, NOT committed.**
Nothing in this update has touched the production Supabase project. Three new migrations (`0015`, `0016`, `0017`) are waiting to be applied by the owner, and the web app changes in `docs/` are not published.

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

- `delete_job(job, version, reason)` marks the job deleted (`deleted_at`, `deleted_by`, `delete_reason`). It disappears for **everyone** (even managers) because `can_view_job()` now excludes deleted jobs, and its files, problems, handoffs, history, tasks and chat disappear from view with it (the stored files can no longer be opened).
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
- `0015`: `drop function pressgo.set_avatar(text,text,bigint), pressgo.remove_avatar(), pressgo._emp_from_path(text); drop table pressgo.employee_avatars;` and drop the three `pressgo avatars …` policies on `storage.objects` (the bucket can be emptied and removed in the dashboard).
- `0016`: `drop function pressgo.set_preferences(text,text); drop table pressgo.employee_preferences;`
- `0017`: **only if no job has been deleted yet** (otherwise deleted jobs would reappear): drop `delete_job(uuid,integer,text)`, the `jobs_frozen` trigger and `jobs_frozen_when_deleted()`, restore `can_view_job()` from `0008_assigned_jobs_only.sql` and `check_job_assignee()` from `0001_foundation.sql`, then drop the three columns and the `jobs_deleted_consistent` constraint.

### Looking at, or restoring, a deleted job (owner only, SQL editor)
```sql
select job_number, customer_name, deleted_at, delete_reason from pressgo.jobs where deleted_at is not null;

-- restore one (the app has no "undelete" button on purpose)
alter table pressgo.jobs disable trigger jobs_frozen;
update pressgo.jobs set deleted_at = null, deleted_by = null, delete_reason = null where job_number = 1042;
alter table pressgo.jobs enable trigger jobs_frozen;
```
(If the job's owner has been disabled since, the restore will refuse until the owner is changed or re-enabled.)

## Tests
- **Database** (`supabase/tests/`, run by `bash supabase/tests/run_local.sh`, needs PostgreSQL 16): new `0015_avatars_test.sql`, `0016_preferences_test.sql`, `0017_delete_job_test.sql`. They cover success paths **and** authorization failures (wrong person, wrong folder, bad type/size/path, disabled login, no employee record, anonymous, direct table writes, stale version, missing reason, frozen job, hidden data, nothing lost). `local_stub.sql` gained one line (delete on `storage.objects`, which real Supabase has too) so the "tidy up your own file" policy can be tested.
- **Browser logic** (`desktop/test/`, run by `cd desktop && npm test`): `prefs-web.test.js` (contrast for every accent, CSS ↔ JS ↔ migration agree), `pastefile-web.test.js` (paste handling, duplicates, limits), `profile-web.test.js`, `delete-job-web.test.js`.
- Known gap: the screens were exercised by hand in a browser against an in-memory fake of the Supabase library (never the real project), not with automated UI tests. Real Storage and real Auth were **not** exercised: the stub in `local_stub.sql` stands in for them, so **check the three `avatars` storage policies in the live dashboard after applying 0015**.

## Manual test checklist (after applying the migrations to a test copy)
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
- `local_stub.sql` is not real Supabase: Storage and Auth behaviour must still be confirmed on a Supabase test project.

## Release runbook (do these in order; steps 1, 3 and 5 need the owner's Supabase access)

1. **Back up the live project first.** Follow `REBUILD.md` section 12.1. The dashboard-only method needs no password. If you use `pg_dump`, keep the connection string in an environment variable and never in a file in this repository. Download both Storage buckets too. Confirm the backup files open and have sensible sizes.
2. **Merge nothing to `main` yet.** GitHub Pages publishes `docs/` from `main`, and the new screens call database functions that do not exist until step 5. This update lives on the branch `feature/profile-look-paste-delete`.
3. **Rehearse on a separate Supabase test project (not the live one).** Create a new free project, then run `0001` to `0017` in order in its SQL editor and the checks in `REBUILD.md` section 11 (expect 19 / 31 / 21 / 54, no table without row security, 0 write privileges for `authenticated` / `anon` / `PUBLIC`, three private buckets). Check in Storage that the `avatars` bucket is private with a 2 MB limit and three policies named `pressgo avatars …`. Point a copy of `docs/config.js` at the test project (never commit that), create a manager and two staff, and go through the manual checklist above. Pay special attention to what the local stub cannot prove: real Storage rules (own folder only), real sign-in, and deleting a job as each role.
4. If the rehearsal is clean, open a pull request from the branch and review the diff once more.
5. **Apply to the live project**, in the SQL editor, one file at a time and in order: `0015_avatars.sql`, `0016_preferences.sql`, `0017_delete_job.sql`. Run the section 11 checks again. The old web app keeps working at this point.
6. **Publish:** merge the pull request into `main` (GitHub Pages then serves the new `docs/`). Hard-refresh once; `docs/sw.js` has a new version so cached copies are replaced.
7. Smoke test on the live site with a manager account: set a picture, change the look, paste a picture on a test job, create and delete a test job. If anything is wrong, use the rollback notes above and revert the merge.
