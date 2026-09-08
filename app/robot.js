// ==============================================================
// robot.js — thin Pardalote adapter for the desk creature.
//
// Owns the hardware seam so sketch.js and brain.js never touch a servo. Four
// Feetech ST bus servos on one UART (pan, tilt, antL, antR), driven together
// through a Pardalote GROUP so a gesture's joints move and arrive phase-locked.
//
// The one method the rest of the app calls to move:
//   playGesture(name, intensity, gaze) -> Promise<{ name, duration }>
// It looks the gesture up in GESTURES (gestures.js), scales it by intensity,
// biases the head toward `gaze` (optional), and plays it via group.gesture().
// It resolves when the motion lands, so callers can await/sequence it.
//
// When USE_ROBOT is false — or the board simply isn't connected yet — there is
// NO hardware: playGesture just resolves after the gesture's nominal duration,
// so the on-canvas face (sketch.js) animates on the same timing. The whole loop
// is testable with no board plugged in.
//
// Safety: on-board soft limits (setLimits) are set per joint at ready, so the
// LLM — or a buggy gesture — can never drive a joint past its safe range. The
// board enforces them; the browser can't override them.
// ==============================================================

const Robot = (() => {
    // Per-joint config. Homes are the centre of each joint's safe travel; the
    // soft limits are set ON THE BOARD from min/max. gaze* map the LLM's gaze
    // (-1..1) onto a count offset from home for the two head joints.
    const JOINTS = {
        pan:  { home: 2048, min: 1550, max: 2550, gazeAxis: 'yaw',   gazeRange: 380 },
        tilt: { home: 2048, min: 1650, max: 2450, gazeAxis: 'pitch', gazeRange: 260 },
        antL: { home: 2048, min: 1650, max: 2450 },
        antR: { home: 2048, min: 1650, max: 2450 },
    };
    const JOINT_NAMES = Object.keys(JOINTS);

    let arduino = null;
    let group = null;
    let conn = null;              // setupConnection() handle (for status text)
    let hardwareReady = false;    // true only once the board is connected + attached
    let onStatus = () => {};      // set by sketch.js to surface connection status
    const gaze = { yaw: 0, pitch: 0 };

    const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    // Amplitude scale from the LLM's intensity: even a low intensity still
    // reads as motion (floor ~0.4), a high one is emphatic (~1.15 at 1.0).
    const scaleFor = (intensity) => 0.4 + 0.75 * clamp01(intensity);

    // The longest lane's total time — how long the whole gesture takes. Used
    // for the no-hardware timing and as the whenDone() timeout budget.
    function laneDuration(lanes) {
        let max = 0;
        for (const segs of Object.values(lanes)) {
            const total = segs.reduce((n, s) => n + Math.max(1, Math.round(s.dur || 0)), 0);
            if (total > max) max = total;
        }
        return max;
    }

    // --- public: names -------------------------------------------------
    // Visible (non-hidden) gesture names — the LLM's allowed vocabulary. Built
    // from GESTURES at runtime so the enum can never drift from what exists.
    function gestureNames() {
        return Object.keys(GESTURES).filter((n) => !GESTURES[n].hidden);
    }
    // Visible names with their descriptions, for the system prompt.
    function gestureCatalogue() {
        return gestureNames().map((n) => ({ name: n, desc: GESTURES[n].desc || '' }));
    }
    function hasGesture(name) { return Object.prototype.hasOwnProperty.call(GESTURES, name); }

    // --- setup / connection -------------------------------------------
    // Called once from sketch.js setup(). When useHardware, builds the Arduino,
    // the four bus servos, the group, and the standard Pardalote connection UI
    // (WiFi / USB row). Pins/IDs come from CONFIG. When useHardware is false,
    // does nothing — the app runs face-only.
    function setup(useHardware, statusCb) {
        onStatus = statusCb || onStatus;
        if (!useHardware) { onStatus('face-only mode (USE_ROBOT = false)'); return; }
        if (typeof Arduino === 'undefined') { onStatus('Pardalote library not loaded'); return; }

        arduino = new Arduino();
        JOINT_NAMES.forEach((name) => arduino.add(name, new BusServo()));
        group = arduino.group('creature', {
            pan: arduino.pan, tilt: arduino.tilt, antL: arduino.antL, antR: arduino.antR,
        });

        // Standard Pardalote connect UI, seeded from CONFIG. Students connect
        // exactly as in the other examples (enter IP / pick USB, press Connect).
        conn = setupConnection(arduino, {
            store: 'plan-d-robot',
            label: 'Robot',
            defaults: { ip: CONFIG.ROBOT_CONN || '192.168.x.x', transport: 'wifi' },
        });

        arduino.on('ready', onReady);
        arduino.on('disconnect', () => { hardwareReady = false; });
    }

    // Board connected: open the bus, attach each servo to its ID, clamp it with
    // an on-board soft limit, and centre it. After this, gestures play locally.
    function onReady() {
        // Bus UART pins (ESP32). Ignored on a UNO R4 (fixed Serial1 = D0/D1).
        arduino.pan.configureBus({ rxPin: CONFIG.BUS_RX, txPin: CONFIG.BUS_TX });

        JOINT_NAMES.forEach((name) => {
            const j = JOINTS[name];
            const s = arduino[name];
            s.attach(CONFIG.SERVO_IDS[name], 'ST');
            s.setLimits(j.min, j.max);   // SAFETY: enforced on the board
            s.enableTorque();
        });

        // Centre everything to a known home before the first gesture.
        group.writeTimed(homeTargets(), 600);
        hardwareReady = true;
        onStatus(`ready — servos ${JOINT_NAMES.map((n) => CONFIG.SERVO_IDS[n]).join(', ')}`);

        if (CONFIG.USE_EYES) initEyes();
    }

    function isReady() { return hardwareReady; }

    // --- gaze / home ---------------------------------------------------
    function homeTargets() {
        return { pan: JOINTS.pan.home, tilt: JOINTS.tilt.home, antL: JOINTS.antL.home, antR: JOINTS.antR.home };
    }
    // Head targets biased by the current gaze (antennas stay home). The board's
    // soft limits still clamp these, so gaze can never push past range either.
    function gazeHeadTargets() {
        return {
            pan:  Math.round(JOINTS.pan.home  + gaze.yaw   * JOINTS.pan.gazeRange),
            tilt: Math.round(JOINTS.tilt.home + gaze.pitch * JOINTS.tilt.gazeRange),
        };
    }
    function setGaze(g) {
        if (!g) return;
        if (typeof g.yaw === 'number')   gaze.yaw   = Math.max(-1, Math.min(1, g.yaw));
        if (typeof g.pitch === 'number') gaze.pitch = Math.max(-1, Math.min(1, g.pitch));
    }
    // Current gaze (for the on-canvas face to mirror where the head is looking).
    function currentGaze() { return { ...gaze }; }

    // --- the one move method ------------------------------------------
    // Play a named gesture. Resolves { name, duration } when it lands.
    async function playGesture(name, intensity = 0.6, gazeBias = null) {
        const g = GESTURES[name] || GESTURES[REST_GESTURE];
        const usedName = GESTURES[name] ? name : REST_GESTURE;
        const lanes = g.build(scaleFor(intensity));
        const duration = laneDuration(lanes);

        if (gazeBias) setGaze(gazeBias);

        if (!hardwareReady) {
            // No board: keep the loop's timing honest so the face animates right.
            await wait(duration + (gazeBias ? 200 : 0));
            return { name: usedName, duration };
        }

        // Orient the head toward the person first (quick), then play the
        // relative gesture on top of that pose. Antennas are unaffected by gaze.
        if (gazeBias) {
            try { await group.writeTimed(gazeHeadTargets(), 200).whenDone({ timeout: 1200 }); }
            catch (e) { /* a slow/again move shouldn't block the gesture */ }
        }
        try {
            await group.gesture(lanes).whenDone({ timeout: duration + 1500 });
        } catch (e) {
            onStatus('gesture timed out (board busy?)');
        }
        return { name: usedName, duration };
    }

    // Return to a calm home pose, biased by the last gaze. Awaitable.
    async function park() {
        if (!hardwareReady) return;
        try {
            await group.writeTimed({ ...homeTargets(), ...gazeHeadTargets() }, 500).whenDone({ timeout: 1500 });
        } catch (e) { /* ignore */ }
    }

    // Halt motion immediately (barge-in): hold current position.
    function stop() {
        if (!hardwareReady) return;
        JOINT_NAMES.forEach((n) => { try { arduino[n].stop(); } catch (e) {} });
    }

    // --- optional NeoPixel "eyes" (guarded by USE_EYES) ----------------
    let eyes = null;
    function initEyes() {
        try {
            eyes = new NeoPixel();
            arduino.add('eyes', eyes);
            eyes.attach(CONFIG.EYES_PIN, CONFIG.EYES_COUNT);
        } catch (e) { eyes = null; }
    }
    // Set both eyes to an [r,g,b] colour (used by sketch.js for state feedback).
    function setEyes(rgb) {
        if (!eyes) return;
        try { eyes.fill(rgb[0], rgb[1], rgb[2]); eyes.show(); } catch (e) {}
    }

    return {
        setup, isReady,
        playGesture, park, stop,
        gestureNames, gestureCatalogue, hasGesture,
        currentGaze, setEyes,
        FILLER_GESTURE, REST_GESTURE,
    };
})();
