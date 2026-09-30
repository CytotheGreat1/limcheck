// Stroke-based painterly rendering (after Hertzmann 1998): the render is repainted on a canvas with
// layers of curved brush strokes, coarse to fine. Strokes follow the image flow field, stop at colour
// edges, carry slightly broken colour and bristle texture; finer layers are only laid where the
// canvas still differs from the source, and where detail matters (faces, hands, the focal figures).
import { clamp, lerp, smoothstep } from './core/math.mjs';
import { mulberry32 } from './core/rng.mjs';

function blurRGB(src, W, H, r) {
  if (r < 1) return Float32Array.from(src);
  const out = new Float32Array(src.length);
  const tmp = new Float32Array(src.length);
  const pass = (a, b, horiz) => {
    const inv = 1 / (2 * r + 1);
    if (horiz) {
      for (let y = 0; y < H; y++) for (let c = 0; c < 3; c++) {
        let acc = 0;
        for (let x = -r; x <= r; x++) acc += a[(y * W + clamp(x, 0, W - 1)) * 3 + c];
        for (let x = 0; x < W; x++) {
          b[(y * W + x) * 3 + c] = acc * inv;
          acc += a[(y * W + Math.min(W - 1, x + r + 1)) * 3 + c] - a[(y * W + Math.max(0, x - r)) * 3 + c];
        }
      }
    } else {
      for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) {
        let acc = 0;
        for (let y = -r; y <= r; y++) acc += a[(clamp(y, 0, H - 1) * W + x) * 3 + c];
        for (let y = 0; y < H; y++) {
          b[(y * W + x) * 3 + c] = acc * inv;
          acc += a[(Math.min(H - 1, y + r + 1) * W + x) * 3 + c] - a[(Math.max(0, y - r) * W + x) * 3 + c];
        }
      }
    }
  };
  pass(src, tmp, true); pass(tmp, out, false);
  pass(out, tmp, true); pass(tmp, out, false);
  return out;
}

const g = (v) => Math.sqrt(Math.max(0, v)); // perceptual-ish encoding for colour differences

export function paint(src, W, H, flow, importance, { scale = 1, log = () => {}, seed = 1 } = {}) {
  const rnd = mulberry32(seed);
  const N = W * H;
  const radii = [26, 14, 8, 4.5, 2.4, 1.3].map((r) => r * scale).filter((r) => r >= 0.9);
  // underpainting: heavily blurred, slightly warm
  let canvas = blurRGB(src, W, H, Math.round(radii[0]));
  for (let i = 0; i < N; i++) { canvas[i * 3] *= 1.03; canvas[i * 3 + 2] *= 0.95; }
  const cov = new Float32Array(1); // placeholder
  for (let li = 0; li < radii.length; li++) {
    const R = radii[li];
    const ref = blurRGB(src, W, H, Math.max(0, Math.round(R * 0.35)));
    const step = Math.max(1, Math.round(R * 0.9));
    const T = 0.035 + 0.02 * (li / radii.length); // error threshold (perceptual)
    const strokes = [];
    for (let gy = 0; gy < H; gy += step) {
      for (let gx = 0; gx < W; gx += step) {
        // sample error in the cell
        let err = 0, best = -1, bx = gx, by = gy, cnt = 0;
        for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) {
          const x = Math.min(W - 1, gx + Math.floor((sx + rnd()) * step / 3));
          const y = Math.min(H - 1, gy + Math.floor((sy + rnd()) * step / 3));
          const i = (y * W + x) * 3;
          const e = Math.abs(g(ref[i]) - g(canvas[i])) + Math.abs(g(ref[i + 1]) - g(canvas[i + 1])) + Math.abs(g(ref[i + 2]) - g(canvas[i + 2]));
          err += e; cnt++;
          if (e > best) { best = e; bx = x; by = y; }
        }
        err /= cnt * 3;
        const imp = importance[Math.min(H - 1, by) * W + Math.min(W - 1, bx)];
        // coarse layers everywhere; fine layers where error remains and detail matters
        const needed = li === 0 || err > T * (1.25 - imp * 0.9);
        if (!needed) continue;
        // fine strokes are not wanted in unimportant areas beyond a certain size
        if (R < 3 * scale && imp < 0.35) continue;
        strokes.push([bx, by]);
      }
    }
    // shuffle
    for (let i = strokes.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = strokes[i]; strokes[i] = strokes[j]; strokes[j] = t; }
    const maxSteps = R > 10 * scale ? 9 : R > 4 * scale ? 7 : 5;
    let drawn = 0;
    for (const [sx, sy] of strokes) {
      const i0 = (sy * W + sx) * 3;
      let cr = ref[i0], cg = ref[i0 + 1], cb = ref[i0 + 2];
      // broken colour: slight value & temperature jitter
      const jv = 1 + (rnd() - 0.5) * 0.09, jt = (rnd() - 0.5) * 0.05;
      cr *= jv * (1 + jt); cg *= jv; cb *= jv * (1 - jt);
      // path along the flow field
      const px = [sx + 0.5], py = [sy + 0.5];
      let dx = flow.tx[sy * W + sx], dy = flow.ty[sy * W + sx];
      if (rnd() < 0.5) { dx = -dx; dy = -dy; }
      const stepLen = R * 0.9;
      for (let k = 1; k <= maxSteps; k++) {
        const nx = px[k - 1] + dx * stepLen, ny = py[k - 1] + dy * stepLen;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) break;
        const j = (Math.floor(ny) * W + Math.floor(nx));
        const d = Math.abs(g(ref[j * 3]) - g(cr)) + Math.abs(g(ref[j * 3 + 1]) - g(cg)) + Math.abs(g(ref[j * 3 + 2]) - g(cb));
        if (k > 1 && d > 0.16) break;
        px.push(nx); py.push(ny);
        let fx = flow.tx[j], fy = flow.ty[j];
        if (fx * dx + fy * dy < 0) { fx = -fx; fy = -fy; }
        dx = dx * 0.5 + fx * 0.5; dy = dy * 0.5 + fy * 0.5;
        const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      }
      drawStroke(canvas, W, H, px, py, R, cr, cg, cb, rnd);
      drawn++;
    }
    log(`paint layer r=${R.toFixed(1)} strokes ${drawn}`);
  }
  return canvas;
}

