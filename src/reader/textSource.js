import {
  REF_W,
  REF_H,
  BODY,
  DISPLAY,
  INK,
  paper,
  resetText,
  runningHead,
  folio,
  drawCover,
  drawTitlePage,
} from './pageArt.js';

// Reference layout (1100×1570 page).
const MARGIN_X = 120;
const TOP = 160;
const BOTTOM = REF_H - 150;
const TEXT_W = REF_W - MARGIN_X * 2;
const BODY_SIZE = 33;
const LEAD = 48;
const INDENT = 44;
const FRONT_PAGES = 2; // cover + title page

const STYLES = {
  body: { font: `400 ${BODY_SIZE}px ${BODY}`, lead: LEAD },
  h1: { font: `600 58px ${DISPLAY}`, lead: 70, before: 260, after: 40, align: 'center' },
  h2: { font: `600 44px ${DISPLAY}`, lead: 56, before: 120, after: 24, align: 'center' },
  h3: { font: `italic 500 36px ${DISPLAY}`, lead: 48, before: 30, after: 34, align: 'center' },
  small: { font: `400 26px ${BODY}`, lead: 40, before: 18, after: 18, align: 'center', spacing: 4 },
};

const PAGE_BREAK = /^(VOLUME|BOOK|PART|CHAPTER|PREFACE)\b/;

