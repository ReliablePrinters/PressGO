# PressGO
Reliable Staff APP — internal Printery communication + job management (staff only).
Live app: https://reliableprinters.github.io/PressGO/ (GitHub Pages, from `docs/`). Database: Supabase project `nbkzejfoxyzvyfehhheo`, schema `pressgo`.

## Status
| Phase | What | State |
|---|---|---|
| 1 | Foundation: accounts, roles, departments, access rules | Done, live |
| 2 | Job core: create, list, detail, assignment, lifecycle, history | Done, live |
| 3 | Files, artwork approval, problems (holds), handoffs | Done, live |
| 3.5 | Username + password sign-in, Staff screen (create logins, reset passwords, roles, disable) | Done, live |
| 4 | Chat: channels, private messages (one person or a group), job chat | Done, live |
| 5 | Home, manager dashboard, tasks, alerts | Done, live |
| 6 | Pilot preparation — see `PILOT.md` | In progress |

## Where things are
- `supabase/migrations/` — database setup, applied in order: 0001 foundation, 0002 job core, 0003 files/problems/handoffs, 0004 usernames (+ service-role access), 0005 chat, 0006 group messages, 0007 tasks and alerts, 0008 "only see jobs meant for you".
- `supabase/functions/admin-users/` — the one server function that creates logins, resets passwords, disables people (needs the secret key, so it only runs inside Supabase). Only active managers can call it.
- `supabase/tests/` — permission tests. Run `bash supabase/tests/run_local.sh` (needs Postgres 16). The function has its own test: `node --experimental-strip-types supabase/tests/functions/run_admin_users_test.mjs`.
- `docs/` — the web app (plain HTML/JS, no build step): `app.js` (sign-in, jobs, staff), `chat.js`, `home.js`, `style.css`, `config.js` (project address + public key).

## How people sign in
Username + password. Username `jane` is stored as `jane@pressgo.example.com`; nothing is ever emailed. Managers create logins on the **Staff** screen and can reset passwords or disable people. People change their own password with **Change password**.
First manager: create one user in Supabase -> Authentication -> Users (email `name@pressgo.example.com`, Auto Confirm ticked) and make sure a row with that email exists in `pressgo.employees` with `manager_role = true`; the first sign-in links them.

## Who sees what (enforced in the database)
- Managers see every job. Everyone else sees a job only if it is assigned to them, they created it, it is assigned to their department and nobody has taken it yet, or it was handed to their department and is waiting for acceptance. Front Desk also sees jobs not yet released and jobs ready for collection.
- Department channels: that department + managers. Managers channel: managers only. Private messages: only the people in them (not even managers). Job chat: only people who can see the job.
- Messages cannot be edited or deleted. History, files, problems and handoffs are permanent records.
- Disabled people can no longer sign in; their history stays.

## Job rules
- New -> Queued -> In Production -> Finishing -> Ready for Collection -> Collected (Cancelled by a manager with a reason).
- Backward moves, cancel/reopen, deadline/priority changes need a reason and appear in History.
- A job cannot start without artwork a manager approved ("Approved for Print"), unless a manager marked artwork not required.
- Files: private bucket `job-files`, 100 MB max, program files blocked, never overwritten (each upload is a new version).
- An open problem blocks the job moving forward until resolved with a note.
- A handoff sends a job to another department; they must accept it (the accepter becomes owner).
- Stale screens cannot overwrite someone else's edit.

## Still undecided (blueprint section 14)
App name, timezone (the app uses each computer's own time zone), file types/size limits, retention.
