// Reads a results PDF into pieces of text with their positions (see sprint.js for what is then
// done with them). pdf.js is loaded only when a PDF is actually read.
export async function pdfPages(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  // give pdf.js its worker directly (on Netlify it can't find the worker file by itself: "fake worker failed")
  if (!globalThis.pdfjsWorker) globalThis.pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), disableFontFace: true, useSystemFonts: false, isEvalSupported: false, verbosity: 0 }).promise
  const pages = []
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    const view = page.getViewport({ scale: 1 })
    const text = await page.getTextContent()
    const items = text.items
      .filter(i => typeof i.str === 'string' && i.str.trim())
      .map(i => ({ x: +i.transform[4].toFixed(1), y: +(view.height - i.transform[5]).toFixed(1), str: i.str }))
    pages.push({ w: view.width, items })
    page.cleanup()
  }
  await doc.destroy()
  return pages
}
