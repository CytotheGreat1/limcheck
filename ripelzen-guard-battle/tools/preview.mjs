// Box-downscale a rendered PNG by an integer factor (used for the README preview).
// usage: node tools/preview.mjs in.png out.png [factor=2]
import { writePNG } from '../src/core/png.mjs';
import { readPNG } from './pngread.mjs';
const [inp, outp, K] = process.argv.slice(2);
const k = +(K || 2);
const { W, H, img } = readPNG(inp);
const w = Math.floor(W / k), h = Math.floor(H / k);
const out = new Uint8Array(w * h * 3);
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
  let s = 0;
  for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) s += img[((y * k + dy) * W + x * k + dx) * 3 + c];
  out[(y * w + x) * 3 + c] = Math.round(s / (k * k));
}
writePNG(outp, w, h, out);
