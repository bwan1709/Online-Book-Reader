import * as THREE from 'three';
import { ReaderBook } from './readerBook.js';
import { PageCache } from './pageCache.js';
import { HandGestures } from './gestures.js';
import { attachPdf, detachPdf } from './storage.js';

const $ = (id) => document.getElementById(id);
const PINCH_TRAVEL = 0.2; // hand travel (fraction of frame) for a full turn

/** Full-screen ebook mode. */
export class Reader {
  /**
   * @param {{ onReload: (book, editionId?, onProgress?) => Promise<void> }} hooks
   *   reopen a shelf book (after attaching/detaching a PDF, or to switch edition)
   */
  constructor(renderer, canvas, hooks) {
    this.renderer = renderer;
    this.canvas = canvas;
    this.hooks = hooks;
    this.active = false;
    this.book = null;
    this.shelfBook = null;
    this.attached = false;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0809);
    this.camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 100);

    // Ambient + frontal key summing to ~π (Lambert divides by π): flat pages show their true colour,
    // a turning page shades as it tilts away from the key.
    this.scene.add(new THREE.AmbientLight(0xfffaf0, 0.7 * Math.PI));
    const key = new THREE.DirectionalLight(0xfff6ea, 0.32 * Math.PI);
    key.position.set(-2, 3, 6);
    this.scene.add(key);

    // Soft shadow under the book.
    const sc = document.createElement('canvas');
    sc.width = sc.height = 128;
    const sg = sc.getContext('2d');
    const grad = sg.createRadialGradient(64, 64, 10, 64, 64, 64);
    grad.addColorStop(0, 'rgba(0,0,0,0.85)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    sg.fillStyle = grad;
    sg.fillRect(0, 0, 128, 128);
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false }),
    );
    this.shadow.position.z = -0.2;
    this.scene.add(this.shadow);

    this.parallax = new THREE.Vector2();
    this.parallaxTarget = new THREE.Vector2();
    this.raycaster = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    this.drag = null;
    this.pinchDrag = null;
    this.lastWheel = 0;

    // Narrow / portrait screens read one page at a time: the camera frames the left or right page.
    this.single = false;
    this.side = 'right';
    this.focusX = 0;
    this.swipe = null;

    this.ui = {
      title: $('r-title'),
      page: $('r-page'),
      slider: $('r-slider'),
      file: $('r-file'),
      attach: $('r-attach'),
      edition: $('r-edition'),
      gesture: $('r-gesture'),
      cam: $('r-cam'),
      camStatus: $('r-cam-status'),
      flash: $('r-flash'),
      toast: $('r-toast'),
    };

    this.gestures = new HandGestures({
      video: $('r-video'),
      overlay: $('r-overlay'),
      onStatus: (text) => (this.ui.camStatus.textContent = text),
      onSwipe: (dir) => {
        this.flash(dir === 'next' ? '→' : '←');
        dir === 'next' ? this.next() : this.prev();
      },
      onPinchStart: () => (this.pinchDrag = { dir: 0 }),
      onPinchMove: (dx) => this.onPinchMove(dx),
      onPinchEnd: () => {
        if (this.pinchDrag?.dragging) this.book.endDrag();
        this.pinchDrag = null;
      },
    });

    this.bindUi();
    this.bindInput();
  }

  // ---------- Document ----------
  /**
   * @param source  page source ({ title, pageCount, aspect, render, dispose })
   * @param shelfBook  catalog entry when opened from the library (enables "Gắn PDF")
   * @param attached  whether `source` is the reader's own PDF for that shelf book
   * @param edition  which edition of a public-domain book is shown
   */
  setSource(source, shelfBook = null, attached = false, edition = null) {
    this.book?.dispose();
    if (this.book) this.scene.remove(this.book.group);
    const cache = new PageCache(source, { anisotropy: this.renderer.capabilities.getMaxAnisotropy() });
    this.book = new ReaderBook(cache);
    this.book.onChange = (s) => this.updatePageLabel(s);
    this.scene.add(this.book.group);
    this.shadow.scale.set(this.book.W * 2 * 1.5, this.book.H * 1.45, 1);
    this.ui.title.textContent = shelfBook ? `${shelfBook.title} — ${shelfBook.author}` : source.title;
    this.ui.slider.max = String(this.book.maxSpread);
    this.side = 'right';
    this.fit();
    this.focusX = this.focusTarget();
    this.updatePageLabel(this.book.spread);

    this.shelfBook = shelfBook;
    this.attached = attached;
    this.ui.attach.hidden = !(shelfBook && !shelfBook.editions);
    this.ui.attach.textContent = attached ? 'Gỡ PDF' : 'Gắn PDF';

    this.edition = edition;
    this.ui.edition.hidden = !(edition && shelfBook.editions.length > 1);
    if (edition) this.ui.edition.innerHTML = `<span class="lbl">Bản: </span>${edition.label} ⇄`;
  }

  /** Cycles to the next edition (e.g. Tiếng Việt ⇄ English) of the open book. */
  async switchEdition() {
    const book = this.shelfBook;
    if (!book?.editions || this.switching) return;
    const list = book.editions;
    const next = list[(list.indexOf(this.edition) + 1) % list.length];
    this.switching = true;
    this.toast(`Đang mở bản ${next.label}…`);
    try {
      await this.hooks.onReload(book, next.id, (p) => this.toast(`Đang dàn trang ${Math.round(p * 100)}%`));
      this.toast(`${next.title} — ${next.credit}`);
    } finally {
      this.switching = false;
    }
  }

  async onAttachClick() {
    const book = this.shelfBook;
    if (!book) return;
    if (this.attached) {
      await detachPdf(book.id);
      this.toast('Đã gỡ PDF');
      this.hooks.onReload(book);
      return;
    }
    this.ui.file.click();
  }

  async onFileChosen(file) {
    if (!file || !this.shelfBook) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      this.toast('Hãy chọn một file PDF');
      return;
    }
    await attachPdf(this.shelfBook.id, file);
    this.toast(`Đã gắn ${file.name} cho "${this.shelfBook.title}"`);
    this.hooks.onReload(this.shelfBook);
  }

  updatePageLabel(s) {
    const n = this.book.pageCount;
    // Spread s shows pages 2s (left) and 2s+1 (right), counting from 1.
    const pages = this.single ? [this.side === 'left' ? 2 * s : 2 * s + 1] : [2 * s, 2 * s + 1].filter((p) => p >= 1 && p <= n);
    this.ui.page.innerHTML = `Trang <b>${pages.join('–')}</b> / ${n}`;
    this.ui.slider.value = String(s);
  }

  // ---------- Navigation (handles single-page mode) ----------
  next() {
    const b = this.book;
    if (!b) return;
    if (!this.single) return b.next();
    if (b.busy) return;
    // Left page → slide to the right page of the same spread (if it exists).
    if (this.side === 'left' && 2 * b.spread < b.pageCount) {
      this.side = 'right';
      this.updatePageLabel(b.spread);
    } else if (b.canTurn(1)) {
      // Right page → turn the leaf; it lands on the left, where the camera is heading.
      this.side = 'left';
      b.next();
    }
  }

  prev() {
    const b = this.book;
    if (!b) return;
    if (!this.single) return b.prev();
    if (b.busy) return;
    if (this.side === 'right' && b.spread > 0) {
      this.side = 'left';
      this.updatePageLabel(b.spread);
    } else if (b.canTurn(-1)) {
      this.side = 'right';
      b.prev();
    }
  }

  jumpTo(spread) {
    if (!this.book) return;
    this.book.jumpTo(spread);
    this.side = this.book.spread === 0 ? 'right' : 'left';
    this.updatePageLabel(this.book.spread);
  }

  focusTarget() {
    if (!this.single || !this.book) return 0;
    return this.side === 'left' ? -this.book.W / 2 : this.book.W / 2;
  }

  // ---------- Layout ----------
  fit() {
    if (!this.book) return;
    const { W, H } = this.book;
    const aspect = window.innerWidth / window.innerHeight;
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const wasSingle = this.single;
    this.single = aspect < 0.85 || window.innerWidth < 640;
    // Leave room for the top bar and bottom controls; frame one page or the whole spread.
    const pagesAcross = this.single ? 1 : 2;
    // The top bar and bottom controls take ~150px whatever the screen, which matters on short screens.
    const free = Math.max(0.5, (window.innerHeight - 150) / window.innerHeight);
    const dV = (H * 1.04) / free / 2 / tan;
    const dH = (pagesAcross * W * 1.06) / 2 / (tan * aspect);
    this.distance = Math.max(dV, dH);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    if (wasSingle !== this.single) this.updatePageLabel(this.book.spread);
  }

  resize() {
    this.fit();
  }

  // ---------- Activation ----------
  setActive(value) {
    this.active = value;
    if (!value && this.gestures.running) this.toggleGestures();
  }

  async toggleGestures() {
    if (this.gestures.running || this.gesturesStarting) {
      this.gestures.stop();
      this.ui.cam.classList.remove('on');
      this.ui.gesture.classList.remove('on');
      return;
    }
    this.gesturesStarting = true;
    this.ui.cam.classList.add('on');
    this.ui.gesture.classList.add('on');
    try {
      await this.gestures.start();
    } catch (err) {
      console.error(err);
      this.gestures.stop();
      this.ui.cam.classList.remove('on');
      this.ui.gesture.classList.remove('on');
      this.toast(err.name === 'NotAllowedError' ? 'Bạn chưa cho phép dùng camera' : 'Không bật được nhận diện tay');
    } finally {
      this.gesturesStarting = false;
    }
  }

  toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  }

  // ---------- Feedback ----------
  flash(symbol) {
    const el = this.ui.flash;
    el.textContent = symbol;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  toast(text) {
    const el = this.ui.toast;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  // ---------- Input ----------
  bindUi() {
    $('r-prev').addEventListener('click', () => this.prev());
    $('r-next').addEventListener('click', () => this.next());
    this.ui.attach.addEventListener('click', () => this.onAttachClick());
    this.ui.edition.addEventListener('click', () => this.switchEdition());
    this.ui.file.addEventListener('change', () => {
      this.onFileChosen(this.ui.file.files[0]);
      this.ui.file.value = '';
    });
    this.ui.gesture.addEventListener('click', () => this.toggleGestures());
    $('r-fullscreen').addEventListener('click', () => this.toggleFullscreen());
    this.ui.slider.addEventListener('input', () => this.jumpTo(Number(this.ui.slider.value)));
  }

  bindInput() {
    window.addEventListener('keydown', (e) => {
      if (!this.active || !this.book || (e.target.tagName === 'INPUT' && e.target.type !== 'range')) return;
      const k = e.key;
      if (k === 'ArrowRight' || k === 'PageDown' || k === ' ') this.next();
      else if (k === 'ArrowLeft' || k === 'PageUp') this.prev();
      else if (k === 'Home') this.jumpTo(0);
      else if (k === 'End') this.jumpTo(this.book.maxSpread);
      else if (k === 'f' || k === 'F') this.toggleFullscreen();
      else if (k === 'g' || k === 'G') this.toggleGestures();
      else return;
      e.preventDefault();
    });

    this.canvas.addEventListener(
      'wheel',
      (e) => {
        if (!this.active || !this.book) return;
        e.preventDefault();
        const now = performance.now();
        if (now - this.lastWheel < 350 || Math.abs(e.deltaY) < 8) return;
        this.lastWheel = now;
        e.deltaY > 0 ? this.next() : this.prev();
      },
      { passive: false },
    );

    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.active || !this.book) return;
      // Single-page mode: swipe sideways to turn, or tap the right/left half of the screen.
      if (this.single) {
        this.swipe = { sx: e.clientX, sy: e.clientY };
        return;
      }
      if (this.book.busy) return;
      const hit = this.hitBook(e);
      if (!hit) return;
      this.canvas.setPointerCapture(e.pointerId);
      this.drag = { x0: hit.x, sx: e.clientX, sy: e.clientY, dir: hit.x > 0 ? 1 : -1, started: false };
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.active) return;
      this.parallaxTarget.set(e.clientX / window.innerWidth - 0.5, e.clientY / window.innerHeight - 0.5);
      const hit = this.hitBook(e);
      this.canvas.style.cursor = this.drag?.started ? 'grabbing' : hit ? 'pointer' : 'default';

      const d = this.drag;
      if (!d) return;
      if (!d.started && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 6) {
        d.started = this.book.beginDrag(d.dir);
        if (!d.started) this.drag = null;
      }
      const p = d.started && this.hitBook(e, false);
      if (p) {
        // Keep the grabbed point under the cursor: the page edge moves by the pointer delta.
        const W = this.book.W;
        const edgeX = d.dir > 0 ? p.x + (W - d.x0) : p.x + (-W - d.x0);
        this.book.setDragProgress(this.book.progressFromX(edgeX));
      }
    });

    const endPointer = (e) => {
      const sw = this.swipe;
      this.swipe = null;
      if (sw && this.active && e.type === 'pointerup') {
        const dx = e.clientX - sw.sx;
        const dy = e.clientY - sw.sy;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) dx < 0 ? this.next() : this.prev();
        else if (Math.hypot(dx, dy) < 10) e.clientX > window.innerWidth / 2 ? this.next() : this.prev();
        return;
      }
      const d = this.drag;
      this.drag = null;
      if (!d || !this.active) return;
      if (d.started) this.book.endDrag();
      else if (e.type === 'pointerup') d.dir > 0 ? this.next() : this.prev();
    };
    this.canvas.addEventListener('pointerup', endPointer);
    this.canvas.addEventListener('pointercancel', endPointer);
  }

  /** Point on the page plane under the pointer; null if outside the book (when bounded). */
  hitBook(e, bounded = true) {
    if (!this.book) return null;
    const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const p = this.raycaster.ray.intersectPlane(this.plane, new THREE.Vector3());
    if (!p || !bounded) return p;
    const { W, H } = this.book;
    return Math.abs(p.x) <= W && Math.abs(p.y) <= H / 2 ? p : null;
  }

  /** Pinch-and-drag: the first clear movement decides direction, then hand travel maps to turn progress. */
  onPinchMove(dx) {
    const pd = this.pinchDrag;
    if (!pd || !this.book) return;
    if (!pd.dir) {
      // One page at a time: a pinch-and-pull simply turns once.
      if (this.single) {
        if (Math.abs(dx) < 0.06) return;
        pd.dir = dx < 0 ? 1 : -1;
        pd.dir > 0 ? this.next() : this.prev();
        return;
      }
      if (Math.abs(dx) < 0.03 || this.book.busy) return;
      const dir = dx < 0 ? 1 : -1;
      if (!this.book.beginDrag(dir)) return;
      pd.dir = dir;
      pd.dragging = true;
    }
    if (!pd.dragging) return;
    const t = Math.min(1, Math.abs(dx) / PINCH_TRAVEL);
    const movedRightWay = pd.dir > 0 ? dx < 0 : dx > 0;
    const amount = movedRightWay ? t : 0;
    this.book.setDragProgress(pd.dir > 0 ? amount : 1 - amount);
  }

  // ---------- Frame ----------
  update(dt) {
    if (!this.book) return;
    this.book.update(dt);
    this.parallax.lerp(this.parallaxTarget, Math.min(1, dt * 3));
    this.focusX += (this.focusTarget() - this.focusX) * (1 - Math.exp(-dt * 6));
    const d = this.distance;
    const x = this.focusX;
    this.camera.position.set(x + this.parallax.x * d * 0.03, -d * 0.06 - this.parallax.y * d * 0.02, d);
    this.camera.lookAt(x, -0.02, 0);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
