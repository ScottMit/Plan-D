# Plan D — Expressive Robot (p5.js)

A single-page p5 sketch that closes the expressive-robot loop:

> **push-to-talk speech → Gemini (structured output) → play a Pardalote gesture → speak the reply**

Press **SPACE**, say one thing, and the desk creature (a tilting head + two
antennas, four Feetech ST bus servos) thinks, moves, and replies. It runs with
**no hardware** too — an on-canvas face animates the same gestures.

## Quick start (face-only, no key, no board)

```bash
cd "app"
python3 -m http.server 8000    # or: npx serve .
```

Open <http://localhost:8000>, press **SPACE**. Without a key it plays a safe
fallback so you can see the loop. Serve over `http://localhost` (not `file://`)
or the mic won't load. Use **Chrome** — Web Speech (STT/TTS) is Chrome-only.

No mic, a quiet room, or a non-Chrome browser? Use the **Type** box under the
header instead: type a message and press Enter — it runs the exact same turn.

### Try the settings live

The dropdowns under the header change how the robot thinks and speaks, no code
editing — they take effect on the next turn:

- **Model** — which Gemini model answers. The list is hardcoded from the models
  a current key can reach (`index.html`). **Some options error on purpose**:
  `gemini-2.5-flash` is retired for new keys and returns a 404 — pick it and the
  on-canvas **⚠ error line** shows the real reason (model name + status + Google's
  message). That's the lesson: model names change and old ones get retired.
- **Thinking** — Gemini 3's `thinkingLevel` (`minimal`→`high`). Lower is faster;
  higher is more considered. Watch how the reply latency changes. It's a **Gemini
  3 feature only**: pick a 2.5 or Gemma model and this control greys out (and
  `brain.js` omits `thinkingConfig`, so those models never get an unknown field).
- **Voice** — the speech language for the mic and the reply.

`config.js` holds the starting values; the menus override them for the session.
They're wired in `sketch.js → wireControls()` — one line each. (Model
availability drifts over time; refresh the `<option>`s in `index.html` from
<https://ai.google.dev/gemini-api/docs/models> when it does.)

### Rewrite the system prompt

Expand **System prompt — rewrite how the robot behaves** to edit the actual
instruction sent to Gemini, in three parts:

- **Persona** — who the robot is (try making it grumpy, shy, a pirate…).
- **Reply style** — how it answers (length, tone, when to pick a gesture).
- **Output rules** — the `intensity`/`gaze` guidance and the no-inventing rule.

Between *Reply style* and *Output rules*, the app inserts your **authored
gesture list** (shown read-only) — so however you rewrite the prompt, the model
still only ever sees gestures that exist. Edits save in this browser and apply
on the next turn; **Reset to default** restores the originals. The parts live in
`brain.js` (`PROMPT_DEFAULTS` / `systemInstruction()`).

## Talk to Gemini for real

1. Deploy the keyless relay once (see `../files/README.md`) and copy its URL.
2. Copy `config.example.js` → `config.js` and set `PROXY_URL` to that relay URL.
   (`config.js` is gitignored — never commit it.)
3. Get a free Gemini key: <https://aistudio.google.com/apikey>.
4. Paste your key into the **Key** field on the page. It's remembered in *this
   browser only* (localStorage) — never written to a file, so keys can't leak
   through git. Each student pastes their own; quota is per-student.
5. Press SPACE (or type) and talk.

No key yet? The ⚠ line under the face says so, and the robot falls back to a
safe canned reply instead of crashing.

### Response timer

The moment the answer comes back (before it's spoken) a **⏱ line** under the
face shows how long the trip took, in parts:

- **stt** — speech→text: how long the recognizer took to hand back your words
  *after you stopped talking* (Chrome sends the audio to Google). Mic turns only
  — typed turns skip it, so the line just shows *think*.
- **think** — the LLM round trip (request → relay → Google → reply parsed). The
  big one, and what the thinking-filler gesture is covering.
- **total** — stt + think: from when you stopped talking to answer-ready.

`brain.js` also measures `network` vs `parse` within *think* (in `lastTiming`) —
`parse` is ~0ms, the point being that the wait is the model, not our code. The
relay→Google leg can't be split from the browser; doing so would need the relay
to send a `Server-Timing` header (a small worker change + redeploy).

## Drive the robot

In `config.js` set `USE_ROBOT: true`, set the four `SERVO_IDS` and (ESP32)
`BUS_RX`/`BUS_TX`. Upload the Pardalote firmware to the board, then use the
**Robot** row on the page (WiFi IP or USB) to connect. Bus servos need their own
6–7.4 V supply and unique IDs. On-board **soft limits** are set per joint at
connect, so neither the LLM nor a buggy gesture can drive a joint out of range.

## Files

| file | what it is |
|---|---|
| `gestures.js` | **The gesture vocabulary you author.** Named Pardalote segment schedules. Add a block → it appears in the model's choices automatically. |
| `robot.js` | Pardalote adapter: connects the bus-servo **group**, `playGesture(name, intensity, gaze)` (awaitable), `park()`, `stop()`, gesture names, soft limits, optional NeoPixel eyes. Falls back to timed no-ops when there's no board. |
| `brain.js` | `askGeminiForGesture(text, history)`: builds a `responseSchema` whose `gesture` **enum is your authored names**, calls Gemini `generateContent` via the relay, returns a parsed directive — or a safe fallback (never throws). |
| `sketch.js` | p5 face + status readout, Web Speech STT/TTS, the `idle→listening→thinking→speaking→idle` state machine, SPACE / barge-in. |
| `config.example.js` | Copy to `config.js`. Keys + robot settings. |
| `lib/pardalote.js` | Vendored Pardalote 1.1.0 bundle (copied from the library; don't edit). |
| `connect.js`, `style.css` | The shared Pardalote connection UI + house style. |

## The LLM output contract (BehaviorDirective)

```jsonc
{
  "speech":    "short, warm reply",
  "gesture":   "curious_tilt",              // enum: your authored gesture names
  "intensity": 0.6,                          // 0..1, scales the movement
  "gaze":      { "yaw": -0.3, "pitch": 0.1 } // optional, -1..1, biases the head
}
```

`speech`, `gesture`, `intensity` are required. The filler/rest gestures
(`thinking`, `neutral`) are `hidden` and excluded from the enum the model sees.

## How gestures map onto Pardalote

The library's `gesture()` takes a **segment schedule** (a list of eased
`{ by/to, dur, curve }` moves the board plays on its own clock), on an actuator,
a group, or the arduino. It is **not** a named-gesture registry — so "authoring a
gesture" here means writing a named entry in `gestures.js`, and `robot.js` plays
it with one call:

```js
group.gesture({ pan:[…], tilt:[…], antL:[…], antR:[…] }).whenDone();
```

Gestures are authored as **relative, net-zero round-trips** (every joint returns
home), so they're safe to fire from any pose. `intensity` scales the amplitudes;
`gaze` biases the head via a quick `writeTimed` before the gesture. Timing is
computed from the longest lane, so the face animates on the same clock when
there's no board.
