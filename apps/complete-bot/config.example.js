// ==============================================================
// config.example.js — copy this file to "config.js" and fill it in.
//
//   1. Copy this file to  config.js  (same folder).
//   2. Set the class relay subdomain (WORKERS_SUBDOMAIN) below.
//   3. NEVER commit config.js and NEVER put it on a public web page.
//      (config.js is already in .gitignore.)
//
// Your API KEY does NOT go in this file. You paste it into the "Key" field on the
// page, where it's kept in your browser only — never in code. This file holds
// only non-secret settings (the relay subdomain and the options below).
//
// config.js must load BEFORE gestures.js / robot.js / brain.js / sketch.js —
// index.html already does that.
// ==============================================================

// Your Cloudflare workers.dev subdomain — the one-time, per-account name in your
// relay URLs (https://<worker>.<THIS>.workers.dev). BOTH relay URLs below are
// built from it, so set it in ONE place. Find it under Workers & Pages in the
// Cloudflare dashboard, or in the URL that `wrangler deploy` prints.
const WORKERS_SUBDOMAIN = 'YOUR-SUBDOMAIN';

// The class's shared KEYLESS relays (deployed from ../files/<name>). The browser
// sends YOUR own key in a header and the relay forwards it, so quota is
// per-student. Both workers live on the same subdomain; only the name differs.
//   • Gemini — relays to Google.
//   • Val    — Val sends no CORS headers, so the browser reaches it through this
//              relay (forwards your own Val key). Only needed for the Val provider.
// (Groq needs no relay — it's called directly with your Groq key.)
const PROXY_URL     = `https://gemini-relay.${WORKERS_SUBDOMAIN}.workers.dev`;
const VAL_PROXY_URL = `https://val-relay.${WORKERS_SUBDOMAIN}.workers.dev`;

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
    SPEECH_LANG: 'en-AU',

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
