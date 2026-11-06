import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';
// Run pdf.js on the main thread: works from file://, in any browser and inside the Android WebView.
import * as pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs';
globalThis.pdfjsWorker = pdfWorker;

// Returns array of pages, each an array of text items
export async function readPdfPages(buf) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    pages.push((await page.getTextContent()).items);
  }
  await doc.destroy();
  return pages;
}
