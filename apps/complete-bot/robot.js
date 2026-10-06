// ==============================================================
// robot.js — Pardalote adapter for the desk creature.
//
// Owns the hardware seam so sketch.js and brain.js never touch a servo. The
// student defines the ACTUATORS in the Physical Robot section of the page —
// add/remove them, pick each one's type (Bus servo / PWM servo / Stepper) and
// set its pins/ID — exactly like the Pardalote Gesture Builder's output setup.
// Each actuator is added to the board by name; a gesture plays on a GROUP built
// from whatever actuators exist, matched to the gesture's lanes BY NAME (so name
// a gesture lane `pan` to drive the actuator you named `pan`).
//
// The one method the rest of the app calls to move:
//   playGesture(name, scale, gaze, speed) -> Promise<{ name, duration }>
// It looks the gesture up in GESTURES (gestures.js), reshapes it by scale
// (amplitude) and speed (tempo) with the library's own modifiers, and plays it.
// It resolves when the motion lands, so callers can await/sequence it.
//
// When hardware is off (the Physical Robot box unticked) — or the board isn't
// connected yet — there is NO hardware: playGesture just resolves after the
// gesture's nominal duration, so the on-canvas face (sketch.js) animates on the
// same timing. The whole loop is testable with no board plugged in.
//
// NOTE: the on-screen face still reads gaze (currentGaze) but the actuators are
// now whatever the student wired, so the face is NOT mapped to them here.
// ==============================================================

