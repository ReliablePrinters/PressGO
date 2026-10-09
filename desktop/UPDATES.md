# How PressGO desktop updates work, and how to publish one

## What staff see
Installed copies of PressGO (made by **PressGO-Setup.exe**, version 1.1.0 or newer) check the official
GitHub Releases of `ReliablePrinters/PressGO` 15 seconds after opening and every 30 minutes after that.
When a newer version exists, an **Update PressGO** button appears at the top of the left menu (and on the
sign-in screen). Nothing is downloaded until someone clicks it. Then:

1. Click **Update PressGO**. A progress bar shows the download. Staff keep working.
2. When it says **Update ready**, click **Restart and install** when they are at a good stopping point.
   PressGO closes, installs quietly and reopens. If they never click it, the downloaded update installs
   the next time they close PressGO normally.
3. If something goes wrong (no internet, release missing, failed safety check) the button is replaced by a
   plain message and **Try again**. Nothing is installed and nothing is deleted.

If PressGO is up to date, nothing is shown. Staff data lives on the server, so an update never touches it.

The **portable zip** and a developer run never show the button (the installer must not be run over a folder
it did not create). Portable users must download the new Setup once.

## One-time catch: version 1.0.0 cannot update itself
The copies installed today (v1.0.0) contain no updater. Everyone installs **v1.1.0** (the first release with
the updater) by hand, once. After that, every later release reaches them by the button.

## Publishing a new version (every time)
1. Change `"version"` in `desktop/package.json` to the new number, higher than the last release
   (for example `1.1.1`). It must be higher or installed copies will ignore it.
2. Merge to `main`.
3. GitHub: **Actions > Build Windows desktop app > Run workflow**, on `main`.
   First run with **publish unticked** (a dry run). It runs the tests, builds the installer, and checks that
   `latest.yml` names the new version.
4. If the dry run is green, run it again on `main` with **publish ticked**. That creates the release
   `v<version>` with `PressGO-Setup.exe`, `PressGO-Portable.zip`, `SHA256SUMS.txt`, `latest.yml` and
   `PressGO-Setup.exe.blockmap`.
5. Edit the release description to a short plain sentence about what changed. Installed copies show the
   first 300 characters, as plain text.

Never delete or edit `latest.yml` or the `.blockmap` on a published release, and never delete old releases.
A release marked "pre-release" or "draft" is ignored by installed copies.

## What is checked, and what is not
- Version numbers are compared as numbers (1.10.0 is newer than 1.9.0). An older or identical release never
  triggers the button.
- The updater checks the downloaded installer's SHA-512 against `latest.yml`, which is read from the same
  official release over HTTPS. A mismatch is rejected and nothing is installed.
- **Not signed:** the installer has no Windows code-signing certificate, so Windows cannot prove who made it
  and the updater cannot check a publisher signature. Trust rests on the official repository over HTTPS.
  Buying a code-signing certificate (or using Azure Trusted Signing) and setting `win.publisherName` in
  `desktop/package.json` is the missing piece. It also removes the "Windows protected your PC" warning.
- Only the real PressGO page, in the main window, can talk to the updater. No tokens or secrets are in the app.

## Right-click menus
The desktop window builds the normal right-click menu itself (Electron shows none by default): text boxes get
Undo, Redo, Cut, Copy, Paste, Paste as plain text and Select all (plus spelling suggestions); links get
Open link in browser and Copy link address; images get Copy image, Save image as, Open image in browser and
Copy image address; empty areas get Back, Reload and Select all. See `contextmenu.js`.

## Testing an update on your own PC before publishing (nothing is published)
`try-build.js` and `try-serve.js` build a separate **PressGO Test** app (its own install folder, settings and
uninstaller, so your real PressGO is never touched). It opens a copy of the site from this computer and looks
for updates in a local folder instead of GitHub. Build version 1.1.0 and 1.1.1 with
`node try-build.js 1.1.0` and `node try-build.js 1.1.1`, install the 1.1.0 one, run
`node try-serve.js 1.1.1`, then open PressGO Test. The Update PressGO button should appear on the sign-in screen.
`node try-serve.js 1.1.1 --tamper` offers the same update with a deliberately broken checksum, which must be rejected.
