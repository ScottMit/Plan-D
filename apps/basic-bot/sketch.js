// ============================================================
//  Colour Bot — a tiny p5.js + Gemini teaching sketch
// ------------------------------------------------------------
//  Type an instruction, and Gemini decides which of three shapes
//  — a circle, a square, and a triangle — should change colour,
//
//  SET UP (three steps):
//    1. Put your own free Gemini key in GEMINI_KEY below.
//       Get one at https://aistudio.google.com/apikey
//    2. Put your class relay URL in PROXY_URL below.
//    3. Serve this folder with the Live Server plugin (click 'Go Live')
// ============================================================

// ---- YOUR settings --------------
const GEMINI_KEY = "PASTE_YOUR_GEMINI_KEY";
const PROXY_URL = "https://gemini-relay.YOUR-SUBDOMAIN.workers.dev";

// ---- The Gemini LLM -------------
const GEMINI_MODEL = "gemini-3.1-flash-lite";
// Other models you can swap in above.
// Ccurrent list: https://ai.google.dev/gemini-api/docs/models
//    Gemini 3 (recommended — fast, multimodal):
//     gemini-3.8-flash      gemini-3.7-flash      gemini-3.6-flash
//     gemini-3.5-flash      gemini-3.5-flash-lite gemini-3.1-flash-lite
//     gemini-3.1-pro-preview  gemini-3-flash-preview
//   Aliases (always point at a current model):
//     gemini-flash-latest   gemini-flash-lite-latest   gemini-pro-latest
//   Gemini 2.5 (older): gemini-2.5-pro   gemini-2.5-flash-lite
//     (note: gemini-2.5-flash is retired for new keys → returns 404)
//   Gemma (open models, text-only): gemma-4-31b-it   gemma-4-26b-a4b-it

// What we tell the model to do (in plain words).
const SYSTEM_PROMPT =
  "You control the colour of 3 shapes on a screen: a circle, a square, and a triangle. " +
  "Read what the user says and, for each shape, return an object with change, r, g, and b. " +
  "If the user clearly asks to change a shape's colour, set change to true and give the colour " +
  "as Red, Green, and Blue integers in the range 0-255. If there is no clear instruction to change " +
  "a shape's colour, set change to false for that shape (still include r, g, b — any values, e.g. 0, " +
  "as they will be ignored). Do not provide any explanation or descriptive text.";
  
// The structured-response schema. Gemini is forced to return JSON
// in exactly this shape: one object per shape, each with a `change`
// flag and r/g/b integers. So our code has clear commands to follow.
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    circle: {
      type: "object",
      properties: {
        change: { type: "boolean" },   // false = leave this shape's colour unchanged
        r: { type: "integer", minimum: 0, maximum: 255 },
        g: { type: "integer", minimum: 0, maximum: 255 },
        b: { type: "integer", minimum: 0, maximum: 255 }
      },
      required: ["change", "r", "g", "b"]
    },
    square: {
      type: "object",
      properties: {
        change: { type: "boolean" },   // false = leave this shape's colour unchanged
        r: { type: "integer", minimum: 0, maximum: 255 },
        g: { type: "integer", minimum: 0, maximum: 255 },
        b: { type: "integer", minimum: 0, maximum: 255 }
      },
      required: ["change", "r", "g", "b"]
    },
    triangle: {
      type: "object",
      properties: {
        change: { type: "boolean" },   // false = leave this shape's colour unchanged
        r: { type: "integer", minimum: 0, maximum: 255 },
        g: { type: "integer", minimum: 0, maximum: 255 },
        b: { type: "integer", minimum: 0, maximum: 255 }
      },
      required: ["change", "r", "g", "b"]
    }
  },
  required: ["circle", "square", "triangle"]
};

// ---- state -------------------------------------------------
let promptInput;
let feedback;
// the current colour of each shape, as [r, g, b]
// neutral grey each shape to start
let shapeColours = {
  circle:   [200, 200, 200],
  square:   [200, 200, 200],
  triangle: [200, 200, 200]
};
let thinking = false;   // true while a request is in flight (blocks double-sends)

// ---- p5 setup ----------------------------------------------
function setup() {
  createCanvas(400, 400);
  // textFont("system-ui");

  // Feedback line above the input: "enter your prompt" → "thinking..." while busy.
  feedback = createDiv("enter your prompt");

  // The one editable field, made in code (keeps the HTML tiny).
  promptInput = createInput("");
  promptInput.attribute("placeholder", "e.g. make the circle red and the triangle blue");
  promptInput.size(360);                   // make the input nice and wide
  promptInput.elt.addEventListener("keydown", (e) => { if (e.key === "Enter") ask(); });

  const sendBtn = createButton("Send");
  sendBtn.mousePressed(ask);
}

// ---- p5 draw (runs ~60x a second) --------------------------
function draw() {
  background(0);
  noStroke();

  // the three shapes, each filled with its current colour
  fill(shapeColours.circle[0], shapeColours.circle[1], shapeColours.circle[2]);
  circle(100, 100, 100);

  rectMode(CENTER);
  fill(shapeColours.square[0], shapeColours.square[1], shapeColours.square[2]);
  rect(300, 100, 100, 100);

  fill(shapeColours.triangle[0], shapeColours.triangle[1], shapeColours.triangle[2]);
  triangle(300, 250, 350, 340, 250, 340);
}

// ---- ask Gemini, then recolour the shapes ------------------
async function ask() {
  const message = promptInput.value().trim();
  if (!message || thinking) return;

  thinking = true;
  feedback.html("thinking...");
  const answer = await askGemini(message);
  thinking = false;
  feedback.html("enter your prompt");

  console.log("answer:", answer);          // see the structured JSON in the console (F12)

  if (answer) {
    applyAnswer(answer);
  }
}

// Recolour each shape the model marked change:true; leave the others as they are.
function applyAnswer(answer) {
  for (const name of ["circle", "square", "triangle"]) {
    const s = answer[name];
    if (s && s.change) shapeColours[name] = [s.r, s.g, s.b];
  }
}

// Send one message to Gemini through the relay and return the parsed answer.
async function askGemini(userText) {
  if (GEMINI_KEY.includes("PASTE_") || PROXY_URL.includes("YOUR-SUBDOMAIN")) {
    console.warn("Edit GEMINI_KEY and PROXY_URL at the top of sketch.js first.");
    return null;
  }
  try {
    const res = await fetch(PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
      body: JSON.stringify({
        model: GEMINI_MODEL,
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ parts: [{ text: userText }] }],
        generationConfig: {
          responseMimeType: "application/json",   // ask for JSON, not prose
          responseSchema: RESPONSE_SCHEMA         // ...in exactly this shape
        }
      })
    });

    const data = await res.json();
    if (!res.ok) { console.error("Gemini error", res.status, data); return null; }

    // The JSON we asked for arrives as a string here; parse it into an object.
    const jsonText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return JSON.parse(jsonText);                  // → { circle:{…}, square:{…}, triangle:{…} }
  } catch (e) {
    console.error("Request failed:", e);
    return null;
  }
}
