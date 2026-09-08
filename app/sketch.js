// ==============================================================
// sketch.js — Plan D: the expressive-robot loop.
//
//   push-to-talk speech  →  Gemini (structured output)  →  play a Pardalote
//   gesture  →  speak the reply
//
// Press SPACE to say one thing. The robot plays a thinking-filler gesture while
// it waits for Gemini, then plays the gesture the model chose and speaks its
// reply. SPACE again while it's speaking interrupts (barge-in) and re-listens.
//
// State machine:  idle → listening → thinking → speaking → idle
//
// Everything animates on an on-canvas face too, so the whole loop works with NO
// hardware (CONFIG.USE_ROBOT = false, or just not connected). Web Speech (STT +
// TTS) is Chrome-only — serve this over http://localhost (not file://) so the
// mic works.
// ==============================================================

// ---- house palette (matches the Pardalote examples) ------------------
const INK = '#2B2420', GREY = '#6d6a5f', HAIR = '#d9d2c2', PAPER = '#faf8f2',
      TEAL = '#3FA9A0', AMBER = '#E8A33D', ORANGE = '#D3542B', RED = '#D22B2B';

const W = 640, H = 600;

// ---- state -----------------------------------------------------------
const STATE = { IDLE: 'idle', LISTENING: 'listening', THINKING: 'thinking', SPEAKING: 'speaking' };
let state = STATE.IDLE;
let turnId = 0;                 // bumped each turn so a barged-in tail bails out

let recog = null;              // SpeechRecognition instance (or null)
let speechSupported = true;
let speakingNow = false;       // drives the mouth animation
let typedInput = null;         // DOM text input — keyboard fallback for the mic
let sttEndT0 = 0;              // performance.now() at onspeechend, to time STT

const history = [];            // rolling { role:'user'|'model', text } turns
const MAX_HISTORY = 8;         // keep the last few turns for context

let lastUser = '';             // last thing heard (shown on canvas)
let lastReply = '';            // last thing said
let lastGesture = '';          // last gesture played
let lastIntensity = 0;
let lastError = '';            // last API/parse failure reason (shown in red)
let lastTiming = null;         // { think, speak, total, network, parse } in ms
let statusLine = 'idle — press SPACE to talk';

// on-canvas face gesture envelope
let gestureAnim = null;        // { name, start, duration, peak }

// Peak face pose per gesture (-1..1). Mirrors what the servos do so the face
// reads the same in hardware and face-only modes. shimmer = oscillate; freq =
// oscillation speed.
const EXPRESSIONS = {
    neutral:        { },
    thinking:       { antenna: 0.35, headTilt: -0.15, brow: 0.15, shimmer: 'antenna', freq: 5 },
    curious_tilt:   { headTurn: 0.5, headTilt: 0.25, antenna: 0.6, brow: 0.5 },
    nod_yes:        { headTilt: -0.55, shimmer: 'headTilt', freq: 4, antenna: 0.1 },
    shake_no:       { headTurn: 0.6, shimmer: 'headTurn', freq: 5, brow: -0.2 },
    perk_up:        { headTilt: 0.55, antenna: 0.9, brow: 0.5 },
    droop:          { headTilt: -0.6, antenna: -0.9, brow: -0.6 },
    excited_wiggle: { headTilt: 0.3, antenna: 0.7, shimmer: 'antenna', freq: 9 },
    look_around:    { headTurn: 0.6, shimmer: 'headTurn', freq: 3, antenna: 0.2 },
    _default:       { headTurn: 0.3, antenna: 0.3 },
};

// accent colour per state (also drives the optional NeoPixel eyes)
const STATE_COLOR = {
    idle: GREY, listening: TEAL, thinking: AMBER, speaking: ORANGE,
};
const STATE_RGB = { idle: [40, 40, 40], listening: [30, 120, 110], thinking: [220, 150, 40], speaking: [200, 70, 30] };

// ---- setup -----------------------------------------------------------
function setup() {
    createCanvas(W, H).parent('stage');   // canvas sits above the Type row + status
    textFont('system-ui');

    Robot.setup(CONFIG.USE_ROBOT, setStatus);
    initSpeech();
    wireControls();

    setState(STATE.IDLE);
}

