import * as THREE from 'three';
import { createIntro } from './intro.js';
import { Reader } from './reader/reader.js';
import { Library, loadBookSource } from './library/library.js';
import { BOOKS } from './library/catalog.js';
import { initStorage } from './reader/storage.js';

// Page textures are drawn with the web fonts, so give them a moment to load.
// The sample text makes the browser fetch the Vietnamese subsets too, not just Latin.
const VI = 'Tiếng Việt — ầẫậắằẳẵặềễệốồổỗộớờởỡợứừửữựỳỷỹỵđ';
await Promise.race([
  Promise.all(
    [
      "600 72px 'Cormorant Garamond'",
      "italic 500 72px 'Cormorant Garamond'",
      "400 72px 'EB Garamond'",
      "italic 400 72px 'EB Garamond'",
      "400 72px 'Be Vietnam Pro'",
      "500 72px 'Be Vietnam Pro'",
    ].map((font) => document.fonts.load(font, VI)),
  ),
  new Promise((r) => setTimeout(r, 2500)),
]);

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

await initStorage();

const fade = document.getElementById('fade');
const intro = createIntro(renderer, canvas);
const reader = new Reader(renderer, canvas, {
  onReload: async (book, editionId, onProgress) => {
    const { source, attached, edition } = await loadBookSource(book, onProgress, editionId);
    reader.setSource(source, book, attached, edition);
  },
});
const library = new Library({
  onOpen: (source, book, attached, edition) => {
    reader.setSource(source, book, attached, edition);
    go('reader');
  },
});

// 'home' | 'library' | 'reader'. Home and library share the particle scene.
let view = 'home';
let switching = false;

function apply() {
  document.body.dataset.view = view;
  const reading = view === 'reader';
  // The reader wants true paper colours; the particle scene wants filmic contrast.
  renderer.toneMapping = reading ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
  intro.setEnabled(view === 'home');
  setImmersive(false);
  intro.setMode(view === 'library' ? 'library' : 'home');
  reader.setActive(reading);
  canvas.style.cursor = 'default';
  if (view === 'library') library.animateIn();
}

/** Home ⇄ library slide over the live scene; anything involving the reader fades through black. */
function go(next) {
  if (switching || view === next) return;
  if (view !== 'reader' && next !== 'reader') {
    view = next;
    apply();
    return;
  }
  switching = true;
  fade.classList.add('on');
  setTimeout(() => {
    view = next;
    apply();
    fade.classList.remove('on');
    setTimeout(() => (switching = false), 600);
  }, 700);
}

// ---------- Immersive: click the home scene to watch it full screen ----------
let immersive = false;
const hint = document.getElementById('immersive-hint');

function setImmersive(on) {
  if (on === immersive) return;
  immersive = on;
  document.body.classList.toggle('immersive', on);
  intro.setMode(on ? 'immersive' : 'home');
  if (on) {
    document.documentElement.requestFullscreen?.().catch(() => {});
    hint.classList.remove('show');
    void hint.offsetWidth;
    hint.classList.add('show');
  } else if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
}

let downAt = null;
canvas.addEventListener('pointerdown', (e) => (downAt = { x: e.clientX, y: e.clientY }));
canvas.addEventListener('pointerup', (e) => {
  if (view !== 'home' || !downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) return;
  setImmersive(!immersive);
});
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && immersive) setImmersive(false);
});

document.getElementById('enter').addEventListener('click', () => go('library'));
document.getElementById('lib-back').addEventListener('click', () => go('home'));
document.getElementById('r-exit').addEventListener('click', () => go('library'));
window.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && view === 'home') go('library');
  if (e.key === 'Escape' && view === 'library') go('home');
  if (e.key === 'Escape' && immersive) setImmersive(false);
});

// Drop a PDF anywhere: it's saved to the reader's shelf and opened.
const drop = document.getElementById('drop');
window.addEventListener('dragover', (e) => {
  e.preventDefault();
  drop.classList.add('on');
});
window.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) drop.classList.remove('on');
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('on');
  if (e.dataTransfer.files[0]) library.importFile(e.dataTransfer.files[0]);
});

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  intro.resize();
  reader.resize();
});

// ?view=library opens the shelf; ?book=<id>[&edition=vi|en] opens a book straight away.
const params = new URLSearchParams(location.search);
if (params.get('view') === 'library') view = 'library';
apply();
const direct = BOOKS.find((b) => b.id === params.get('book'));
if (direct) {
  const { source, attached, edition } = await loadBookSource(direct, null, params.get('edition'));
  reader.setSource(source, direct, attached, edition);
  view = 'reader';
  apply();
}

const timer = new THREE.Timer();
renderer.setAnimationLoop((time) => {
  timer.update(time);
  const dt = Math.min(timer.getDelta(), 0.05);
  const t = timer.getElapsed();
  if (view === 'reader') {
    reader.update(dt);
    reader.render();
  } else {
    intro.update(dt, t);
    intro.render();
  }
});
