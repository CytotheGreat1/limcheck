// Crop a region of a PNG written by this project (8-bit RGB, no interlace) and scale it up.
// usage: node tools/crop.mjs in.png out.png x y w h [scale]
import fs from 'node:fs';
import { writePNG } from '../src/core/png.mjs';
import { readPNG } from './pngread.mjs';
const [inp, outp, X, Y, Wc, Hc, SC] = process.argv.slice(2);
const { W, H, img } = readPNG(inp);
const x0 = +X, y0 = +Y, w = +Wc, h = +Hc, s = +(SC || 1);
const out = new Uint8Array(w * s * h * s * 3);
for (let y = 0; y < h * s; y++) for (let x = 0; x < w * s; x++) {
  const sx = Math.min(W - 1, x0 + Math.floor(x / s)), sy = Math.min(H - 1, y0 + Math.floor(y / s));
  for (let c = 0; c < 3; c++) out[(y * w * s + x) * 3 + c] = img[(sy * W + sx) * 3 + c];
}
writePNG(outp, w * s, h * s, out);

