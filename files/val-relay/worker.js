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
// POST = a chat turn; GET = list the available models (both need the key).
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export default {
  async fetch(request, env) {
    // 1. CORS preflight (the browser sends this automatically before the call).
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    // 2. The student's own Val key rides in this header. We forward it, never log it.
    const auth = request.headers.get("Authorization");
    if (!auth) {
      return json({ error: "Missing Authorization header (your own Val key: 'Bearer sk-…')." }, 401);
    }

    // 3. Where to forward. Set VAL_API_BASE in wrangler.toml to the environment
    //    whose dashboard issued the students' keys (the class uses NPE):
    //      NPE   https://val-npe.rmit.edu.au/api/chat/completions  (dashboard: https://val-npe.rmit.edu.au/)
    //      prod  https://val.rmit.edu.au/api/chat/completions
    const chatUrl = (env && env.VAL_API_BASE) || "https://val-npe.rmit.edu.au/api/chat/completions";

    // 4a. GET → list models. The page uses this to populate its Model menu with
    //     whatever your account can actually reach. The models URL sits beside
    //     chat/completions under /api, so swap the path.
    if (request.method === "GET") {
      const modelsUrl = chatUrl.replace(/\/chat\/completions\/?$/, "/models");
      return relay(() => fetch(modelsUrl, { method: "GET", headers: { "Authorization": auth } }));
    }

    // 4b. POST → a chat turn. Forward the JSON body straight through (OpenAI
    //     chat-completions shape), adding the caller's Authorization header.
    if (request.method === "POST") {
      const bodyText = await request.text();
      return relay(() => fetch(chatUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": auth },
        body: bodyText,
      }));
    }

    return json({ error: "Use GET (list models) or POST (chat)." }, 405);
  },
};

// Run a forward and relay Val's exact response back, with CORS headers added.
async function relay(doFetch) {
  let valRes;
  try { valRes = await doFetch(); }
  catch { return json({ error: "Could not reach the Val API." }, 502); }
  const text = await valRes.text();
  return new Response(text, {
    status: valRes.status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
