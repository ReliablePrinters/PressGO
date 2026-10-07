# PressGO
Reliable Staff APP — internal Printery communication + job management (staff only).
Built from the Notion "V1 implementation blueprint".

## Status
| Phase | What | State |
|---|---|---|
| 1 | Foundation: accounts, roles, departments, access rules | **Done, live in Supabase** |
| 2 | Job core: create, list, detail, assignment, lifecycle, history | **Done, live in Supabase; screens in `docs/`** |
| 3 | Files, artwork approval, problems (holds), handoffs | **Done, live in Supabase; screens in `docs/`** |
| 4 | Chat, DMs, job chat | |
| 5 | Tasks, notifications, search, Home, manager dashboard | |
| 6 | Pilot preparation | |

## Where things are
- Database: Supabase project (PressGO lives in its own `pressgo` schema, separate from Reliable-Printers).
- `supabase/migrations/` — database setup (0001 foundation, 0002 job core, 0003 files/problems/handoffs). All three are applied.
- `supabase/tests/` — permission tests. Run `bash supabase/tests/run_local.sh`.
- `docs/` — the web app (plain HTML/JS, no build step). Hosted with GitHub Pages.

## Putting the app online (GitHub Pages)
1. Upload this whole folder's contents to your `PressGO` repo (Add file -> Upload files).
2. Repo **Settings -> Pages -> Build and deployment**: Source "Deploy from a branch", branch `main`, folder `/docs`, Save.
3. After a minute your app is at `https://pressgo.github.io/PressGO/` (the page shows the exact address).
4. Supabase **Authentication -> URL Configuration**: add that address to "Redirect URLs".

## One setting still needed in Supabase
Settings -> Integrations -> Data API -> Exposed schemas: add `pressgo`, then Save.

## First sign-in
Open the app, "Create login" with `printrel@yahoo.com`, confirm the email, sign in. That email is already the first manager.

## Rules that are enforced in the database
- staff only see jobs of their department / assigned to them; Front Desk and managers see all
- managers read all department channels but **never other people's DMs**; Managers channel closed to other staff
- disabled employees and visitors see nothing; invitations only, and only a *confirmed* email can claim one
- Front Desk/manager create jobs (retry-safe, never-reused numbers); staff can accept an unassigned job in their own department
- lifecycle: New -> Queued -> In Production -> Finishing -> Ready for Collection -> Collected (Cancelled by manager with reason)
- manager overrides, backward moves, cancel/reopen, and deadline/priority changes all need a reason and are recorded in History
- a job can't start without artwork a manager has approved ("Approved for Print"), unless a manager marked artwork "not required"
- files live in a private storage bucket (`job-files`), max 100 MB, program files blocked, never edited or deleted; each re-upload is a new version
- an open problem blocks the job moving forward until it is resolved with a note
- a handoff sends a job to another department with a note; that department sees it and must accept it (the accepter becomes owner)
- stale screens can't overwrite someone else's edit

## Still undecided (blueprint section 14)
App name, timezone (the app currently uses each computer's own time zone), who approves artwork, allowed file types/size, retention.
