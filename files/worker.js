// worker.js — Keyless Gemini relay for the Expressive Robots studio.
//
// This worker holds NO API key. Each request carries the student's OWN Gemini key
// in the "x-goog-api-key" header, so every call is billed to that student's own
// free quota. One student's runaway loop can only exhaust their own daily limit —
// never anyone else's.
//
// The worker's only jobs: answer the browser's CORS preflight, then forward the
// request to Google's generateContent endpoint using the caller's key. It does
// NOT log keys.

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// Default model if the client doesn't specify one.
// Verify current model names at: https://ai.google.dev/gemini-api/docs/models
const DEFAULT_MODEL = "gemini-3.6-flash";

// Allow browser sketches (localhost or a local dev server) to call this relay.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-goog-api-key",
};

export default {
  async fetch(request) {
    // 1. CORS preflight (the browser sends this automatically before the POST).
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    if (request.method !== "POST") {
      return json({ error: "Use POST." }, 405);
    }

    // 2. The student's own key rides in this header. We use it, and never log it.
    const apiKey = request.headers.get("x-goog-api-key");
    if (!apiKey) {
      return json({ error: "Missing x-goog-api-key header (your own Gemini key)." }, 400);
    }

    // 3. Read the JSON body. Pull out "model"; forward everything else to Gemini as-is.
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Request body must be JSON." }, 400);
    }
    const { model = DEFAULT_MODEL, ...payload } = body;
    const url = `${GEMINI_BASE}/${model}:generateContent`;

    // 4. Forward to Google with the caller's key.
    let googleRes;
    try {
      googleRes = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(payload),
      });
    } catch {
      return json({ error: "Could not reach the Gemini API." }, 502);
    }

    // 5. Relay Google's exact response back to the browser, with CORS headers added.
    const text = await googleRes.text();
    return new Response(text, {
      status: googleRes.status,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
