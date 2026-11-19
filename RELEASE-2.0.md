# PressGO 2.0: release notes and runbook

**Status (updated 2026-11-19): built, tested and pushed on `feature/pressgo-2.0` (pull request #4, draft). NOT merged, NOT deployed. The web app now also runs correctly on the database as it is today (migration 0014), switching off only the features that need a missing update (see "Releasing before the migrations" in section 2). No migration has been applied to the live database.**
Everything below was developed and tested in an isolated Supabase test project and a throwaway local PostgreSQL. No production database changes have been made as part of this PressGO 2.0 release preparation. The checks made on the live project (`nbkzejfoxyzvyfehhheo`) were read-only: plain SELECT statements, most recently on 2026-11-18 for a readable data export, a schema comparison and a file inventory.

This release **includes pull request #3** (avatars, personal look, pasted pictures, safe job delete; migrations 0015-0017). The 2.0 work sits directly on top of that branch (`feature/pressgo-2.0` starts at PR #3's last commit `2b5a6e0`), so nothing is duplicated and nothing conflicts. `main` has not moved since (`241730a`).

## 1. What is in PressGO 2.0

| Area | What people get | Database change |
|---|---|---|
| Profile and look (PR #3) | A picture next to your name (initials stay as the default), Light / Dark / follow-my-computer, accent colour, pasting a picture into a job's upload box, deleting a job (hidden and locked, never erased) | 0015, 0016, 0017 |
| Messaging | An alert opens the exact message; replies work for pictures too and alert the person replied to; taking back a picture approval tells the sender; Mark as unread; a "New messages" line; a short ping; in-app banners; alerts arrive live | 0018 |
| Settings | One page: Profile, Security (change your own password, current one required), Notifications (sound, banners, which alert types, Windows options), Appearance, Keyboard, About (version) | none |
| New look | "Print Room" light theme (ink-navy sidebar, Press Blue) and "Clean Slate" dark theme on every screen; six accent colours, all contrast-checked; works on phones | none |
| Global search | Ctrl+K (Cmd+K on a Mac) or the Search button: jobs, people, conversations, messages. Shows only what the person may already open | none (uses the existing rules) |
| Job activity | A timeline on every job: who, what, when, old and new values; older jobs with gaps say so instead of inventing history | none (reads the existing audit records) |
| My work | One page of what needs you: needs attention, approvals, front desk queue, assigned jobs, tasks, unread messages, recent activity | none |
| Keyboard shortcuts | Ctrl/Cmd+K, Esc, `?`, and "G then H / W / J / T / M / A / S" to go to a page (switchable in Settings); in the Windows app also Ctrl+Shift+M / A / J / T | none |
| Windows app 1.2.0 | Clicking a notification opens the exact message or job; the taskbar button flashes; the loading colour matches the new look | none |

Home is still the landing page. Nothing was removed.

## 2. Database migrations 0015 to 0018

| File | What it does | Depends on | Old web app still works after it? | Undo |
|---|---|---|---|---|
| `0015_avatars.sql` | `employee_avatars`, `set_avatar()` / `remove_avatar()`, private bucket `avatars` (2 MB, JPEG/PNG/WebP) + 3 storage policies | `employees` (0001), the `storage` schema | Yes (only adds) | `rollbacks/0015_rollback.sql` (then empty and delete the bucket in the dashboard) |
| `0016_preferences.sql` | `employee_preferences`, `set_preferences()` | `employees` | Yes (only adds) | `rollbacks/0016_rollback.sql` |
| `0017_delete_job.sql` | `jobs.deleted_at/deleted_by/delete_reason`, `delete_job()`, trigger `jobs_frozen`; replaces `can_view_job()` and `check_job_assignee()` | `jobs`, 0008's `can_view_job` | Yes | `rollbacks/0017_rollback.sql` (refuses while any job is deleted; restore them first) |
| `0018_message_links_replies.sql` | `notifications.conversation_id/message_id`; `mark_unread()`; replaces `_notify`, `approve_picture`, `send_message`, `send_attachment` (the old 6-argument call still works); adds `notifications` to the `supabase_realtime` publication (guarded) | 0005-0007, 0009, 0011 | Yes (the old six-argument `send_attachment` call still works and is tested) | `rollbacks/0018_rollback.sql` |

- **Order and safety.** Apply in this order, each once. Every file is additive or `create or replace`; none deletes data. **Apply them before publishing the new web app if you want every feature on day one** (the new screens call the new functions); the web app can also be published first (next subsection). The old web app keeps working with the migrated database.
- **Counts after 0001-0018** (a clean local build): 19 tables, 31 policies, 21 triggers, 55 functions, 0 tables without row security. `supabase/checks/verify_release.sql` (read-only): **32 required rows** must all be `true`; 16 advisory rows are fingerprints (on the live project, `_notify` and `create_job` carried a comment-only difference before 0018; after 0018 only `create_job` still shows it, and that is accepted on its rows).
- **Rollbacks are tested with data**: the rollback test applies 0015-0018 to a database containing a picture, a saved look, a deleted job, a reply and a reply alert, then undoes them in the order 0018, 0017, 0016, 0015 and proves the structure is identical to before 0015. It also proves the 0017 undo refuses while a job is deleted, including under a concurrent delete.
- **The live project.** `supabase/.temp/linked-project.json` and `docs/config.js` both name project `nbkzejfoxyzvyfehhheo`. The test project is `hfaeupaioacstfkqvfvo`. A second, paused project (`fcmkichfgbrflvnmjgba`) must never be touched. **Confirm the project name/ref in the dashboard URL before every live step.**
- Never use the Supabase CLI here: `supabase/.temp` links it to the live project. (`supabase/.temp/` is listed in `.gitignore` so it cannot be committed.)

### Releasing before the migrations (compatibility mode)

The web app checks once after sign-in which database updates exist (`docs/caps.js`: it reads zero rows of one column per update; nothing is changed) and switches off only what needs a missing update. Publishing it changes no database: the backup and the pre-check (steps 4 and 5 below) belong to the moment the migrations are applied, not to the web release.

| Feature | Needs | With the database at 0014 (live today) | After the update is applied |
|---|---|---|---|
| Profile picture | 0015 | Settings > Profile says it is not available yet; initials everywhere | picture editor and pictures appear |
| Saved look (light/dark, accent colour) | 0016 | Settings > Appearance says it is not available yet; PressGO keeps following the computer | controls appear, saved to the account |
| Delete job | 0017 | the Delete job button is not shown | button appears |
| Mark as unread, a picture sent as a reply, alerts that open the exact message | 0018 | not offered; alerts open the job as before | offered |

Everything else behaves the same at 0014: jobs, chat, text replies (`send_message` has accepted a reply since 0005; only the "someone replied to you" alert needs 0018), search, My work, Activity, shortcuts, notifications and the Windows app. Until 0018 puts alerts on the live feed, new alerts show up on the 30-second refresh instead of at once.
After the migrations are applied, people get the features on their next page load: no new release is needed.

Tested: `desktop/test/caps.test.js` and `desktop/test/compat-0014-web.test.js` (28 tests: the real browser code against a 0014-like and a fully migrated database, plus a scan that fails if the web code ever uses something newer than 0014 without a gate) and `supabase/tests/compat_0014_test.sql` (a database built from 0001-0014 only, and a fully migrated one). **Not verified: a run against the real Supabase project** (nothing was sent to it for this). The first sign-in after publishing is that check: hard-refresh, then Settings > Profile and Settings > Appearance should say "not available yet", and a job, a chat message and Alerts should work as before. If a check is inconclusive the feature stays visible and its call is guarded, so the worst case is the same error message as before, never a "saved" message for something that was not saved. To undo the web release, revert the merge.

## 3. Versions

| Item | Before the release commit | In the release commit |
|---|---|---|
| Web app (`docs/version.js`, shown in Settings > About) | `2.0.0`, build date `2026-11-16` (the day it was built) | `2.0.0`, build date `2026-11-19` (change it only if release day is a different day) |
| Service worker (`docs/sw.js` `VERSION`) | `2026-10-20.1` (from PR #3) | `2026-11-19.1`, a new value. It names the cache, so people's old copy is replaced |
| Windows app (`desktop/package.json`) | `1.1.1` | `1.2.0` (it must be higher than 1.1.1 or installed copies ignore it). One test that pinned 1.1.1 (`desktop/test/splash.test.js`) is updated to 1.2.0 in the same commit |
| Test site | n/a | n/a |

## 4. Windows app test build (not the real installer)

`desktop/dist-test/1.2.0/PressGO-Test-Setup.exe` (111.7 MB, **unsigned**, like every PressGO installer) and the unpacked copy `desktop/dist-test/1.2.0/win-unpacked/PressGO Test.exe`. It is a separate app ("PressGO Test", its own name, settings and uninstaller): it never replaces or updates the real PressGO. It opens the **isolated test site** `http://127.0.0.1:8082/` (test Supabase project), not the live site. The real installer and the GitHub Releases are untouched.

Smoke test already done (no sign-in needed): it starts, opens the test site, exposes the desktop bridge (`notify`, `update`), reports version 1.2.0, the page reports PressGO 2.0.0 with shortcuts and search loaded, and the sign-in screen shows the new look.

**What you test by hand** (start the test site first: `cd C:\PressGO-TestEnv` then `node server.mjs`; run `PressGO Test.exe`; sign in with a test account):
1. Notification click-through: minimize PressGO Test, send it a private message (or an Urgent one) from another browser signed in as another test user; click the Windows notification. PressGO Test comes forward and opens that exact message, which flashes.
2. Taskbar flash: the same situation makes the taskbar button flash until you look. It stops when you open the window.
3. Windows notification settings: Settings > Notifications shows a **Windows notifications** section with a test button; "Send a test notification" shows a toast.
4. Keyboard: Ctrl+K opens search; G then J goes to Jobs; **Ctrl+Shift+J / T / M / A** go to Jobs / Tasks / Messages / Alerts (Windows app only); nothing triggers while typing in a box.
5. Loading colour: the window shows the navy (`#0f1b2a`) background while the site loads.
6. About: Settings > About shows "Desktop app version 1.2.0" and "Version 2.0.0".

Build it again any time: `cd desktop` then `node try-build.js 1.2.0 --url=http://127.0.0.1:8082/` (only a local address is accepted; the default `localhost:8081` serves `docs/` with the LIVE `config.js`, so do not use it for sign-in tests).

## 5. Decisions still open

**Suggestions tab (Stage 10): recommendation, ship shortly AFTER 2.0 as 2.1.** It needs its own migration, a new Supabase Edge Function, a server-side secret and an outside service (Discord); none of that is built, and the webhook has not been connected or tested. 2.0 is already large and fully tested; adding an untested external integration would delay it and widen what can go wrong on release day. A short, separate release lets 2.0 settle, keeps the rollback story simple (two independent changes), and lets the webhook be tested on the test project first. The only cost is a few days without the feature.

**2.1 roadmap (agreed 2026-11-16; none of it is built, each needs its own plan and approval):** Suggestions tab (Discord webhook kept as a server-side secret), multiple images in one message, editing sent messages, forwarding messages between conversations. The three messaging items touch the same message tables and storage rules, so they should be planned together with the existing replies, alerts, unread tracking, deep links and search.

**The stored accent key `purple` (it is "Press Blue" on screen).** The default accent is stored under the name `purple` only because migration 0016 already lists that name. People never see the key. Changing it is possible but only cheap **before** 0016 goes live: it means editing 0016 (default, the list, `set_preferences`), its test and rollback test, the `verify_release.sql` fingerprints, the website lists (`prefs.js`, `style.css`), a one-line fallback for a copy saved in someone's browser, and re-applying 0016 to the test project. After 0016 is live it needs a new migration (change the list, rewrite stored rows, replace the function) and the old and new web apps would briefly disagree. **Recommendation: do not rename.** The benefit is tidiness for future developers; the cost is touching a migration that has been tested and fingerprinted. It is documented in code comments and here. If you want it renamed, decide before the live apply.

## 6. Verification summary (at preparation time)

- Front-end tests: 268 of 268 pass on Node 22, the version the build workflow uses (`cd desktop`, `node --test`). The count includes the tests that keep the separate PressGO Test build apart from the real one.
- Database tests (local PostgreSQL 17.11): 26 of 26 pass (including the new compatibility test on a database at 0014 and on a fully migrated one), including the role tests for search, activity history and My work, the extended rollback test, and `verify_release.sql` (32 of 32 required, 16 of 16 advisory). Re-run on 2026-11-18 on a clean copy of the committed code. Each migration was also rehearsed alone and in the planned production order, checking row counts, what each person can see, the old app's calls and each rollback.
- Real-browser checks of every stage as manager and as Front Desk (see the stage reports): all 16 screens load without errors; restricted jobs, chats and messages never appear.
- Contrast: every screen and every accent was measured in light and dark (about 8,000 text checks, 0 failures).

### Known limits and untested
- The Windows notification click-through, taskbar flash and Ctrl+Shift chords have only been tested in code and in a simulated environment; section 4 above is the real test.
- There is no real production-only login in the test project; that role is covered by the database role tests and the logic tests, not by a live sign-in.
- The service worker could not be exercised in the test browser (the embedded preview refuses to register it); `sw.js` itself is unchanged apart from the version number proposed above.
- Message search scans text without an index. It is instant at today's size; a database index would be needed if the message history grew into the hundreds of thousands.
- The installer is unsigned (Windows shows "protected your PC" until a code-signing certificate is bought).
- `desktop/package-lock.json` (created locally) is **not** part of the release; the build workflow uses `npm install` and pins exact Electron and electron-builder versions in `package.json` (the updater library `electron-updater` floats within 6.x).

## 7. Exact release steps (each one waits for the owner's explicit approval)

**Before anything:** the owner reviews this file and the diff.

1. **Commit** (local only; items 1-4 below are the commits 3b2fdd7, 91e750c, f130133 and 25aeae0, followed by 984ca77, 27dd46d and b67b251 (updater message fix, test-build separation); item 5 is the release-day commit, which contains this file). On branch `feature/pressgo-2.0`, each commit has an explicit file list (never `git add .`):
   1. `supabase/`: migration 0018, rollback, tests, test runner and rollback-test changes, `verify_release.sql`, and `.gitignore` (adds `supabase/.temp/`).
   2. Web app: every `docs/*.js`, `docs/index.html`, `docs/style.css`, `docs/manifest.webmanifest` and the web tests in `desktop/test/`.
   3. Windows app: `desktop/main.js`, `notify.js`, `preload.js`, `try-build.js` and their tests.
   4. Documentation: `README.md`, `REBUILD.md`, `FEATURE-UPDATE-NOTES.md`, `SETUP.md`, `RELEASE-2.0.md`, `desktop/NOTIFICATIONS.md`, `desktop/UPDATES.md`.
   5. (release day) Version numbers: `docs/sw.js`, `docs/version.js` build date, `desktop/package.json` to 1.2.0, the version assertion in `desktop/test/splash.test.js`, and this file.
2. **Push** the branch `feature/pressgo-2.0` as a **new** branch (it contains all of PR #3's commits). Nothing is merged.
3. **Open a pull request** `feature/pressgo-2.0` into `main`, titled "PressGO 2.0 (includes PR #3)", marked do-not-merge until step 9. Review the diff on GitHub. PR #3 is left as it is; it closes by itself once its commits reach `main`.
4. **Back up the live project** (REBUILD.md section 12.1, dashboard method; also download the `job-files` and `chat-files` buckets).
5. **Read-only pre-check on live** (SQL editor, owner approves): the drift check in FEATURE-UPDATE-NOTES.md and `verify_release.sql` before applying anything. Confirm the project ref in the address bar is `nbkzejfoxyzvyfehhheo`.
6. **Apply the four migrations** on live, one file at a time, in order 0015, 0016, 0017, 0018, in the SQL editor (the same way they were applied to the test project: paste, confirm the file's SHA-256, run). Run `verify_release.sql` after the last one: all 32 required rows `true`.
7. **Old app check** (FEATURE-UPDATE-NOTES.md Part B3): with the migrations applied and the new web app **not yet published**, a manager and a staff member can still open a job, send a message and upload a file.
8. **Version commit** (step 1.5), push.
9. **Merge the pull request** into `main`: GitHub Pages then serves the new web app. Hard-refresh once; Settings > About should say 2.0.0.
10. **Live smoke test** (a manager and a staff account; use the checklists in FEATURE-UPDATE-NOTES.md Parts A to C plus: search, My work, a job's Activity, Settings, shortcuts, a reply to a picture).
11. **Windows app:** GitHub > Actions > "Build Windows desktop app": first a **dry run** (publish unticked), then, if green, publish `v1.2.0` and write a one-sentence description (UPDATES.md). Installed copies then show the Update button. Test the real installer once.
12. **If something is wrong:** revert the merge first (the old web app works with the migrated database), then, only if needed, run the rollback files in the order 0018, 0017, 0016, 0015.
13. **Afterwards:** decide Suggestions (2.1) and the optional rename.
14. **If the migrations are applied after the web release** (see "Releasing before the migrations"): do steps 4 to 6 on that day (backup, pre-check, then 0015, 0016, 0017, 0018 one at a time with `verify_release.sql` at the end), then hard-refresh: the features in the table appear. Step 7 does not apply (the new web app is already live); check the four features instead.
