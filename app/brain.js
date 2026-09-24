// ==============================================================
// brain.js — the LLM turn: user text -> a BehaviorDirective.
//
// askGeminiForGesture(userText, history) builds a JSON schema whose `gesture`
// enum is the robot's AUTHORED gesture names (from Robot.gestureCatalogue()),
// so the model can only ever pick a gesture that exists. It calls Gemini's
// generateContent through the keyless relay (PROXY_URL from config.js) using the
// student's own key from the page's Key field (getKey, saved per-browser),
// parses the structured JSON, and returns:
//
//   { speech, gesture, scale, speed, gaze }   // scale ~0.3–1.5, speed ~0.5–2.0; gaze optional { yaw, pitch }
//
// On any failure (network, non-OK, bad JSON, an out-of-vocab gesture) it logs
// and returns a SAFE fallback directive — never throws, never an unknown move.
//
// Why generateContent (not the Interactions API): the Interactions client adds
// an Api-Revision header that triggers a CORS preflight the Gemini host
// rejects, so it can't be called from a browser. generateContent has no such
// problem and is what the relay forwards.
// ==============================================================

const Brain = (() => {

    // --- the student's API key ----------------------------------------
    // The key lives in the page's Key field, remembered in THIS browser only
    // (localStorage) — never in a committed file. getKey() falls back to a
    // GEMINI_KEY in config.js if one is set (handy for the teacher's own copy),
    // so nothing breaks if the field is left blank but config has a key.
    const KEY_STORE = 'plan-d-gemini-key';
    function getKey() {
        try { const k = localStorage.getItem(KEY_STORE); if (k) return k; } catch (e) {}
        return (typeof GEMINI_KEY === 'string' ? GEMINI_KEY : '');
    }
    function setKey(v) {
        try { localStorage.setItem(KEY_STORE, (v || '').trim()); } catch (e) {}
    }

    // thinkingLevel is a GEMINI 3 feature. Gemini 2.5 used a different, numeric
    // setting (thinkingBudget) and Gemma has no thinking at all — sending
    // thinkingLevel to those is an unknown field (a 400). Match gemini-3.x /
    // gemini-3-… and the "-latest" aliases (which currently resolve to Gemini 3).
    function supportsThinkingLevel(model) {
        const m = String(model || '');
        return /^gemini-3[.-]/.test(m) || /-latest$/.test(m);
    }

    // --- the system prompt, in editable parts -------------------------
    // The instruction the model gets is three student-editable parts with the
    // AUTHORED gesture list inserted between them. Students rewrite the parts in
    // the page; edits are saved in this browser (never a file). The gesture list
    // is always inserted from Robot.gestureCatalogue(), so no edit can break
    // gesture selection or list a gesture that doesn't exist.
    const PROMPT_STORE = 'plan-d-prompt';
    const PROMPT_DEFAULTS = {
        persona: 'You are a small, friendly expressive desk robot — a little creature with a '
               + 'tilting head and two antennas. You are warm, curious, and concise.',
        task:    'For each thing the person says, reply in character with ONE or TWO short '
               + 'sentences (spoken aloud, so keep it natural and brief). Choose exactly ONE '
               + 'gesture from the list below that best matches the feeling of your reply.',
        rules:   'Shape the movement with two levers. scale (about 0.3–1.5, 1.0 = as '
               + 'authored) is how BIG the motion is — go bigger for strong feeling '
               + '(excitement, emphasis, surprise), smaller for subtle, calm, or shy '
               + 'replies. speed (about 0.5–2.0, 1.0 = normal) is how FAST it plays — quicker '
               + 'for excited, urgent, or playful, slower for calm, tired, tender, or sad. '
               + 'They combine: big + fast reads as very excited, small + slow as subdued or '
               + 'weary; keep both near 1.0 for a plain, neutral reply. Optionally add gaze '
               + 'for a small expressive glance — pitch up (+) when alert or delighted, down '
               + '(−) when shy or sad; yaw a little to the side when unsure or evasive. Keep '
               + 'gaze values small (around ±0.3) and leave gaze out for plain, direct '
               + 'attention. Never invent a gesture name that is not in the list.',
    };
    function getPrompt() {
        let saved = {};
        try { saved = JSON.parse(localStorage.getItem(PROMPT_STORE) || '{}'); } catch (e) {}
        return { ...PROMPT_DEFAULTS, ...saved };
    }
    function setPromptPart(part, value) {
        if (!(part in PROMPT_DEFAULTS)) return;
        const cur = getPrompt();
        cur[part] = value;
        try { localStorage.setItem(PROMPT_STORE, JSON.stringify(cur)); } catch (e) {}
    }
    function promptDefaults() { return { ...PROMPT_DEFAULTS }; }

    // Assemble the three parts + the injected gesture list into the final
    // system instruction the model receives.
    function systemInstruction() {
        const p = getPrompt();
        const list = Robot.gestureCatalogue().map((g) => `- ${g.name}: ${g.desc}`).join('\n');
        return [
            p.persona, '',
            p.task, '',
            'Available gestures:',
            list, '',
            p.rules,
        ].join('\n');
    }

    // The BehaviorDirective schema. gesture.enum = authored names (built fresh
    // each call, so it always matches the current vocabulary). The `description`
    // fields document each lever for the model AND for the on-screen Response
    // schema panel — they ride with the enforced contract, so they hold even if
    // the editable System prompt drifts.
    function responseSchema() {
        return {
            type: 'object',
            properties: {
                speech:    { type: 'string', description: 'what the robot says out loud — one or two short, natural sentences' },
                gesture:   { type: 'string', enum: Robot.gestureNames(), description: 'the expressive move to play; must be one of the listed gestures' },
                scale:     { type: 'number', description: 'amplitude 0.3–1.5 (1 = as authored): bigger for strong feeling, smaller for subtle or calm' },
                speed:     { type: 'number', description: 'tempo 0.5–2.0 (1 = normal): faster for excited or urgent, slower for calm, tired, or sad' },
                gaze: {
                    type: 'object',
                    description: 'optional small glance to set the mood; leave out for plain, direct attention',
                    properties: {
                        yaw:   { type: 'number', description: 'turn left/right, about ±0.3' },
                        pitch: { type: 'number', description: 'look up (+) or down (−), about ±0.3' },
                    },
                },
            },
            required: ['speech', 'gesture', 'scale', 'speed'],
        };
    }

    // Turn our rolling history into Gemini `contents`. Roles are 'user'|'model';
    // Gemini requires the first entry to be 'user', so trim any leading model
    // turns (can happen after a fallback that had no preceding user turn).
    function toContents(history) {
        const contents = history.map((h) => ({
            role: h.role === 'model' ? 'model' : 'user',
            parts: [{ text: String(h.text || '') }],
        }));
        while (contents.length && contents[0].role !== 'user') contents.shift();
        return contents;
    }

    // A safe directive when the model can't be reached or parsed. Prefers a
    // gentle, unmistakably-fine gesture from whatever the student authored.
    // `detail` (optional) is a short, human-readable reason the sketch shows on
    // screen — so a bad model name or key isn't a silent failure.
    function fallbackDirective(speech, detail) {
        const names = Robot.gestureNames();
        const safe = names.includes('curious_tilt') ? 'curious_tilt' : (names[0] || Robot.REST_GESTURE);
        return { speech: speech || "Hmm — I didn't quite catch that.", gesture: safe, scale: 1.0, speed: 1.0, gaze: null, error: detail || null };
    }

    // Coerce/repair a parsed directive into something the robot can always play.
    function sanitise(d) {
        if (!d || typeof d !== 'object') return fallbackDirective();
        const names = Robot.gestureNames();
        let gesture = typeof d.gesture === 'string' ? d.gesture : '';
        if (!names.includes(gesture)) {
            console.warn('[brain] model returned an out-of-vocab gesture:', gesture, '→ using fallback gesture');
            gesture = names.includes('curious_tilt') ? 'curious_tilt' : (names[0] || Robot.REST_GESTURE);
        }
        let scale = Number(d.scale);
        if (!Number.isFinite(scale)) scale = 1.0;
        scale = Math.max(0.2, Math.min(1.5, scale));
        let speed = Number(d.speed);
        if (!Number.isFinite(speed)) speed = 1.0;
        speed = Math.max(0.5, Math.min(2.0, speed));
        let gaze = null;
        if (d.gaze && typeof d.gaze === 'object') {
            const yaw = Number(d.gaze.yaw), pitch = Number(d.gaze.pitch);
            gaze = {
                yaw:   Number.isFinite(yaw)   ? Math.max(-1, Math.min(1, yaw))   : 0,
                pitch: Number.isFinite(pitch) ? Math.max(-1, Math.min(1, pitch)) : 0,
            };
        }
        const speech = (typeof d.speech === 'string' && d.speech.trim()) ? d.speech.trim() : '…';
        return { speech, gesture, scale, speed, gaze };
    }

    // The main call. Returns a sanitised BehaviorDirective (never throws).
    async function askGeminiForGesture(userText, history) {
        const key = getKey().trim();
        if (!key || key.includes('PASTE_')) {
            console.warn('[brain] no Gemini key — paste one into the Key field on the page.');
            return fallbackDirective('I need a Gemini key before I can really chat.',
                'no Gemini key yet — paste yours into the Key field above the face');
        }
        if (!PROXY_URL || PROXY_URL.includes('YOUR-SUBDOMAIN')) {
            console.warn('[brain] PROXY_URL not set in config.js — using fallback.');
            return fallbackDirective("My relay isn't set up yet.",
                'PROXY_URL not set in config.js (the class relay URL)');
        }

        const generationConfig = {
            responseMimeType: 'application/json',
            responseSchema: responseSchema(),
        };
        // Add the Gemini 3 thinking control only for models that understand it
        // (see supportsThinkingLevel). 'low' minimises latency for this quick loop.
        if (supportsThinkingLevel(CONFIG.GEMINI_MODEL)) {
            generationConfig.thinkingConfig = { thinkingLevel: CONFIG.THINKING_LEVEL || 'low' };
        }

        const body = {
            model: CONFIG.GEMINI_MODEL,
            systemInstruction: { parts: [{ text: systemInstruction() }] },
            contents: toContents(history),
            generationConfig,
        };

        // Time the round trip: `network` covers request → relay → Google →
        // reply fully read back (the whole trip, dominated by the model itself);
        // `parse` is turning that reply into a directive (tiny — the lesson is
        // that the wait is the model, not our code). Attached to what we return.
        let res, data;
        const tNet0 = performance.now();
        try {
            res = await fetch(PROXY_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
                body: JSON.stringify(body),
            });
            data = await res.json();
        } catch (e) {
            console.error('[brain] network error reaching the relay:', e);
            return fallbackDirective("I can't reach my brain right now.", 'network error reaching the relay (PROXY_URL)');
        }
        const networkMs = performance.now() - tNet0;

        if (!res.ok) {
            // Surface the real reason (e.g. a 404 "model no longer available", a
            // 400 bad request, a 429 quota) instead of failing silently. The
            // model name is included because a wrong/retired model is the usual
            // cause — exactly what the on-screen error line should reveal.
            const msg = data?.error?.message || 'request failed';
            console.error('[brain] Gemini error', res.status, data);
            return withTiming(fallbackDirective("Something went wrong when I tried to think.",
                `Gemini ${res.status} on "${CONFIG.GEMINI_MODEL}": ${msg}`), networkMs, 0);
        }

        const jsonText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        try {
            const tParse0 = performance.now();
            const directive = sanitise(JSON.parse(jsonText));
            return withTiming(directive, networkMs, performance.now() - tParse0);
        } catch (e) {
            console.error('[brain] could not parse the model JSON:', jsonText, e);
            return withTiming(fallbackDirective("I got a bit tangled up thinking about that.",
                'the model returned unreadable JSON'), networkMs, 0);
        }
    }

    // Attach round-trip timing (ms) to a directive for the on-screen timer.
    function withTiming(directive, networkMs, parseMs) {
        directive.timing = { network: networkMs, parse: parseMs };
        return directive;
    }

    return {
        askGeminiForGesture, getKey, setKey, supportsThinkingLevel,
        getPrompt, setPromptPart, promptDefaults, responseSchema,
    };
})();
