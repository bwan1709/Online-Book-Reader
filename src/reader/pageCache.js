import * as THREE from 'three';

function makeTexture(canvas, anisotropy) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  return tex;
}

/** Inside-cover paper shown where there is no page (before the first / after the last). */
function makeEndpaper(w, h, anisotropy) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#4a0812';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(232,226,212,0.08)';
  g.lineWidth = 2;
  const step = w / 12;
  for (let x = -h; x < w + h; x += step) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x + h, h);
    g.moveTo(x + h, 0);
    g.lineTo(x, h);
    g.stroke();
  }
  const s = h / 1570;
  g.fillStyle = 'rgba(232,226,212,0.55)';
  g.textAlign = 'center';
  g.font = `400 ${22 * s}px 'JetBrains Mono', monospace`;
  g.letterSpacing = `${10 * s}px`;
  g.fillText('EX LIBRIS', w / 2 + 5 * s, h / 2 - 30 * s);
  g.font = `700 ${56 * s}px 'Cinzel', serif`;
  g.letterSpacing = `${14 * s}px`;
  g.fillText('NEXVS', w / 2 + 7 * s, h / 2 + 40 * s);
  return makeTexture(c, anisotropy);
}

/**
 * Renders pages on demand into canvas textures, newest request first,
 * keeping at most `limit` pages in memory.
 */
export class PageCache {
  constructor(source, { anisotropy = 8 } = {}) {
    const touch = matchMedia('(pointer: coarse)').matches;
    this.source = source;
    this.anisotropy = anisotropy;
    // Phones have far less GPU memory: smaller page textures, fewer kept around.
    this.limit = touch ? 12 : 40;
    const screen = Math.max(window.innerHeight, window.innerWidth / 0.7) * Math.min(window.devicePixelRatio, 2);
    this.height = Math.round(Math.min(touch ? 1600 : 2048, Math.max(1100, screen)));
    this.width = Math.round(this.height * source.aspect);
    this.entries = new Map();
    this.pending = [];
    this.working = false;
    this.endpaper = makeEndpaper(this.width, this.height, anisotropy);
  }

  get(index) {
    if (index < 0 || index >= this.source.pageCount) return this.endpaper;
    let entry = this.entries.get(index);
    if (entry) {
      this.entries.delete(index);
      this.entries.set(index, entry);
      return entry.texture;
    }

    const canvas = document.createElement('canvas');
    canvas.width = this.width;
    canvas.height = this.height;
    const g = canvas.getContext('2d');
    g.fillStyle = '#efe9dc';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = 'rgba(22,19,15,0.3)';
    g.font = `${canvas.height / 30}px 'JetBrains Mono', monospace`;
    g.textAlign = 'center';
    g.fillText('· · ·', canvas.width / 2, canvas.height / 2);
    g.textAlign = 'left';

    entry = { canvas, texture: makeTexture(canvas, this.anisotropy), index };
    this.entries.set(index, entry);
    this.pending.push(entry);
    this.evict();
    this.work();
    return entry.texture;
  }

  preload(indices) {
    for (const i of indices) this.get(i);
  }

  evict() {
    while (this.entries.size > this.limit) {
      const [oldest, entry] = this.entries.entries().next().value;
      this.entries.delete(oldest);
      entry.texture.dispose();
      entry.evicted = true;
    }
  }

  async work() {
    if (this.working) return;
    this.working = true;
    while (this.pending.length) {
      const entry = this.pending.pop();
      if (entry.evicted || this.disposed) continue;
      try {
        await this.source.render(entry.index, entry.canvas);
        entry.texture.needsUpdate = true;
      } catch (err) {
        console.error(`Failed to render page ${entry.index + 1}`, err);
      }
    }
    this.working = false;
  }

  dispose() {
    this.disposed = true;
    for (const { texture } of this.entries.values()) texture.dispose();
    this.endpaper.dispose();
    this.entries.clear();
    this.source.dispose();
  }
}
