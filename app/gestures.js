// ==============================================================
// gestures.js — the robot's authored gesture vocabulary.
//
// THIS IS THE FILE YOU AUTHOR. Each entry is a named expressive motion for the
// desk creature (a tilting head + two antennas, driven by four Feetech ST bus
// servos). A gesture is a Pardalote SEGMENT SCHEDULE: per joint, an ordered list
// of eased segments the board plays on its own clock. robot.js wraps each entry's
// `lanes` in a Pardalote Gesture and plays it with `group.gesture(...)`.
//
// Author at FULL amplitude — the size you'd want at maximum energy. You do NOT
// scale here any more: robot.js reshapes the gesture at play time with the
// library's own modifiers —
//   • scale → Gesture.scale()  (how big the movement is; from the LLM, ~0.3–1.5, 1 = as authored)
//   • speed → Gesture.speed()  (how fast; from the LLM, ~0.5–2.0, 1 = normal)
// so one authored gesture covers gentle↔emphatic and calm↔snappy on its own.
//
// Joints (all in servo COUNTS, 0–4095, centre 2048). NOTE: this build's head is
// mounted UPSIDE DOWN, so the vertical joints are authored inverted from the
// natural sense — for tilt/antL/antR, a POSITIVE `by` moves DOWN / lowers. pan
// (horizontal) is unaffected. Flip the vertical signs back if you remount.
//   pan   — head turn left/right   (+ = one way, − = the other)
//   tilt  — head nod up/down       (+ = DOWN, − = up)   ← inverted (upside-down mount)
//   antL  — left antenna           (+ = LOWER)          ← inverted
//   antR  — right antenna          (+ = LOWER)          ← inverted
//
// Each segment is { by, dur, curve }:
//   by     relative delta in counts (gestures are RELATIVE round-trips, so the
//          head returns to where it started — safe to fire from any pose).
//          Because scale multiplies these deltas, keep gestures relative.
//   dur    milliseconds for that segment (speed divides this at play time).
//   curve  'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'back' (back = a
//          little overshoot — great for a lively settle).
//
// `hidden: true` keeps a gesture OUT of the list the LLM sees (used for the
// resting pose and the thinking-filler). `desc` is shown to the LLM so it can
// pick the right gesture for a reply — keep it a short, plain description of
// the FEELING the motion conveys.
//
// To add a gesture: copy a block, rename the key, write its `lanes` segments,
// give it a `desc`. It appears in the model's enum automatically. No other file
// changes.
// ==============================================================

