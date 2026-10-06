# Keyless Gemini Relay — setup guide

A tiny Cloudflare Worker that forwards Gemini requests **without storing any key**.
Each student's sketch sends their **own** Gemini key with every request, so quota is
per-student: one runaway loop only ever burns that student's own free daily limit.

You deploy this **once**. There is nothing to install on student machines — everyone
just points their sketch at the same relay URL. It works on shared WiFi, phone
hotspots, or home internet, because a sketch only makes an outbound web request to a
public URL (no device-to-device networking involved).

**Files in this folder**
- `worker.js` — the relay (deploy this to Cloudflare)
- `wrangler.toml` — its config (no secrets)
- `client/` — a minimal p5 sketch to test the relay

---

## Prerequisites
- A Google account (for the Gemini key).
- A Cloudflare account (free).
- Node.js installed, if you use the command-line deploy (Part B, Option 1).
  Check with `node --version`. If missing, install the LTS from https://nodejs.org.

---

## Part A — Get a Gemini API key (2 minutes)

1. Go to https://aistudio.google.com/apikey and sign in.
2. Click **Create API key**. Copy it (it starts with `AIza...`).
3. Keep it private — treat it like a password. It's a free-tier key with **no billing
   attached**, so the worst case if it leaks is someone using your free quota, and you
   can just delete and regenerate it.

Each student does this for themselves. You only need your own key to test.

---

## Part B — Deploy the relay to Cloudflare (once)

### Option 1 — Command line (recommended)

1. Sign up at https://dash.cloudflare.com/sign-up.
2. Install Wrangler (Cloudflare's deploy tool):
   ```
   npm install -g wrangler
   ```
3. Log in (opens a browser to authorise):
   ```
   wrangler login
   ```
4. From **this folder** (the one with `worker.js` and `wrangler.toml`):
   ```
   wrangler deploy
   ```
5. Wrangler prints your public URL, e.g.
   `https://gemini-relay.your-name.workers.dev`. **Copy it** — that's the relay.

There are **no secrets to set** — this relay stores nothing. That's the whole point.

### Option 2 — Dashboard paste (no command line)

1. In the Cloudflare dashboard go to **Workers & Pages → Create → Create Worker**.
2. Give it a name (e.g. `gemini-relay`), click **Deploy**, then **Edit code**.
3. Delete the sample code, paste the entire contents of `worker.js`, click **Deploy**.
4. Your URL is shown at the top, e.g. `https://gemini-relay.your-name.workers.dev`.

---

## Part C — Test the relay with curl (no browser yet)

This proves the relay works before you involve p5. Replace the URL and key:

```
curl -X POST https://gemini-relay.YOUR-SUBDOMAIN.workers.dev \
  -H "Content-Type: application/json" \
  -H "x-goog-api-key: YOUR_GEMINI_KEY" \
  -d '{"model":"gemini-2.5-flash","contents":[{"parts":[{"text":"Say hello in five words."}]}]}'
```

Success looks like JSON containing:
`"candidates": [ { "content": { "parts": [ { "text": "Hello, nice to meet you!" } ] } } ]`

If you get an error, see Troubleshooting below.

---

## Part D — Test from p5

1. In `client/`, copy `config.example.js` to `config.js`.
2. Open `config.js` and paste in **your** Gemini key and **your** relay URL.
3. Serve the `client/` folder with any static server (opening the file directly can be
   blocked by the browser). Easiest options:
   ```
   npx serve client          # then open the printed http://localhost:... URL
   ```
   or, from inside `client/`:
   ```
   python3 -m http.server 8000   # then open http://localhost:8000
   ```
   (VS Code's "Live Server" extension also works.)
4. Press **SPACE**. You should see a one-line greeting on the canvas and in the console
   (F12 → Console). That's the full chain: sketch → relay → Gemini → back.

---

## For the class, and for the robot

**Per student.** Each student does Part A (their own key) and Part D (paste key + the one
shared relay URL into their own `config.js`). Nobody installs anything. Add `config.js` to
`.gitignore` so keys are never committed.

**Structured output for gestures.** For the robot you want the model to return a
`BehaviorDirective` as JSON, not prose. Same relay — just add `generationConfig`:

```
async function askGeminiForGesture(userText) {
  const res = await fetch(PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
    body: JSON.stringify({
      model: "gemini-2.5-flash",
      contents: [{ parts: [{ text: userText }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: {
            speech:    { type: "string" },
            gesture:   { type: "string",
                         enum: ["curious_tilt","nod_yes","perk_up","droop","thinking"] },
            intensity: { type: "number" }
          },
          required: ["speech","gesture","intensity"]
        }
      }
    }),
  });
  const data = await res.json();
  const jsonText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  return JSON.parse(jsonText); // -> { speech, gesture, intensity }
}
```

The `enum` is your gesture vocabulary — the model can only pick a gesture that exists.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Missing x-goog-api-key header` | The sketch didn't send a key. Check `config.js` loaded before `sketch.js`, and `GEMINI_KEY` is set. |
| `400 API key not valid` | Wrong/incomplete key. Re-copy from AI Studio. |
| `403` / key blocked | Google blocks keys detected as publicly exposed. Regenerate the key and never publish it. |
| `404` model not found | Model name changed. Check https://ai.google.dev/gemini-api/docs/models and update `model`. |
| `429` quota exceeded | That student hit their own free daily limit (~1,500/day). It resets; nobody else is affected. |
| CORS error in console | Serve the page with a local server (Part D), don't open the file directly. |
| Nothing happens on SPACE | Open the console (F12) for the real error; check the relay URL in `config.js`. |

---

## Cost and limits

Cloudflare Workers free tier covers **100,000 requests/day** — far more than a class
will use. Gemini usage is billed to each student's own free key, so **there is no shared
spend to run up**. If you ever want to cap the relay's request count per user, you can add
per-IP rate limiting later, but it protects a request count, not money.
