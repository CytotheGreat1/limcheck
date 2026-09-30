// The painter. Works like a studio painter working from posed lay figures: the 3D scene is only the
// reference it looks at (local colour, where the light falls, which way each surface turns, where one
// form ends and another begins). Nothing rendered is copied into the picture. The canvas is built
// entirely from brush marks, in a traditional sequence:
//
//   toned ground -> umber underdrawing and shadow washes -> block-in of the big masses ->
//   form-following modelling strokes, coarse to fine -> impasto lights and dark accents ->
//   glazes -> relief of the paint and canvas weave under a raking studio light.
//
// Values are simplified into a few soft steps (light, half-light, half-shadow, shadow) the way a
// painter groups them, lights are warmed and half-tones cooled, and every stroke carries broken
// colour, bristle streaks, a dry-brush tail and wet paint picked up from the canvas beneath.
import { clamp, lerp, smoothstep } from './core/math.mjs';
import { mulberry32, NoiseTex } from './core/rng.mjs';
import { Env } from './core/light.mjs';

// ---------------------------------------------------------------- helpers
function boxBlur1(src, W, H, r, out, tmp) {
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    let acc = 0;
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
}
function gauss1(src, W, H, sigma) {
  const out = Float32Array.from(src);
  if (sigma < 0.5) return out;
  const r = Math.max(1, Math.round(sigma * 0.95));
  const tmp = new Float32Array(W * H), a = new Float32Array(W * H);
  boxBlur1(out, W, H, r, a, tmp);
  boxBlur1(a, W, H, r, out, tmp);
  boxBlur1(out, W, H, r, a, tmp);
  return a;
}
function gaussRGB(src, W, H, sigma) {
  const N = W * H;
  const ch = [0, 1, 2].map((c) => {
    const a = new Float32Array(N);
    for (let i = 0; i < N; i++) a[i] = src[i * 3 + c];
    return gauss1(a, W, H, sigma);
  });
  const out = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { out[i * 3] = ch[0][i]; out[i * 3 + 1] = ch[1][i]; out[i * 3 + 2] = ch[2][i]; }
  return out;
}
const lumOf = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
// perceptual encoding for colour decisions
const pe = (v) => Math.sqrt(v > 0 ? v : 0);
function cdiff(a, i, r, g, b) {
  return (Math.abs(pe(a[i]) - pe(r)) + Math.abs(pe(a[i + 1]) - pe(g)) + Math.abs(pe(a[i + 2]) - pe(b))) / 3;
}

// four soft value steps, the way a painter groups light
function quantL(L) {
  const x = Math.min(L, 1.15) * 3;
  const k = Math.floor(x), f = x - k;
  return (k + smoothstep(0.32, 0.68, f)) / 3;
}

