# PressGO pilot checklist

## Before staff start (about 30 minutes)
1. Sign in as yourself (`yoshi`). Open **Staff** and add everyone: username (letters/numbers, e.g. `jane`), name, a first password (8+ characters), tick the department(s), tick Front Desk / Manager only where needed.
2. Give each person their username and first password in person. Ask them to press **Change password** on first sign-in.
3. Check each department has the right people (Staff -> Edit).
4. Turn off public sign-ups in Supabase: Authentication -> Sign In / Providers -> "Allow new users to sign up" OFF. (Only managers should create logins.)
5. Optional clean-up: disable the old `printrel` manager row and delete the mistyped `printerl@yahoo.com` login in Supabase -> Authentication -> Users.
6. Back up: Supabase -> Database -> Backups (or run the export in the Supabase SQL editor) and save a copy before day one, and weekly after.

## Day-one test (run once with two people)
1. Front desk: **+ New job**, send it to a department. Another person in that department sees it; a different department does not.
2. Department person: open the job, upload artwork. Manager: **Approve for Print**.
3. Assign the job to one person: the rest of the department no longer sees it. That person gets an **Alert**.
4. Start it, report a problem (it blocks moving forward), resolve it, hand off to another department and accept it.
5. Send a private message to one person and to a whole department; check the others cannot see it.
6. Add a task on a job; mark it done.

## Daily use
- **Home** shows your jobs, things waiting for you, tasks and unread messages. Managers also get the dashboard.
- Problems or questions about a job: use the job's **Job chat**.

## If something goes wrong
- Someone cannot sign in: Staff -> Reset password. Disabled by mistake: Staff -> Edit -> turn on.
- Screen looks old: refresh (Ctrl+F5).
- Tell Claude exactly what you clicked and what the screen said.
