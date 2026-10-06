// ==============================================================
// brain.js — the LLM turn: user text -> a behaviour directive.
//
// askForDirective(userText, history, imageB64) assembles the system instruction
// (editable persona/task/rules + the authored gesture list) and the response
// schema (responseSchema), then hands them to the ACTIVE PROVIDER, which knows
// how to talk to one LLM service: where to send the request, how to authenticate,
// how to shape the request body, and how to read the reply. It parses the
// structured JSON and returns a directive object (whatever the schema defines —
// by default { speech, gesture, scale, speed, gaze }).
//
// On any failure (no key, network, non-OK, bad JSON) it logs and returns a SAFE
// fallback directive — never throws.
//
// --- Adding another LLM (Grok, RMIT Val, …) ----------------------------
// Only the PROVIDER differs between services; the turn loop below is neutral.
// To add one, write another provider object with the same shape as
// GeminiProvider (endpoint / headers / buildBody / extractText / errorMessage +
// the capability predicates), register it in PROVIDERS, and point the app at it
// (CONFIG.LLM_PROVIDER). This build ships Gemini only.
//
// Why generateContent (not the Interactions API): the Interactions client adds
// an Api-Revision header that triggers a CORS preflight the Gemini host rejects,
// so it can't be called from a browser. generateContent has no such problem and
// is what the relay forwards.
// ==============================================================

