# Plan D — Handoff spec (for Claude Code)

Context for building the "D" stage of the Expressive Robots studio directly in the repo,
where the full Pardalote source is on disk. This captures decisions already made in planning
so they don't get relitigated, and flags the one thing that must be read from the local files.

---

## What D is

A single-page **p5.js** sketch that closes the expressive-robot loop:

**push-to-talk speech → Gemini (structured output) → play a Pardalote gesture → speak the reply**

It's for an Industrial Design cohort (mixed coding/electronics skill) familiar with Arduino and
p5.js. It is deliberately the simple, single-sketch version — no node bus, no build step. The
robot is a small expressive "desk creature" (tilting head + antennas), driven by Pardalote.

Pathway note: stage **H** (Wizard-of-Oz / robot charades) already happened in class; stage **A**
(modular node bus) is out of scope this semester. **D is the deliverable.**

---

## FIRST: read the local Pardalote, especially `gesture()`

The published GitHub README is **behind** the local copy and does **not** document `gesture()`.
Do not rely on it for that method. Read the library in this repo and establish the real API:

- Where `gesture()` lives (on `arduino`, on a group, or on an actuator).
- How a student **authors/defines** a gesture vs **triggers/plays** it (same method overloaded,
  or define-then-trigger-by-name?).
- Its parameters — name, keyframes/poses, duration, and whether it takes an intensity/scale.
- Whether playing a gesture returns a `whenDone()`-style promise (needed for sequencing and for
  the thinking-filler timing).
- How authored gesture **names** are discovered at runtime (so the LLM's allowed-gesture list can
  be generated from them, not hard-coded).

Build D's actuation layer on that real API. Everything below is settled; this is the one seam to
resolve from source.

---

## Decisions already locked (do not revisit)

1. **Gestures are authored via Pardalote's `gesture()` method.** Students write their own
   gestures; D does not hand-roll a gesture/keyframe system. D triggers gestures by name.
2. **LLM = Gemini via the keyless relay** already built (see `gemini-relay/`). The browser sends
   the student's **own** key in the `x-goog-api-key` header; the relay forwards to Google. Quota
   is per-student. Do not put a key in the relay or in client code that gets committed.
3. **Use `generateContent`, NOT the Interactions API.** The Interactions API can't be called from
   a browser — its client adds an `Api-Revision` header that triggers a CORS preflight
   `generativelanguage.googleapis.com` rejects. `generateContent` has no such problem.
4. **Structured output** via `generationConfig.responseSchema` (`responseMimeType:
   "application/json"`). The `gesture` field is an **enum built at runtime from the student's
   authored gesture names** — so the model can only pick a gesture that exists.
5. **STT/TTS = Web Speech API**, Chrome. **Push-to-talk** (press SPACE for one utterance), not
   always-listening — robust in a noisy studio and stops the robot talking to itself.
