# PressGO
Reliable Staff APP — internal Printery communication + job management (staff only).
Built from the Notion "V1 implementation blueprint".

## Status
| Phase | What | State |
|---|---|---|
| 1 | Foundation: accounts, roles, departments, access rules | Done, live in Supabase |
| 2 | Job core: create, list, detail, assignment, lifecycle, history | Done, live in Supabase; screens in `docs/` |
| 3 | Files, artwork approval, holds, handoffs | Next |
| 4 | Chat, DMs, job chat | |
| 5 | Tasks, notifications, search, Home, manager dashboard | |
| 6 | Pilot preparation | |

## Where things are
- Database: a Supabase project. PressGO lives in its own `pressgo` schema, separate from Reliable-Printers.
- `supabase/migrations/` — the database setup (0001 foundation, 0002 job core). Already applied to Supabase.
- `docs/` — the web app (plain HTML/JS, no build step).

## Still to switch on
1. Supabase: Settings -> Integrations -> Data API -> Exposed schemas: add `pressgo`, then Save.
2. Publish `docs/` (GitHub Pages: Settings -> Pages -> branch `main`, folder `/docs`; a private repo needs a paid GitHub plan for this, otherwise host the `docs` folder on any static host).
3. Supabase: Authentication -> URL Configuration: add the published address to Redirect URLs.
4. First sign-in: open the app, "Create login" with `printrel@yahoo.com`, confirm the email, sign in. That email is already the first manager.

## Rules enforced in the database
- staff only see jobs of their department or assigned to them; Front Desk and managers see all
- managers read all department channels but never other people's direct messages; the Managers channel is closed to other staff
- disabled employees and visitors see nothing; invitations only, and only a confirmed email can claim one
- Front Desk/managers create jobs (retry-safe, never-reused numbers); staff can accept an unassigned job in their own department
- lifecycle: New -> Queued -> In Production -> Finishing -> Ready for Collection -> Collected (Cancelled by a manager with a reason)
- manager overrides, backward moves, cancel/reopen and deadline/priority changes need a reason and are recorded in History
- a job can't start without approved artwork unless a manager marked artwork "not required" (approvals arrive in Phase 3)
- stale screens can't overwrite someone else's edit

## Still undecided
App name, timezone (the app currently uses each computer's own time zone), who approves artwork, allowed file types/size, retention.
