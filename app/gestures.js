// ==============================================================
// gestures.js — the robot's authored gesture vocabulary.
//
// THIS IS THE FILE YOU AUTHOR. Each entry is a named expressive motion for the
// desk creature (a tilting head + two antennas, driven by four Feetech ST bus
// servos). A gesture is a Pardalote SEGMENT SCHEDULE: per joint, an ordered
// list of eased segments the board plays on its own clock. See the Pardalote
// bus-servo `gesture()` docs — this is exactly what robot.js feeds to
// `group.gesture({ pan:[…], tilt:[…], antL:[…], antR:[…] })`.
//
// Joints (all in servo COUNTS, 0–4095, centre 2048):
//   pan   — head turn left/right   (+ = one way, − = the other)
//   tilt  — head nod up/down       (+ = up,  − = down)
//   antL  — left antenna           (+ = raise)
//   antR  — right antenna          (+ = raise)
//
// Each segment is { by, dur, curve }:
//   by     relative delta in counts (gestures are RELATIVE round-trips, so the
//          head returns to where it started — safe to fire from any pose).
//   dur    milliseconds for that segment.
//   curve  'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'back' (back = a
//          little overshoot — great for a lively settle).
//
// `build(scale)` receives an amplitude scale (robot.js derives it from the
// LLM's `intensity`, 0..1). Multiply your `by` values by it via amp() so the
// same gesture can be gentle or emphatic. Durations are NOT scaled — timing
// stays constant, only how far it moves changes.
//
// `hidden: true` keeps a gesture OUT of the list the LLM sees (used for the
// resting pose and the thinking-filler). `desc` is shown to the LLM so it can
// pick the right gesture for a reply — keep it a short, plain description of
// the FEELING the motion conveys.
//
// To add a gesture: copy a block, rename the key, write its segments, give it a
// `desc`. It appears in the model's enum automatically. No other file changes.
// ==============================================================

// Scale a count amplitude by the intensity scale and round to a whole count.
function amp(counts, scale) { return Math.round(counts * scale); }

