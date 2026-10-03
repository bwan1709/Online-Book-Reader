// Hand tracking with MediaPipe Hand Landmarker, running entirely in the browser.
// Assets are served locally from /public (see scripts/setup-assets.mjs).
const WASM_PATH = '/mediapipe/wasm';
const MODEL_PATH = '/models/hand_landmarker.task';

// Swipe = a quick flick, not a long arm movement.
const SWIPE_WINDOW_MS = 250;
const SWIPE_MIN_DISTANCE = 0.07; // fraction of frame width
const SWIPE_MIN_SPEED = 0.5; // frame widths per second, measured over the last ~100 ms
const SWIPE_COOLDOWN_MS = 450;
const REVERSE_BLOCK_MS = 900; // ignore the hand drifting back after a flick

const PINCH_ON = 0.33; // thumb–index distance relative to palm size
const PINCH_OFF = 0.5;
const POSE_FRAMES = 2; // a new pose must hold this many frames before it takes effect

// Smoothing (exponential moving average): higher = more responsive, lower = steadier.
const SMOOTH_POS = 0.55;

const KNUCKLES = [5, 9, 13, 17];
const FINGERS = [
  [8, 6],
  [12, 10],
  [16, 14],
  [20, 18],
]; // [tip, pip]

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const avg = (lm, ids) => ({
  x: ids.reduce((s, i) => s + lm[i].x, 0) / ids.length,
  y: ids.reduce((s, i) => s + lm[i].y, 0) / ids.length,
});

const STATUS = {
  none: 'Đưa tay vào khung hình',
  open: '✋ Hất tay ← → để lật · 🤏 Chụm để kéo trang',
  pinch: '🤏 Đang giữ trang — kéo để lật',
  fist: '✊ Tạm dừng — xòe tay để tiếp tục',
};

/**
 * Poses: 'open' (flick to swipe), 'pinch' (grab a page), 'fist' (pause: move the hand freely).
 *
 * Emits:
 *  onSwipe('next' | 'prev')
 *  onPinchStart() / onPinchMove(dx) / onPinchEnd()
 *  onStatus(text)
 * Positions are in mirrored frame coordinates (x: 0 = user's left, 1 = user's right).
 */
export class HandGestures {
  constructor(handlers) {
    Object.assign(this, handlers);
    this.video = handlers.video;
    this.overlay = handlers.overlay;
    this.running = false;
    this.pose = 'none';
    this.candidate = { pose: 'none', frames: 0 };
    this.smooth = null;
    this.history = [];
    this.cooldownUntil = 0;
    this.lastSwipe = { dir: null, t: 0 };
    this.lastVideoTime = -1;
    this.loop = this.loop.bind(this);
  }

