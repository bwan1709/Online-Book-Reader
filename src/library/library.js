import { BOOKS, CATEGORIES, coverUrl } from './catalog.js';
import {
  getAttachedPdf,
  listAttached,
  listOwnBooks,
  addOwnBook,
  getOwnBook,
  removeOwnBook,
  getThumb,
  setThumb,
  folderStatus,
  folderName,
  linkFolder,
  reconnectFolder,
} from '../reader/storage.js';
import { openPdf, pdfThumbnail } from '../reader/pdfSource.js';
import { createTextBook } from '../reader/textSource.js';
import { createInfoBook } from '../reader/infoSource.js';

const covers = new Map();
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Loads a cover for use as a WebGL texture (Open Library sends CORS headers). Resolves null on failure. */
function loadCover(book) {
  if (!covers.has(book.id)) {
    covers.set(
      book.id,
      new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img.naturalWidth > 10 ? img : null);
        img.onerror = () => resolve(null);
        img.src = coverUrl(book);
        setTimeout(() => resolve(null), 8000);
      }),
    );
  }
  return covers.get(book.id);
}

/** The edition to open: the one asked for, else the last one read, else the first (Vietnamese). */
function pickEdition(book, editionId) {
  const key = `nexvs-edition-${book.id}`;
  const id = editionId || localStorage.getItem(key);
  const edition = book.editions.find((e) => e.id === id) || book.editions[0];
  localStorage.setItem(key, edition.id);
  return edition;
}

/**
 * Builds the page source for a shelf book: the reader's own PDF, the full public-domain text,
 * or an introduction.
 * @returns {Promise<{ source, attached: boolean, edition?: object }>}
 */
export async function loadBookSource(book, onProgress, editionId) {
  const pdf = await getAttachedPdf(book.id);
  if (pdf) {
    const source = await openPdf(pdf);
    source.title = book.title;
    return { source, attached: true };
  }
  const image = await loadCover(book);
  if (book.editions) {
    const edition = pickEdition(book, editionId);
    return { source: await createTextBook(book, edition, image, onProgress), attached: false, edition };
  }
  return { source: createInfoBook(book, image), attached: false };
}

const STORAGE_TEXT = {
  ready: (name) =>
    `Sách của bạn được lưu thành file trong thư mục <b>${escapeHtml(name)}</b> trên máy — bỏ PDF vào đó cũng sẽ hiện ở đây.`,
  'needs-permission': (name) => `Trình duyệt cần bạn xác nhận lại quyền truy cập thư mục <b>${escapeHtml(name)}</b>.`,
  none: () =>
    'Sách của bạn đang lưu trong trình duyệt và có thể mất khi xoá dữ liệu duyệt web. Chọn một thư mục trên máy để giữ chúng an toàn.',
  unsupported: () =>
    'Sách của bạn được lưu trong trình duyệt này (đã xin lưu trữ bền vững). Dùng Chrome hoặc Edge để lưu thẳng vào thư mục trên máy.',
};

/** The bookshelf screen (DOM). */
export class Library {
  /** @param {{ onOpen: (source, shelfBook, attached, edition) => void }} hooks */
  constructor({ onOpen }) {
    this.onOpen = onOpen;
    this.grid = document.getElementById('lib-grid');
    this.tabs = document.getElementById('lib-tabs');
    this.file = document.getElementById('lib-file');
    this.storageBar = document.getElementById('lib-storage');
    this.category = 'all';
    this.busy = false;

    this.renderTabs();
    this.renderCards();
    this.file.addEventListener('change', () => {
      if (this.file.files[0]) this.importFile(this.file.files[0]);
      this.file.value = '';
    });
  }

  renderTabs() {
    this.tabs.innerHTML = '';
    for (const c of [...CATEGORIES, { id: 'mine', label: 'Sách của bạn' }]) {
      const b = document.createElement('button');
      b.className = 'lib-tab' + (c.id === this.category ? ' on' : '');
      b.textContent = c.label;
      b.addEventListener('click', () => {
        this.category = c.id;
        this.renderTabs();
        this.filter();
      });
      this.tabs.append(b);
    }
  }