const Brain = (() => {

    // --- the student's API key (per provider) -------------------------
    // The key lives in the page's Key field, remembered in THIS browser only
    // (localStorage) — never in a file. Each provider keeps its OWN key (Gemini /
    // Groq / Val use different keys), so switching provider swaps the field. Gemini
    // also reads the legacy single-key store, so a key saved by an earlier version
    // still works.
    const keyStoreFor = (id) => 'plan-d-key-' + id;
    function getKey() {
        const id = getProviderId();
        try { const k = localStorage.getItem(keyStoreFor(id)); if (k) return k; } catch (e) {}
        if (id === 'gemini') {
            try { const legacy = localStorage.getItem('plan-d-gemini-key'); if (legacy) return legacy; } catch (e) {}
        }
        return '';
    }
    function setKey(v) {
        try { localStorage.setItem(keyStoreFor(getProviderId()), (v || '').trim()); } catch (e) {}
    }

    // Appended to the system instruction only on turns that carry a frame, so the
    // model knows the image is live and uses it (especially for gaze). Generic
    // prose — the PROVIDER decides how the image itself rides along.
    const VISION_NOTE = 'A still photo of what you can see through your camera right now is attached to '
        + 'this message. Use it: notice the person and their expression, and let it shape your reply and '
        + 'your gaze. Don\'t describe the photo like a caption — react to it naturally, in character.';

    // ===============================================================
    // PROVIDERS — one object per LLM service. The turn loop calls only this
    // interface, so every service-specific detail (URL, auth, body shape, reply
    // shape, model capabilities) lives here. Each provider implements:
    //   supportsThinkingLevel(model) · supportsVision(model)   — model capabilities
    //   endpoint() · endpointReady() · headers(key)            — where + auth
    //   buildBody({ model, systemText, history, imageB64, schema, thinking })
    //   extractText(data) · errorMessage(data)                 — read the reply
    // ===============================================================

    // Google Gemini via generateContent, through the keyless class relay
    // (PROXY_URL from config.js), carrying the student's own key in a header.
    const GeminiProvider = {
        id: 'gemini',
        label: 'Google Gemini',

        // Where students get a key, and what the Key field should look like.
        keyHint: { placeholder: 'paste your own Gemini API key', text: 'Get one free at', link: 'aistudio.google.com/apikey', url: 'https://aistudio.google.com/apikey' },

        // The model menu (grouped). Model availability changes often — refresh
        // from https://ai.google.dev/gemini-api/docs/models. Some are here to
        // FAIL on purpose (e.g. gemini-2.5-flash is retired for new keys → 404).
        models() {
            return [
                { label: 'Gemini 3 — current', options: [
                    { value: 'gemini-3.8-flash', label: 'gemini-3.8-flash' },
                    { value: 'gemini-3.7-flash', label: 'gemini-3.7-flash' },
                    { value: 'gemini-3.6-flash', label: 'gemini-3.6-flash (default)' },
                    { value: 'gemini-3.5-flash', label: 'gemini-3.5-flash' },
                    { value: 'gemini-3.5-flash-lite', label: 'gemini-3.5-flash-lite' },
                    { value: 'gemini-3.1-flash-lite', label: 'gemini-3.1-flash-lite' },
                    { value: 'gemini-3.1-pro-preview', label: 'gemini-3.1-pro-preview' },
                    { value: 'gemini-3-flash-preview', label: 'gemini-3-flash-preview' },
                ] },
                { label: 'Aliases — always point at a current model', options: [
                    { value: 'gemini-flash-latest', label: 'gemini-flash-latest' },
                    { value: 'gemini-flash-lite-latest', label: 'gemini-flash-lite-latest' },
                    { value: 'gemini-pro-latest', label: 'gemini-pro-latest' },
                ] },
                { label: 'Gemini 2.5 — older (may error)', options: [
                    { value: 'gemini-2.5-flash', label: 'gemini-2.5-flash' },
                    { value: 'gemini-2.5-pro', label: 'gemini-2.5-pro' },
                    { value: 'gemini-2.5-flash-lite', label: 'gemini-2.5-flash-lite' },
                ] },
                { label: 'Gemma — open models (structured output may differ)', options: [
                    { value: 'gemma-4-31b-it', label: 'gemma-4-31b-it' },
                    { value: 'gemma-4-26b-a4b-it', label: 'gemma-4-26b-a4b-it' },
                ] },
            ];
        },
        defaultModel() { return (typeof CONFIG !== 'undefined' && CONFIG.GEMINI_MODEL) || 'gemini-3.6-flash'; },

        // thinkingLevel is a GEMINI 3 feature. Gemini 2.5 used a different, numeric
        // setting (thinkingBudget) and Gemma has none — sending thinkingLevel to
        // those is an unknown field (a 400). Match gemini-3.x / gemini-3-… and the
        // "-latest" aliases (which currently resolve to Gemini 3).
        supportsThinkingLevel(model) {
            const m = String(model || '');
            return /^gemini-3[.-]/.test(m) || /-latest$/.test(m);
        },
        // Every Gemini is multimodal; the Gemma open models are text-only, so a
        // frame is dropped for them (it would just be ignored or error).
        supportsVision(model) { return /^gemini-/i.test(String(model || '')); },

        endpoint() { return (typeof PROXY_URL === 'string') ? PROXY_URL : ''; },
        endpointReady() { const u = this.endpoint(); return !!u && !u.includes('YOUR-SUBDOMAIN'); },
        headers(key) { return { 'Content-Type': 'application/json', 'x-goog-api-key': key }; },

        // Our rolling history → Gemini `contents`. Roles are 'user'|'model';
        // Gemini requires the first entry to be 'user', so trim any leading model
        // turns (can happen after a fallback with no preceding user turn).
        _toContents(history) {
            const c = (history || []).map((h) => ({
                role: h.role === 'model' ? 'model' : 'user',
                parts: [{ text: String(h.text || '') }],
            }));
            while (c.length && c[0].role !== 'user') c.shift();
            return c;
        },

        // Build the generateContent request body from the neutral spec. The webcam
        // frame (if any — already gated by supportsVision) rides on the LAST user
        // turn as inlineData, so we never resend old frames.
        buildBody({ model, systemText, history, imageB64, schema, thinking }) {
            const generationConfig = { responseMimeType: 'application/json', responseSchema: schema };
            if (thinking) generationConfig.thinkingConfig = { thinkingLevel: thinking };
            const contents = this._toContents(history);
            if (imageB64 && contents.length) {
                contents[contents.length - 1].parts.push({ inlineData: { mimeType: 'image/jpeg', data: imageB64 } });
            }
            return { model, systemInstruction: { parts: [{ text: systemText }] }, contents, generationConfig };
        },

        // The structured-output JSON text out of a successful response.
        extractText(data) { return data && data.candidates && data.candidates[0]
            && data.candidates[0].content && data.candidates[0].content.parts
            && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text; },
        // A human-readable reason for a non-OK response.
        errorMessage(data) { return (data && data.error && data.error.message) || 'request failed'; },
    };

    // --- OpenAI-compatible chat services (Groq, Val) ------------------
    // Groq and Val both speak the OpenAI /chat/completions dialect, so they share
    // this one base; `cfg` supplies the per-service differences (endpoint, model
    // list, how structured output is requested, vision/reasoning support). Gemini
    // keeps its own object above because its wire format is different.
    //   cfg: { id, label, endpoint(), models, defaultModel,
    //          structured: 'json_schema' | 'json_object',
    //          vision: bool, reasoning: bool, reasoningEffort(level)->str,
    //          stripReasoning: bool }
    function openAiChat(cfg) {
        // Our rolling history → OpenAI `messages` (system first; roles user|assistant).
        // A webcam frame (already gated by supportsVision) attaches to the last user
        // turn as an OpenAI content-array image_url (data: URI).
        function messagesFrom(systemText, history, imageB64) {
            const msgs = [{ role: 'system', content: systemText }];
            const turns = (history || []).map((h) => ({
                role: h.role === 'model' ? 'assistant' : 'user',
                content: String(h.text || ''),
            }));
            if (imageB64) {
                for (let i = turns.length - 1; i >= 0; i--) {
                    if (turns[i].role === 'user') {
                        turns[i] = { role: 'user', content: [
                            { type: 'text', text: turns[i].content },
                            { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + imageB64 } },
                        ] };
                        break;
                    }
                }
            }
            return msgs.concat(turns);
        }

        return {
            id: cfg.id,
            label: cfg.label,
            keyHint: cfg.keyHint,

            supportsThinkingLevel(model) { return cfg.reasoning ? (cfg.supportsThinkingLevel ? cfg.supportsThinkingLevel(model) : true) : false; },
            supportsVision() { return !!cfg.vision; },

            endpoint() { return cfg.endpoint(); },
            endpointReady() { const u = cfg.endpoint(); return !!u && !/YOUR-SUBDOMAIN|PASTE_/.test(u); },
            headers(key) { return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` }; },

            models() { return cfg.models; },
            defaultModel() { return cfg.defaultModel; },

            buildBody({ model, systemText, history, imageB64, schema, thinking }) {
                let sysText = systemText, responseFormat;
                if (cfg.structured === 'json_schema') {
                    // Val: the service enforces the schema (OpenAI structured outputs).
                    responseFormat = { type: 'json_schema', json_schema: { name: 'behaviour_directive', schema } };
                } else {
                    // Groq: reasoning models don't honour a strict schema reliably, so
                    // ask for a JSON object and embed the schema in the instruction.
                    sysText = systemText + '\n\nReturn ONLY a JSON object matching this schema — no prose, no code fences:\n' + JSON.stringify(schema);
                    responseFormat = { type: 'json_object' };
                }
                const body = {
                    model,
                    messages: messagesFrom(sysText, history, imageB64),
                    response_format: responseFormat,
                    max_tokens: cfg.maxTokens || 1024,
                    temperature: cfg.temperature != null ? cfg.temperature : 0.8,
                };
                // Reasoning control (e.g. Groq gpt-oss): map our thinking level →
                // reasoning_effort, and drop the reasoning text from the reply.
                if (thinking && cfg.reasoning) {
                    body.reasoning_effort = cfg.reasoningEffort ? cfg.reasoningEffort(thinking) : thinking;
                    body.include_reasoning = false;
                }
                return body;
            },

            // Pull the assistant message out, and — for reasoning models — strip any
            // <think>…</think> and code fences, then isolate the first { … } object.
            extractText(data) {
                let t = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
                t = String(t || '');
                if (cfg.stripReasoning) {
                    t = t.replace(/^[\s\S]*?<\/think>/i, '')        // up to the first </think>
                         .replace(/<think>[\s\S]*?<\/think>/gi, '') // any remaining closed blocks
                         .replace(/<think>[\s\S]*$/i, '')           // a trailing unclosed block
                         .replace(/```(?:json)?/gi, '')             // code fences
                         .trim();
                    const m = t.match(/\{[\s\S]*\}/);               // the first JSON object
                    if (m) t = m[0];
                }
                return t;
            },
            errorMessage(data) { return (data && data.error && data.error.message) || 'request failed'; },
        };
    }

    // Groq — OpenAI-compatible, called DIRECT (Groq allows browser CORS). The
    // listed models are text-only reasoning models (gpt-oss / qwen), so vision is
    // off and we strip their <think> reasoning before parsing.
    const GroqProvider = openAiChat({
        id: 'groq', label: 'Groq',
        keyHint: { placeholder: 'gsk_…', text: 'Get one at', link: 'console.groq.com/keys', url: 'https://console.groq.com/keys' },
        endpoint: () => 'https://api.groq.com/openai/v1/chat/completions',
        structured: 'json_object',
        vision: false,
        reasoning: true,
        stripReasoning: true,
        supportsThinkingLevel: (m) => /gpt-oss/i.test(String(m || '')),
        reasoningEffort: (lvl) => (lvl === 'minimal' ? 'low' : lvl),
        models: [{ label: 'Groq', options: [
            { value: 'openai/gpt-oss-120b', label: 'gpt-oss-120b · OpenAI (best)' },
            { value: 'openai/gpt-oss-20b',  label: 'gpt-oss-20b · OpenAI (fastest)' },
            { value: 'qwen/qwen3.6-27b',    label: 'qwen3.6-27b · Alibaba (reasoning)' },
        ] }],
        defaultModel: 'openai/gpt-oss-120b',
    });

    // RMIT Val — OpenAI-compatible, but Val sends NO CORS headers (Terms §8.1), so
    // it's reached through the KEYLESS val-relay (VAL_PROXY_URL from config.js),
    // which forwards the student's own key. Val enforces a real json_schema and is
    // multimodal (val-gpt-4o); clean output, so no reasoning-stripping.
    const ValProvider = openAiChat({
        id: 'val', label: 'RMIT Val',
        keyHint: { placeholder: 'sk-… (from your Val dashboard)', text: 'Generate one in your Val dashboard —', link: 'val-npe.rmit.edu.au', url: 'https://val-npe.rmit.edu.au/' },
        endpoint: () => (typeof VAL_PROXY_URL === 'string' ? VAL_PROXY_URL : ''),
        structured: 'json_schema',
        vision: true,
        reasoning: false,
        models: [{ label: 'Val', options: [
            { value: 'val-gpt-4o', label: 'val-gpt-4o (GPT-4o)' },
        ] }],
        defaultModel: 'val-gpt-4o',
    });

    // The registry, in menu order.
    const PROVIDERS = { gemini: GeminiProvider, groq: GroqProvider, val: ValProvider };
    function providers() { return Object.keys(PROVIDERS).map((id) => ({ id, label: PROVIDERS[id].label })); }

    // Which provider is selected — saved in this browser (the page's Provider
    // dropdown sets it). Falls back to CONFIG.LLM_PROVIDER, then Gemini.
    const PROVIDER_STORE = 'plan-d-provider';
    function getProviderId() {
        try { const id = localStorage.getItem(PROVIDER_STORE); if (id && PROVIDERS[id]) return id; } catch (e) {}
        const c = (typeof CONFIG !== 'undefined' && CONFIG.LLM_PROVIDER) || '';
        return PROVIDERS[c] ? c : 'gemini';
    }
    function setProviderId(id) { if (PROVIDERS[id]) { try { localStorage.setItem(PROVIDER_STORE, id); } catch (e) {} } }
    function activeProvider() { return PROVIDERS[getProviderId()] || GeminiProvider; }
    function providerModels() { const p = activeProvider(); return p.models ? p.models() : []; }
    function providerKeyHint() { return activeProvider().keyHint || {}; }

    // The chosen MODEL is remembered PER PROVIDER, so switching back and forth
    // keeps each service on its own last model. Defaults to the provider's default.
    function getModel() {
        const p = activeProvider();
        try { const m = localStorage.getItem('plan-d-model-' + p.id); if (m) return m; } catch (e) {}
        return (p.defaultModel ? p.defaultModel() : '') || '';
    }
    function setModel(m) {
        try { localStorage.setItem('plan-d-model-' + getProviderId(), String(m)); } catch (e) {}
    }
    function activeModel() { return getModel(); }

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

    // --- the response schema (defined here in the code) ---------------
    // responseSchema() is the structured-output shape the model MUST return. The
    // API enforces it, so the chosen gesture is always a real one (enum = authored
    // names, built fresh each call) and the levers are always present. EDIT THIS
    // IN THE CODE to change what the robot returns: add a field here, then give it
    // an effect by adding a handler of the same name in actions.js. The Response
    // Schema panel shows this read-only, so students can see the exact contract.
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

    // A safe directive when the model can't be reached or parsed. Prefers a
    // gentle, unmistakably-fine gesture from whatever the student authored.
    // `detail` (optional) is a short, human-readable reason the sketch shows on
    // screen — so a bad model name or key isn't a silent failure.
    function fallbackDirective(speech, detail) {
        const names = Robot.gestureNames();
        const safe = names.includes('curious_tilt') ? 'curious_tilt' : (names[0] || Robot.REST_GESTURE);
        return { speech: speech || "Hmm — I didn't quite catch that.", gesture: safe, scale: 1.0, speed: 1.0, gaze: null, error: detail || null };
    }

    // The model returns JSON shaped by the ACTIVE schema, which students can edit
    // in the code — so we no longer force the old {speech,gesture,scale,speed,gaze}
    // shape here. We pass the parsed object through almost untouched and let the
    // layers that use it stay safe on their own: actions.js decides what each field
    // means, and robot.js clamps scale/speed/gaze and falls back to a real gesture
    // if the name doesn't exist. The only guarantee made here is "it's an object".
    function sanitise(d) {
        if (!d || typeof d !== 'object' || Array.isArray(d)) return fallbackDirective();
        return d;
    }

    // Attach round-trip timing (ms) to a directive for the on-screen timer.
    function withTiming(directive, networkMs, parseMs) {
        directive.timing = { network: networkMs, parse: parseMs };
        return directive;
    }

    // The main call. Returns a directive (never throws). Provider-neutral: it
    // gathers the neutral request spec and lets the active provider shape the
    // request and read the reply. imageB64 (optional) is a JPEG webcam frame
    // (base64, no data: prefix) — the robot's "eyes"; dropped for text-only models.
    async function askForDirective(userText, history, imageB64) {
        const provider = activeProvider();
        const model = activeModel();

        const key = getKey().trim();
        if (!key) {
            console.warn('[brain] no API key — paste one into the Key field on the page.');
            return fallbackDirective('I need a key before I can really chat.',
                'no key yet — paste yours into the Key field above the face');
        }
        if (!provider.endpointReady()) {
            console.warn('[brain] relay endpoint not set in config.js — using fallback.');
            return fallbackDirective("My relay isn't set up yet.",
                `the ${provider.label} relay URL isn't set in config.js`);
        }

        // Gate the model-dependent extras with the provider's own capabilities,
        // then hand the provider a neutral spec to shape into its request body.
        const useImage = !!imageB64 && provider.supportsVision(model);
        const systemText = useImage ? systemInstruction() + '\n\n' + VISION_NOTE : systemInstruction();
        const thinking = provider.supportsThinkingLevel(model) ? (CONFIG.THINKING_LEVEL || 'low') : null;
        const body = provider.buildBody({
            model, systemText, history,
            imageB64: useImage ? imageB64 : null,
            schema: responseSchema(),
            thinking,
        });

        // Time the round trip: `network` covers request → relay → service → reply
        // fully read back (dominated by the model itself); `parse` is turning that
        // reply into a directive (tiny — the lesson is the wait is the model, not us).
        let res, data;
        const tNet0 = performance.now();
        try {
            res = await fetch(provider.endpoint(), {
                method: 'POST',
                headers: provider.headers(key),
                body: JSON.stringify(body),
            });
            data = await res.json();
        } catch (e) {
            console.error('[brain] network error reaching the relay:', e);
            return fallbackDirective("I can't reach my brain right now.", 'network error reaching the relay');
        }
        const networkMs = performance.now() - tNet0;

        if (!res.ok) {
            // Surface the real reason (a 404 "model no longer available", a 400 bad
            // request, a 429 quota…) instead of failing silently — the model name is
            // included because a wrong/retired model is the usual cause.
            const msg = provider.errorMessage(data);
            console.error(`[brain] ${provider.id} error`, res.status, data);
            return withTiming(fallbackDirective("Something went wrong when I tried to think.",
                `${provider.label} ${res.status} on "${model}": ${msg}`), networkMs, 0);
        }

        const jsonText = provider.extractText(data);
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

    // Capability predicates the page uses to grey out model-dependent controls
    // (Thinking, Camera) — delegated to the active provider so they always match
    // what the request will actually send.
    function supportsThinkingLevel(model) { return activeProvider().supportsThinkingLevel(model); }
    function supportsVision(model) { return activeProvider().supportsVision(model); }

    return {
        askForDirective, getKey, setKey, supportsThinkingLevel, supportsVision,
        getPrompt, setPromptPart, promptDefaults, responseSchema,
        providers, getProviderId, setProviderId, providerModels, providerKeyHint,
        getModel, setModel,
    };
})();