// Connect the settings UI (the <select>s + Type box, all defined in index.html)
// to the running app. The dropdowns are pure config: each one just seeds itself
// from CONFIG and writes the chosen value back, so the NEXT turn picks it up —
// nothing here builds markup or reruns a request.
function wireControls() {
    const el = (id) => document.getElementById(id);

    // A dropdown → a CONFIG field. Seeds the menu from the current value, then
    // updates it on change. `after` lets a control do a little extra (relabel
    // the mic's language). No page reload, no reconnect.
    const bindSelect = (id, key, after) => {
        const sel = el(id);
        if (!sel) return;
        sel.value = CONFIG[key];
        const apply = () => { CONFIG[key] = sel.value; if (after) after(sel.value); };
        if (sel.value !== CONFIG[key]) apply();   // config value wasn't listed → adopt the shown one
        sel.addEventListener('change', apply);
    };

    // Key field → the student's own Gemini key, saved in this browser only.
    // Seeds from whatever's saved (Brain.getKey), and stores every keystroke so
    // the next turn — and the next reload — uses it. Nothing is written to a file.
    const keyField = el('gemini-key');
    if (keyField) {
        keyField.value = Brain.getKey();
        keyField.addEventListener('input', () => Brain.setKey(keyField.value));
    }

    // On a model change, grey out Thinking when the model can't use it (only
    // Gemini 3 understands thinkingLevel — see Brain.supportsThinkingLevel).
    bindSelect('sel-model', 'GEMINI_MODEL', updateThinkingAvailability);
    bindSelect('sel-thinking', 'THINKING_LEVEL');
    bindSelect('sel-lang', 'SPEECH_LANG', (lang) => { if (recog) recog.lang = lang; });
    updateThinkingAvailability();   // set the initial enabled/greyed state

    // Type box → the same turn the mic runs. Enter or Send both submit.
    typedInput = el('say');
    if (el('send')) el('send').addEventListener('click', submitTyped);
    if (typedInput) typedInput.addEventListener('keydown', (e) => {
        // Enter sends; Shift+Enter drops to a second line (it's a textarea now).
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); submitTyped(); }
    });

    wirePromptEditor(el);
}

// The editable system prompt. Each textarea maps to one part of the prompt
// (Brain.getPrompt/setPromptPart); the gesture list is shown read-only because
// it's generated from the authored gestures, not typed. Reset restores defaults.
function wirePromptEditor(el) {
    const PARTS = { 'prompt-persona': 'persona', 'prompt-task': 'task', 'prompt-rules': 'rules' };
    const saved = Brain.getPrompt();
    for (const [id, part] of Object.entries(PARTS)) {
        const ta = el(id);
        if (!ta) continue;
        ta.value = saved[part];
        ta.addEventListener('input', () => Brain.setPromptPart(part, ta.value));
    }

    // Read-only mirror of the gesture list that gets inserted into the prompt.
    const glist = el('prompt-gestures');
    if (glist) glist.value = Robot.gestureCatalogue().map((g) => `- ${g.name}: ${g.desc}`).join('\n');

    const reset = el('prompt-reset');
    if (reset) reset.addEventListener('click', () => {
        const d = Brain.promptDefaults();
        for (const [id, part] of Object.entries(PARTS)) {
            Brain.setPromptPart(part, d[part]);
            const ta = el(id);
            if (ta) ta.value = d[part];
        }
    });
}

// Enable the Thinking dropdown only when the chosen model supports thinkingLevel
// (Gemini 3). Otherwise grey it out and show the note — brain.js already omits
// thinkingConfig for those models, so the two stay in step.
function updateThinkingAvailability() {
    const sel = document.getElementById('sel-thinking');
    const note = document.getElementById('thinking-note');
    const ok = Brain.supportsThinkingLevel(CONFIG.GEMINI_MODEL);
    if (sel) sel.disabled = !ok;
    if (note) note.hidden = ok;
}

// Route typed text through the same loop as a spoken utterance. Interrupts a
// reply in progress (like barge-in, but without opening the mic).
function submitTyped() {
    if (!typedInput) return;
    const text = (typedInput.value || '').trim();
    if (!text) return;
    typedInput.value = '';
    if (state === STATE.LISTENING) { try { recog.abort(); } catch (e) {} }
    if (state === STATE.SPEAKING) {
        try { window.speechSynthesis.cancel(); } catch (e) {}
        Robot.stop();
        speakingNow = false;
        gestureAnim = null;
    }
    lastUser = text;
    runTurn(text);   // runTurn bumps turnId, orphaning any in-flight turn's tail
}

// ---- draw ------------------------------------------------------------
function draw() {
    background(PAPER);
    drawFace();
    drawReadout();
}

// ---- state machine ---------------------------------------------------
function setState(s) {
    state = s;
    if (CONFIG.USE_EYES) Robot.setEyes(STATE_RGB[s] || STATE_RGB.idle);
}

function setStatus(s) {
    statusLine = s;
    const el = document.getElementById('status');
    if (el) el.textContent = 'status: ' + s;
}

