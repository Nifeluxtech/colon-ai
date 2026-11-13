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

## Next
- 0.6.1 Spoken replies: play button per reply, sentence-by-sentence TTS (Naija Speech voices), voice per language.
- 0.6.2 Hands-free mode: silence detection, auto-send, speak the reply, listen again.
- 0.6.3 Evaluation: real recorded clips per language (WER), low-end Android timing (Infinix SMART class).