// ---------------------------------------------------------------- the model colour
// What the painter decides each point should look like: local colour under simplified light.
function modelColour(T, W, H) {
  const N = W * H, G = T.g;
  const focalOid = Env.focalOid || new Uint8Array(0);
  const M = new Float32Array(N * 3);
  const sc = Env.sunCol, sI = Env.sunI, kc = Env.skyCol, gc = Env.groundCol;
  for (let i = 0; i < N; i++) {
    const tag = T.tag[i];
    let r, g, b;
    if (tag === 0 || T.z[i] === Infinity) {
      r = T.rgb[i * 3]; g = T.rgb[i * 3 + 1]; b = T.rgb[i * 3 + 2];
      M[i * 3] = r; M[i * 3 + 1] = g; M[i * 3 + 2] = b;
      continue;
    }
    const ar = G.alb[i * 3], ag = G.alb[i * 3 + 1], ab = G.alb[i * 3 + 2];
    const L = G.sun[i], A = G.amb[i];
    const q = quantL(L);
    const li = sI * q;
    // half-tones lean cool, full lights lean warm, shadows take warm reflected light from the ground
    const half = Math.exp(-((q - 0.4) * (q - 0.4)) / 0.03);
    const lr = sc[0] * li * (1 + 0.04 * q) , lg = sc[1] * li, lb = sc[2] * li * (1 - 0.03 * q);
    const amb = A * 1.2;
    r = ar * (lr + kc[0] * amb * (1 - 0.1 * half) + gc[0] * 0.5 * (1 - q));
    g = ag * (lg + kc[1] * amb + gc[1] * 0.45 * (1 - q));
    b = ab * (lb + kc[2] * amb * (1 + 0.12 * half) + gc[2] * 0.3 * (1 - q));
    // highlights, simplified into a lit spot
    const sp = G.spec[i];
    if (sp > 0.04) {
      const h = smoothstep(0.04, 0.35, sp) * 1.1;
      r += h * sc[0] * 0.9; g += h * sc[1] * 0.9; b += h * sc[2] * 0.85;
    }
    // aerial perspective and the smoke veil
    const f = G.fog[i];
    if (f > 0) { r = r * (1 - f) + G.haze[i * 3] * f; g = g * (1 - f) + G.haze[i * 3 + 1] * f; b = b * (1 - f) + G.haze[i * 3 + 2] * f; }
    const sa = G.smA[i];
    if (sa > 0) { r = r * (1 - sa) + G.smC[i * 3] * sa; g = g * (1 - sa) + G.smC[i * 3 + 1] * sa; b = b * (1 - sa) + G.smC[i * 3 + 2] * sa; }
    // the painter's depth design: the principal figures carry the strongest light and darks; the
    // rest of the line steps back into the smoky air, lighter and greyer with distance
    if (tag >= 2 && tag <= 8) {
      const z = T.z[i];
      const focal = focalOid[G.oid[i]] === 1;
      let veil = smoothstep(6, 35, z) * 0.42 + (focal ? 0 : 0.12 * smoothstep(3, 9, z));
      if (focal) { r *= 1.08; g *= 1.06; b *= 1.03; }
      if (veil > 0) {
        const vr = 0.5, vg = 0.49, vb = 0.46;
        r = r * (1 - veil) + vr * veil; g = g * (1 - veil) + vg * veil; b = b * (1 - veil) + vb * veil;
      }
    }
    M[i * 3] = r; M[i * 3 + 1] = g; M[i * 3 + 2] = b;
  }
  // smoke over the sky was already composited into the sky colour
  return M;
}

