# Colon AI app guide

What Colon tells users about its own app: where every setting lives and how each feature is turned on. Written from
the app itself (`apps/chat/src/pages/help.js`, `pages/settings.js`, `components/wake-word-settings.js`,
`components/saga-settings.js`, `components/app-row.js`, `pages/memory.js`, `pages/projects.js`) and
`docs/os-assistant/`. Keep it in step with them: when a setting moves or is renamed, change it here too.

The API reads this file at startup (`services/api/src/modules/appguide`). When a user asks how to do something in
Colon ("how do I turn on Hey Colon?", "where is the setting for memory?"), the sections that match the question go
into the reply's system context, so the answer gives the exact path. Format rules for the parser:

- Each `## ` heading is one section. The `<!-- keys: … -->` line under it lists the words and phrases that select it
  (lower case, comma separated). Keep sections short: a few lines each.
- Paths are written with `›`, as the user sees them: Settings › Voice › Hey Colon.
- Say when something is Android-app only.

## Settings: where things are
<!-- keys: settings, setting, preferences, options, where is, find the setting -->
Open Settings from the profile menu (your avatar, top right) › Settings, or the menu › Settings. Sections, in order,
with quick-jump chips at the top: Account · Appearance · Language · Voice · Chat · Saga · Memory · Privacy · Data ·
App (Colon on your phone). The version (Colon AI v…) is at the bottom of Settings and of Help & Support.

## Hey Colon (wake word)
<!-- keys: hey colon, wake word, wake-word, wakeword, hotword, say hey colon, always listening, screen off, battery saver -->
Android app only (Colon AI for Android 0.23.0 or newer). Settings › Voice › **Hey Colon**: switch it on. Off by
default. Turning it on asks for the microphone (and notifications on Android 13+). A notification "Hey Colon is on"
shows while it can listen; its **Stop** button turns it off. **Pause on battery saver** (Settings › Voice, under Hey
Colon) is on by default. It pauses during calls, while another app records and while Colon itself listens, then
resumes. After a phone restart, open Colon once to start it again (Android 14+ rule). If the switch is missing, the
app is the web version or an older/local build: update the app. For it to open over other apps, allow Display over
other apps (see that section). On Infinix and Tecno, also allow auto-start (see that section).

