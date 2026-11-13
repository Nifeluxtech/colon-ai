# Phase 6 · Voice

Release standard (ROADMAP): accuracy tested on Nigerian English, Pidgin, Yorùbá, Hausa and Igbo samples, and it works
on low-end Android phones.

## 0.6.0 · Voice input (done)
- Mic → recording bar (language picker, level meter, Done/Cancel, 5-minute cap) → `POST /voice/transcribe` →
  transcript in the message box, editable → send. "Send after dictation" sends it at once.
- Provider chain per language (`modules/voice/providers.js`):

| Language | First | Fallback |
| --- | --- | --- |
| Hausa, Igbo, Yorùbá, Nigerian English | Naija Speech API (`ncair-asr`) | Gemini |
| Naijá (Pidgin), Mixed / not sure | Gemini | — |

- Naija Speech free limits per key: 10 requests a minute, 1,000 a day, 120 audio minutes a day. Non-commercial
  licence (NCAIR / Awarri): the attribution is shown in Settings › Voice. Commercial use needs a licence from them.
- Gemini free tier: Google may use prompts to improve its products.
- First check (2026-11-13, sandbox, short TTS clips as WebM/Opus): Naija Speech 1.4–2.0 s per clip, Hausa, Yorùbá
  and Igbo close to the spoken text; Gemini with "Mixed" misread a Hausa clip as Igbo, so the app asks for the
  language rather than guessing (auto-detect is the weak spot).

## 0.6.1 · Spoken replies (done)
- Read-aloud button on each reply → `lib/read-aloud.js` → `POST /voice/speak` per chunk → MP3 played in order.
- Voices: `ha` hausa_female1 / hausa_male2, `ig` igbo_female2 / igbo_male2, `yo` yoruba_female2 / yoruba_male2,
  `en` idera / osagie. Naijá is read by the English voice.
- Measured 2026-11-13: generation is slower than real time and serialised per key (3 parallel requests finished at
  5.5, 10.7 and 11 s). So "Automatic" uses Colon voices only for Yorùbá, Hausa and Igbo; English and Naijá use the
  phone's voice (instant, offline). Users can choose "Always Colon voices".
- Budget: Naija Speech allows 10 requests a minute per key for the whole app; read-aloud takes at most 7.

## Next
- 0.6.2 Fix: English dictation no longer stops at the first pause on Android (auto-restart until Done).
- 0.6.3 Fix: dictation text no longer repeated on Android.
- 0.6.4 Hands-free mode: silence detection, auto-send, speak the reply, listen again.
- 0.6.5 Evaluation: real recorded clips per language (WER), low-end Android timing (Infinix SMART class).
