// Minimal decoder for the 8-bit RGB, non-interlaced PNGs this project writes.
import fs from 'node:fs';
import zlib from 'node:zlib';

export function readPNG(path) {
  const buf = fs.readFileSync(path);
  let p = 8, W = 0, H = 0;
  const idat = [];
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
  return { W, H, img };
}
