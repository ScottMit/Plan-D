# Keyless Val Relay — setup guide

A tiny Cloudflare Worker that forwards requests to **RMIT's Val** AI gateway
**without storing any key**. Each student sends their **own** Val key with every
request, so usage is per-student.

Why a relay at all? Val's API Terms of Use (§8.1) say Val deliberately sends **no
CORS headers**, so a browser can't call it directly — you must go "through a
secure middleware or backend component." This worker is that component. It does
not hold or log a key; it just answers the browser's CORS preflight and forwards
the call (adding the caller's `Authorization` header) to Val.

You deploy this **once**. Students just point the app's `VAL_PROXY_URL` at the
resulting worker URL.

**Files in this folder**
- `worker.js` — the relay (deploy this to Cloudflare)
- `wrangler.toml` — its config (no secrets; sets `VAL_API_BASE`)

---

## Prerequisites
- An RMIT account with Val API access (for the key).
- A Cloudflare account (free).
- Node.js installed, if you use the command-line deploy. Check with
  `node --version`; if missing, install the LTS from https://nodejs.org.

---

## Part A — Get a Val API key

1. Go to **https://val-npe.rmit.edu.au/** and sign in with your RMIT account.
2. Open your account / developer settings and **generate an API key**. Copy it
   (it starts with `sk-…`). Keep it private, like a password.

Each student does this with their own account — the key is theirs, and it is only
ever sent from their own browser through the relay to Val.

---

## Part B — Deploy the worker

**Option 1 — command line (Wrangler)**

```bash
cd files/val-relay
npx wrangler login        # opens a browser to authorise Cloudflare
npx wrangler deploy       # prints your worker URL
```

The deploy prints a URL like `https://val-relay.<your-subdomain>.workers.dev`.
That is your `VAL_PROXY_URL`.

**Option 2 — Cloudflare dashboard**

Create a Worker, paste the contents of `worker.js`, and under **Settings →
Variables** add a plain (non-secret) variable `VAL_API_BASE` with the value from
`wrangler.toml`. Save and deploy.

### Choosing the environment
The class uses the **non-production (NPE)** environment — students generate their
keys at `https://val-npe.rmit.edu.au/`, so `VAL_API_BASE` (in `wrangler.toml`) is:

| Environment | `VAL_API_BASE` |
|---|---|
| **Non-production (NPE)** — the class default | `https://val-npe.rmit.edu.au/api/chat/completions` |
| Production (`val.rmit.edu.au`) | `https://val.rmit.edu.au/api/chat/completions` |

---

## Part C — Point the app at the relay

In the app's `config.js` (copied from `config.example.js`), set:

```js
const VAL_PROXY_URL = "https://val-relay.YOUR-SUBDOMAIN.workers.dev";
```

Then choose **Val** as the provider in the page and paste your `sk-…` key into the
Key field. The app sends `Authorization: Bearer <your key>`; the relay forwards it
to Val and returns Val's reply.

---

## Notes

- **No key is stored** here, and the worker never logs the `Authorization` header
  (Terms §5 / §8.1).
- **Per-student quota / throttling.** If Val rate-limits you (HTTP 429), the app
  surfaces it on its status line; wait and retry (Terms §1.2–1.3).
- **Data.** Val's Terms (§3.1–3.2) make outputs RMIT's and license inputs to RMIT
  for platform improvement — so anything you send (including webcam frames, if you
  turn the camera on) is covered by that. Mention this to students.