/** Splits a Project Gutenberg plain-text file into clean paragraphs, starting at `start`. */
function gutenbergParagraphs(raw, start) {
  let text = raw.replace(/\r\n/g, '\n');
  const begin = text.search(/\*\*\* ?START OF (THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\n/);
  const end = text.search(/\*\*\* ?END OF (THE|THIS) PROJECT GUTENBERG EBOOK/);
  if (begin >= 0) text = text.slice(text.indexOf('\n', begin) + 1, end > 0 ? end : undefined);

  let paras = text
    .split(/\n\s*\n/)
    .map((p) =>
      p
        .replace(/\s*\n\s*/g, ' ')
        .replace(/_/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((p) => p && !/^\[Illustration/i.test(p));

  // The start heading also appears in the table of contents; the real one is followed by prose.
  const at = paras.findIndex((p, i) => p === start && paras.slice(i + 1, i + 4).some((q) => q.length > 200));
  if (at > 0) paras = paras.slice(at);
  return paras.map((p) => {
    const kind = classify(p);
    return { text: p, kind, breakBefore: PAGE_BREAK.test(p) };
  });
}

/** Our own format (see scripts/fetch-wikisource.mjs): "# part", "## chapter", "⁂" scene breaks. */
function plainParagraphs(raw) {
  return raw
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((p) => {
      if (p.startsWith('## ')) return { text: p.slice(3), kind: 'h2', breakBefore: true };
      if (p.startsWith('# ')) return { text: p.slice(2), kind: 'h1', breakBefore: true };
      if (/^(⁂|\*( \*)+)$/.test(p)) return { text: '⁂', kind: 'small', breakBefore: false };
      return { text: p, kind: 'body', breakBefore: false };
    });
}

function classify(p) {
  if (/^(VOLUME|PART)\b/.test(p)) return 'h1';
  if (/^(BOOK|PREFACE)\b/.test(p)) return 'h2';
  if (/^CHAPTER\b/.test(p)) return 'h2';
  const letters = p.replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (p.length < 70 && letters.length > 2 && letters === letters.toUpperCase()) return 'h3';
  return 'body';
}

/**
 * Lays out a long text into pages. Runs in chunks so even Les Misérables doesn't freeze the page.
 * Each page is a list of lines: { text, style, x, y, justify, width }.
 */
async function paginate(paras, onProgress) {
  const ctx = document.createElement('canvas').getContext('2d');
  const widths = new Map();
  const measure = (font, word) => {
    const key = font + word;
    let w = widths.get(key);
    if (w === undefined) {
      ctx.font = font;
      w = ctx.measureText(word).width;
      widths.set(key, w);
    }
    return w;
  };

  const pages = [];
  let lines = [];
  let y = TOP;
  let lastWasHeading = false;

  const newPage = () => {
    if (lines.length) pages.push(lines);
    lines = [];
    y = TOP;
  };

  for (let i = 0; i < paras.length; i++) {
    const { text: p, breakBefore } = paras[i];
    let { kind } = paras[i];

    if (kind !== 'body') {
      // Headings that open a new section start a fresh page (unless they follow another heading).
      if (breakBefore && !lastWasHeading && lines.length) newPage();
      // A stray all-caps line that doesn't follow a heading is a signature or note, not a title.
      if (kind === 'h3' && !lastWasHeading && !breakBefore) kind = 'small';
      const st = STYLES[kind];
      y += lines.length ? st.before * 0.5 : st.before;
      ctx.font = st.font;
      const words = p.split(' ');
      let line = '';
      const flush = () => {
        if (y + st.lead > BOTTOM) newPage();
        lines.push({ text: line, style: kind, y, align: 'center' });
        y += st.lead;
      };
      for (const w of words) {
        const test = line ? `${line} ${w}` : w;
        if (ctx.measureText(test).width > TEXT_W && line) {
          flush();
          line = w;
        } else line = test;
      }
      if (line) flush();
      y += st.after;
      // An inline small-caps line (e.g. a signature) should not glue the next section to this page.
      lastWasHeading = kind !== 'small';
      continue;
    }

    // Body paragraph: greedy line breaking with cached word widths, justified except the last line.
    const words = p.split(' ');
    const font = STYLES.body.font;
    const space = measure(font, ' ');
    let lineWords = [];
    let lineW = 0;
    let first = true;
    const flush = (last) => {
      if (y + LEAD > BOTTOM) newPage();
      const indent = first && !lastWasHeading ? INDENT : 0;
      lines.push({ text: lineWords.join(' '), style: 'body', y, x: indent, justify: !last, width: TEXT_W - indent });
      y += LEAD;
      first = false;
      lineWords = [];
      lineW = 0;
    };
    for (const w of words) {
      const ww = measure(font, w);
      const avail = TEXT_W - (first && !lastWasHeading ? INDENT : 0);
      const next = lineWords.length ? lineW + space + ww : ww;
      if (next > avail && lineWords.length) {
        flush(false);
        lineWords.push(w);
        lineW = ww;
      } else {
        lineWords.push(w);
        lineW = next;
      }
    }
    if (lineWords.length) flush(true);
    y += LEAD * 0.25;
    lastWasHeading = false;

    if (i % 300 === 0) {
      onProgress?.(i / paras.length);
      await new Promise((r) => setTimeout(r));
    }
  }
  newPage();
  onProgress?.(1);
  return { pages, measure };
}

function drawLine(g, line, s, measure) {
  const st = STYLES[line.style];
  g.font = st.font.replace(/(\d+)px/, (_, n) => `${n * s}px`);
  g.fillStyle = line.style === 'small' ? 'rgba(23,20,15,0.65)' : INK;
  const y = line.y * s;
  if (line.align === 'center') {
    g.textAlign = 'center';
    g.letterSpacing = `${(st.spacing || 0) * s}px`;
    g.fillText(line.text, (REF_W / 2) * s, y);
    resetText(g);
    return;
  }
  const x0 = (MARGIN_X + (line.x || 0)) * s;
  const words = line.text.split(' ');
  if (!line.justify || words.length < 2) {
    g.fillText(line.text, x0, y);
    return;
  }
  // Justify: spread the leftover width across the gaps (widths measured at reference size).
  const natural = words.reduce((sum, w) => sum + measure(st.font, w), 0);
  const gap = (line.width - natural) / (words.length - 1);
  let x = x0;
  for (const w of words) {
    g.fillText(w, x, y);
    x += (measure(st.font, w) + gap) * s;
  }
}

/**
 * A public-domain book, paginated in the browser.
 * @param edition  { file, format: 'gutenberg' | 'plain', start?, title, credit, source }
 */
export async function createTextBook(book, edition, image, onProgress) {
  const res = await fetch(edition.file);
  if (!res.ok) throw new Error(`Missing ${edition.file} — run "npm run setup"`);
  const raw = await res.text();
  const paras = edition.format === 'plain' ? plainParagraphs(raw) : gutenbergParagraphs(raw, edition.start);
  const { pages, measure } = await paginate(paras, onProgress);

  return {
    title: book.title,
    pageCount: FRONT_PAGES + pages.length,
    aspect: REF_W / REF_H,

    async render(index, canvas) {
      const g = canvas.getContext('2d');
      const { width: w, height: h } = canvas;
      const s = h / REF_H;
      resetText(g);
      if (index === 0) return drawCover(g, w, h, book, image);
      if (index === 1) {
        return drawTitlePage(g, w, h, { ...book, subtitle: edition.title }, [edition.credit, edition.source]);
      }
      paper(g, w, h);
      const lines = pages[index - FRONT_PAGES];
      if (!lines.some((l) => l.style === 'h1')) runningHead(g, w, s, edition.title);
      for (const line of lines) drawLine(g, line, s, measure);
      folio(g, w, h, s, index - 1);
    },

    dispose() {},
  };
}
