// Renders the generator headlessly and writes the two upload-ready PNGs.
//
//   node tools/export-pngs.mjs [outDir] [configOverrides.json]
//
// Needs Playwright with a Chromium build (npm i -D playwright && npx playwright install chromium).
// The PNGs are byte-for-byte what the "Download" buttons in index.html produce.
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const page = pathToFileURL(path.join(here, '..', 'index.html')).href;
const outDir = path.resolve(process.argv[2] || path.join(here, '..'));
const overrides = process.argv[3] ? JSON.parse(await readFile(process.argv[3], 'utf8')) : null;

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
try {
  const tab = await browser.newPage();
  const errors = [];
  tab.on('pageerror', e => errors.push(e.message));
  await tab.goto(page);
  await tab.waitForFunction(() => window.BreloisUniform);
  const files = await tab.evaluate(cfg => {
    const B = window.BreloisUniform;
    if (cfg) {
      Object.assign(B.CONFIG.colors, cfg.colors || {});
      Object.assign(B.CONFIG.options, cfg.options || {});
    }
    B.render();
    return { shirt: B.pngDataURL('shirt'), pants: B.pngDataURL('pants') };
  }, overrides);
  if (errors.length) throw new Error('Page errors:\n' + errors.join('\n'));
  await mkdir(outDir, { recursive: true });
  for (const [which, name] of [['shirt', 'Brelois_Hussar_Shirt.png'], ['pants', 'Brelois_Hussar_Pants.png']]) {
    const buf = Buffer.from(files[which].split(',')[1], 'base64');
    await writeFile(path.join(outDir, name), buf);
    console.log(`wrote ${path.join(outDir, name)} (${buf.length} bytes)`);
  }
} finally {
  await browser.close();
}