// ---------------------------------------------------------------- stroke rendering
let COV = new Float32Array(0), CAL = new Float32Array(0);
// px,py: path; cols: brush colour at each path vertex (wet pickup); R: radius; load: paint thickness
function drawStroke(C, Hp, W, H, px, py, cols, R, opts, rnd) {
  const n = px.length;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) { x0 = Math.min(x0, px[i]); x1 = Math.max(x1, px[i]); y0 = Math.min(y0, py[i]); y1 = Math.max(y1, py[i]); }
  x0 = Math.max(0, Math.floor(x0 - R - 1)); y0 = Math.max(0, Math.floor(y0 - R - 1));
  x1 = Math.min(W - 1, Math.ceil(x1 + R + 1)); y1 = Math.min(H - 1, Math.ceil(y1 + R + 1));
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  if (bw <= 0 || bh <= 0) return;
  if (COV.length < bw * bh) { COV = new Float32Array(bw * bh * 2); CAL = new Float32Array(bw * bh * 2); }
  COV.fill(0, 0, bw * bh);
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(px[i] - px[i - 1], py[i] - py[i - 1]));
  const Ltot = cum[n - 1] + 1e-6;
  // bristles: a handful of streaks across the brush with individual paint amounts
  const NB = 7;
  const bristle = new Float32Array(NB + 1);
  for (let k = 0; k <= NB; k++) bristle[k] = 0.55 + 0.45 * rnd();
  const dry = opts.dry ?? 0.5;
  const segs = Math.max(1, n - 1);
  for (let si = 0; si < segs; si++) {
    const ax = px[si], ay = py[si];
    const bx = n > 1 ? px[si + 1] : ax + 0.01, by = n > 1 ? py[si + 1] : ay;
    const vx = bx - ax, vy = by - ay;
    const ll = vx * vx + vy * vy || 1e-6, sl = Math.sqrt(ll);
    // taper: thinner at the start and end of the stroke
    const sx0 = Math.max(x0, Math.floor(Math.min(ax, bx) - R)), sx1 = Math.min(x1, Math.ceil(Math.max(ax, bx) + R));
    const sy0 = Math.max(y0, Math.floor(Math.min(ay, by) - R)), sy1 = Math.min(y1, Math.ceil(Math.max(ay, by) + R));
    for (let y = sy0; y <= sy1; y++) {
      const qy = y + 0.5;
      const row = (y - y0) * bw - x0;
      for (let x = sx0; x <= sx1; x++) {
        const qx = x + 0.5;
        let t = ((qx - ax) * vx + (qy - ay) * vy) / ll;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = qx - ax - vx * t, ey = qy - ay - vy * t;
        const along = (cum[Math.min(si, n - 1)] + t * sl) / Ltot;
        const taper = 0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, 0.12 + along * 0.95));
        const Rr = R * taper;
        const d2 = ex * ex + ey * ey;
        if (d2 >= Rr * Rr) continue;
        const d = Math.sqrt(d2);
        const across = (ex * -vy + ey * vx) / (sl * Rr); // -1..1
        const bpos = (across * 0.5 + 0.5) * NB;
        const bi = Math.min(NB - 1, Math.floor(bpos)), bf = bpos - bi;
        const bamt = bristle[bi] + (bristle[bi + 1] - bristle[bi]) * bf;
        let a = 1 - smoothstep(0.62, 1.0, d / Rr);
        a *= bamt;
        // dry-brush: paint runs out toward the end, bristles leave gaps
        const runOut = smoothstep(0.45, 1.0, along) * dry;
        if (runOut > 0) a *= clamp(1 - runOut * (1.4 - bamt * 1.2), 0, 1);
        const k = row + x;
        if (a > COV[k]) { COV[k] = a; CAL[k] = along; }
      }
    }
  }
  const op = opts.opacity ?? 0.92, load = opts.load ?? 0.2;
  for (let y = y0; y <= y1; y++) {
    const row = (y - y0) * bw;
    for (let x = x0; x <= x1; x++) {
      const a0 = COV[row + x - x0];
      if (a0 <= 0.002) continue;
      const a = a0 * op;
      // brush colour interpolated along the stroke (it changes as wet paint is picked up)
      const f = CAL[row + x - x0] * (n - 1);
      const ci = Math.min(n - 2, Math.floor(f));
      let cr, cg, cb;
      if (n < 2) { cr = cols[0]; cg = cols[1]; cb = cols[2]; }
      else {
        const k = f - ci;
        cr = cols[ci * 3] + (cols[ci * 3 + 3] - cols[ci * 3]) * k;
        cg = cols[ci * 3 + 1] + (cols[ci * 3 + 4] - cols[ci * 3 + 1]) * k;
        cb = cols[ci * 3 + 2] + (cols[ci * 3 + 5] - cols[ci * 3 + 2]) * k;
      }
      const i = y * W + x;
      C[i * 3] += (cr - C[i * 3]) * a; C[i * 3 + 1] += (cg - C[i * 3 + 1]) * a; C[i * 3 + 2] += (cb - C[i * 3 + 2]) * a;
      // paint body: lighter paint (lead white) is laid thicker
      const lt = lumOf(cr, cg, cb);
      Hp[i] += a0 * load * (0.45 + Math.min(1.2, lt * 1.6)) - Hp[i] * a0 * 0.35;
    }
  }
}