  async start() {
    this.onStatus('Đang bật camera…');
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play();

    this.onStatus('Đang tải mô hình nhận diện tay…');
    const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: MODEL_PATH, delegate },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.6,
      minTrackingConfidence: 0.5,
    });
    try {
      this.landmarker = await HandLandmarker.createFromOptions(fileset, options('GPU'));
    } catch {
      this.landmarker = await HandLandmarker.createFromOptions(fileset, options('CPU'));
    }
    this.connections = HandLandmarker.HAND_CONNECTIONS;

    this.running = true;
    this.onStatus(STATUS.none);
    requestAnimationFrame(this.loop);
  }

  stop() {
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.landmarker?.close();
    this.landmarker = null;
    this.video.srcObject = null;
    this.setPose('none');
    const g = this.overlay.getContext('2d');
    g.clearRect(0, 0, this.overlay.width, this.overlay.height);
  }

  loop() {
    if (!this.running) return;
    if (this.video.readyState >= 2 && this.video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = this.video.currentTime;
      const result = this.landmarker.detectForVideo(this.video, performance.now());
      this.process(result.landmarks?.[0]);
    }
    requestAnimationFrame(this.loop);
  }

  classify(lm) {
    const wrist = lm[0];
    const curled = FINGERS.filter(([tip, pip]) => dist(lm[tip], wrist) < dist(lm[pip], wrist)).length;
    if (curled >= 3) return 'fist';
    const indexExtended = dist(lm[8], wrist) > dist(lm[6], wrist);
    const pinch = dist(lm[4], lm[8]) / dist(lm[0], lm[9]);
    const threshold = this.pose === 'pinch' ? PINCH_OFF : PINCH_ON; // hysteresis
    return indexExtended && pinch < threshold ? 'pinch' : 'open';
  }

  setPose(pose) {
    if (pose === this.pose) return;
    if (this.pose === 'pinch') this.onPinchEnd();
    this.pose = pose;
    this.history.length = 0;
    if (pose === 'pinch') {
      this.anchor = { ...this.smooth };
      this.onPinchStart();
    } else if (pose === 'open') {
      // Leaving pinch/fist often looks like a flick; give it a moment.
      this.cooldownUntil = Math.max(this.cooldownUntil, performance.now() + 300);
    }
    this.onStatus(STATUS[pose]);
  }

  process(lm) {
    this.draw(lm);
    if (!lm) {
      this.smooth = null;
      this.candidate = { pose: 'none', frames: 0 };
      this.setPose('none');
      return;
    }

    // Smoothed hand position (knuckles + index/middle tips, so a wrist flick counts).
    const x = 1 - avg(lm, [...KNUCKLES, 8, 12]).x;
    if (!this.smooth) this.smooth = { x };
    else this.smooth.x += (x - this.smooth.x) * SMOOTH_POS;

    const seen = this.classify(lm);
    if (seen === this.candidate.pose) this.candidate.frames++;
    else this.candidate = { pose: seen, frames: 1 };
    if (this.candidate.frames >= POSE_FRAMES || this.pose === 'none') this.setPose(this.candidate.pose);

    if (this.pose === 'pinch') this.onPinchMove(this.smooth.x - this.anchor.x);
    else if (this.pose === 'open') this.detectSwipe(this.smooth.x);
  }

  detectSwipe(x) {
    const now = performance.now();
    this.history.push({ t: now, x });
    while (this.history.length && now - this.history[0].t > SWIPE_WINDOW_MS) this.history.shift();
    if (now < this.cooldownUntil || this.history.length < 3) return;

    // Distance from the furthest point in the window, plus recent speed.
    const xs = this.history.map((h) => h.x);
    const movedLeft = Math.max(...xs) - x;
    const movedRight = x - Math.min(...xs);
    const recent = this.history.find((h) => now - h.t <= 100) ?? this.history[0];
    const speed = (x - recent.x) / Math.max(0.016, (now - recent.t) / 1000);

    let dir = null;
    if (movedLeft >= SWIPE_MIN_DISTANCE && -speed >= SWIPE_MIN_SPEED) dir = 'next';
    else if (movedRight >= SWIPE_MIN_DISTANCE && speed >= SWIPE_MIN_SPEED) dir = 'prev';
    if (!dir) return;
    if (this.lastSwipe.dir && this.lastSwipe.dir !== dir && now - this.lastSwipe.t < REVERSE_BLOCK_MS) return;

    this.lastSwipe = { dir, t: now };
    this.cooldownUntil = now + SWIPE_COOLDOWN_MS;
    this.history.length = 0;
    this.onSwipe(dir);
  }

  draw(lm) {
    const c = this.overlay;
    const w = (c.width = c.clientWidth * devicePixelRatio);
    const h = (c.height = c.clientHeight * devicePixelRatio);
    const g = c.getContext('2d');
    g.clearRect(0, 0, w, h);
    if (!lm) return;

    const P = (p) => [(1 - p.x) * w, p.y * h];
    const accent = this.pose === 'open' ? 'rgba(232,226,212,0.75)' : '#ff2a3d';
    g.lineWidth = 2 * devicePixelRatio;
    g.strokeStyle = accent;
    for (const { start, end } of this.connections) {
      g.beginPath();
      g.moveTo(...P(lm[start]));
      g.lineTo(...P(lm[end]));
      g.stroke();
    }
    g.fillStyle = '#ff2a3d';
    for (const p of lm) {
      g.beginPath();
      g.arc(...P(p), 3 * devicePixelRatio, 0, Math.PI * 2);
      g.fill();
    }
    if (this.pose === 'pinch') {
      g.lineWidth = 5 * devicePixelRatio;
      g.beginPath();
      g.moveTo(...P(lm[4]));
      g.lineTo(...P(lm[8]));
      g.stroke();
    }
  }
}
