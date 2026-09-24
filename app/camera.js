// ==============================================================
// camera.js — the robot's optional "eyes" (laptop webcam).
//
// Off by default. Ticking the Camera toggle turns the webcam ON immediately and
// a live preview is drawn on the canvas (see sketch.js → drawCameraPreview).
// A single still frame is captured only when a turn is SENT (sketch.js grabs
// Webcam.snapshot() in runTurn) and handed to brain.js to send to Gemini — so
// the reply and gaze can react to what the robot sees. We never stream frames
// to the model and never store them.
//
// Privacy: enabling asks the browser for camera permission; disabling stops the
// media track (the webcam light goes off).
// ==============================================================

const Webcam = (() => {
    const TARGET_W = 512;       // downscale width for the frame sent to Gemini
    const JPEG_QUALITY = 0.5;   // small enough to keep latency/quota reasonable

    let capture = null;         // p5 MediaElement wrapping the <video>
    let want = false;           // student asked for the camera to be on

    // Turn the webcam ON. Idempotent. Asks for permission the first time.
    function enable() {
        want = true;
        if (capture) return;
        capture = createCapture(VIDEO);   // browser permission prompt
        const v = capture.elt;
        v.setAttribute('playsinline', '');
        v.muted = true;
        // Keep the <video> decoding but out of sight. NOTE: a display:none video
        // won't reliably paint to a canvas, so we position it off-screen instead
        // of hiding it — the preview is drawn on the p5 canvas from this element.
        capture.style('position', 'fixed');
        capture.style('left', '-10000px');
        capture.style('top', '0');
        capture.style('width', '2px');
        capture.style('height', '2px');
        capture.style('opacity', '0');
        capture.style('pointer-events', 'none');
    }

    // Turn the webcam OFF and release it (stops the track → camera light off).
    function disable() {
        want = false;
        if (!capture) return;
        try { capture.elt.srcObject.getTracks().forEach((t) => t.stop()); } catch (e) {}
        capture.remove();
        capture = null;
    }

    function toggle() { return isRequested() ? disable() : enable(); }
    function isRequested() { return want; }
    function videoEl() { return capture && capture.elt; }   // for the canvas preview
    // Live once the stream reports real frame dimensions (there's something to draw/send).
    function isLive() { return !!(want && capture && capture.elt && capture.elt.videoWidth > 0); }

    // One downscaled JPEG frame as base64 (no data: prefix), or null if off/not ready.
    function snapshot() {
        const v = videoEl();
        if (!isLive()) return null;
        const w = TARGET_W;
        const h = Math.round(TARGET_W * v.videoHeight / v.videoWidth) || Math.round(TARGET_W * 0.75);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        try {
            c.getContext('2d').drawImage(v, 0, 0, w, h);
            return c.toDataURL('image/jpeg', JPEG_QUALITY).split(',')[1] || null;
        } catch (e) { return null; }
    }

    return { enable, disable, toggle, isRequested, isLive, videoEl, snapshot };
})();