6. **Thinking-filler gesture** plays while awaiting Gemini, to cover ~1s latency.
7. **No-robot fallback:** a `USE_ROBOT` flag; when off (or the board isn't connected), gestures
   animate an **on-canvas p5 face** instead, so the whole loop is testable without hardware.
8. **State machine:** `idle → listening → thinking → speaking → idle`, with SPACE during
   `speaking` interrupting (barge-in) and re-listening.
9. **Safety:** rely on Pardalote's **on-board soft limits** (`setLimits`) so the LLM can never
   drive a joint past range. Also fall back to a safe canned directive on API/parse failure.

---

## The BehaviorDirective (LLM output contract)

```jsonc
{
  "speech":   "short, warm reply — one or two sentences",
  "gesture":  "curious_tilt",          // enum: the student's authored gesture names
  "intensity": 0.6,                     // 0.0–1.0, scales the movement
  "gaze":     { "yaw": -0.3, "pitch": 0.1 }  // optional, -1..1; bias head toward the person
}
```

`required`: `speech`, `gesture`, `intensity`. Exclude the filler/rest gestures (e.g. `thinking`,
`neutral`) from the enum the model sees.

---

## The Gemini call (through the relay)

- POST to `PROXY_URL` with header `x-goog-api-key: <student key>`.
- Body: `{ model, systemInstruction, contents, generationConfig }`.
  - `systemInstruction`: robot persona + "choose ONE gesture from this list: <names>" + tone.
  - `contents`: a short rolling history (last few turns) as `{ role: "user"|"model", parts }`,
    then the new user turn. Trim any leading `model` entries so `contents` starts with `user`.
  - `generationConfig.responseSchema`: the BehaviorDirective schema above, `gesture.enum` =
    authored names.
- Response text is at `candidates[0].content.parts[0].text`; it's the JSON string — `JSON.parse`
  it. On non-OK or parse failure, log and use a fallback directive
  (`{ speech: "...", gesture: <a safe one>, intensity: 0.5 }`).
- Default model: `gemini-2.5-flash` (verify current names at
  https://ai.google.dev/gemini-api/docs/models and make it a config value).

---

## Assumed reference robot (confirm against the repo / the actual build)

- Feetech **ST bus servos** (counts 0–4095, centre 2048): **pan** + **tilt** neck, **antL** +
  **antR** antennas. Hardware IDs to be confirmed (assume 1/2/3/4).
- Driven together via a Pardalote **group** so a gesture's joints move/arrive together.
- On-board **soft limits** set per joint on `ready`.
- Optional **NeoPixel** "eyes" for state feedback (guard behind a `USE_EYES` flag).
- ESP32 running the Pardalote firmware; browser reaches it per the library's connection method
  (confirm serial vs WiFi from the local source — the library now supports both).
- Bus servos need their own 6–7.4 V supply (not USB); set unique servo IDs before use.

If `gesture()` already encapsulates the joint targeting, D should just call `gesture(name, …)`
and not touch individual servos except for centring/limits at startup.

---

## Config (per student, gitignored)

```js
const GEMINI_KEY = "";        // each student's own free AI Studio key
const PROXY_URL  = "";        // the class's deployed relay URL (gemini-relay)
const ROBOT_CONN = "";        // IP or serial target, per the library's connect API
const GEMINI_MODEL = "gemini-2.5-flash";
const USE_ROBOT = true;       // false = on-canvas face only, no hardware
const USE_EYES  = false;      // NeoPixel eyes present?
```

---

## Suggested file layout (adapt to the real `gesture()` API)

- `index.html` — loads p5, the Pardalote core + needed extensions, then the app files.
- `config.example.js` → copied to `config.js` (keys/settings; `config.js` gitignored).
- `robot.js` — thin Pardalote adapter: connect, `playGesture(name, intensity, gaze)` (awaitable),
  `park()`, `gestureNames()`, optional eyes. **This is where the real `gesture()` calls go.**
- `brain.js` — `askGeminiForGesture(userText, history)`: builds the schema from `gestureNames()`,
  calls the relay, returns a parsed directive (or a safe fallback).
- `sketch.js` — p5 setup/draw (on-canvas face + status readout), Web Speech STT/TTS, the state
  machine, and the SPACE key handling.

Serve it with a local static server (not `file://`) so the mic and scripts load correctly.

---

## Definition of done

- SPACE captures one utterance; the robot thinks (filler gesture), then plays the chosen gesture
  and speaks a reply.
- The model can only select an **authored** gesture (enum-constrained); an unknown/failed response
  degrades to a safe fallback, never a crash or an out-of-range move.
- Works in `USE_ROBOT=false` mode with the on-canvas face, and on hardware with `USE_ROBOT=true`.
- Barge-in: SPACE during speech stops it and re-listens.

---

## Other artifacts (already written, in the same outputs area)

- `gemini-relay/` — the keyless relay (worker + p5 client + README). Reuse it; don't rebuild it.
- `expressive-robot-build-plan.md` — the deep spec for stage A (not needed for D, but useful
  background on the node-bus architecture and how it positions against ROS 2 / Reachy / Misty).
- `expressive-robots-studio-plan.md` — the two-track teaching plan and the 14-week schedule.

---

## Suggested opening prompt for Claude Code

> Read the Pardalote library in this folder, especially the `gesture()` API and an example of a
> student authoring a gesture and triggering one. Then build a single-page p5.js sketch (Plan D)
> per `plan-d-handoff.md`: push-to-talk Web Speech → Gemini `generateContent` via my keyless
> relay, with a `responseSchema` whose `gesture` enum is built from my authored gesture names →
> play the gesture via Pardalote's `gesture()` → speak the reply. Include a thinking-filler
> gesture during the wait, a no-robot on-canvas face fallback, and the idle/listening/thinking/
> speaking state machine. Start by telling me the real `gesture()` signature you found and how
> you'll map `playGesture(name, intensity, gaze)` onto it.
