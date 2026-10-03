/** Opens a PDF file as a page source. pdf.js is loaded only when needed. */
export async function openPdf(file) {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const first = await doc.getPage(1);
  const { width, height } = first.getViewport({ scale: 1 });

  return {
    title: file.name.replace(/\.pdf$/i, ''),
    pageCount: doc.numPages,
    aspect: Math.min(1.2, Math.max(0.45, width / height)),

    async render(index, canvas) {
      const page = await doc.getPage(index + 1);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(canvas.width / base.width, canvas.height / base.height) });

      const tmp = document.createElement('canvas');
      tmp.width = Math.ceil(viewport.width);
      tmp.height = Math.ceil(viewport.height);
      await page.render({ canvas: tmp, viewport }).promise;

      // Letterbox pages whose size differs from the first page.
      const g = canvas.getContext('2d');
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, canvas.width, canvas.height);
      g.drawImage(tmp, (canvas.width - tmp.width) / 2, (canvas.height - tmp.height) / 2);
      page.cleanup();
    },

    dispose() {
      // In pdf.js v6 the loading task owns the document and its worker.
      task.destroy();
    },
  };
}

/** First page as a small JPEG, used as the cover of the reader's own books. */
export async function pdfThumbnail(file, width = 320) {
  const source = await openPdf(file);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = Math.round(width / source.aspect);
  try {
    await source.render(0, canvas);
    return canvas.toDataURL('image/jpeg', 0.82);
  } finally {
    source.dispose();
  }
}