const GESTURES = {

    // --- Hidden poses: never offered to the LLM ------------------------

    // Resting settle. robot.park() drives the joints to their true home; this
    // relative micro-settle just adds life when returning to rest.
    neutral: {
        hidden: true,
        desc: 'at rest, calm',
        build: (s) => ({
            tilt: [{ by: amp(30, s), dur: 260, curve: 'easeOut' }, { by: amp(-30, s), dur: 320, curve: 'easeInOut' }],
            antL: [{ by: amp(20, s), dur: 260, curve: 'easeOut' }, { by: amp(-20, s), dur: 320, curve: 'easeInOut' }],
            antR: [{ by: amp(20, s), dur: 260, curve: 'easeOut' }, { by: amp(-20, s), dur: 320, curve: 'easeInOut' }],
        }),
    },

    // Thinking filler — plays WHILE waiting for the LLM, to cover the ~1s of
    // latency. A slow, pondering antenna waggle with a tiny head bob. Net-zero.
    thinking: {
        hidden: true,
        desc: 'pondering, waiting',
        build: (s) => ({
            tilt: [
                { by: amp(-40, s), dur: 380, curve: 'easeInOut' },
                { by: amp(40, s), dur: 420, curve: 'easeInOut' },
            ],
            antL: [
                { by: amp(90, s), dur: 300, curve: 'easeOut' },
                { by: amp(-140, s), dur: 360, curve: 'easeInOut' },
                { by: amp(50, s), dur: 300, curve: 'easeInOut' },
            ],
            antR: [
                { by: amp(-90, s), dur: 300, curve: 'easeOut' },
                { by: amp(140, s), dur: 360, curve: 'easeInOut' },
                { by: amp(-50, s), dur: 300, curve: 'easeInOut' },
            ],
        }),
    },

    // --- Expressive vocabulary: offered to the LLM ---------------------

    curious_tilt: {
        desc: 'interested, curious — cocks its head and perks its antennas',
        build: (s) => ({
            pan: [{ by: amp(170, s), dur: 280, curve: 'easeOut' }, { by: 0, dur: 380, curve: 'linear' }, { by: amp(-170, s), dur: 320, curve: 'easeInOut' }],
            tilt: [{ by: amp(110, s), dur: 280, curve: 'back' }, { by: 0, dur: 380, curve: 'linear' }, { by: amp(-110, s), dur: 320, curve: 'easeInOut' }],
            antL: [{ by: amp(190, s), dur: 240, curve: 'back' }, { by: 0, dur: 420, curve: 'linear' }, { by: amp(-190, s), dur: 320, curve: 'easeInOut' }],
            antR: [{ by: amp(150, s), dur: 240, curve: 'back' }, { by: 0, dur: 420, curve: 'linear' }, { by: amp(-150, s), dur: 320, curve: 'easeInOut' }],
        }),
    },

    nod_yes: {
        desc: 'agreement, yes — nods its head',
        build: (s) => ({
            tilt: [
                { by: amp(-170, s), dur: 220, curve: 'easeOut' },
                { by: amp(170, s), dur: 260, curve: 'easeInOut' },
                { by: amp(-150, s), dur: 220, curve: 'easeInOut' },
                { by: amp(150, s), dur: 240, curve: 'back' },
            ],
            antL: [{ by: amp(-40, s), dur: 220, curve: 'easeOut' }, { by: amp(40, s), dur: 720, curve: 'easeInOut' }],
            antR: [{ by: amp(-40, s), dur: 220, curve: 'easeOut' }, { by: amp(40, s), dur: 720, curve: 'easeInOut' }],
        }),
    },

    shake_no: {
        desc: 'disagreement, no — shakes its head side to side',
        build: (s) => ({
            pan: [
                { by: amp(180, s), dur: 200, curve: 'easeOut' },
                { by: amp(-360, s), dur: 300, curve: 'easeInOut' },
                { by: amp(360, s), dur: 300, curve: 'easeInOut' },
                { by: amp(-180, s), dur: 220, curve: 'easeInOut' },
            ],
        }),
    },

    perk_up: {
        desc: 'delight, excitement, alert — snaps its head up and antennas high',
        build: (s) => ({
            tilt: [{ by: amp(200, s), dur: 200, curve: 'back' }, { by: 0, dur: 420, curve: 'linear' }, { by: amp(-200, s), dur: 340, curve: 'easeInOut' }],
            antL: [{ by: amp(280, s), dur: 180, curve: 'back' }, { by: 0, dur: 440, curve: 'linear' }, { by: amp(-280, s), dur: 340, curve: 'easeInOut' }],
            antR: [{ by: amp(280, s), dur: 180, curve: 'back' }, { by: 0, dur: 440, curve: 'linear' }, { by: amp(-280, s), dur: 340, curve: 'easeInOut' }],
        }),
    },

    droop: {
        desc: 'sadness, disappointment — head sinks and antennas fall',
        build: (s) => ({
            tilt: [{ by: amp(-210, s), dur: 520, curve: 'easeIn' }, { by: 0, dur: 380, curve: 'linear' }, { by: amp(210, s), dur: 520, curve: 'easeInOut' }],
            antL: [{ by: amp(-240, s), dur: 560, curve: 'easeIn' }, { by: 0, dur: 340, curve: 'linear' }, { by: amp(240, s), dur: 520, curve: 'easeInOut' }],
            antR: [{ by: amp(-240, s), dur: 560, curve: 'easeIn' }, { by: 0, dur: 340, curve: 'linear' }, { by: amp(240, s), dur: 520, curve: 'easeInOut' }],
        }),
    },

    excited_wiggle: {
        desc: 'playful, giddy joy — antennas wiggle and head bounces',
        build: (s) => ({
            tilt: [
                { by: amp(80, s), dur: 140, curve: 'easeOut' }, { by: amp(-80, s), dur: 160, curve: 'easeInOut' },
                { by: amp(80, s), dur: 140, curve: 'easeOut' }, { by: amp(-80, s), dur: 160, curve: 'easeInOut' },
            ],
            antL: [
                { by: amp(180, s), dur: 120, curve: 'easeOut' }, { by: amp(-180, s), dur: 130, curve: 'easeInOut' },
                { by: amp(180, s), dur: 120, curve: 'easeOut' }, { by: amp(-180, s), dur: 130, curve: 'easeInOut' },
            ],
            antR: [
                { by: amp(-180, s), dur: 120, curve: 'easeOut' }, { by: amp(180, s), dur: 130, curve: 'easeInOut' },
                { by: amp(-180, s), dur: 120, curve: 'easeOut' }, { by: amp(180, s), dur: 130, curve: 'easeInOut' },
            ],
        }),
    },

    look_around: {
        desc: 'searching, scanning, unsure — sweeps its gaze left then right',
        build: (s) => ({
            pan: [
                { by: amp(-280, s), dur: 340, curve: 'easeInOut' },
                { by: 0, dur: 320, curve: 'linear' },
                { by: amp(560, s), dur: 480, curve: 'easeInOut' },
                { by: 0, dur: 320, curve: 'linear' },
                { by: amp(-280, s), dur: 340, curve: 'easeInOut' },
            ],
            antL: [{ by: amp(60, s), dur: 340, curve: 'easeOut' }, { by: amp(-60, s), dur: 1460, curve: 'easeInOut' }],
            antR: [{ by: amp(60, s), dur: 340, curve: 'easeOut' }, { by: amp(-60, s), dur: 1460, curve: 'easeInOut' }],
        }),
    },
};

// Which hidden gestures serve which role (referenced by robot.js / sketch.js).
const FILLER_GESTURE = 'thinking';   // played during the LLM wait
const REST_GESTURE   = 'neutral';    // the calm resting settle
