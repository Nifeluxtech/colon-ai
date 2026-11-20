# Step 2 · Phone control

Plan: `docs/os-assistant/plan.md`. Say or type a short command in Colon AI (Android app, hands-free or typed) and the
phone does it. All free: public Android intents and system services, no new library, no server call, works offline.

## Commands
| Say | Does | Leaves Colon |
|---|---|---|
| "open WhatsApp", "launch the OPay app" | opens the installed app with that name | yes |
| "open settings", "wifi settings", "turn on bluetooth" | opens that settings screen or panel (Android 10+ shows the switch; apps can't flip it) | yes |
| "turn on the torch", "flashlight off" | torch on/off | no |
| "volume up/down", "set the volume to 40%", "max volume", "mute", "unmute" | media volume | no |
| "pause the music", "resume the song", "next song", "previous song" | media keys to whatever is playing | no |
| "call 0803 123 4567" | opens the dialler with the number; **the user taps Call** | yes |
| "text 0803… saying I'm on my way" | opens Messages with the text; **the user taps Send** | yes |
| "set an alarm for 6:30 am", "wake me up at 7pm" | clock app alarm | no |
| "set a timer for 5 minutes" | clock app timer | no |
| "navigate to Ikeja City Mall" | map app search for the place | yes |
| "open the camera", "take a selfie" | camera app | yes |

The answer is a toast; in hands-free it is spoken and Colon listens again. A command that leaves Colon ends hands-free.

## How it works
1. `apps/chat/src/lib/phone-intent.js` (pure, tested in `packages/ui/test/phone-intent.test.js`): `parsePhone(text)`
   turns a whole short command into `{ action, ... }`, or `null` for anything else (questions, chat, browser).
2. `apps/chat/src/actions/phone-chat.js`, called first in `send()` (`send-message.js`) when the app has feature
   `phone`: sends `ColonNative.call('phone', cmd)`. "open youtube" (a site in `browser-intent.js` SITES) still opens
   the site in the chat's browser unless the user said "app" or is in hands-free. "open <name>" with no such app
   (`not_found`) goes on as an ordinary message.
3. Android `NativeBridge` command `phone`: `PhoneRules.check` (allowlist: 11 actions, argument checks, unit-tested in
   `PhoneRulesTest.kt`) and only then `PhoneActions.run`. Unknown actions answer `unknown_action`, bad arguments
   `bad_args`; the page can't make the phone do anything else, whatever it sends.
4. Manifest: `SET_ALARM` (normal permission, no prompt) and a `<queries>` entry for launcher activities so apps can be
   found by name on Android 11+. No CALL_PHONE, SEND_SMS, contacts or accessibility permission.

## Not yet (later steps)
- Calling or texting a contact by name (needs READ_CONTACTS and a confirm card).
- "Play <song>" (Step 3, Colon Music). Toggling Wi-Fi/Bluetooth directly (Android 10+ doesn't allow it).
- Commands the chat model decides (Saga structured JSON through the same `phone` allowlist).

## Test checklist (Infinix SMART 20)
- [ ] Each row of the table, typed and in hands-free
- [ ] "open google.com", "open the browser", "how do I open WhatsApp?" behave as before
- [ ] "open telegram" with Telegram not installed goes to chat as usual
- [ ] Alarm and timer appear in the Clock app; torch works with the camera closed
- [ ] CI: unit tests + lint for both flavors
