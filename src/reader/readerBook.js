import * as THREE from 'three';

const SEG = 40;
const STACK_MIN = 0.006;
const STACK_MAX = 0.05;
const easeInOut = (x) => 0.5 - 0.5 * Math.cos(Math.PI * x);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function gutterTexture(darkOnLeft) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 4;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(darkOnLeft ? 0 : 256, 0, darkOnLeft ? 256 : 0, 0);
  grad.addColorStop(0, 'rgba(0,0,0,0.38)');
  grad.addColorStop(0.06, 'rgba(0,0,0,0.16)');
  grad.addColorStop(0.2, 'rgba(0,0,0,0)');
  grad.addColorStop(0.97, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.12)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * A full-screen two-page spread. Spread `s` shows page 2s-1 on the left and 2s on the right,
 * so page 0 (the cover) sits alone on the right like a real book.
 *
 * Turning uses the same trick as the intro book: the static top planes swap textures at
 * the start/end of a turn, and a single bending page is visible only while in flight.
 */
export class ReaderBook {
  constructor(cache) {
    this.cache = cache;
    this.pageCount = cache.source.pageCount;
    this.maxSpread = Math.floor(this.pageCount / 2);
    this.H = 2;
    this.W = 2 * cache.source.aspect;
    this.spread = 0;
    this.flight = null;
    this.queue = [];
    this.onChange = () => {};

    const { W, H } = this;
    this.group = new THREE.Group();

    const boardMat = new THREE.MeshStandardMaterial({ color: 0x1a0b0e, roughness: 0.6, metalness: 0.15 });
    const boardGeo = new THREE.BoxGeometry(W + 0.07, H + 0.1, 0.04);
    for (const side of [-1, 1]) {
      const board = new THREE.Mesh(boardGeo, boardMat);
      board.position.set(side * (W / 2 + 0.02), 0, -STACK_MAX - 0.02);
      this.group.add(board);
    }
    const spine = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, H + 0.1, 16), boardMat);
    spine.position.z = -STACK_MAX - 0.03;
    this.group.add(spine);

    const edgeMat = new THREE.MeshStandardMaterial({ color: 0xd8d0bf, roughness: 1 });
    const stackGeo = new THREE.BoxGeometry(W, H, 1);
    this.leftStack = new THREE.Mesh(stackGeo, edgeMat);
    this.rightStack = new THREE.Mesh(stackGeo, edgeMat);
    this.leftStack.position.x = -W / 2;
    this.rightStack.position.x = W / 2;
    this.group.add(this.leftStack, this.rightStack);

    const topGeo = new THREE.PlaneGeometry(W, H);
    const pageMat = () => new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
    this.leftTop = new THREE.Mesh(topGeo, pageMat());
    this.rightTop = new THREE.Mesh(topGeo, pageMat());
    this.leftTop.position.x = -W / 2;
    this.rightTop.position.x = W / 2;

    const shadeMat = (darkOnLeft) =>
      new THREE.MeshBasicMaterial({ map: gutterTexture(darkOnLeft), transparent: true, depthWrite: false });
    this.leftShade = new THREE.Mesh(topGeo, shadeMat(false));
    this.rightShade = new THREE.Mesh(topGeo, shadeMat(true));
    this.leftTop.add(this.leftShade);
    this.rightTop.add(this.rightShade);
    this.leftShade.position.z = this.rightShade.position.z = 0.0005;
    this.group.add(this.leftTop, this.rightTop);

    this.page = this.makeTurningPage();
    this.group.add(this.page.mesh);

    this.refresh();
  }

  makeTurningPage() {
    const { W, H } = this;
    const geo = new THREE.PlaneGeometry(W, H, SEG, 1);
    geo.translate(W / 2, 0, 0);

    // Back face shares positions/normals; mirrored U so it reads correctly once turned.
    const backGeo = new THREE.BufferGeometry();
    backGeo.setIndex(geo.index);
    backGeo.setAttribute('position', geo.attributes.position);
    backGeo.setAttribute('normal', geo.attributes.normal);
    const uv = geo.attributes.uv.clone();
    for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
    backGeo.setAttribute('uv', uv);

    const front = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ roughness: 1, side: THREE.FrontSide }));
    const back = new THREE.Mesh(backGeo, new THREE.MeshStandardMaterial({ roughness: 1, side: THREE.BackSide }));
    front.frustumCulled = back.frustumCulled = false;
    const mesh = new THREE.Group();
    mesh.add(front, back);
    mesh.visible = false;

    const pos = geo.attributes.position;
    const cols = new Int16Array(pos.count);
    const ys = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      cols[i] = Math.round(pos.getX(i) / (W / SEG));
      ys[i] = pos.getY(i);
    }
    return { mesh, front, back, geo, cols, ys, px: new Float32Array(SEG + 1), pz: new Float32Array(SEG + 1) };
  }

  tex(index) {
    return this.cache.get(index);
  }

  setMap(mesh, texture) {
    if (mesh.material.map === texture) return;
    mesh.material.map = texture;
    mesh.material.needsUpdate = true;
  }

  /** Sync static pages and stack thickness to the current spread. */
  refresh() {
    const s = this.spread;
    this.setMap(this.leftTop, this.tex(2 * s - 1));
    this.setMap(this.rightTop, this.tex(2 * s));
    this.updateStacks(s / Math.max(1, this.maxSpread));
    this.cache.preload([2 * s + 1, 2 * s + 2, 2 * s - 2, 2 * s - 3, 2 * s + 3, 2 * s + 4]);
    this.onChange(s);
  }

  updateStacks(progress) {
    const left = STACK_MIN + (STACK_MAX - STACK_MIN) * progress;
    const right = STACK_MIN + (STACK_MAX - STACK_MIN) * (1 - progress);
    for (const [stack, top, depth] of [
      [this.leftStack, this.leftTop, left],
      [this.rightStack, this.rightTop, right],
    ]) {
      stack.scale.z = depth;
      stack.position.z = -STACK_MAX + depth / 2;
      top.position.z = -STACK_MAX + depth + 0.001;
    }
    this.hingeZ = Math.max(this.leftTop.position.z, this.rightTop.position.z) + 0.002;
  }

  get busy() {
    return this.flight !== null;
  }

  canTurn(dir) {
    return dir > 0 ? this.spread < this.maxSpread : this.spread > 0;
  }

  next() {
    this.request(1);
  }

  prev() {
    this.request(-1);
  }

  request(dir) {
    if (this.flight) {
      if (this.queue.length < 4) this.queue.push(dir);
      return;
    }
    if (this.startTurn(dir, false)) this.flight.target = dir > 0 ? 1 : 0;
  }

  jumpTo(spread) {
    if (this.flight) return;
    this.queue.length = 0;
    this.spread = clamp(Math.round(spread), 0, this.maxSpread);
    this.refresh();
  }

  startTurn(dir, manual) {
    if (this.flight || !this.canTurn(dir)) return false;
    const s = this.spread;
    const { front, back } = this.page;
    if (dir > 0) {
      this.setMap(front, this.tex(2 * s));
      this.setMap(back, this.tex(2 * s + 1));
      this.setMap(this.rightTop, this.tex(2 * s + 2));
    } else {
      this.setMap(front, this.tex(2 * s - 2));
      this.setMap(back, this.tex(2 * s - 1));
      this.setMap(this.leftTop, this.tex(2 * s - 3));
    }
    const p = dir > 0 ? 0 : 1;
    this.flight = { dir, p, target: p, dragTarget: p, manual };
    this.page.mesh.visible = true;
    this.bend(p, dir);
    return true;
  }

  // ---- Manual control (mouse drag / pinch) ----
  beginDrag(dir) {
    return this.startTurn(dir, true);
  }

  /** The page eases towards this progress in update(), which hides hand/mouse jitter. */
  setDragProgress(p) {
    if (!this.flight?.manual) return;
    this.flight.dragTarget = clamp(p, 0, 1);
  }

  endDrag(forceComplete = false) {
    const f = this.flight;
    if (!f?.manual) return;
    f.manual = false;
    const complete = forceComplete || (f.dir > 0 ? f.dragTarget > 0.35 : f.dragTarget < 0.65);
    const doneAt = f.dir > 0 ? 1 : 0;
    f.target = complete ? doneAt : 1 - doneAt;
  }

  finish() {
    const f = this.flight;
    const completed = f.dir > 0 ? f.target === 1 : f.target === 0;
    if (completed) this.spread += f.dir;
    this.flight = null;
    this.page.mesh.visible = false;
    this.refresh();
    while (this.queue.length) {
      const dir = this.queue.shift();
      if (this.startTurn(dir, false)) {
        this.flight.target = dir > 0 ? 1 : 0;
        break;
      }
    }
  }

  bend(p, dir) {
    const { W, page } = this;
    const angle = easeInOut(p) * Math.PI;
    const curl = -dir * Math.sin(Math.PI * p) * 0.7;
    const ds = W / SEG;
    let x = 0;
    let z = 0;
    for (let i = 1; i <= SEG; i++) {
      const phi = clamp(angle + curl * ((i - 0.5) / SEG), 0, Math.PI);
      x += Math.cos(phi) * ds;
      z += Math.sin(phi) * ds;
      page.px[i] = x;
      page.pz[i] = z;
    }
    const pos = page.geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const c = page.cols[i];
      pos.setXYZ(i, page.px[c], page.ys[i], this.hingeZ + page.pz[c]);
    }
    pos.needsUpdate = true;
    page.geo.computeVertexNormals();
  }

  update(dt) {
    const f = this.flight;
    if (!f) return;
    if (f.manual) {
      f.p += (f.dragTarget - f.p) * (1 - Math.exp(-dt * 14));
      this.bend(f.p, f.dir);
      return;
    }
    const speed = this.queue.length ? 2.6 : 1.4;
    const step = dt * speed;
    f.p = f.target > f.p ? Math.min(f.target, f.p + step) : Math.max(f.target, f.p - step);
    this.bend(f.p, f.dir);
    if (f.p === f.target) this.finish();
  }

  /** Converts a pointer x on the book plane to turn progress, for dragging. */
  progressFromX(x) {
    const angle = Math.acos(clamp(x / this.W, -1, 1));
    return Math.acos(clamp(1 - (2 * angle) / Math.PI, -1, 1)) / Math.PI;
  }

  dispose() {
    this.group.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) {
        o.material.dispose();
      }
    });
    this.leftShade.material.map.dispose();
    this.rightShade.material.map.dispose();
    this.cache.dispose();
  }
}
