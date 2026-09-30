// Crop a region of a PNG written by this project (8-bit RGB, no interlace) and scale it up.
// usage: node tools/crop.mjs in.png out.png x y w h [scale]
import fs from 'node:fs';
import zlib from 'node:zlib';
import { writePNG } from '../src/core/png.mjs';
const [inp, outp, X, Y, Wc, Hc, SC] = process.argv.slice(2);
const buf = fs.readFileSync(inp);
let p = 8, W = 0, H = 0; const idat = [];
while (p < buf.length) {
  const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8);
  const data = buf.subarray(p + 8, p + 8 + len);
  if (type === 'IHDR') { W = data.readUInt32BE(0); H = data.readUInt32BE(4); }
  if (type === 'IDAT') idat.push(data);
  p += 12 + len;
}
const raw = zlib.inflateSync(Buffer.concat(idat));
const stride = W * 3, img = new Uint8Array(W * H * 3);
for (let y = 0; y < H; y++) {
  const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
  for (let i = 0; i < stride; i++) {
    const a = i >= 3 ? img[y * stride + i - 3] : 0, b = y > 0 ? img[(y - 1) * stride + i] : 0, c = i >= 3 && y > 0 ? img[(y - 1) * stride + i - 3] : 0;
    let pr = 0;
    if (f === 1) pr = a; else if (f === 2) pr = b; else if (f === 3) pr = (a + b) >> 1;
    else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
    img[y * stride + i] = (row[i] + pr) & 255;
  }
}
const x0 = +X, y0 = +Y, w = +Wc, h = +Hc, s = +(SC || 1);
const out = new Uint8Array(w * s * h * s * 3);
for (let y = 0; y < h * s; y++) for (let x = 0; x < w * s; x++) {
  const sx = Math.min(W - 1, x0 + Math.floor(x / s)), sy = Math.min(H - 1, y0 + Math.floor(y / s));
  for (let c = 0; c < 3; c++) out[(y * w * s + x) * 3 + c] = img[(sy * W + sx) * 3 + c];
}
writePNG(outp, w * s, h * s, out);
