// Crawls a public-domain work from Vietnamese Wikisource into the reader's plain-text format:
//   "# Heading" (part, new page) · "## Heading" (chapter, new page) · paragraphs separated by blank lines.
// Pages are walked in reading order: a page's own text first, then its sub-pages as linked in its wikitext.
const API = 'https://vi.wikisource.org/w/api.php';
const HEADERS = { 'User-Agent': 'NEXVS-reader/1.0 (local e-book reader; https://github.com/)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function parse(title) {
  const url = `${API}?action=parse&format=json&prop=text|wikitext&redirects=1&page=${encodeURIComponent(title)}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      const json = await res.json();
      if (json.error) throw new Error(`${title}: ${json.error.info}`);
      await sleep(250); // be polite to Wikimedia
      return { html: json.parse.text['*'], wikitext: json.parse.wikitext['*'] };
    } catch (err) {
      if (attempt === 2) throw err;
      await sleep(1500);
    }
  }
}

const decode = (s) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/Ð/g, 'Đ'); // scans often use the Icelandic eth for Vietnamese Đ

/** Body paragraphs of a rendered page, without the header, footnote markers, page numbers or lists. */
function paragraphsOf(html) {
  const body = html
    .replace(/<sup[^>]*class="reference"[\s\S]*?<\/sup>/g, '')
    .replace(/<span[^>]*class="[^"]*pagenum[^"]*"[\s\S]*?<\/span>/g, '')
    .replace(/<div[^>]*class="[^"]*(ws-noexport|header)[^"]*"[\s\S]*?<\/div>\s*<\/div>/g, '');
  const out = [];
  for (const m of body.matchAll(/<p>([\s\S]*?)<\/p>/g)) {
    const text = decode(m[1].replace(/<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, ''))
      .replace(/\s+/g, ' ')
      .trim();
    if (text) out.push(text);
  }
  return out;
}

/** Sub-pages linked from a page's wikitext, in order: [[/Child|Label]] or [[Parent/Child|Label]]. */
function childrenOf(title, wikitext) {
  const kids = [];
  for (const m of wikitext.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)) {
    let target = m[1].trim();
    if (target.startsWith('../') || target.startsWith(':')) continue;
    if (target.startsWith('/')) target = title + target;
    if (!target.startsWith(title + '/')) continue;
    const label = (m[2] || target.slice(title.length + 1)).trim();
    if (!kids.some((k) => k.target === target)) kids.push({ target, label });
  }
  return kids;
}

/**
 * @param {string} root  Wikisource title of the work
 * @param {{ skip?: RegExp, drop?: RegExp[] }} options
 *   skip: sub-pages to leave out (e.g. third-party commentary)
 *   drop: paragraphs to remove (printer's imprints, running titles, wiki layout leftovers)
 */
export async function crawlWork(root, { skip, drop = [] } = {}) {
  const rootName = root.split('/').pop();
  const lines = [];
  let pages = 0;

  async function walk(title, label, depth) {
    const { html, wikitext } = await parse(title);
    pages++;
    process.stdout.write(`\r  ${pages} trang · ${title.slice(0, 70).padEnd(70)}`);
    const paras = paragraphsOf(html).filter((p) => !/^Bố cục \d+$/.test(p) && !drop.some((re) => re.test(p)));
    const kids = childrenOf(title, wikitext).filter((k) => !skip?.test(k.target));
    if (depth > 0 && label && label !== rootName && (paras.length || kids.length)) {
      lines.push(`${depth === 1 ? '#' : '##'} ${label.replace(/^\((\d+)\)$/, 'Chương $1')}`);
    }
    lines.push(...paras);
    for (const k of kids) await walk(k.target, k.label, Math.min(depth + 1, 2));
  }

  await walk(root, null, 0);
  process.stdout.write('\n');
  return lines.join('\n\n') + '\n';
}

