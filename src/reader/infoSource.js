import { REF_W, REF_H, BODY, DISPLAY, SANS, INK, CRIMSON, paper, resetText, wrap, centered, folio, drawCover, drawTitlePage } from './pageArt.js';

function heading(g, s, kicker, title, y) {
  const left = 120 * s;
  g.fillStyle = CRIMSON;
  g.font = `500 ${20 * s}px ${SANS}`;
  g.letterSpacing = `${6 * s}px`;
  g.fillText(kicker, left, y);
  resetText(g);
  g.fillStyle = INK;
  g.font = `600 ${64 * s}px ${DISPLAY}`;
  g.fillText(title, left, y + 80 * s);
  g.fillStyle = CRIMSON;
  g.fillRect(left, y + 110 * s, 60 * s, 4 * s);
  return y + 190 * s;
}

function paragraphs(g, s, list, y, { dropCap = false } = {}) {
  const left = 120 * s;
  const width = (REF_W - 240) * s;
  const size = 36 * s;
  const lead = size * 1.5;
  list.forEach((para, i) => {
    g.font = `400 ${size}px ${BODY}`;
    g.fillStyle = INK;
    let text = para;
    let indent = 0;
    if (dropCap && i === 0) {
      g.font = `600 ${size * 3}px ${DISPLAY}`;
      g.fillStyle = CRIMSON;
      g.fillText(para[0], left, y + lead);
      indent = g.measureText(para[0]).width + 16 * s;
      text = para.slice(1);
      g.font = `400 ${size}px ${BODY}`;
      g.fillStyle = INK;
    }
    const firstLines = wrap(g, text, width - indent);
    const capLines = indent ? firstLines.slice(0, 2) : [];
    capLines.forEach((line, li) => g.fillText(line, left + indent, y + lead * li));
    y += lead * capLines.length;
    const rest = indent ? wrap(g, firstLines.slice(2).join(' '), width) : firstLines;
    for (const line of rest) {
      g.fillText(line, left, y);
      y += lead;
    }
    y += lead * 0.5;
  });
  return y;
}

function factRow(g, s, label, value, y) {
  const left = 120 * s;
  g.fillStyle = 'rgba(23,20,15,0.5)';
  g.font = `500 ${18 * s}px ${SANS}`;
  g.letterSpacing = `${4 * s}px`;
  g.fillText(label.toUpperCase(), left, y);
  resetText(g);
  g.fillStyle = INK;
  g.font = `400 ${34 * s}px ${BODY}`;
  let yy = y + 46 * s;
  for (const line of wrap(g, value, (REF_W - 240) * s)) {
    g.fillText(line, left, yy);
    yy += 44 * s;
  }
  return yy + 30 * s;
}

/** A still-copyrighted book: cover, title, facts, introduction and a note on reading the full text. */
export function createInfoBook(book, image) {
  return {
    title: book.title,
    pageCount: 5,
    aspect: REF_W / REF_H,

    async render(index, canvas) {
      const g = canvas.getContext('2d');
      const { width: w, height: h } = canvas;
      const s = h / REF_H;
      resetText(g);
      if (index === 0) return drawCover(g, w, h, book, image);
      if (index === 1) return drawTitlePage(g, w, h, book, [book.original]);

      paper(g, w, h);
      if (index === 2) {
        let y = heading(g, s, 'THÔNG TIN', 'Về cuốn sách', 220 * s);
        y = factRow(g, s, 'Tác giả', book.author, y);
        y = factRow(g, s, 'Nguyên tác', book.original, y);
        y = factRow(g, s, 'Xuất bản lần đầu', String(book.year), y);
        y = factRow(g, s, 'Thể loại', book.genre, y);
        factRow(g, s, 'Độ dài', `khoảng ${book.pages} trang`, y);
      } else if (index === 3) {
        const y = heading(g, s, 'GIỚI THIỆU', 'Nội dung', 220 * s);
        paragraphs(g, s, book.about, y, { dropCap: true });
      } else if (index === 4) {
        const y = heading(g, s, 'ĐỌC TRỌN VẸN', 'Bản quyền', 220 * s);
        paragraphs(
          g,
          s,
          [
            'Cuốn sách này vẫn còn được bảo hộ bản quyền, nên thư viện chỉ có thể giới thiệu chứ không hiển thị toàn văn.',
            ...(book.note ? [book.note] : []),
            'Nếu bạn sở hữu bản điện tử dạng PDF, hãy bấm nút "Gắn PDF" ở thanh trên cùng. File chỉ được lưu trên máy của bạn và sẽ tự mở ở lần đọc sau.',
          ],
          y,
        );
        centered(g, '✦', h - 220 * s, `400 ${40 * s}px ${BODY}`, CRIMSON);
      }
      folio(g, w, h, s, index - 1);
    },

    dispose() {},
  };
}