// ---------------------------------------------------------------- main
export function paintPicture(T, { W, H, log = () => {}, seed = 7 }) {
  const N = W * H, G = T.g;
  const sc = W / 3840;
  const rnd = mulberry32(seed);
  const tex = new NoiseTex(256, 8, 4, 12.9);

  const M = modelColour(T, W, H);
  log('model colour');

  // ------------ where the eye goes: importance
  const imp = new Float32Array(N);
  const focalOid = Env.focalOid || new Uint8Array(0);
  const isFocal = (i) => focalOid[G.oid[i]] === 1;
  for (let i = 0; i < N; i++) {
    const t = T.tag[i], z = T.z[i];
    let v = 0.12;
    if (t >= 2 && t <= 8) {
      if (isFocal(i)) {
        v = z < 10 ? 0.75 : 0.6;
        if (t === 5) v = 1; // faces and hands of the principal figures
        if (t === 4 || t === 6) v = Math.max(v, 0.85);
      } else {
        // the rest of the line is suggested more than described
        v = z < 8 ? 0.36 : z < 20 ? 0.28 : 0.18;
        if (t === 5 && z < 20) v = 0.45;
      }
    }
    if (t === 9) v = z < 60 ? 0.28 : 0.15;
    if (t === 1) v = z < 8 ? 0.34 : 0.15;
    v *= 1 - 0.6 * G.smA[i];
    imp[i] = v;
  }
  const impB = gauss1(imp, W, H, 2.5 * sc);

  // ------------ direction field: strokes wrap around forms, follow clouds and smoke, lie flat on the land
  const lumM = new Float32Array(N);
  for (let i = 0; i < N; i++) lumM[i] = pe(lumOf(M[i * 3], M[i * 3 + 1], M[i * 3 + 2]));
  const Exx = new Float32Array(N), Exy = new Float32Array(N), Eyy = new Float32Array(N);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    const gx = lumM[i + 1] - lumM[i - 1], gy = lumM[i + W] - lumM[i - W];
    Exx[i] = gx * gx; Exy[i] = gx * gy; Eyy[i] = gy * gy;
  }
  const sig = 4 * sc;
  const Sxx = gauss1(Exx, W, H, sig), Sxy = gauss1(Exy, W, H, sig), Syy = gauss1(Eyy, W, H, sig);
  // doubled-angle vector field (c2 = cos 2θ, s2 = sin 2θ), weighted
  const C2 = new Float32Array(N), S2 = new Float32Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const t = T.tag[i];
    // structure tensor tangent (along edges)
    const a = Sxx[i], b = Sxy[i], c = Syy[i];
    let th = 0.5 * Math.atan2(2 * b, a - c) + Math.PI / 2;
    let w = Math.min(1, Math.sqrt((a - c) * (a - c) + 4 * b * b) * 400);
    let th2 = th, w2 = 0;
    if (t >= 2 && t <= 9 && T.z[i] !== Infinity) {
      // wrap around the form: perpendicular to the surface normal seen on screen
      const nx = G.nx[i], ny = -G.ny[i];
      const m = Math.hypot(nx, ny);
      const f = focalOid[G.oid[i]] === 1 ? 1.2 : 0.8;
      if (m > 0.05) { th2 = Math.atan2(nx, -ny); w2 = smoothstep(0.2, 0.6, m) * f; }
    } else if (t === 1) {
      // land: near grass stands up, the fields lie flat toward the horizon
      const z = T.z[i];
      const vert = smoothstep(14, 5, z);
      th2 = lerp(0.04 * tex.at(x / W * 6, y / H * 6), Math.PI / 2 + 0.25 * tex.at(x / W * 20, y / H * 20), vert);
      w2 = 1.2;
    } else {
      // sky / smoke: follow the forms, with a gentle sweeping default
      th2 = -0.35 + 0.6 * tex.at(x / W * 2.5, y / H * 2.5);
      w2 = 0.35;
    }
    const cc = Math.cos(2 * th) * w + Math.cos(2 * th2) * w2;
    const ss = Math.sin(2 * th) * w + Math.sin(2 * th2) * w2;
    C2[i] = cc; S2[i] = ss;
  }
  const C2b = gauss1(C2, W, H, 1.5 * sc), S2b = gauss1(S2, W, H, 1.5 * sc);
  const DX = new Float32Array(N), DY = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const th = 0.5 * Math.atan2(S2b[i], C2b[i]);
    DX[i] = Math.cos(th); DY[i] = Math.sin(th);
  }
  log('direction field');

  // ------------ the canvas: toned ground (warm ochre-umber imprimatura) and weave
  const Cv = new Float32Array(N * 3);
  const Hp = new Float32Array(N);
  const ground = [0.2, 0.125, 0.06];
  for (let i = 0; i < N; i++) {
    const x = i % W, y = (i / W) | 0;
    const n = 1 + 0.08 * tex.at(x / W * 3, y / H * 3);
    Cv[i * 3] = ground[0] * n; Cv[i * 3 + 1] = ground[1] * n; Cv[i * 3 + 2] = ground[2] * n;
  }

  // ------------ blurred model images per brush size
  const blurCache = new Map();
  const Mb = (sigma) => {
    const k = Math.round(sigma * 10);
    if (!blurCache.has(k)) blurCache.set(k, gaussRGB(M, W, H, sigma));
    return blurCache.get(k);
  };

  // ------------ generic stroke placement
  const paintLayer = (name, R, { step, sigma, thresh, minImp = 0, maxImp = 2, len = 6, stop = 0.2, pickup = 0.05, jitter = 0.07, opacity = 0.9, load = 0.2, dry = 0.5, cover = 0, colourFn = null, dirJitter = 0.15, oidStop = false, filter = null }) => {
    const ref = Mb(sigma);
    const cells = [];
    const st = Math.max(1, step);
    for (let gy = 0; gy < H; gy += st) for (let gx = 0; gx < W; gx += st) {
      const x = Math.min(W - 1, Math.floor(gx + rnd() * st)), y = Math.min(H - 1, Math.floor(gy + rnd() * st));
      const i = y * W + x;
      const im = impB[i];
      if (im < minImp || im > maxImp) continue;
      if (filter && !filter(i, x, y)) continue;
      const err = cdiff(Cv, i * 3, ref[i * 3], ref[i * 3 + 1], ref[i * 3 + 2]);
      if (err < thresh * (1.2 - im * 0.6) && rnd() > cover) continue;
      cells.push(i);
    }
    for (let k = cells.length - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); const t = cells[k]; cells[k] = cells[j]; cells[j] = t; }
    for (const i0 of cells) {
      const sx = i0 % W, sy = (i0 / W) | 0;
      let cr, cg, cb;
      if (colourFn) { const c = colourFn(i0); cr = c[0]; cg = c[1]; cb = c[2]; }
      else { cr = ref[i0 * 3]; cg = ref[i0 * 3 + 1]; cb = ref[i0 * 3 + 2]; }
      // broken colour: value and temperature varied stroke to stroke
      const jv = 1 + (rnd() - 0.5) * jitter * 2, jt = (rnd() - 0.5) * jitter;
      cr *= jv * (1 + jt); cg *= jv; cb *= jv * (1 - jt);
      const px = [sx + 0.5], py = [sy + 0.5];
      const cols = [cr, cg, cb];
      let dx = DX[i0], dy = DY[i0];
      const ja = (rnd() - 0.5) * dirJitter * 2;
      { const c = Math.cos(ja), s = Math.sin(ja); const nx = dx * c - dy * s; dy = dx * s + dy * c; dx = nx; }
      if (rnd() < 0.5) { dx = -dx; dy = -dy; }
      const oid0 = G.oid[i0];
      const steps = Math.max(1, Math.round(len * (0.6 + rnd() * 0.7)));
      let br = cr, bg = cg, bb = cb;
      for (let k = 1; k <= steps; k++) {
        const nx = px[k - 1] + dx * R * 0.85, ny = py[k - 1] + dy * R * 0.85;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) break;
        const j = ((ny | 0) * W + (nx | 0));
        if (k > 1 && cdiff(ref, j * 3, cr, cg, cb) > stop) break;
        if (oidStop && G.oid[j] !== oid0 && impB[i0] > 0.5) break;
        // wet paint picked up from the canvas
        br += (Cv[j * 3] - br) * pickup; bg += (Cv[j * 3 + 1] - bg) * pickup; bb += (Cv[j * 3 + 2] - bb) * pickup;
        px.push(nx); py.push(ny); cols.push(br, bg, bb);
        let fx = DX[j], fy = DY[j];
        if (fx * dx + fy * dy < 0) { fx = -fx; fy = -fy; }
        dx = dx * 0.6 + fx * 0.4; dy = dy * 0.6 + fy * 0.4;
        const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      }
      drawStroke(Cv, Hp, W, H, px, py, cols, R * (0.8 + rnd() * 0.4), { opacity, load, dry }, rnd);
    }
    log(`${name}: r=${R.toFixed(1)} strokes ${cells.length}`);
  };

  // ------------ 1. underdrawing: umber contour lines where forms part, thin washes in the shadows
  {
    const umber = [0.055, 0.032, 0.016];
    const cells = [];
    const st = Math.max(2, Math.round(3 * sc));
    for (let y = 1; y < H - 1; y += st) for (let x = 1; x < W - 1; x += st) {
      const i = y * W + x;
      const t = T.tag[i];
      if (t < 2 || t > 9) continue;
      const o = G.oid[i];
      const edge = G.oid[i + 1] !== o || G.oid[i - 1] !== o || G.oid[i + W] !== o || G.oid[i - W] !== o
        || Math.abs(T.z[i + 1] - T.z[i]) > T.z[i] * 0.08 || Math.abs(T.z[i + W] - T.z[i]) > T.z[i] * 0.08;
      if (edge && rnd() < 0.8) cells.push(i);
    }
    for (const i0 of cells) {
      const x = i0 % W, y = (i0 / W) | 0;
      let dx = DX[i0], dy = DY[i0];
      const px = [x + 0.5], py = [y + 0.5], cols = [...umber];
      for (let k = 1; k <= 3; k++) {
        const nx = px[k - 1] + dx * 2.5 * sc, ny = py[k - 1] + dy * 2.5 * sc;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) break;
        px.push(nx + (rnd() - 0.5) * 0.6); py.push(ny + (rnd() - 0.5) * 0.6); cols.push(...umber);
        const j = (ny | 0) * W + (nx | 0);
        let fx = DX[j], fy = DY[j];
        if (fx * dx + fy * dy < 0) { fx = -fx; fy = -fy; }
        dx = fx; dy = fy;
      }
      drawStroke(Cv, Hp, W, H, px, py, cols, 1.6 * sc * (0.7 + rnd() * 0.6), { opacity: 0.75, load: 0.05, dry: 0.7 }, rnd);
    }
    log(`underdrawing: ${cells.length} marks`);
    // brown-green shadow washes on the figures (a brunaille underpainting)
    paintLayer('shadow washes', 7 * sc, {
      step: Math.round(6 * sc), sigma: 3 * sc, thresh: 0, cover: 1, len: 5, stop: 0.5, pickup: 0.02, jitter: 0.05,
      opacity: 0.45, load: 0.04, dry: 0.3,
      filter: (i) => T.tag[i] >= 2 && T.tag[i] <= 8 && G.sun[i] < 0.25 && G.smA[i] < 0.5,
      colourFn: () => [0.04, 0.035, 0.02],
    });
  }

  // ------------ 2. block-in: the big masses, broad and loose
  paintLayer('block-in', 30 * sc, { step: Math.round(24 * sc), sigma: 12 * sc, thresh: 0, cover: 1, len: 6, stop: 0.3, pickup: 0.06, jitter: 0.08, opacity: 0.9, load: 0.12, dry: 0.45, dirJitter: 0.25 });
  paintLayer('masses', 16 * sc, { step: Math.round(12 * sc), sigma: 6 * sc, thresh: 0.02, cover: 0.45, len: 6, stop: 0.22, pickup: 0.06, jitter: 0.08, opacity: 0.9, load: 0.16, dry: 0.5 });
  // ------------ 3. modelling the forms, coarse to fine
  paintLayer('forms', 8.5 * sc, { step: Math.round(6 * sc), sigma: 3 * sc, thresh: 0.03, cover: 0.2, len: 6, stop: 0.16, pickup: 0.05, jitter: 0.07, opacity: 0.9, load: 0.2, dry: 0.5, minImp: 0.1 });
  paintLayer('forms', 5 * sc, { step: Math.round(3.5 * sc), sigma: 1.6 * sc, thresh: 0.04, cover: 0.08, len: 5, stop: 0.13, pickup: 0.04, jitter: 0.06, opacity: 0.92, load: 0.22, dry: 0.5, minImp: 0.4, oidStop: true });
  paintLayer('detail', 3 * sc, { step: Math.max(1, Math.round(2.2 * sc)), sigma: 0.9 * sc, thresh: 0.045, cover: 0.03, len: 4, stop: 0.11, pickup: 0.03, jitter: 0.05, opacity: 0.94, load: 0.25, dry: 0.45, minImp: 0.55, oidStop: true });
  paintLayer('fine', 1.9 * sc, { step: Math.max(1, Math.round(1.5 * sc)), sigma: 0.5 * sc, thresh: 0.05, cover: 0, len: 3, stop: 0.1, pickup: 0.02, jitter: 0.04, opacity: 0.95, load: 0.25, dry: 0.4, minImp: 0.85, oidStop: true });

  // ------------ 4. lights laid on thick, and the darkest accents
  {
    const ref = Mb(0.8 * sc);
    const cells = [];
    const st = Math.max(1, Math.round(2.5 * sc));
    for (let y = 0; y < H; y += st) for (let x = 0; x < W; x += st) {
      const i = y * W + x;
      const t = T.tag[i];
      if (t < 2 || t > 8 || G.smA[i] > 0.6) continue;
      const l = lumOf(ref[i * 3], ref[i * 3 + 1], ref[i * 3 + 2]);
      const hot = G.spec[i] > 0.12 || (l > 0.55 && G.sun[i] > 0.6);
      if (hot && rnd() < 0.55 * impB[i] + 0.1) cells.push(i);
    }
    for (const i0 of cells) {
      const x = i0 % W, y = (i0 / W) | 0;
      const k = 1.15 + rnd() * 0.25;
      const c = [ref[i0 * 3] * k + 0.05, ref[i0 * 3 + 1] * k + 0.045, ref[i0 * 3 + 2] * k + 0.03];
      const dx = DX[i0], dy = DY[i0];
      const L = (1.5 + rnd() * 2.5) * sc;
      drawStroke(Cv, Hp, W, H, [x + 0.5 - dx * L, x + 0.5 + dx * L], [y + 0.5 - dy * L, y + 0.5 + dy * L], [...c, ...c], (1.3 + rnd() * 1.2) * sc, { opacity: 0.85, load: 0.9, dry: 0.3 }, rnd);
    }
    log(`impasto lights: ${cells.length}`);
    // dark accents in the deepest folds and under-edges
    const dcells = [];
    for (let y = 1; y < H - 1; y += st) for (let x = 1; x < W - 1; x += st) {
      const i = y * W + x;
      const t = T.tag[i];
      if (t < 2 || t > 8 || G.smA[i] > 0.4 || T.z[i] > 25) continue;
      const l = lumOf(ref[i * 3], ref[i * 3 + 1], ref[i * 3 + 2]);
      if (l < 0.012 && G.amb[i] < 0.55 && rnd() < 0.25) dcells.push(i);
    }
    for (const i0 of dcells) {
      const x = i0 % W, y = (i0 / W) | 0;
      const dx = DX[i0], dy = DY[i0], L = (2 + rnd() * 3) * sc;
      const c = [0.012, 0.008, 0.005];
      drawStroke(Cv, Hp, W, H, [x + 0.5 - dx * L, x + 0.5 + dx * L], [y + 0.5 - dy * L, y + 0.5 + dy * L], [...c, ...c], 1.1 * sc, { opacity: 0.6, load: 0.05, dry: 0.5 }, rnd);
    }
    log(`dark accents: ${dcells.length}`);
  }

  // ------------ 5. glazes: warm transparent darks deepen the shadows, unevenly
  for (let i = 0; i < N; i++) {
    const x = i % W, y = (i / W) | 0;
    const l = lumOf(Cv[i * 3], Cv[i * 3 + 1], Cv[i * 3 + 2]);
    const g = (1 - smoothstep(0.02, 0.18, l)) * (0.55 + 0.45 * tex.at(x / W * 5, y / H * 5));
    Cv[i * 3] *= 1 - 0.1 * g; Cv[i * 3 + 1] *= 1 - 0.16 * g; Cv[i * 3 + 2] *= 1 - 0.3 * g;
  }

  // ------------ 6. the paint surface: impasto relief and canvas weave under a raking light
  const weave = new Float32Array(N);
  const per = 3.4 * sc;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const wx = Math.sin((x / per) * Math.PI), wy = Math.sin((y / per) * Math.PI);
    const over = ((Math.floor(x / per) + Math.floor(y / per)) & 1) ? wx * wx : wy * wy;
    weave[i] = over * (0.8 + 0.4 * tex.at(x / W * 40, y / H * 40));
  }
  const Hs = gauss1(Hp, W, H, 0.7 * sc);
  const out = new Float32Array(N * 3);
  const lx = -0.62, ly = -0.78; // studio light from the upper left
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    const hw = Math.exp(-Hs[i] * 3);
    const h = (k) => Hs[k] + weave[k] * 0.2 * hw;
    const gx = (h(i + 1) - h(i - 1)) * 0.5 / sc, gy = (h(i + W) - h(i - W)) * 0.5 / sc;
    const slope = -(gx * lx + gy * ly);
    const shade = clamp(1 + slope * 0.9, 0.7, 1.3);
    const glint = Math.max(0, slope - 0.18) * 0.12 * Math.min(1, Hs[i] * 2);
    out[i * 3] = Cv[i * 3] * shade + glint; out[i * 3 + 1] = Cv[i * 3 + 1] * shade + glint; out[i * 3 + 2] = Cv[i * 3 + 2] * shade + glint * 0.9;
  }
  for (let x = 0; x < W; x++) for (const y of [0, H - 1]) { const i = y * W + x; out[i * 3] = Cv[i * 3]; out[i * 3 + 1] = Cv[i * 3 + 1]; out[i * 3 + 2] = Cv[i * 3 + 2]; }
  for (let y = 0; y < H; y++) for (const x of [0, W - 1]) { const i = y * W + x; out[i * 3] = Cv[i * 3]; out[i * 3 + 1] = Cv[i * 3 + 1]; out[i * 3 + 2] = Cv[i * 3 + 2]; }
  log('paint relief');
  return out;
}
