// sketch.js — minimal p5 test of the keyless Gemini relay.
// Needs config.js (GEMINI_KEY + PROXY_URL) loaded first (see index.html).

function setup() {
  createCanvas(480, 220);
  background(240);
  textAlign(CENTER, CENTER);
  textSize(14);
  text("Press SPACE to ask Gemini.\nWatch the browser console (F12).", width / 2, height / 2);
}

async function keyPressed() {
  if (key === " ") {
    background(240);
    text("thinking...", width / 2, height / 2);
    const reply = await askGemini("In one short sentence, greet me as a friendly desk robot.");
    background(240);
    textAlign(LEFT, TOP);
    text(reply || "(no reply — check the console)", 20, 20, width - 40, height - 40);
    console.log("Gemini said:", reply);
  }
}

// Sends a prompt through YOUR relay using YOUR key. Returns the model's text.
async function askGemini(promptText) {
  const res = await fetch(PROXY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": GEMINI_KEY, // your own key -> your own quota
    },
    body: JSON.stringify({
      model: "gemini-2.5-flash",
      contents: [{ parts: [{ text: promptText }] }],
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error("Gemini error:", data);
    return null;
  }
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
}
