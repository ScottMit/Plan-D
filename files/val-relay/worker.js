// worker.js — Keyless Val relay for the Expressive Robots studio.
//
// RMIT's Val gateway deliberately sends NO CORS headers, so a browser can't call
// it directly (Val API Terms of Use §8.1: "enable this access through … a secure
// middleware or backend component"). This tiny Cloudflare Worker is that
// middleware: it answers the browser's CORS preflight, then forwards the request
// to Val's chat/completions endpoint.
//
// It holds NO key. Each student generates their OWN Val key in their dashboard
// (https://val-npe.rmit.edu.au/) and sends it in the "Authorization: Bearer sk-…"
// header; the worker forwards that header untouched to Val. Usage is per-student,
// and the worker never logs the key. (The student is the developer here, each
// using their own key — not the end-user key-exposure case §8.1 warns against.)
//
// You deploy this ONCE. Students just point the app's VAL_PROXY_URL at it.

// Allow browser sketches (localhost or a local dev server) to call this relay.
// Forwarded header is "Authorization" (the Bearer key), not x-goog-api-key.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export default {
  async fetch(request, env) {
    // 1. CORS preflight (the browser sends this automatically before the POST).
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }
    if (request.method !== "POST") {
      return json({ error: "Use POST." }, 405);
    }

    // 2. The student's own Val key rides in this header. We forward it, never log it.
    const auth = request.headers.get("Authorization");
    if (!auth) {
      return json({ error: "Missing Authorization header (your own Val key: 'Bearer sk-…')." }, 400);
    }

    // 3. Where to forward. Set VAL_API_BASE in wrangler.toml to the environment
    //    whose dashboard issued the students' keys (the class uses NPE):
    //      NPE   https://val-npe.rmit.edu.au/api/chat/completions  (dashboard: https://val-npe.rmit.edu.au/)
    //      prod  https://val.rmit.edu.au/api/chat/completions
    const target = (env && env.VAL_API_BASE) || "https://val-npe.rmit.edu.au/api/chat/completions";

    // 4. Forward the JSON body straight through (OpenAI chat-completions shape),
    //    adding the caller's Authorization header.
    const bodyText = await request.text();
    let valRes;
    try {
      valRes = await fetch(target, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": auth },
        body: bodyText,
      });
    } catch {
      return json({ error: "Could not reach the Val API." }, 502);
    }

    // 5. Relay Val's exact response back to the browser, with CORS headers added.
    const text = await valRes.text();
    return new Response(text, {
      status: valRes.status,
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
