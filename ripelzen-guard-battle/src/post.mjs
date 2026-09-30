// Post: downsample, colour grading, painterly brushwork (flow-aligned strokes + bristle texture),
// canvas weave, vignette, tone map, write PNG.
import { writePNG } from './core/png.mjs';
import { linToSrgb, clamp, lerp, smoothstep } from './core/math.mjs';
import { NoiseTex, mulberry32 } from './core/rng.mjs';
import { paint } from './paint.mjs';

function boxBlur(src, W, H, r, out) {
  // separable box blur, single channel
  const tmp = new Float32Array(W * H);
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < H; y++) {
    let acc = 0;
    const row = y * W;
    for (let x = -r; x <= r; x++) acc += src[row + clamp(x, 0, W - 1)];
    for (let x = 0; x < W; x++) {
      tmp[row + x] = acc * inv;
      acc += src[row + Math.min(W - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < W; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[clamp(y, 0, H - 1) * W + x];
    for (let y = 0; y < H; y++) {
      out[y * W + x] = acc * inv;
      acc += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x];
    }
  }
  return out;
}
function gauss(src, W, H, r) {
  const a = new Float32Array(W * H), b = new Float32Array(W * H);
  boxBlur(src, W, H, r, a);
  boxBlur(a, W, H, r, b);
  boxBlur(b, W, H, r, a);
  return a;
}

export function finish(T, cam, story, { W, H, SS, log = () => {}, fast = false }) {
  const N = W * H;
  const img = new Float32Array(N * 3);
  const depth = new Float32Array(N);
  const tag = new Uint8Array(N);
  const n = SS * SS;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0, zmin = Infinity;
      const cnt = new Uint8Array(0);
      let tg = 0;
      for (let dy = 0; dy < SS; dy++) {
        const row = (y * SS + dy) * T.W + x * SS;
        for (let dx = 0; dx < SS; dx++) {
          const i = row + dx;
          r += T.rgb[i * 3]; g += T.rgb[i * 3 + 1]; b += T.rgb[i * 3 + 2];
          if (T.z[i] < zmin) { zmin = T.z[i]; tg = T.tag[i]; }
        }
      }
      const o = y * W + x;
      img[o * 3] = r / n; img[o * 3 + 1] = g / n; img[o * 3 + 2] = b / n;
      depth[o] = zmin; tag[o] = tg;
    }
  }
  log('downsampled');

  // ---------------- colour grading (linear) ----------------
  const expo = 0.78;
  for (let i = 0; i < N; i++) {
    let r = img[i * 3] * expo, g = img[i * 3 + 1] * expo, b = img[i * 3 + 2] * expo;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    // gentle desaturation, stronger in the greens of the landscape
    const sat = tag[i] === 1 ? 0.72 : 0.86;
    r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat;
    // warm umber shadows, creamy highlights
    const sh = 1 - smoothstep(0.0, 0.25, l), hi = smoothstep(0.35, 1.2, l);
    r *= 1 + 0.1 * sh + 0.04 * hi; g *= 1 + 0.02 * sh + 0.02 * hi; b *= 1 - 0.12 * sh - 0.06 * hi;
    img[i * 3] = r; img[i * 3 + 1] = g; img[i * 3 + 2] = b;
  }

  // ---------------- flow field from the structure tensor ----------------
  const lum = new Float32Array(N);
  for (let i = 0; i < N; i++) lum[i] = Math.pow(0.2126 * img[i * 3] + 0.7152 * img[i * 3 + 1] + 0.0722 * img[i * 3 + 2] + 1e-4, 0.45);
  const Exx = new Float32Array(N), Exy = new Float32Array(N), Eyy = new Float32Array(N);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const gx = (lum[i - W + 1] + 2 * lum[i + 1] + lum[i + W + 1] - lum[i - W - 1] - 2 * lum[i - 1] - lum[i + W - 1]) * 0.25;
      const gy = (lum[i + W - 1] + 2 * lum[i + W] + lum[i + W + 1] - lum[i - W - 1] - 2 * lum[i - W] - lum[i - W + 1]) * 0.25;
      Exx[i] = gx * gx; Exy[i] = gx * gy; Eyy[i] = gy * gy;
    }
  }
  const sr = Math.max(2, Math.round(W / 900));
  const Sxx = gauss(Exx, W, H, sr), Sxy = gauss(Exy, W, H, sr), Syy = gauss(Eyy, W, H, sr);
  const tx = new Float32Array(N), ty = new Float32Array(N), coh = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = Sxx[i], b = Sxy[i], c = Syy[i];
    const tr = a + c, det = Math.sqrt((a - c) * (a - c) + 4 * b * b);
    const l1 = (tr + det) / 2, l2 = (tr - det) / 2;
    // eigenvector of the smaller eigenvalue = edge tangent
    let vx = b, vy = l2 - a;
    if (Math.abs(vx) + Math.abs(vy) < 1e-12) { vx = 1; vy = 0; }
    const ln = Math.hypot(vx, vy);
    tx[i] = vx / ln; ty[i] = vy / ln;
    coh[i] = tr > 1e-8 ? (l1 - l2) / (l1 + l2 + 1e-6) : 0;
  }
  // in flat regions give strokes a painterly default direction (gently diagonal, varying)
  const nt = new NoiseTex(256, 8, 3, 91.3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const w = smoothstep(0.05, 0.4, coh[i]);
    if (w < 1) {
      const ang = 0.6 + 1.2 * nt.at(x / W * 3, y / H * 2);
      tx[i] = lerp(Math.cos(ang), tx[i], w); ty[i] = lerp(Math.sin(ang), ty[i], w);
      const l = Math.hypot(tx[i], ty[i]) || 1; tx[i] /= l; ty[i] /= l;
    }
  }
  log('flow field');

  // ---------------- importance map (where the brush must be fine) ----------------
  const scale = W / 3840;
  const imp = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const t = tag[i], z = depth[i];
    let v = 0.15;
    if (t >= 2 && t !== 9) v = z < 8 ? 0.62 : z < 20 ? 0.5 : z < 60 ? 0.35 : 0.22;
    if (t === 5) v = z < 20 ? 0.9 : 0.6; // skin: faces, hands
    if (t === 4 && z < 20) v = Math.max(v, 0.7); // metal glints
    if (t === 8) v = 0.5;
    imp[i] = v;
  }
  const impB = gauss(imp, W, H, Math.max(1, Math.round(3 * scale)));
  const out = paint(img, W, H, { tx, ty }, impB, { scale: scale * 1.0, log });
  // keep a touch of the crisp render where detail matters most
  for (let i = 0; i < N; i++) {
    const k = impB[i] > 0.75 ? (impB[i] - 0.75) * 1.2 : 0;
    for (let c = 0; c < 3; c++) out[i * 3 + c] = lerp(out[i * 3 + c], img[i * 3 + c], k);
  }
  log('painted');

  // ---------------- bristle texture: noise smeared along the flow ----------------
  const rnd = mulberry32(77);
  const noise = new Float32Array(N);
  for (let i = 0; i < N; i++) noise[i] = rnd() - 0.5;
  const bristle = new Float32Array(N);
  const bl = Math.max(3, Math.round(7 * scale));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let s = 0, px = x, py = y;
      for (let k = 0; k < bl; k++) {
        const j = clamp(Math.round(py), 0, H - 1) * W + clamp(Math.round(px), 0, W - 1);
        s += noise[j];
        px += tx[j]; py += ty[j];
      }
      px = x; py = y;
      for (let k = 0; k < bl; k++) {
        const j = clamp(Math.round(py), 0, H - 1) * W + clamp(Math.round(px), 0, W - 1);
        s += noise[j];
        px -= tx[j]; py -= ty[j];
      }
      bristle[i] = s / Math.sqrt(2 * bl);
    }
  }
  log('bristle texture');

  // ---------------- canvas, vignette, tone map ----------------
  const canvasN = new NoiseTex(256, 16, 2, 5.5);
  const rgb = new Uint8Array(N * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const u = x / W - 0.5, v = y / H - 0.5;
      const vig = 1 - 0.32 * Math.pow(Math.min(1, (u * u * 1.1 + v * v * 1.6) * 2.2), 1.4);
      const weave = 1 + 0.018 * (Math.sin(x * 1.9 / scale) * Math.sin(y * 1.9 / scale)) + 0.012 * canvasN.at(x / 700, y / 700);
      const lumv = 0.2126 * out[i * 3] + 0.7152 * out[i * 3 + 1] + 0.0722 * out[i * 3 + 2];
      const br = 1 + bristle[i] * 0.07 * (tag[i] >= 2 ? 0.7 : 1.1) * (0.4 + Math.min(1, lumv * 2));
      for (let c = 0; c < 3; c++) {
        let val = out[i * 3 + c] * vig * weave * br;
        // filmic tone curve (ACES approximation)
        val = (val * (2.51 * val + 0.03)) / (val * (2.43 * val + 0.59) + 0.14);
        // aged varnish: slight warm cast in the highlights
        if (c === 2) val *= 0.965;
        if (c === 0) val *= 1.01;
        rgb[i * 3 + c] = Math.round(linToSrgb(clamp(val, 0, 1)) * 255);
      }
    }
  }
  return { save(p) { writePNG(p, W, H, rgb); } };
}
