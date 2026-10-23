# Testing PressGO on your own computer (no WSL, no Docker, no Supabase)

This page explains how to check PressGO's database changes **on this computer** before anything is applied to the live Supabase project.
You do not need to be a programmer, and you do not need to type commands.

**What the tests do:** they start a small, throw-away copy of the PostgreSQL database program on this computer, build PressGO's database inside it from the migration files, try to break the rules on purpose, and then delete it all. The live project is never contacted, and no real data is read.

## 1. Run the tests (takes about one minute)

1. Open the PressGO folder (`C:\PressGO-test`).
2. **Double-click `RUN-TESTS.cmd`.**
3. A black window opens and prints lines as it goes. Wait until it says **"Press any key to continue"**, then read the **SUMMARY**, then press a key to close it.

You can run it as often as you like. It leaves nothing behind.

## 2. How to read the result

Look at the last block, headed **SUMMARY**. It has three lines:

| Line | What it means when it says PASSED |
|---|---|
| **Database tests (real PostgreSQL)** | Real PostgreSQL 17.11 (the same version the live project runs) built the database from all 17 migration files, and 15 permission test files, the rollback test, a two-session test of the "undo" for migration 0017, and the release check all behaved as expected. |
| **Admin-users function (fake Supabase)** | The code behind the Staff screen's account tools ran correctly against a *pretend* Supabase. This does **not** prove the real one works. |
| **Web app logic** | The app's own logic (themes, pasting pictures, the delete dialog and so on) ran correctly, with no database at all. |

- **All three PASSED** means every local check is fine.
- **Any line says FAILED:** scroll up in the window and look for lines starting with **FAIL**. The few lines printed under a FAIL say what went wrong. Take a screenshot of the window (or select the text and copy it) and send it to whoever is helping you. **Do not apply anything to Supabase** until it passes.
- **"COULD NOT RUN"** means the test database program was not found or would not start. See section 4.

Inside the database part, the lines mean:
- *migration files numbered in order*: no migration is missing or repeated.
- *each `0001` ... `0017` test*: the permission rules for that step (who may see, change or delete what).
- *rollback lines*: the "undo" files for migrations 0015-0017 work, in the right order, and the database ends up exactly as before. One line checks that the undo for 0017 **refuses** to run while a deleted job still exists.
- *required checks 27 of 27*: the read-only release check (`supabase/checks/verify_release.sql`) is satisfied. The "advisory" fingerprints are extra warnings, not failures.

## 3. What this does NOT prove

- **Real Supabase sign-in and Storage.** Supabase's login and file storage are replaced by a small stand-in (`supabase/tests/local_stub.sql`). Whether pictures can really be uploaded only into your own folder, and whether real logins work, is only proven by the manual checklist in `FEATURE-UPDATE-NOTES.md` (Parts B and C) on the real project, or by a Docker-based copy of Supabase, which this computer does not have.
- **Your live data.** The tests use invented people and jobs. They say nothing about the data that is actually in the live project.
- **A restore from your backup.** That has never been rehearsed.
- **Anything about the live project's current state.** For that, the read-only checks in `FEATURE-UPDATE-NOTES.md` are used, and each needs your approval.

## 4. If something fails

| What you see | What to do |
|---|---|
| **COULD NOT RUN / "Could not find PostgreSQL"** | The test database program is missing. Double-click **`SETUP-POSTGRES.cmd`** (explained below), then run the tests again. |
| **"Git for Windows was not found"** | Install Git for Windows (the same program that provides "Git Bash"), then run again. Do not use the `bash.exe` that comes with Windows itself: that one starts WSL. |
| **"the test server did not start"** and mentions the port | Another program is using port 54329. Close the other test window if one is open, or restart the computer, and try again. |
| A **FAIL** line | A real test failed. Send the lines under it to whoever is helping you. Do not apply the migrations. |
| The window closes by itself | Open **Command Prompt** (Start menu, type `cmd`), type `cd /d C:\PressGO-test`, press Enter, type `RUN-TESTS.cmd`, press Enter. The window will stay open so you can read it. |
| Anything looks stuck for more than 5 minutes | Close the window, then run it again. The test server is deleted automatically each time, and leftovers cannot hurt anything. |

Nothing the tests do can damage the live project, your backups or your files: they only write to a temporary folder that is deleted at the end.

## 5. One-time setup (already done on this computer)

The tests need the PostgreSQL database program. It was installed like this on 2026-10-21, and you only need to redo it on another computer:

- **File:** `postgresql-17.11-5-windows-x64-binaries.zip` (381,531,864 bytes, about 364 MB), from `get.enterprisedb.com` (EDB, the company that builds PostgreSQL for Windows). The SHA-256 of the copy that was used is `80379b2c04d51c30225532e0ae04509899141e9957ed096fe749d7fd9df8f82f`. EDB does not publish a checksum, so this only lets you confirm you have the same file as that day, and the programs inside are not digitally signed.
- **Where it lives:** `C:\PressGO-Tools\postgresql-17.11` (about 1 GB). It is **not** part of the project folder and is not in Git.
- **What it did not change:** no administrator rights, no Windows settings, no PATH entry, no service that starts with Windows, no registry changes.
- **To redo it:** double-click `SETUP-POSTGRES.cmd`. It checks the download size before unpacking. Add `-DryRun` after the file name in a command window to see what it would do without downloading anything.
- **To remove it:** delete the `C:\PressGO-Tools` folder. Nothing else depends on it, except that `RUN-TESTS.cmd` will then ask you to set it up again.

## 6. About WSL, Ubuntu and Docker

None of them is needed. WSL and Ubuntu were started earlier in an attempt to get a Linux database, and the Ubuntu first-time setup got stuck. That left some leftover files that take disk space; it does not affect the tests. Removing it is optional and is a separate decision (it would be `wsl --unregister Ubuntu`, which deletes that Ubuntu copy). Please don't run that, or any other WSL command, unless you have decided you want it gone.

Docker would only be useful later, to run a full copy of Supabase (real sign-in and Storage) on this computer.

## 7. Safety rules built into this setup

- The tests do **not use `docs/config.js`** or any Supabase address or key, and make no internet calls (checked on 2026-10-21: the only web addresses in the test files are made-up examples; the web-app tests read the app's own scripts, not its settings file).
- The test database only listens on this computer (127.0.0.1) and only exists while the tests run.
- Running the tests does not change any project file.
- Applying migrations to the live Supabase project, merging, and publishing are **separate decisions** that always need your explicit approval. Passing tests here is a requirement for those steps, never a replacement for the manual checklist and a fresh backup.
