// ==============================================================
// config.example.js — copy this file to "config.js" and fill it in.
//
//   1. Copy this file to  config.js  (same folder).
//   2. Set the class relay URL (PROXY_URL) below.
//   3. NEVER commit config.js and NEVER put it on a public web page.
//      (config.js is already in .gitignore.)
//
// config.js must load BEFORE gestures.js / robot.js / brain.js / sketch.js —
// index.html already does that.
// ==============================================================

// --- Your Gemini key -------------------------------------------------
// You DON'T need to put your key here — paste it into the "Key" field on the
// page instead (it's remembered in your browser, never in a file). Leaving this
// blank is the normal, safest setup. A teacher running their own copy may
// optionally pre-fill a key here; the page's field always wins if both are set.
const GEMINI_KEY = '';

// The class's shared keyless relay URL (deployed from ../files — your teacher
// provides this). The browser sends YOUR key in a header; quota is per-student.
const PROXY_URL = 'https://gemini-relay.YOUR-SUBDOMAIN.workers.dev';

// --- Everything else lives on CONFIG ----------------------------------
const CONFIG = {
    // Gemini model. Model names change and OLD ONES GET RETIRED — e.g.
    // gemini-2.5-flash now returns 404 "no longer available to new users". If
    // replies stop working, this is the first thing to check. Current names:
    // https://ai.google.dev/gemini-api/docs/models
    GEMINI_MODEL: 'gemini-3.6-flash',

    // Gemini 3 "thinking" level: 'minimal' | 'low' | 'medium' | 'high'. Low
    // keeps replies snappy (this is a fast back-and-forth), which matters for
    // the ~1s latency the thinking-filler gesture is covering.
    // (Also switchable live from the Thinking dropdown on the page.)
    THINKING_LEVEL: 'low',

    // Speech (Web Speech API — Chrome). (Also switchable live from the Voice
    // dropdown on the page.)
    SPEECH_LANG: 'en-US',

    // --- Robot -------------------------------------------------------
    // false = on-canvas face only, no hardware (great for testing the loop).
    // true  = drive the real bus servos (connect via the Robot row on the page).
    USE_ROBOT: false,

    // Where the board is. WiFi: its IP (e.g. '192.168.1.42'). You can also just
    // pick USB on the page and press Connect — this only seeds the field.
    ROBOT_CONN: '192.168.x.x',

    // Feetech ST bus-servo IDs for the four joints (set unique IDs on the
    // servos first). Assumed 1/2/3/4 — confirm against your build.
    SERVO_IDS: { pan: 1, tilt: 2, antL: 3, antR: 4 },

    // ESP32 bus-UART pins. Ignored on a UNO R4 (fixed to Serial1 = D0/D1).
    BUS_RX: 18,
    BUS_TX: 19,

    // --- Optional NeoPixel "eyes" for state feedback -----------------
    USE_EYES: false,
    EYES_PIN: 5,
    EYES_COUNT: 2,
};