// SPACE is the one control. What it does depends on the state.
function keyPressed() {
    if (key !== ' ') return;
    // If a text field / dropdown has focus (the typed-input box, the IP field),
    // let SPACE type normally instead of starting the mic.
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT')) return;
    // stop the page scrolling on space
    if (state === STATE.IDLE) {
        startListening();
    } else if (state === STATE.LISTENING) {
        cancelListening();               // press again to abort a mishear
    } else if (state === STATE.SPEAKING) {
        bargeIn();                       // interrupt the reply and re-listen
    }
    // (during THINKING we ignore SPACE — the model call is already in flight)
    return false;
}

// ---- listening (STT) -------------------------------------------------
function initSpeech() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
        speechSupported = false;
        setStatus('Web Speech not available — use Chrome, served over http://localhost');
        return;
    }
    recog = new SR();
    recog.lang = CONFIG.SPEECH_LANG || 'en-US';
    recog.interimResults = false;
    recog.maxAlternatives = 1;
    recog.continuous = false;            // one utterance per press (push-to-talk)

    // Time speech→text: the recognizer keeps working AFTER you stop talking
    // (onspeechend) until it delivers the transcript (onresult). That gap is the
    // STT latency — Chrome sends the audio to Google to transcribe.
    recog.onspeechend = () => { sttEndT0 = performance.now(); };
    recog.onresult = (e) => {
        const sttMs = sttEndT0 ? (performance.now() - sttEndT0) : null;
        sttEndT0 = 0;
        const text = (e.results[0] && e.results[0][0] && e.results[0][0].transcript || '').trim();
        if (text) { lastUser = text; runTurn(text, sttMs); }
    };
    recog.onerror = (e) => {
        if (e.error === 'no-speech') setStatus('idle — didn\'t hear anything, press SPACE');
        else setStatus('mic error: ' + e.error);
        if (state === STATE.LISTENING) setState(STATE.IDLE);
    };
    recog.onend = () => {
        // If it ended without a result (silence/abort), fall back to idle.
        if (state === STATE.LISTENING) { setState(STATE.IDLE); setStatus('idle — press SPACE to talk'); }
    };
}

function startListening() {
    if (!speechSupported) { setStatus('no mic support — need Chrome over http://localhost'); return; }
    setState(STATE.LISTENING);
    setStatus('listening… speak now');
    try { recog.start(); }
    catch (e) { /* start() throws if already started — ignore */ }
}

function cancelListening() {
    try { recog.abort(); } catch (e) {}
    setState(STATE.IDLE);
    setStatus('idle — press SPACE to talk');
}

// ---- one full turn ---------------------------------------------------
// sttMs = how long speech→text took (from the mic), or null when typed.
async function runTurn(text, sttMs = null) {
    const myTurn = ++turnId;
    const tStart = performance.now();    // start the think timer
    setState(STATE.THINKING);
    setStatus('thinking…');

    history.push({ role: 'user', text });
    trimHistory();

    // Filler gesture covers the ~1s of LLM latency (don't await — let it play
    // while the request is in flight).
    startFaceGesture(Robot.FILLER_GESTURE, 1400);
    Robot.playGesture(Robot.FILLER_GESTURE, 0.5);

    const directive = await Brain.askGeminiForGesture(text, history);
    if (myTurn !== turnId) return;       // a barge-in superseded this turn

    history.push({ role: 'model', text: directive.speech });
    trimHistory();

    lastReply = directive.speech;
    lastGesture = directive.gesture;
    lastIntensity = directive.intensity;
    // Show a fallback's reason on screen (so failures aren't silent), and clear
    // it on the next successful turn — a good directive has no `error`, so this
    // resets to '' automatically.
    lastError = directive.error || '';

    // Timing is posted NOW — the moment the answer is back, before it's spoken.
    // Parts of the trip up to the response: stt (speech→text, mic only) + think
    // (the LLM round trip); total is their sum. network/parse split the think
    // leg (network is the trip to Gemini, parse is our code — always ~0ms).
    const think = performance.now() - tStart;
    lastTiming = {
        stt:     sttMs,
        think:   think,
        total:   (sttMs || 0) + think,
        network: directive.timing ? directive.timing.network : null,
        parse:   directive.timing ? directive.timing.parse : null,
    };

    setState(STATE.SPEAKING);
    setStatus('speaking…');

    // Gesture and speech together.
    startFaceGesture(directive.gesture, gestureDurationGuess(directive.gesture));
    const gesturePromise = Robot.playGesture(directive.gesture, directive.intensity, directive.gaze);
    const speechPromise = speak(directive.speech);

    await Promise.all([gesturePromise, speechPromise]);
    if (myTurn !== turnId) return;       // barged-in during the reply

    setState(STATE.IDLE);
    // If this turn fell back, leave the reason in the status line — otherwise it
    // would flash past as 'speaking…' and you'd never see why it didn't work.
    setStatus(lastError ? '⚠ ' + lastError : 'idle — press SPACE to talk');
    Robot.park();
}