// Render a stroke as a soft capsule chain with bristle streaks, blended into the canvas.
// Coverage is rasterised per segment into a scratch buffer (max-combined), then blended once.
let COV = new Float32Array(0), CW = 0;
function drawStroke(C, W, H, px, py, R, cr, cg, cb, rnd) {
  const n = px.length;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) { x0 = Math.min(x0, px[i]); x1 = Math.max(x1, px[i]); y0 = Math.min(y0, py[i]); y1 = Math.max(y1, py[i]); }
  x0 = Math.max(0, Math.floor(x0 - R - 1)); y0 = Math.max(0, Math.floor(y0 - R - 1));
  x1 = Math.min(W - 1, Math.ceil(x1 + R + 1)); y1 = Math.min(H - 1, Math.ceil(y1 + R + 1));
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  if (bw <= 0 || bh <= 0) return;
  if (COV.length < bw * bh) COV = new Float32Array(bw * bh * 2);
  COV.fill(0, 0, bw * bh);
  CW = bw;
  // cumulative length for along-stroke parameter
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(px[i] - px[i - 1], py[i] - py[i - 1]));
  const Ltot = cum[n - 1] + 1e-6;
  const bseed = rnd() * 100;
  const opacity = 0.82 + rnd() * 0.15;
  const nbr = 5 + Math.floor(rnd() * 4);
  const segs = Math.max(1, n - 1);
  for (let si = 0; si < segs; si++) {
    const ax = px[si], ay = py[si];
    const bx = n > 1 ? px[si + 1] : ax, by = n > 1 ? py[si + 1] : ay;
    const vx = bx - ax, vy = by - ay;
    const ll = vx * vx + vy * vy;
    const sl = Math.sqrt(ll) || 1;
    const sx0 = Math.max(x0, Math.floor(Math.min(ax, bx) - R)), sx1 = Math.min(x1, Math.ceil(Math.max(ax, bx) + R));
    const sy0 = Math.max(y0, Math.floor(Math.min(ay, by) - R)), sy1 = Math.min(y1, Math.ceil(Math.max(ay, by) + R));
    for (let y = sy0; y <= sy1; y++) {
      const qy = y + 0.5;
      const row = (y - y0) * bw - x0;
      for (let x = sx0; x <= sx1; x++) {
        const qx = x + 0.5;
        let t = ll > 0 ? ((qx - ax) * vx + (qy - ay) * vy) / ll : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = qx - ax - vx * t, ey = qy - ay - vy * t;
        const d2 = ex * ex + ey * ey;
        if (d2 >= R * R) continue;
        const d = Math.sqrt(d2);
        const across = ll > 0 ? (ex * -vy + ey * vx) / (sl * R) : 0;
        const along = (cum[Math.min(si, n - 1)] + t * sl) / Ltot;
        let a = 1 - smoothstep(0.7, 1.0, d / R);
        const bwv = Math.sin((across * nbr + bseed) * 3.1) * 0.5 + 0.5;
        a *= 0.72 + 0.28 * bwv;
        a *= 1 - 0.35 * smoothstep(0.55, 1.0, along) * (0.5 + 0.5 * Math.sin(across * 17 + bseed));
        const k = row + x;
        if (a > COV[k]) COV[k] = a;
      }
    }
  }
  for (let y = y0; y <= y1; y++) {
    const row = (y - y0) * bw;
    for (let x = x0; x <= x1; x++) {
      const a0 = COV[row + x - x0];
      if (a0 <= 0) continue;
      const a = a0 * opacity;
      const i = (y * W + x) * 3;
      C[i] += (cr - C[i]) * a; C[i + 1] += (cg - C[i + 1]) * a; C[i + 2] += (cb - C[i + 2]) * a;
    }
  }
}
