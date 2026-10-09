# PressGO desktop message notifications

## What works
| PressGO is... | Windows notification? |
|---|---|
| Open and you are looking at it | No (you can already see the message; the chat list shows an unread dot) |
| Open but minimized, or another program is in front | **Yes** |
| Open on another desktop, or behind other windows | **Yes** |
| Fully closed (X clicked, or not started) | **No. This cannot work with the current design.** |

PressGO receives chat messages through a live connection to Supabase that only exists while the app is running.
A closed app has no connection, so it cannot know a message arrived. Nothing is pretended around that.

## How it works
- The page already listens to new messages (`chat-all`, via Supabase Realtime). Realtime applies the same database
  security rules as everything else, so the app only ever receives messages the signed-in person may read.
- `docs/notify.js` decides if a message deserves a notification: not your own, not hidden, not already seen,
  PressGO is not the window in use, and it matches the person's setting.
- Messages arriving within 2 seconds become one notification ("5 new messages from Bob"). A flood across more than
  3 chats becomes one summary. The desktop app also refuses more than 5 pop-ups in 10 seconds.
- `desktop/notify.js` shows the native Windows notification. Clicking it restores PressGO if minimized, brings it
  to the front and opens that conversation.
- Settings (per person, per computer): **Private messages and Urgent** (default), **All chats**, **Off**, and
  **Show the message text** on/off (off shows only the sender). Open it with the **Notifications** button at the
  bottom of the left menu. The same dialog has a **Send a test notification** button.
- No keys or secrets are involved, no database or server change was made, and nothing is sent anywhere new.

## Windows settings
Settings > System > Notifications: "Notifications" on, and PressGO switched on in the app list (it appears there
after its first notification, so use the test button once). Focus assist / Do Not Disturb hides them. Works for the
installed app (the Start menu shortcut gives Windows the name it needs), not for a loose unzipped copy.

## Getting notifications while PressGO is closed (needs your approval; nothing here is built)
1. **Run in the background (small, no server).** Closing the window hides PressGO to the system tray instead of
   quitting, optionally starting with Windows. The app keeps its connection, so everything above keeps working.
   Cost: the X button no longer quits, which staff must be told about.
2. **True push (bigger).** A server sends a push when a message is inserted: a new table for each device's
   subscription, a database trigger or webhook, and a Supabase Edge Function holding a private push key. That is a
   Supabase migration and a new secret, so it must be approved and reviewed first. Electron has no built-in push,
   so this also means adding a push service to the desktop app.
Option 1 is the safer next step.

## Testing on your PC without real messages
`node try-serve.js 1.1.1 --notify` shows a small test page inside PressGO Test with buttons for a test notification,
a delayed one (to try minimized) and click-to-open. Rebuild the test app first (`node try-build.js 1.1.0`) because
this feature changes the desktop part.