function trimHistory() {
    while (history.length > MAX_HISTORY) history.shift();
    while (history.length && history[0].role !== 'user') history.shift();
}

// ---- speaking (TTS) --------------------------------------------------
function speak(text) {
    return new Promise((resolve) => {
        if (!('speechSynthesis' in window) || !text) { resolve(); return; }
        const u = new SpeechSynthesisUtterance(text);
        u.lang = CONFIG.SPEECH_LANG || 'en-US';
        u.rate = 1.0;
        u.pitch = 1.15;                  // a little bright, for a small creature
        u.onstart = () => { speakingNow = true; };
        u.onend = () => { speakingNow = false; resolve(); };
        u.onerror = () => { speakingNow = false; resolve(); };
        try { window.speechSynthesis.speak(u); }
        catch (e) { speakingNow = false; resolve(); }
    });
}

// SPACE during speaking: stop the voice + head, then listen for the reply.
function bargeIn() {
    turnId++;                            // orphan the in-flight turn's tail
    speakingNow = false;
    try { window.speechSynthesis.cancel(); } catch (e) {}
    Robot.stop();
    gestureAnim = null;
    startListening();
}

// ---- on-canvas face animation ----------------------------------------
function startFaceGesture(name, duration) {
    const peak = EXPRESSIONS[name] || EXPRESSIONS._default;
    gestureAnim = { name, start: millis(), duration: Math.max(300, duration), peak };
}

// Rough duration for the face when we don't have the exact lane total handy.
function gestureDurationGuess(name) {
    const g = (typeof GESTURES !== 'undefined') && GESTURES[name];
    if (!g) return 1200;
    const lanes = g.build(1);
    let max = 0;
    for (const segs of Object.values(lanes)) {
        const t = segs.reduce((n, s) => n + Math.max(1, s.dur || 0), 0);
        if (t > max) max = t;
    }
    return max || 1200;
}

// Resolve the current face pose from gaze + the running gesture envelope.
function facePose() {
    const g = Robot.currentGaze ? Robot.currentGaze() : { yaw: 0, pitch: 0 };
    let headTurn = g.yaw * 0.5, headTilt = g.pitch * 0.4;
    let eyeX = g.yaw, eyeY = -g.pitch, antenna = 0, brow = 0, mouth = 0;

    if (gestureAnim) {
        const t = (millis() - gestureAnim.start) / gestureAnim.duration;
        if (t >= 1) { gestureAnim = null; }
        else {
            const env = Math.sin(Math.min(1, Math.max(0, t)) * Math.PI); // 0→1→0
            const p = gestureAnim.peak;
            if (p.shimmer) {
                const osc = Math.sin(t * Math.PI * (p.freq || 6));
                if (p.shimmer === 'headTurn') headTurn += (p.headTurn || 0) * osc * env;
                if (p.shimmer === 'headTilt') headTilt += (p.headTilt || 0) * osc * env;
                if (p.shimmer === 'antenna') antenna += (p.antenna || 0) * osc * env;
                if (p.shimmer !== 'headTurn') headTurn += (p.headTurn || 0) * env;
                if (p.shimmer !== 'headTilt') headTilt += (p.headTilt || 0) * env;
                if (p.shimmer !== 'antenna') antenna += (p.antenna || 0) * env;
            } else {
                headTurn += (p.headTurn || 0) * env;
                headTilt += (p.headTilt || 0) * env;
                antenna += (p.antenna || 0) * env;
            }
            brow += (p.brow || 0) * env;
            eyeX += (p.headTurn || 0) * env * 0.5;
            eyeY += (p.headTilt || 0) * env * 0.3;
        }
    }
    if (speakingNow) mouth = 0.45 + 0.45 * Math.sin(millis() * 0.02);
    return { headTurn, headTilt, eyeX, eyeY, antenna, brow, mouth };
}

