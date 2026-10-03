// Shared drawing helpers for generated book pages. All sizes are for a 1100×1570 reference page
// and are multiplied by `s` (canvas height / 1570) when drawing.

export const REF_W = 1100;
export const REF_H = 1570;
export const DISPLAY = "'Cormorant Garamond', Georgia, serif";
export const BODY = "'EB Garamond', Georgia, serif";
export const SANS = "'Be Vietnam Pro', system-ui, sans-serif";
export const INK = '#17140f';
export const CRIMSON = '#a10d24';
export const PAPER = '#efe9dc';

export function paper(g, w, h) {
  g.fillStyle = PAPER;
  g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(40,30,20,0.05)';
  for (let i = 0; i < 3000; i++) g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
  const v = g.createRadialGradient(w / 2, h / 2, h * 0.25, w / 2, h / 2, h * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(60,40,20,0.16)');
  g.fillStyle = v;
  g.fillRect(0, 0, w, h);
}

export function resetText(g) {
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.letterSpacing = '0px';
}

export function wrap(g, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (g.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function centered(g, text, y, font, color, spacing = 0) {
  g.font = font;
  g.fillStyle = color;
  g.letterSpacing = `${spacing}px`;
  g.textAlign = 'center';
  // letterSpacing adds trailing space; nudge to keep the optical centre.
  g.fillText(text, g.canvas.width / 2 + spacing / 2, y);
  resetText(g);
}

export function runningHead(g, w, s, text) {
  g.fillStyle = 'rgba(23,20,15,0.5)';
  g.font = `italic 400 ${24 * s}px ${BODY}`;
  g.textAlign = 'center';
  g.fillText(text, w / 2, 92 * s);
  resetText(g);
}

export function folio(g, w, h, s, n) {
  g.fillStyle = 'rgba(23,20,15,0.6)';
  g.font = `400 ${24 * s}px ${BODY}`;
  g.textAlign = 'center';
  g.fillText(String(n), w / 2, h - 70 * s);
  resetText(g);
}

/** Full-bleed cover: the fetched image if available, otherwise a typographic cover. */
export function drawCover(g, w, h, book, image) {
  resetText(g);
  if (image) {
    g.fillStyle = '#0c0b0c';
    g.fillRect(0, 0, w, h);
    // Cover-fit the image.
    const scale = Math.max(w / image.width, h / image.height);
    const iw = image.width * scale;
    const ih = image.height * scale;
    g.drawImage(image, (w - iw) / 2, (h - ih) / 2, iw, ih);
    // Spine shading on the left edge.
    const spine = g.createLinearGradient(0, 0, w * 0.08, 0);
    spine.addColorStop(0, 'rgba(0,0,0,0.45)');
    spine.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = spine;
    g.fillRect(0, 0, w * 0.08, h);
    return;
  }
  const s = h / REF_H;
  g.fillStyle = book.color || '#141214';
  g.fillRect(0, 0, w, h);
  const light = isLight(book.color);
  const ink = light ? INK : '#e8e2d4';
  g.strokeStyle = light ? 'rgba(23,20,15,0.35)' : 'rgba(232,226,212,0.35)';
  g.lineWidth = 2 * s;
  g.strokeRect(60 * s, 60 * s, w - 120 * s, h - 120 * s);
  g.font = `600 ${110 * s}px ${DISPLAY}`;
  g.fillStyle = ink;
  g.textAlign = 'center';
  let y = h * 0.4;
  for (const line of wrap(g, book.title, w - 200 * s)) {
    g.fillText(line, w / 2, y);
    y += 120 * s;
  }
  g.fillStyle = '#c8102e';
  g.fillRect(w / 2 - 50 * s, y - 50 * s, 100 * s, 5 * s);
  centered(g, book.author.toUpperCase(), y + 40 * s, `400 ${28 * s}px ${SANS}`, ink, 8 * s);
}

function isLight(hex = '#000000') {
  const n = parseInt(hex.slice(1), 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 150;
}

/** Title page shared by text and info books. */
export function drawTitlePage(g, w, h, book, extraLines = []) {
  const s = h / REF_H;
  paper(g, w, h);
  resetText(g);
  g.font = `600 ${84 * s}px ${DISPLAY}`;
  g.fillStyle = INK;
  g.textAlign = 'center';
  let y = h * 0.3;
  for (const line of wrap(g, book.title, w - 220 * s)) {
    g.fillText(line, w / 2, y);
    y += 92 * s;
  }
  resetText(g);
  g.fillStyle = CRIMSON;
  g.fillRect(w / 2 - 40 * s, y - 40 * s, 80 * s, 4 * s);
  y += 30 * s;
  g.font = `italic 500 ${36 * s}px ${DISPLAY}`;
  g.fillStyle = 'rgba(23,20,15,0.75)';
  g.textAlign = 'center';
  for (const line of wrap(g, book.subtitle || '', w - 240 * s)) {
    g.fillText(line, w / 2, y);
    y += 46 * s;
  }
  resetText(g);
  centered(g, book.author.toUpperCase(), h * 0.62, `400 ${26 * s}px ${SANS}`, INK, 8 * s);
  extraLines.forEach((line, i) =>
    centered(g, line, h * 0.8 + i * 40 * s, `400 ${22 * s}px ${SANS}`, 'rgba(23,20,15,0.55)'),
  );
}
