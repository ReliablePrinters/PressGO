# PressGO startup: "The PressGO Print Sequence"

The animated start of PressGO Desktop. **Status: implemented in the local app source and built into the PressGO Test app for hand-testing. It is not in the real installer or any GitHub release, and nothing is committed, pushed or deployed.**

## What people see

A deep navy screen (the app's own `#0f1b2a`). A printer draws itself in thin lines with Press Blue highlights; its rollers turn and its carriage crosses once. A sheet of paper slides out of the slot. Registration marks appear at its corners. The print head inks the **PressGO** wordmark (the live text, in bundled Inter) from left to right, and the real **Reliable Printers & Stationery Ltd.** logo presses onto the sheet. The printer dims into a calm "Starting PressGO" state until the app is ready; then the splash settles to the app's own background (black in the dark theme, light grey in the light theme) and dissolves into the app (220 ms).

* The whole sequence is about 2.2 s. **If the app is ready sooner, the splash leaves at once, wherever it has got to. There is no minimum time and nothing waits for the animation.**
* It runs only at launch. It is removed after the hand-over and never plays during normal use.

| Situation | What happens |
|---|---|
| App ready before the intro ends | The hand-over starts immediately |
| Still loading after the intro (2.3 s) | Calm loading state. The intro does not replay |
| Still loading after 12 s | "Still starting. This is taking longer than usual." and **Try again** |
| Offline or the server cannot be reached | Amber LED, "You are offline", a live "Trying again in N s". Retries after 3 s, 6 s, then every 10 s, and at once when Windows reports it is back online. **Try now** |
| Another load error, or the app process crashes while starting | "PressGO could not start", the error number, **Try again** and **Quit** |
| 45 s without the app | The same, with **Try again** and **Quit** |
| Windows "reduce motion" | The finished picture fades in once (250 ms), nothing moves, 120 ms hand-over |
| The splash itself cannot load | The app is shown plainly, as before the splash existed. A safety timer means there is never "no window" |

"Ready" means the web app has drawn its first screen (the dashboard shell or the sign-in page). Once the app is showing, a failed page load behaves exactly as it always did (the old "PressGO cannot connect" page).

## How it is built

* **One window, one extra view.** The PressGO page stays in the window's own web contents, so the updater, notifications, context menu, page bridge and every security setting are unchanged. The splash is a local page in a view on top of it, removed after the hand-over. The window stays hidden until the splash has drawn (about 0.15 s), then shows, so the first thing anyone sees is the navy splash.
* **CSS and SVG only.** Only `transform`, `opacity` and `stroke-dashoffset` are animated (compositor-friendly, almost no CPU), no animation library. It pauses when the window is hidden.
* **Local and sandboxed.** No network request. A strict content policy (`default-src 'none'`; images, styles, scripts and the one font from the app itself only). The page's only bridge can receive a state and ask for a retry or quit.
* **The app loads in parallel.** Loading starts the instant the window is created, not after the splash.

| File | Purpose |
|---|---|
| `startup.js` | The controller used by `desktop/main.js`: the layered view, readiness, failures, retry, hand-over |
| `splashlogic.js` | The state machine and the words (tested) |
| `splash.html`, `splash.css`, `splash.js` | The page. `?demo=1` adds preview controls in a browser |
| `splash-preload.js` | The splash's bridge: `onState`, `retry`, `quit`, `loaded` |
| `assets/logo.png` | The real Reliable Printers logo, identical to `docs/logo.png` (192 x 192) |
| `fonts/InterVariable.woff2`, `fonts/Inter-LICENSE.txt` | Inter 4.1 from its official release (github.com/rsms/inter), SIL Open Font License 1.1, bundled with its licence |

## Hand-testing in PressGO Test

Run the PressGO Test app (isolated test site and test data, separate from the real PressGO). Start the test site first (`cd C:\PressGO-TestEnv` then `node server.mjs`).

Scenarios (local test build only; a normal build ignores them): close PressGO Test, then run `desktop\TEST-STARTUP-SCENARIOS.cmd` with one of:

| Command | Shows |
|---|---|
| `TEST-STARTUP-SCENARIOS.cmd` | A normal start (on the local test site the app is ready in well under a second) |
| `TEST-STARTUP-SCENARIOS.cmd slow:3000` | The load begins after 3 s: the full intro, the calm state, then the hand-over |
| `TEST-STARTUP-SCENARIOS.cmd slow:15000` | Goes on to "Still starting. This is taking longer than usual." |
| `TEST-STARTUP-SCENARIOS.cmd offline:2` | The first two attempts fail as if offline (countdown, **Try now**), the third succeeds |
| `TEST-STARTUP-SCENARIOS.cmd fail` or `crash` | "PressGO could not start" with **Try again** and **Quit** |

A log of each start is written to `%TEMP%\pressgo-startup-test.log` in the test build (timings of: window shown, app ready, splash removed).

## What changed in the app source

* `desktop/main.js`: the window starts hidden in the splash navy; the page load is started by the startup controller; failures are handled by it while the splash is up; **everything else is unchanged**.
* `desktop/package.json`: the startup folder is added to the packaged files (the version number is **not** changed).
* `desktop/test/design-web.test.js`: the window-colour test now describes the splash navy (the "cannot connect" page still uses the page colours).
* New: this folder, `desktop/test/splash.test.js`.

**Not changed:** `desktop/preload.js`, the updater, notifications, context menu, the website (`docs/`), the existing installer, the GitHub release, the database.

## Still open

* **Higher-resolution Reliable Printers logo.** `docs/logo.png` is 192 x 192: crisp at 100% and 125% display scaling, slightly soft at 200%. When a larger original (ideally SVG, or PNG of 512 px or more) is supplied, it replaces `assets/logo.png` with no other change.
* **Release.** A new real installer and a GitHub release (and the version number 1.2.0 planned for the desktop app) are separate steps that need their own approval.