function drawFace() {
    const cx = W / 2, cy = 210;
    const pose = facePose();
    const accent = STATE_COLOR[state] || GREY;

    push();
    translate(cx + pose.headTurn * 34, cy - pose.headTilt * 22);
    rotate(pose.headTurn * 0.12);

    // antennas — angle spreads/raises with `antenna`
    const antBase = -96, spread = 34 + pose.antenna * 26, lift = -pose.antenna * 30;
    stroke(INK); strokeWeight(4); noFill();
    for (const dir of [-1, 1]) {
        const tipX = dir * (spread + 18), tipY = antBase + lift - 40;
        line(dir * 20, antBase, tipX, tipY);
        fill(accent); noStroke();
        circle(tipX, tipY, 16);
        noFill(); stroke(INK);
    }

    // head
    stroke(INK); strokeWeight(3); fill('#fff');
    rectMode(CENTER);
    rect(0, 0, 240, 190, 46);

    // eyes
    const eyeDX = 52, eyeY = -12, eyeR = 42;
    noStroke();
    for (const dir of [-1, 1]) {
        fill('#fff'); stroke(INK); strokeWeight(3);
        circle(dir * eyeDX, eyeY, eyeR);
        // pupil follows gaze
        fill(INK); noStroke();
        circle(dir * eyeDX + pose.eyeX * 12, eyeY + pose.eyeY * 10, 18);
    }

    // brows — inner ends lift for curious, drop for sad
    stroke(INK); strokeWeight(4);
    for (const dir of [-1, 1]) {
        const bx = dir * eyeDX, by = eyeY - 34;
        const inner = -pose.brow * 10, outer = pose.brow * 6;
        line(bx - 22, by - (dir < 0 ? inner : outer), bx + 22, by - (dir < 0 ? outer : inner));
    }

    // mouth — opens while speaking
    noFill(); stroke(INK); strokeWeight(4);
    const mo = pose.mouth * 26;
    if (mo > 3) { fill(INK); ellipse(0, 62, 46, 12 + mo); }
    else { line(-26, 62, 26, 62); }

    pop();

    // state pill under the face
    noStroke(); fill(accent);
    const pill = state.toUpperCase();
    textAlign(CENTER, CENTER); textSize(13);
    const pw = textWidth(pill) + 28;
    rectMode(CENTER); fill(accent);
    rect(cx, cy + 140, pw, 26, 13);
    fill('#fff'); text(pill, cx, cy + 139);
}

function drawReadout() {
    const x = 28, top = 396, colW = W - 2 * x;   // symmetric margins keep text on-canvas
    textAlign(LEFT, TOP);
    // drawFace() leaves rectMode(CENTER) set for its state pill; p5's text() box
    // respects rectMode, so without this the boxed you/robot lines get centred on
    // x and run off the left edge. Reset to CORNER before any boxed text.
    rectMode(CORNER);
    noStroke();

    // What you said (spoken or typed) — the prominent line.
    fill(GREY); textSize(11); text('YOU', x, top);
    fill(INK); textSize(14);
    text(lastUser || '—', x, top + 15, colW, 38);

    // What the robot said back.
    fill(GREY); textSize(11); text('ROBOT', x, top + 60);
    fill(INK); textSize(14);
    text(lastReply || '—', x, top + 75, colW, 44);

    // gesture + intensity
    fill(GREY); textSize(12);
    const gline = lastGesture ? `gesture: ${lastGesture}   intensity: ${lastIntensity.toFixed(2)}` : 'gesture: —';
    text(gline, x, top + 128);

    // timing line — the trip up to the response, broken into parts. STT only
    // appears when the turn came from the mic (typed turns skip speech→text).
    if (lastTiming) {
        fill(TEAL); textSize(12);
        const line = (lastTiming.stt != null)
            ? '⏱ stt ' + fmtDur(lastTiming.stt) + '  ·  think ' + fmtDur(lastTiming.think)
              + '  ·  total ' + fmtDur(lastTiming.total)
            : '⏱ think ' + fmtDur(lastTiming.think);
        text(line, x, top + 148);
    }

    // error line — only when the last turn fell back (bad model, no key, quota…).
    // Two lines tall, since messages like a 404 model error wrap past one.
    if (lastError) {
        fill(RED); textSize(12);
        text('⚠ ' + lastError, x, top + 168, colW, 32);
    }

    // hint — right-aligned, on the gesture line
    fill(GREY); textSize(12);
    const hint = !speechSupported
        ? 'No mic here (Chrome only) — type below and press Enter'
        : state === STATE.SPEAKING
            ? 'SPACE to interrupt and talk — or type'
            : 'SPACE to talk, or type below';
    textAlign(RIGHT, TOP);
    text(hint, W - x, top + 128);
    textAlign(LEFT, TOP);
}

// Format a millisecond duration: seconds (2 dp) at/above 1s, else whole ms.
function fmtDur(ms) {
    if (ms == null) return '—';
    return ms >= 1000 ? (ms / 1000).toFixed(2) + 's' : Math.round(ms) + 'ms';
}
