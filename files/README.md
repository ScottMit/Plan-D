# Relays (Cloudflare Workers)

The class LLM **relays** live here — one small Cloudflare Worker per AI service.
Each is **keyless**: it stores no API key, forwards each student's **own** key, and
exists only so the browser can reach a service it otherwise couldn't. You deploy
each one **once**; students point the app's config at the resulting worker URLs.

| Folder | Service | Why a relay |
|---|---|---|
| [`gemini-relay/`](gemini-relay/) | Google Gemini | isolates quota to each student's own key |
| [`val-relay/`](val-relay/) | RMIT Val | Val sends no CORS headers — a browser can't call it directly (Val Terms §8.1) |

Each folder has its own `worker.js`, `wrangler.toml`, and `README.md` with
step-by-step deploy instructions. Deploy from inside that folder, e.g.:

```bash
cd files/gemini-relay && npx wrangler deploy
cd files/val-relay    && npx wrangler deploy
```

**Groq needs no relay** — it allows direct browser calls, so the app talks to
`api.groq.com` straight from the page with the student's own key.

Nothing here holds a secret; keys live only in each student's browser (and travel
through the relay to the service). Never commit a real key or a `config.js`.