const GESTURES = {

    // --- Hidden poses: never offered to the LLM ------------------------

    // Resting settle. robot.park() drives the joints to their true home; this
    // relative micro-settle just adds life when returning to rest.
    neutral: {
        hidden: true,
        desc: 'at rest, calm',
        lanes: {
            tilt: [{ by: -30, dur: 260, curve: 'easeOut' }, { by: 30, dur: 320, curve: 'easeInOut' }],
            antL: [{ by: -20, dur: 260, curve: 'easeOut' }, { by: 20, dur: 320, curve: 'easeInOut' }],
            antR: [{ by: -20, dur: 260, curve: 'easeOut' }, { by: 20, dur: 320, curve: 'easeInOut' }],
        },
    },

    // Thinking filler — plays WHILE waiting for the LLM, to cover the ~1s of
    // latency. A slow, pondering antenna waggle with a tiny head bob. Net-zero.
    thinking: {
        hidden: true,
        desc: 'pondering, waiting',
        lanes: {
            tilt: [
                { by: 40, dur: 380, curve: 'easeInOut' },
                { by: -40, dur: 420, curve: 'easeInOut' },
            ],
            antL: [
                { by: -90, dur: 300, curve: 'easeOut' },
                { by: 140, dur: 360, curve: 'easeInOut' },
                { by: -50, dur: 300, curve: 'easeInOut' },
            ],
            antR: [
                { by: 90, dur: 300, curve: 'easeOut' },
                { by: -140, dur: 360, curve: 'easeInOut' },
                { by: 50, dur: 300, curve: 'easeInOut' },
            ],
        },
    },

    // --- Expressive vocabulary: offered to the LLM ---------------------

    curious_tilt: {
        desc: 'interested, curious — cocks its head and perks its antennas',
        lanes: {
            pan: [{ by: 170, dur: 280, curve: 'easeOut' }, { by: 0, dur: 380, curve: 'linear' }, { by: -170, dur: 320, curve: 'easeInOut' }],
            tilt: [{ by: -110, dur: 280, curve: 'back' }, { by: 0, dur: 380, curve: 'linear' }, { by: 110, dur: 320, curve: 'easeInOut' }],
            antL: [{ by: -190, dur: 240, curve: 'back' }, { by: 0, dur: 420, curve: 'linear' }, { by: 190, dur: 320, curve: 'easeInOut' }],
            antR: [{ by: -150, dur: 240, curve: 'back' }, { by: 0, dur: 420, curve: 'linear' }, { by: 150, dur: 320, curve: 'easeInOut' }],
        },
    },

    // Every primary beat is the same duration, so the modifiers read cleanly:
    // crop lands on beat boundaries, speed scales evenly, scale keeps the beats
    // proportional. Net-zero (returns home).
    nod_yes: {
        desc: 'agreement, yes — nods its head twice and settles',
        lanes: {
            // A double nod that decays into a small back-settle. Four equal 260ms
            // beats → crop quarters = down / up / down / settle.
            tilt: [
                { by: 190, dur: 260, curve: 'easeInOut' },   // down
                { by: -190, dur: 260, curve: 'easeInOut' },   // up
                { by: 130, dur: 260, curve: 'easeInOut' },   // down (smaller)
                { by: -130, dur: 260, curve: 'back' },        // up + overshoot settle
            ],
            // Antennas perk on the first beat then relax over the rest — secondary
            // motion for life; padded to arrive with the tilt lane.
            antL: [{ by: -35, dur: 260, curve: 'easeOut' }, { by: 35, dur: 780, curve: 'easeInOut' }],
            antR: [{ by: -35, dur: 260, curve: 'easeOut' }, { by: 35, dur: 780, curve: 'easeInOut' }],
        },
    },

    shake_no: {
        desc: 'disagreement, no — shakes its head side to side',
        lanes: {
            // Centre → right → full left → full right → back to centre: two full
            // crossings. Four equal 260ms beats keep the modifiers legible.
            pan: [
                { by: 180, dur: 260, curve: 'easeInOut' },   // to the right
                { by: -360, dur: 260, curve: 'easeInOut' },   // swing left
                { by: 360, dur: 260, curve: 'easeInOut' },   // swing right
                { by: -180, dur: 260, curve: 'easeInOut' },   // back to centre
            ],
        },
    },

    perk_up: {
        desc: 'delight, excitement, alert — snaps its head up and antennas high',
        lanes: {
            tilt: [{ by: -200, dur: 200, curve: 'back' }, { by: 0, dur: 420, curve: 'linear' }, { by: 200, dur: 340, curve: 'easeInOut' }],
            antL: [{ by: -280, dur: 180, curve: 'back' }, { by: 0, dur: 440, curve: 'linear' }, { by: 280, dur: 340, curve: 'easeInOut' }],
            antR: [{ by: -280, dur: 180, curve: 'back' }, { by: 0, dur: 440, curve: 'linear' }, { by: 280, dur: 340, curve: 'easeInOut' }],
        },
    },

    droop: {
        desc: 'sadness, disappointment — head sinks and antennas fall',
        lanes: {
            tilt: [{ by: 210, dur: 520, curve: 'easeIn' }, { by: 0, dur: 380, curve: 'linear' }, { by: -210, dur: 520, curve: 'easeInOut' }],
            antL: [{ by: 240, dur: 560, curve: 'easeIn' }, { by: 0, dur: 340, curve: 'linear' }, { by: -240, dur: 520, curve: 'easeInOut' }],
            antR: [{ by: 240, dur: 560, curve: 'easeIn' }, { by: 0, dur: 340, curve: 'linear' }, { by: -240, dur: 520, curve: 'easeInOut' }],
        },
    },

    excited_wiggle: {
        desc: 'playful, giddy joy — antennas wiggle and head bounces',
        lanes: {
            tilt: [
                { by: -80, dur: 140, curve: 'easeOut' }, { by: 80, dur: 160, curve: 'easeInOut' },
                { by: -80, dur: 140, curve: 'easeOut' }, { by: 80, dur: 160, curve: 'easeInOut' },
            ],
            antL: [
                { by: -180, dur: 120, curve: 'easeOut' }, { by: 180, dur: 130, curve: 'easeInOut' },
                { by: -180, dur: 120, curve: 'easeOut' }, { by: 180, dur: 130, curve: 'easeInOut' },
            ],
            antR: [
                { by: 180, dur: 120, curve: 'easeOut' }, { by: -180, dur: 130, curve: 'easeInOut' },
                { by: 180, dur: 120, curve: 'easeOut' }, { by: -180, dur: 130, curve: 'easeInOut' },
            ],
        },
    },

    look_around: {
        desc: 'searching, scanning, unsure — sweeps its gaze left then right',
        lanes: {
            pan: [
                { by: -280, dur: 340, curve: 'easeInOut' },
                { by: 0, dur: 320, curve: 'linear' },
                { by: 560, dur: 480, curve: 'easeInOut' },
                { by: 0, dur: 320, curve: 'linear' },
                { by: -280, dur: 340, curve: 'easeInOut' },
            ],
            antL: [{ by: -60, dur: 340, curve: 'easeOut' }, { by: 60, dur: 1460, curve: 'easeInOut' }],
            antR: [{ by: -60, dur: 340, curve: 'easeOut' }, { by: 60, dur: 1460, curve: 'easeInOut' }],
        },
    },
};

// Which hidden gestures serve which role (referenced by robot.js / sketch.js).
const FILLER_GESTURE = 'thinking';   // played during the LLM wait
const REST_GESTURE   = 'neutral';    // the calm resting settle