  // ---------- Cards ----------
  renderCards() {
    this.grid.innerHTML = '';
    BOOKS.forEach((book, i) => {
      const card = this.makeCard({
        id: book.id,
        category: book.category,
        index: i,
        tint: book.color,
        title: book.title,
        meta: `${book.author} · ${book.year}`,
        extra: book.editions ? book.editions.map((e) => e.label).join(' · ') : '',
        badge: book.editions ? ['full', 'Toàn văn'] : ['intro', 'Giới thiệu'],
        cover: coverUrl(book, 'M'),
      });
      card.addEventListener('click', () => this.openShelfBook(book, card));
      this.grid.append(card);
    });

    this.addCard = document.createElement('button');
    this.addCard.className = 'card card-add';
    this.addCard.dataset.category = 'mine';
    this.addCard.innerHTML = `<div class="card-cover"><span class="plus">+</span><span>Thêm file PDF<br />của bạn</span></div>
      <div class="card-meta"><h3>Sách của bạn</h3><p>PDF bất kỳ · lưu trên máy</p></div>`;
    this.addCard.addEventListener('click', () => this.file.click());
    this.grid.append(this.addCard);
  }

  makeCard({ id, category, index, tint, title, meta, extra, badge, cover }) {
    const card = document.createElement('button');
    card.className = 'card';
    card.dataset.id = id;
    card.dataset.category = category;
    card.style.setProperty('--i', index);
    card.style.setProperty('--tint', tint || '#2a2628');
    card.innerHTML = `
      <div class="card-cover">
        <div class="card-fallback"><span>${escapeHtml(title)}</span></div>
        <img alt="" crossorigin="anonymous" loading="lazy" />
        <span class="badge ${badge[0]}">${badge[1]}</span>
        <div class="card-loading"><span></span></div>
      </div>
      <div class="card-meta">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(meta)}</p>
        ${extra ? `<p class="card-langs">${escapeHtml(extra)}</p>` : ''}
      </div>`;
    const img = card.querySelector('img');
    img.addEventListener('load', () => img.naturalWidth > 10 && card.classList.add('has-cover'));
    if (cover) img.src = cover;

    // Subtle 3D tilt following the pointer.
    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect();
      card.style.setProperty('--rx', `${((e.clientY - r.top) / r.height - 0.5) * -10}deg`);
      card.style.setProperty('--ry', `${((e.clientX - r.left) / r.width - 0.5) * 12}deg`);
    });
    card.addEventListener('pointerleave', () => {
      card.style.setProperty('--rx', '0deg');
      card.style.setProperty('--ry', '0deg');
    });
    return card;
  }

  /** (Re)draws the reader's own books, just before the "+" card. */
  async renderOwnBooks() {
    for (const old of this.grid.querySelectorAll('.card-own')) old.remove();
    const own = await listOwnBooks();
    own.forEach((b, i) => {
      const card = this.makeCard({
        id: b.id,
        category: 'mine',
        index: BOOKS.length + i,
        title: b.name,
        meta: b.where === 'folder' ? 'Trong thư mục của bạn' : 'Trong trình duyệt',
        badge: ['mine', 'PDF của bạn'],
      });
      card.classList.add('card-own');
      const remove = document.createElement('span');
      remove.className = 'card-remove';
      remove.title = b.where === 'folder' ? 'Xoá file khỏi thư mục' : 'Xoá khỏi trình duyệt';
      remove.textContent = '×';
      remove.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`Xoá "${b.name}"?${b.where === 'folder' ? ' File PDF trong thư mục cũng sẽ bị xoá.' : ''}`)) return;
        await removeOwnBook(b.id);
        this.refresh();
      });
      card.querySelector('.card-cover').append(remove);
      card.addEventListener('click', () => this.openOwnBook(b, card));
      this.grid.insertBefore(card, this.addCard);
      this.loadThumb(b, card);
    });
    this.addCard.style.setProperty('--i', BOOKS.length + own.length);
    this.filter();
  }

  async loadThumb(book, card) {
    let thumb = await getThumb(book.id);
    if (!thumb) {
      const file = await getOwnBook(book.id);
      if (!file) return;
      thumb = await pdfThumbnail(file).catch(() => null);
      if (!thumb) return;
      setThumb(book.id, thumb);
    }
    card.querySelector('img').src = thumb;
  }

  filter() {
    for (const card of this.grid.children) {
      const show = this.category === 'all' || card.dataset.category === this.category;
      card.classList.toggle('hidden', !show);
    }
  }

  // ---------- Storage status ----------
  async renderStorage() {
    const status = await folderStatus();
    const action = { ready: 'Đổi thư mục', 'needs-permission': 'Kết nối lại', none: 'Chọn thư mục trên máy' }[status];
    this.storageBar.className = `lib-storage ${status}`;
    this.storageBar.innerHTML = `<span class="lib-storage-icon">${status === 'ready' ? '📁' : '💾'}</span>
      <span>${STORAGE_TEXT[status](folderName() || '')}</span>
      ${action ? `<button class="lib-storage-btn">${action}</button>` : ''}`;
    this.storageBar.querySelector('button')?.addEventListener('click', async () => {
      try {
        if (status === 'needs-permission') await reconnectFolder();
        else await linkFolder();
      } catch (err) {
        if (err.name !== 'AbortError') console.error(err);
      }
      this.refresh();
    });
  }

  /** Re-reads storage: attached badges, own books, folder status. */
  async refresh() {
    await this.renderStorage();
    const attached = new Set(await listAttached());
    for (const book of BOOKS) {
      const badge = this.grid.querySelector(`.card[data-id="${book.id}"] .badge`);
      const has = attached.has(book.id);
      badge.textContent = has ? 'PDF của bạn' : book.editions ? 'Toàn văn' : 'Giới thiệu';
      badge.className = `badge ${has ? 'mine' : book.editions ? 'full' : 'intro'}`;
    }
    await this.renderOwnBooks();
  }

  // ---------- Opening ----------
  async withLoading(card, fn) {
    if (this.busy) return;
    this.busy = true;
    const label = card.querySelector('.card-loading span');
    card.classList.add('loading');
    label.textContent = 'Đang mở…';
    try {
      await fn((text) => (label.textContent = text));
    } catch (err) {
      console.error(err);
      label.textContent = 'Không mở được sách';
      await new Promise((r) => setTimeout(r, 1500));
    } finally {
      card.classList.remove('loading');
      this.busy = false;
    }
  }

  openShelfBook(book, card) {
    return this.withLoading(card, async (status) => {
      const { source, attached, edition } = await loadBookSource(book, (p) =>
        status(`Đang dàn trang ${Math.round(p * 100)}%`),
      );
      this.onOpen(source, book, attached, edition);
    });
  }

  openOwnBook(book, card) {
    return this.withLoading(card, async () => {
      const file = await getOwnBook(book.id);
      if (!file) throw new Error('File không còn trong thư mục');
      const source = await openPdf(file);
      source.title = book.name;
      this.onOpen(source, null, false, null);
    });
  }

  /** Saves a PDF the reader added (button or drag & drop) to their shelf, then opens it. */
  async importFile(file) {
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      alert('Hãy chọn một file PDF');
      return;
    }
    await addOwnBook(file);
    const source = await openPdf(file);
    source.title = file.name.replace(/\.pdf$/i, '');
    this.onOpen(source, null, false, null);
    this.refresh();
  }

  /** Staggered entrance animation each time the shelf is shown. */
  animateIn() {
    this.grid.classList.remove('enter');
    void this.grid.offsetWidth;
    this.grid.classList.add('enter');
    this.refresh();
  }
}
