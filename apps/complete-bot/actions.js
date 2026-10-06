// ==============================================================
// actions.js — what each field of the model's reply DOES.
//
// The model returns ONE JSON object, shaped by the Response Schema panel. For
// every field in that reply, if a handler with the SAME NAME exists here, it
// runs. A field with no handler is simply ignored — so you can add a field to
// the schema to experiment, then add a handler here to give it an effect. This
// is the seam between "what the model says" and "what the robot does".
//
// A handler is:   (value, reply) => void | Promise
//   value   this field's value from the reply
//   reply   the whole reply object (so e.g. `gesture` can read scale/speed/gaze)
// Return a Promise if the action takes time (speaking, playing a gesture); the
// turn waits for every returned promise before it goes back to idle.
//
// To add a behaviour:
//   1. Add the field to the schema in the Response Schema panel (so the model
//      fills it in — give it a `description` so the model knows what to send).
//   2. Add a handler with that field's name to HANDLERS below.
//
// These handlers call functions that live in sketch.js (speak, startFaceGesture,
// showReply, …) and robot.js (Robot.playGesture) — everything shares one global
// scope, and handlers only run mid-turn, long after every file has loaded.
// ==============================================================

const Actions = (() => {

    // fieldName -> (value, reply) => void | Promise
    const HANDLERS = {

        // Say the reply out loud (and show it in the on-screen readout).
        speech(value) {
            showReply(String(value || ''));
            return speak(String(value || ''));
        },

        // Play an expressive gesture on the face AND the robot. Reads its sibling
        // levers from the reply: scale (size), speed (tempo), gaze (glance).
        // robot.js clamps scale/speed/gaze and falls back to a safe gesture if the
        // name isn't one that exists, so an edited schema can't drive junk.
        gesture(value, reply) {
            const name  = String(value || '');
            const scale = Number(reply.scale);
            const speed = Number(reply.speed);
            const gaze  = reply.gaze || null;
            showGesture(name, scale, speed);
            startFaceGesture(name, gestureDurationGuess(name, speed || 1));
            return Robot.playGesture(name, scale, gaze, speed);
        },

        // OPTIONAL on-screen expression — NOT in the default schema. Add an
        // `expression` field to the schema (e.g. { type:'string', enum:
        // ['perk_up','droop','curious_tilt','thinking','neutral'] }) and the face
        // will strike that pose. A worked example of wiring a brand-new field to
        // an effect — here, an on-screen expression rather than a robot move.
        expression(value) {
            startFaceGesture(String(value || 'neutral'), 1200);
        },

        // scale / speed / gaze deliberately have NO handler of their own — the
        // `gesture` handler above reads them. (A field with no handler is ignored,
        // so leaving them out here is exactly right.)
    };

    // Run every handler whose field is present in the reply, collecting the ones
    // that return a promise so the caller can await them together. Unknown fields
    // (no handler) are skipped; a throwing handler is logged, not fatal.
    function run(reply) {
        if (!reply || typeof reply !== 'object') return Promise.resolve();
        const pending = [];
        for (const field of Object.keys(reply)) {
            const fn = HANDLERS[field];
            if (typeof fn !== 'function') continue;        // unknown field → ignored
            try {
                const r = fn(reply[field], reply);
                if (r && typeof r.then === 'function') pending.push(r);
            } catch (e) {
                console.warn('[actions] handler for "' + field + '" threw:', e);
            }
        }
        return Promise.all(pending);
    }

    // The field names that currently have a handler (handy for debugging).
    function fields() { return Object.keys(HANDLERS); }

    return { run, fields };
})();