const Robot = (() => {

    // --- actuator types (mirrors the Gesture Builder's OUTPUT_TYPES) ---
    // Each type knows how to make its library object, how to attach it, how to
    // hold it (torque/enable), and a sensible home value for park(). The `fields`
    // are the connection inputs shown in the UI (ID, or Pin, or STEP·DIR·EN).
    const ACTUATOR_TYPES = {
        busservo: {
            label: 'Bus servo', cls: 'BusServo', home: 2048,
            fields: [{ key: 'id', label: 'ID', min: 1, max: 253 }],
            make:   () => new BusServo(),
            attach: (s, a) => s.attach(a.id, 'ST'),
            hold:   (s) => { try { s.enableTorque(); } catch (e) {} },
        },
        servo: {
            label: 'PWM servo', cls: 'Servo', home: 90,
            fields: [{ key: 'pin', label: 'Pin', min: 0, max: 99 }],
            make:   () => new Servo(),
            attach: (s, a) => s.attach(a.pin),
            hold:   () => {},   // PWM servos always hold
        },
        stepper: {
            label: 'Stepper', cls: 'Stepper', home: 0,
            fields: [{ key: 'step', label: 'STEP', min: 0, max: 99 },
                     { key: 'dir',  label: 'DIR',  min: 0, max: 99 },
                     { key: 'en',   label: 'EN',   min: -1, max: 99 }],   // −1 = no EN pin
            make:   () => new Stepper(),
            attach: (s, a) => s.attach(a.step, a.dir, a.en),
            hold:   (s) => { try { s.enable(); } catch (e) {} },
        },
    };
    const typeOf = (a) => ACTUATOR_TYPES[a && a.type] || null;
    // Bound = a known type with every connection field filled in. Only bound
    // actuators are added to the board, attached, or driven.
    function isBound(a) {
        const t = typeOf(a);
        return !!(t && a.name && t.fields.every((f) => a[f.key] != null));
    }

    const toPin = (v, lo, hi) => {
        if (v == null || v === '') return null;
        let n = Math.round(Number(v));
        if (!Number.isFinite(n)) return null;
        if (lo != null) n = Math.max(lo, n);
        if (hi != null) n = Math.min(hi, n);
        return n;
    };
    const numOr = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

    // --- actuator definitions (persisted per browser) -----------------
    const ACT_STORE = 'plan-d-actuators';
    // Out of the box: the four creature joints as bus servos, so the authored
    // gestures (whose lanes are named pan/tilt/antL/antR) work with no setup. IDs
    // and bus pins come from config.js. Students then add/remove/retype freely.
    function defaultActuators() {
        const ids = CONFIG.SERVO_IDS || { pan: 1, tilt: 2, antL: 3, antR: 4 };
        return ['pan', 'tilt', 'antL', 'antR'].map((n) => ({
            name: n, type: 'busservo', id: ids[n] != null ? ids[n] : null,
            pin: null, step: null, dir: null, en: -1,
        }));
    }
    function defaultBus() { return { rx: numOr(CONFIG.BUS_RX, 18), tx: numOr(CONFIG.BUS_TX, 19) }; }
    function cleanActuator(a) {
        const type = ACTUATOR_TYPES[a && a.type] ? a.type : 'busservo';
        return {
            name: (typeof a.name === 'string' ? a.name : '').trim().slice(0, 40),
            type,
            id:   toPin(a.id,   1, 253),
            pin:  toPin(a.pin,  0, 99),
            step: toPin(a.step, 0, 99),
            dir:  toPin(a.dir,  0, 99),
            en:   a.en == null ? -1 : toPin(a.en, -1, 99),
        };
    }

    let bus = defaultBus();
    let actuators = loadActuators();
    function loadActuators() {
        try {
            const raw = JSON.parse(localStorage.getItem(ACT_STORE) || 'null');
            if (raw && Array.isArray(raw.items)) {
                if (raw.bus && typeof raw.bus === 'object') bus = { rx: toPin(raw.bus.rx), tx: toPin(raw.bus.tx) };
                return raw.items.map(cleanActuator);
            }
        } catch (e) {}
        return defaultActuators();
    }
    function persistActuators() {
        try { localStorage.setItem(ACT_STORE, JSON.stringify({ bus, items: actuators })); } catch (e) {}
    }
    const busPins = () => ({ rxPin: numOr(bus.rx, -1), txPin: numOr(bus.tx, -1) });

    // --- hardware state ------------------------------------------------
    let arduino = null;
    let group = null;             // rebuilt from the bound actuators on attach
    let conn = null;              // setupConnection() handle (row + status helpers)
    let hardwareBuilt = false;    // true once the Arduino/connection row exist
    let hardwareEnabled = false;  // true while the "use a physical robot" box is ticked
    let hardwareReady = false;    // true only once the board is connected + attached
    let busConfigSent = false;    // bus RX/TX is sent once per connection
    let onStatus = () => {};
    const gaze = { yaw: 0, pitch: 0 };

    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    // Amplitude / tempo levers from the LLM, straight into the library modifiers,
    // clamped so a wild value can't invert or stall the motion. Missing → 1.
    const scaleFor = (scale) => { const n = Number(scale); return Number.isFinite(n) ? Math.max(0.2, Math.min(1.5, n)) : 1.0; };
    const speedFor = (speed) => { const n = Number(speed); return Number.isFinite(n) ? Math.max(0.5, Math.min(2.0, n)) : 1.0; };

    // The longest lane's total time — for the no-hardware timing and the
    // whenDone() budget.
    function laneDuration(lanes) {
        let max = 0;
        for (const segs of Object.values(lanes)) {
            const total = segs.reduce((n, s) => n + Math.max(1, Math.round(s.dur || 0)), 0);
            if (total > max) max = total;
        }
        return max;
    }

    // --- public: gesture vocabulary -----------------------------------
    function gestureNames() { return Object.keys(GESTURES).filter((n) => !GESTURES[n].hidden); }
    function gestureCatalogue() { return gestureNames().map((n) => ({ name: n, desc: GESTURES[n].desc || '' })); }
    function hasGesture(name) { return Object.prototype.hasOwnProperty.call(GESTURES, name); }

    // --- public: actuator setup (for the UI in sketch.js) -------------
    function actuatorTypes() { return ACTUATOR_TYPES; }
    function getActuators() { return actuators.map((a) => ({ ...a })); }   // working copy for the UI
    function getBus() { return { ...bus }; }

    // Replace the whole actuator list (and bus pins) from the UI. Persists, and —
    // if the board is live — applies the change on the board straight away:
    // anything whose name went away is removed, and the current set is re-attached.
    function applyActuators(items, busCfg) {
        const prevNames = actuators.map((a) => a.name).filter(Boolean);
        actuators = (Array.isArray(items) ? items : []).map(cleanActuator);
        if (busCfg) bus = { rx: toPin(busCfg.rx), tx: toPin(busCfg.tx) };
        persistActuators();
        if (!arduino) return;                       // not built yet — applied on connect
        const live = new Set(actuators.map((a) => a.name));
        prevNames.forEach((n) => { if (!live.has(n)) dropName(n); });
        if (hardwareReady) resyncActuators();
    }

    // Restore the default actuators + bus pins (the four creature joints from
    // config.js), clearing the browser's saved setup. Applies on the board too
    // when live, like applyActuators. The UI re-reads getActuators()/getBus() after.
    function resetActuators() {
        const prevNames = actuators.map((a) => a.name).filter(Boolean);
        bus = defaultBus();
        actuators = defaultActuators();
        try { localStorage.removeItem(ACT_STORE); } catch (e) {}
        if (!arduino) return;
        const live = new Set(actuators.map((a) => a.name));
        prevNames.forEach((n) => { if (!live.has(n)) dropName(n); });
        if (hardwareReady) resyncActuators();
    }

    // --- setup / connection -------------------------------------------
    // Records the status callback; builds NO hardware (face-only until the box is
    // ticked). CONFIG.USE_ROBOT only seeds the checkbox's start state.
    function setup(statusCb) {
        onStatus = statusCb || onStatus;
        onStatus('face-only mode — tick “use a physical robot” to add a body');
    }

    // Build the Arduino + the standard Pardalote connection UI. Done once, the
    // first time hardware is enabled. Actuators are added here and re-added/attached
    // on 'ready'. sketch.js relocates conn.row into the Physical Robot section.
    function buildHardware() {
        if (hardwareBuilt) return true;
        if (typeof Arduino === 'undefined') { onStatus('Pardalote library not loaded'); return false; }
        arduino = new Arduino();
        ensureAllActuators();
        conn = setupConnection(arduino, {
            store: 'plan-d-robot',
            label: 'Robot',
            defaults: { ip: CONFIG.ROBOT_CONN || '192.168.x.x', transport: 'wifi' },
        });
        arduino.on('ready', onReady);
        arduino.on('disconnect', () => { hardwareReady = false; });
        hardwareBuilt = true;
        return true;
    }

    function enableHardware() {
        if (!buildHardware()) return null;
        hardwareEnabled = true;
        return conn;
    }
    function disableHardware() {
        hardwareEnabled = false;
        hardwareReady = false;
        if (arduino) { try { arduino.disconnect(); } catch (e) {} }
        onStatus('face-only mode — physical robot off');
    }
    function isHardwareEnabled() { return hardwareEnabled; }
    function connRow() { return conn ? conn.row : null; }

    // Board connected: (re)attach every bound actuator, (re)build the group, and
    // centre everything to home.
    function onReady() {
        busConfigSent = false;
        ensureAllActuators();
        resyncActuators();
        hardwareReady = true;
        const n = actuators.filter(isBound).length;
        onStatus(`ready — ${n} actuator${n === 1 ? '' : 's'}`);
        if (CONFIG.USE_EYES) initEyes();
        park();
    }

    // Make sure arduino[name] is an instance of this actuator's type (create or
    // replace if not). Unbound actuators get nothing — they never reach the board.
    function ensureActuator(a) {
        if (!arduino || !isBound(a)) return null;
        const t = typeOf(a);
        if (!arduino[a.name] || arduino[a.name].constructor.name !== t.cls) arduino.add(a.name, t.make());
        return arduino[a.name];
    }
    function ensureAllActuators() { actuators.forEach(ensureActuator); }
    // arduino.remove() detaches on the board AND frees the logical id for reuse.
    function dropName(name) { if (arduino && arduino[name]) { try { arduino.remove(name); } catch (e) {} } }

    // Attach + hold every bound actuator (bus config sent once, before the first
    // bus attach), then rebuild the play group.
    function resyncActuators() {
        for (const a of actuators) {
            const s = ensureActuator(a);
            if (!s) continue;
            const t = typeOf(a);
            if (a.type === 'busservo' && !busConfigSent) { try { s.configureBus(busPins()); } catch (e) {} busConfigSent = true; }
            try { t.attach(s, a); } catch (e) {}
            t.hold(s);
        }
        rebuildGroup();
    }
    function rebuildGroup() {
        if (!arduino) { group = null; return; }
        const members = {};
        for (const a of actuators) if (isBound(a) && arduino[a.name]) members[a.name] = arduino[a.name];
        group = Object.keys(members).length ? arduino.group('creature', members) : null;
    }

    function isReady() { return hardwareReady; }

    // --- gaze (on-screen face only) -----------------------------------
    function setGaze(g) {
        if (!g) return;
        if (typeof g.yaw === 'number')   gaze.yaw   = Math.max(-1, Math.min(1, g.yaw));
        if (typeof g.pitch === 'number') gaze.pitch = Math.max(-1, Math.min(1, g.pitch));
    }
    function currentGaze() { return { ...gaze }; }

    // Home targets for park(): each bound actuator's type default home.
    function homeTargets() {
        const t = {};
        for (const a of actuators) if (isBound(a)) t[a.name] = typeOf(a).home;
        return t;
    }

    // --- the one move method ------------------------------------------
    // Wrap a named authored gesture as a chainable library Gesture at full
    // amplitude, so callers can tune it before playing. Unknown names fall back
    // to the rest gesture.
    function gesture(name) {
        const g = GESTURES[name] || GESTURES[REST_GESTURE];
        return Gesture.from(g.lanes);
    }

    // Play a named gesture. Resolves { name, duration } when it lands. scale/speed
    // reshape the authored gesture via the library modifiers.
    async function playGesture(name, scale = 1, gazeBias = null, speed = 1) {
        const usedName = GESTURES[name] ? name : REST_GESTURE;
        const g = gesture(usedName).scale(scaleFor(scale)).speed(speedFor(speed));
        const { duration } = await play(g, gazeBias);
        return { name: usedName, duration };
    }

    // Play a Gesture (library object) or a raw lanes object on the current group.
    // group.gesture() matches lanes to actuators BY NAME and ignores lanes with no
    // actuator. Resolves { duration } when it lands. With no board / no actuators,
    // just waits the nominal duration so the on-screen face stays in step.
    async function play(input, gazeBias = null) {
        const duration = (input && typeof input.duration === 'function') ? input.duration() : laneDuration(input);
        if (gazeBias) setGaze(gazeBias);   // on-screen face only

        if (!hardwareReady || !group) { await wait(duration); return { duration }; }
        try {
            await group.gesture(input).whenDone({ timeout: duration + 1500 });
        } catch (e) {
            onStatus('gesture timed out (board busy?)');
        }
        return { duration };
    }

    // Return to a calm home pose. Awaitable.
    async function park() {
        if (!hardwareReady || !group) return;
        const home = homeTargets();
        if (!Object.keys(home).length) return;
        try { await group.writeTimed(home, 500).whenDone({ timeout: 1500 }); } catch (e) {}
    }

    // Halt motion immediately (barge-in): hold current position.
    function stop() {
        if (!hardwareReady) return;
        for (const a of actuators) { if (isBound(a) && arduino[a.name]) { try { arduino[a.name].stop(); } catch (e) {} } }
    }

    // --- optional NeoPixel "eyes" (guarded by USE_EYES) ---------------
    let eyes = null;
    function initEyes() {
        try { eyes = new NeoPixel(); arduino.add('eyes', eyes); eyes.attach(CONFIG.EYES_PIN, CONFIG.EYES_COUNT); }
        catch (e) { eyes = null; }
    }
    function setEyes(rgb) {
        if (!eyes) return;
        try { eyes.fill(rgb[0], rgb[1], rgb[2]); eyes.show(); } catch (e) {}
    }

    return {
        setup, isReady,
        enableHardware, disableHardware, isHardwareEnabled, connRow,
        actuatorTypes, getActuators, getBus, applyActuators, resetActuators,
        gesture, play, playGesture, park, stop,
        gestureNames, gestureCatalogue, hasGesture,
        currentGaze, setEyes,
        FILLER_GESTURE, REST_GESTURE,
    };
})();