## Voice input and read aloud
<!-- keys: voice, microphone, mic, dictation, speech, speak, read aloud, read-aloud, voice language, colon voice, male voice, female voice -->
Tap the mic in the message box to speak; Colon writes what you said so you can fix it before sending. Settings ›
Voice: **Speech language** (English Nigeria, Naijá, Yorùbá, Hausa, Igbo, Mixed…), **Voice input method** (Automatic,
Colon speech, Live dictation, Record a voice note), **Send after dictation**, **Read-aloud voice** (Automatic / Colon
voices / this phone's voice), **Colon voice** (Female/Male), **Read-aloud speed**, and **Microphone access › Test**.
Read a reply aloud with the speaker button under it. Microphone blocked on the web: allow it in the browser's site
settings; in the app: Android Settings › Apps › Colon AI › Permissions › Microphone.

## Voice mode (hands-free conversation)
<!-- keys: voice mode, hands-free, hands free, handsfree, talk to colon, conversation mode, voice chat, pill, mute, end voice -->
Start it with the **Voice mode** button in the empty message box, or the mic menu › Hands-free conversation. Colon
listens, answers aloud and listens again. On the voice screen: **Mute**, **End** (red X), **Show chat**. In the
Android app it keeps going over other apps as a small pill at the top (needs Display over other apps); tap the pill
to expand it, hold or swipe it away to end. Also from the phone: Quick Settings tile "Talk to Colon", long-press the
Colon AI icon › Talk to Colon, or Hey Colon.

## Colon as the phone's assistant
<!-- keys: default assistant, digital assistant, assistant app, long-press home, long press home, assist, quick settings tile, tile, shortcut, folax -->
Android app only. Settings (phone) › Apps › Default apps › Digital assistant app › **Colon AI** (Infinix XOS:
Settings › Apps › Default apps › Assist & voice input). Then long-press Home (or the corner swipe). Phones that keep
the gesture for their own assistant (Infinix Folax): pull down Quick Settings › edit (pencil) › drag in **Talk to
Colon**, or long-press the Colon AI icon › Talk to Colon (drag it to the home screen for one tap).

## Display over other apps
<!-- keys: display over other apps, overlay, draw over, appear on top, floating, pill not showing, over other apps -->
Android app only. Needed for voice mode's pill over other apps and for Hey Colon to open from another app. The first
time voice mode starts without it, Colon asks once (Open settings / Not now). To turn it on later: Android Settings ›
Apps › Colon AI › **Display over other apps** › Allow (on some phones: Apps › Special app access › Display over
other apps › Colon AI). Without it, Colon uses a notification with Mute and End instead.

## Auto-start and battery (Infinix XOS, Tecno HiOS, Samsung)
<!-- keys: auto-start, autostart, auto start, background, killed, stops working, battery optimization, battery optimisation, phone master, infinix, tecno, itel, xos, hios, samsung, sleeping apps -->
Infinix (XOS), Tecno (HiOS) and itel close apps in the background, which stops Hey Colon and music. Allow Colon:
- Infinix / Tecno / itel: Phone Master (or Settings › App management) › **Auto-start management** › turn on Colon AI.
  Then Settings › Battery › App battery management (Power management) › Colon AI › **No restrictions** / Don't
  optimise. Menu names differ a little by XOS/HiOS version; search Settings for "auto-start".
- Samsung: Settings › Battery › Background usage limits › remove Colon AI from Sleeping / Deep sleeping apps.
- Any phone: Android Settings › Apps › Colon AI › Battery › Unrestricted. Lock Colon in Recents (long-press its
  card › Lock) if the phone offers it.

## Memory
<!-- keys: memory, remember, forget, saved memories, what you know about me, my name, nickname, call me, personal info, consent -->
Signed-in only. Settings › Memory and projects › **Memory** (or open /memory). Off until you turn it on. When on,
Colon keeps notes you add there, what you ask it to remember in a chat ("remember that …"), and personal things you
tell it (your name, nickname, what to call you, where you live, school, job, likes, dislikes, "always"/"never"
requests). It never saves passwords, PINs or card numbers. A "Saved to memory" chip appears under your message with
**Undo**. On the Memory screen you can view, edit, delete or clear all notes, or turn memory off (notes stay until
you delete them). Project memories are on each project's page.

## Projects
<!-- keys: project, projects, folder, instructions, project files, move to project, group chats -->
Signed-in only. Settings › Memory and projects › **Projects** (or Projects in the sidebar). Create a project, give it
instructions Colon follows in every chat in it, add files, and start new chats inside it. Move an existing chat in:
the chat's ⋯ menu in the sidebar › **Move to project**. How many projects you can have depends on your plan.

## Colon Music and videos
<!-- keys: music, song, play, playlist, youtube, audiomack, video, watch, pause, resume, skip, stop the music, my songs, shuffle -->
Type or say it in a chat: "play Last Last by Burna Boy" (your phone's songs first in the Android app, then YouTube in
a video card in the chat), "watch Davido live", "play my music" / "shuffle my songs", "play Calm Down on YouTube" or
"on Audiomack". While the card plays: "pause", "resume", "forward", "back", "stop the music". In the Android app
music keeps playing with Colon closed, with notification and lock-screen controls; Android asks once for the music
permission.

## Song ID (what song is this)
<!-- keys: song id, song recognition, what song is this, what's playing, shazam, identify song, recognise song, recognize song, who sings this -->
Say or type "what song is this?" (also "what's playing", "shazam this"). Colon answers from its own video card or
player first; when nothing plays there, the Android app listens with the mic for about 11 seconds. No match offline
with the Shazam app installed: Colon opens Shazam. Then "play it" plays the named song. The mic part is Android-app
only.

## Phone control
<!-- keys: open app, open whatsapp, torch, flashlight, volume, alarm, timer, set an alarm, set a timer, phone call, make a call, send a text, sms, navigate, camera, phone commands, control my phone -->
Android app only. Say or type: "open WhatsApp", "wifi settings", "turn on the torch", "volume up" / "set the volume to
40%", "set an alarm for 6:30 am", "set a timer for 5 minutes", "call 0803…" (you tap Call), "text 0803… saying …"
(you tap Send), "navigate to …", "open the camera". Android doesn't let apps flip Wi-Fi or Bluetooth: Colon opens
the switch for you.

## Saga (browsing) and the browser panel
<!-- keys: saga, browse, browsing, browser, browser panel, colon browser, speed mode, saved logins, secured login, scheduled checks, routines, open link -->
Saga browses and does web tasks for you from a chat ("book…", "check … every morning"). Settings › **Saga**:
**Speed mode** (fewer, shorter steps for slow networks), **Saved logins (Colon Secured Login)** (Android app only,
kept encrypted on the phone), **Scheduled checks** and **Routines** (delete them there; create them by asking in a
chat). The browser panel opens from the globe button or "Browse the Web"; Settings › Chat › **Open links in the
browser panel** and **Browser panel layout** (Split screen / Inside the conversation). The full Colon Browser app:
Settings › Colon on your phone › Colon Browser app (or Get Colon Browser for Android on the web).

## Updates and the Android app
<!-- keys: update, updates, new version, latest version, upgrade, apk, install, download app, android app, version -->
Android: Settings › Colon on your phone › **Colon AI for Android** › tap it to **Check for updates**; the app also
offers updates by itself. To install the first time: Settings (or Help) › Get Colon AI for Android (APK from GitHub
Releases, Android 7+; allow your browser to install apps when Android asks). "All releases and what changed" is in
the same place. The web app updates itself: reload the page.

## Language, theme and text size
<!-- keys: language, reply language, pidgin, yoruba, hausa, igbo, theme, dark mode, light mode, text size, font size, appearance -->
Settings › Language › **Reply language** (Colon answers in it when it can; saved to your account). Settings ›
Appearance › **Theme** (Light / Dark / Auto) and **Text size**. Dark mode is also in the profile menu.

## Chat preferences and modes
<!-- keys: mode, modes, study mode, developer mode, research mode, deep research, default mode, default model, model, enter to send, stream replies, cbt, practice test -->
Pick a mode (General, Study, Developer, Research) from the chips above the message box or the model picker at the top.
Settings › Chat: **Default mode for new chats**, **Default model**, **Enter to send**, **Stream replies**, **Show mode
on replies**. Research mode has **Deep research** (a report written in the background). CBT practice test: Explore ›
CBT practice, or CBT practice in the sidebar.

## Chats, history and data
<!-- keys: history, delete chat, delete all, export, archive, archived, pin, saved chats, share chat, rename, chat history, temporary chat, clear files, delete account, delete my account, my account, account, sign out, log out, devices, two-factor, password -->
Each chat's ⋯ menu in the sidebar: Rename, Share link, Save (pin), Archive, Move to project, Delete. History lists
all chats (Archived inside it). Settings › Privacy › **Save chat history** (off = temporary chats). Settings › Data:
**Export conversations**, **Clear uploaded files**, **Delete all conversations**. Settings › Account: Display name,
**Password and two-factor**, **Devices**. Delete your account: Account › Security.

## Share to Colon and attachments
<!-- keys: share, share to colon, attach, attachment, upload, image, pdf, file, zip -->
Attach with the paperclip: images up to 10 MB, PDFs and documents up to 20 MB, text/code up to 2 MB, a .zip project up
to 20 MB, 5 files per message. In the Android app, Share › **Colon AI** from any app puts the text, link or image in
the message box.
