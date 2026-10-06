// Tesseract.js over the prepared inputs -> results_tess.json
const fs = require('fs');
const path = require('path');
const { createWorker } = require('tesseract.js');
const CLICK = process.argv[2] || 'click';
const OUT = process.argv[3] || 'results_tess.json';
const SKIP_SCAN = !!process.argv[4];

(async () => {
  const worker = await createWorker('eng');
  await worker.setParameters({
    tessedit_char_whitelist: '0123456789.',
    tessedit_pageseg_mode: '11', // sparse text: find as many words as possible, no layout
  });
  const out = { scan: {}, click: {} };
  const t0 = Date.now();
  for (const v of (SKIP_SCAN ? [] : ['r0', 'cw', 'ccw'])) {
    const { data } = await worker.recognize(path.join('scan', v + '.png'));
    out.scan[v] = data.words.map(w => ({ text: w.text, conf: w.confidence, box: [w.bbox.x0, w.bbox.y0, w.bbox.x1, w.bbox.y1] }));
  }
  const tScan = Date.now() - t0;
  const t1 = Date.now();
  const files = fs.readdirSync(CLICK);
  await worker.setParameters({ tessedit_pageseg_mode: '11' });
  for (const f of files) {
    const { data } = await worker.recognize(path.join(CLICK, f));
    out.click[f] = data.words.map(w => ({ text: w.text, conf: w.confidence, box: [w.bbox.x0, w.bbox.y0, w.bbox.x1, w.bbox.y1] }));
  }
  out.ms = { scan: tScan, click_per_image: Math.round((Date.now() - t1) / files.length) };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  await worker.terminate();
  console.log('done', out.ms);
})().catch(e => { console.error(e); process.exit(1); });
