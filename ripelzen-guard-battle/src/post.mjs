// Final stage: the painter repaints the picture from the reference, then the finished canvas is
// toned (warm neoclassical palette, aged varnish, darkened edges) and written out.
import { writePNG } from './core/png.mjs';
import { linToSrgb, clamp, smoothstep } from './core/math.mjs';
import { paintPicture } from './painter.mjs';

export function finish(T, cam, story, { W, H, log = () => {} }) {
  const N = W * H;
  const img = paintPicture(T, { W, H, log });
  const rgb = new Uint8Array(N * 3);
  const expo = 0.8;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let r = img[i * 3] * expo, g = img[i * 3 + 1] * expo, b = img[i * 3 + 2] * expo;
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      // restrained earth palette: pull saturation down a little, warm the shadows, cream the lights
      r = l + (r - l) * 0.85; g = l + (g - l) * 0.85; b = l + (b - l) * 0.85;
      const sh = 1 - smoothstep(0.0, 0.22, l), hi = smoothstep(0.35, 1.2, l);
      r *= 1 + 0.08 * sh + 0.03 * hi; g *= 1 + 0.01 * sh + 0.015 * hi; b *= 1 - 0.1 * sh - 0.05 * hi;
      // darkened edges, as the old varnish and the eye settle on the centre
      const u = x / W - 0.5, v = y / H - 0.5;
      const vig = 1 - 0.3 * Math.pow(Math.min(1, (u * u * 1.1 + v * v * 1.6) * 2.2), 1.4);
      for (const [c, val0] of [[0, r], [1, g], [2, b]]) {
        let val = val0 * vig;
        val = (val * (2.51 * val + 0.03)) / (val * (2.43 * val + 0.59) + 0.14);
        if (c === 2) val *= 0.96;
        rgb[i * 3 + c] = Math.round(linToSrgb(clamp(val, 0, 1)) * 255);
      }
    }
  }
  log('toned');
  return { save(p) { writePNG(p, W, H, rgb); } };
}
