// Prepares everything the app serves locally from public/:
//  - MediaPipe's WASM runtime and the hand-landmark model (hand gestures, no CDN at runtime)
//  - public-domain English texts from Project Gutenberg
//  - public-domain Vietnamese works crawled from Vietnamese Wikisource
// (Neither site allows cross-origin requests, so the browser can't fetch them directly.)
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { crawlWork } from './fetch-wikisource.mjs';

const DOWNLOADS = [
  {
    url: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
    path: 'public/models/hand_landmarker.task',
    label: 'Hand model',
  },
  // Nobody's Boy (Sans famille) — Hector Malot, tr. Florence Crewe-Jones
  { url: 'https://www.gutenberg.org/cache/epub/25102/pg25102.txt', path: 'public/books/25102.txt', label: "Nobody's Boy" },
  // Les Misérables — Victor Hugo, tr. Isabel F. Hapgood
  { url: 'https://www.gutenberg.org/cache/epub/135/pg135.txt', path: 'public/books/135.txt', label: 'Les Misérables' },
];

// Hồ Biểu Chánh (1885–1958) — public domain in Vietnam (life + 50 years).
const WIKISOURCE = [
  {
    // Adaptation of Sans famille (1923). The commentary sub-page is by another writer, so it's left out.
    title: 'Cay đắng mùi đời',
    path: 'public/books/cay-dang-mui-doi.txt',
    skip: /bình nghị/,
    drop: [/^Tác-giả:/, /^Người lảnh xuất bản:?$/, /^VIÊN-HOÀNH$/, /^CAY ĐẮNG MÙI ĐỜI/, /^N\. B\. —/, /^Saigon\. —/],
  },
  // Adaptation of Les Misérables (1926).
  { title: 'Ngọn cỏ gió đùa', path: 'public/books/ngon-co-gio-dua.txt' },
];

cpSync('node_modules/@mediapipe/tasks-vision/wasm', 'public/mediapipe/wasm', { recursive: true });
console.log('✓ MediaPipe wasm copied');

for (const { url, path, label } of DOWNLOADS) {
  if (existsSync(path)) {
    console.log(`✓ ${label} present`);
    continue;
  }
  mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${label}: download failed (${res.status})`);
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  console.log(`✓ ${label} downloaded`);
}

for (const { title, path, ...options } of WIKISOURCE) {
  if (existsSync(path)) {
    console.log(`✓ ${title} present`);
    continue;
  }
  console.log(`↓ ${title} (Wikisource)`);
  mkdirSync('public/books', { recursive: true });
  writeFileSync(path, await crawlWork(title, options));
  console.log(`✓ ${title} crawled`);
}
