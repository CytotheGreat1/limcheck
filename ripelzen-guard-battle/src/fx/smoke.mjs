// Volumetric-ish powder smoke and dust: soft spherical puffs integrated analytically along each
// view ray, clipped by the scene depth (so smoke threads between the soldiers), textured with
// billowing noise and lit by the sun patches.
import { clamp, lerp, smoothstep, norm } from '../core/math.mjs';
import { NoiseTex } from '../core/rng.mjs';
import { Env } from '../core/light.mjs';

export class Smoke {
  constructor() {
    this.puffs = [];
    this.tex1 = new NoiseTex(512, 6, 5, 31.1);
    this.tex2 = new NoiseTex(256, 12, 4, 17.7);
  }
  // c: centre, r: radius (m), dens: extinction per metre at the core, o: {col, emit, lit, noise}
  add(c, r, dens, o = {}) {
    this.puffs.push({
      c, r, dens,
      col: o.col || [0.9, 0.88, 0.84],
      emit: o.emit || null,
      noise: o.noise ?? 1,
      lit: o.lit ?? 1,
      seed: this.puffs.length * 0.6180339 % 1,
    });
  }

  render(T, cam, SS, W, H, log) {
    const puffs = this.puffs;
    const TILE = 16;
    const tw = Math.ceil(W / TILE), th = Math.ceil(H / TILE);
    const bins = Array.from({ length: tw * th }, () => []);
    const cp = cam.pos, fw = cam.fwd;
    const fFinal = cam.f / SS, cxF = cam.cx / SS, cyF = cam.cy / SS;
    const sun = Env.sunDir;
    // pre-compute per-puff screen footprint and lighting constants
    for (let i = 0; i < puffs.length; i++) {
      const p = puffs[i];
      const v = cam.view(p.c);
      let x0, x1, y0, y1;
      if (v[2] < p.r * 1.05) { x0 = 0; x1 = tw - 1; y0 = 0; y1 = th - 1; }
      else {
        const sx = cxF + (fFinal * v[0]) / v[2], sy = cyF - (fFinal * v[1]) / v[2];
        const rp = (fFinal * p.r) / Math.sqrt(v[2] * v[2] - p.r * p.r) + 2;
        p.rpx = rp; p.sx = sx; p.sy = sy;
        x0 = Math.max(0, Math.floor((sx - rp) / TILE)); x1 = Math.min(tw - 1, Math.floor((sx + rp) / TILE));
        y0 = Math.max(0, Math.floor((sy - rp) / TILE)); y1 = Math.min(th - 1, Math.floor((sy + rp) / TILE));
        if (x0 > x1 || y0 > y1) continue;
      }
      if (!p.rpx) { p.rpx = W; p.sx = W / 2; p.sy = H / 2; }
      p.sunV = Env.sunMask ? Env.sunMask(p.c[0], p.c[2]) : 1;
      for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) bins[ty * tw + tx].push(i);
    }
    let total = 0;
    for (const b of bins) total += b.length;
    if (log) log('smoke puffs', puffs.length, 'avg per tile', (total / bins.length).toFixed(1));
    const sc = Env.sunCol, sI = Env.sunI, kc = Env.skyCol;
    const tau = new Float64Array(SS * SS), tdist = new Float64Array(SS * SS);
    const acR = new Float64Array(SS * SS), acG = new Float64Array(SS * SS), acB = new Float64Array(SS * SS);
    const emR = new Float64Array(SS * SS), emG = new Float64Array(SS * SS), emB = new Float64Array(SS * SS);
    const n = SS * SS;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const list = bins[Math.floor(y / TILE) * tw + Math.floor(x / TILE)];
        if (!list.length) continue;
        const d = cam.ray(x * SS + SS / 2, y * SS + SS / 2);
        const dfw = d[0] * fw[0] + d[1] * fw[1] + d[2] * fw[2];
        for (let k = 0; k < n; k++) {
          const sx = x * SS + (k % SS), sy = y * SS + Math.floor(k / SS);
          const z = T.z[sy * T.W + sx];
          tdist[k] = z === Infinity ? 1e9 : z / dfw;
          tau[k] = 0; acR[k] = acG[k] = acB[k] = 0; emR[k] = emG[k] = emB[k] = 0;
        }
        let any = false;
        for (let li = 0; li < list.length; li++) {
          const p = puffs[list[li]];
          const ox = p.c[0] - cp[0], oy = p.c[1] - cp[1], oz = p.c[2] - cp[2];
          const bb = ox * d[0] + oy * d[1] + oz * d[2];
          const h2 = ox * ox + oy * oy + oz * oz - bb * bb;
          const r2 = p.r * p.r;
          if (h2 >= r2) continue;
          const l = Math.sqrt(r2 - h2);
          const t0 = bb - l, t1 = bb + l;
          if (t1 <= 0) continue;
          // billow texture in puff-relative screen coordinates
          const q = 0.55 / p.rpx;
          const u = (x - p.sx) * q + p.seed * 7.3, v = (y - p.sy) * q + p.seed * 3.1;
          let nz = this.tex1.at(u, v) * 0.65 + this.tex2.at(u * 2.3 + 0.5, v * 2.3) * 0.35;
          const hr = Math.sqrt(h2) / p.r;
          let nf = 1 + p.noise * (nz * 1.4 - (hr * hr) * 0.6);
          if (nf <= 0.02) continue;
          if (nf > 2) nf = 2;
          // lighting: front surface normal vs sun, plus noise relief
          const tf = Math.max(t0, 0);
          const sx0 = cp[0] + d[0] * tf - p.c[0], sy0 = cp[1] + d[1] * tf - p.c[1], sz0 = cp[2] + d[2] * tf - p.c[2];
          const inv = 1 / p.r;
          let ndl = (sx0 * sun[0] + sy0 * sun[1] + sz0 * sun[2]) * inv;
          ndl += nz * 0.5;
          let lit = clamp(0.5 + 0.5 * ndl, 0, 1);
          lit = lit * lit;
          const sunAmt = p.lit * p.sunV * sI * 0.42 * lit;
          const cr = p.col[0] * (sc[0] * sunAmt + kc[0] * 1.35 + 0.1);
          const cg = p.col[1] * (sc[1] * sunAmt + kc[1] * 1.35 + 0.1);
          const cb = p.col[2] * (sc[2] * sunAmt + kc[2] * 1.35 + 0.1);
          const inr = 1 / r2;
          for (let k = 0; k < n; k++) {
            const ta = t0 > 0 ? t0 : 0;
            const tb = t1 < tdist[k] ? t1 : tdist[k];
            if (tb <= ta) continue;
            const ua = ta - bb, ub = tb - bb;
            const integ = (ub - ua) * (1 - h2 * inr) - (ub * ub * ub - ua * ua * ua) * inr / 3;
            const tt = p.dens * integ * nf;
            if (tt <= 0) continue;
            tau[k] += tt;
            acR[k] += cr * tt; acG[k] += cg * tt; acB[k] += cb * tt;
            if (p.emit) { emR[k] += p.emit[0] * tt; emG[k] += p.emit[1] * tt; emB[k] += p.emit[2] * tt; }
            any = true;
          }
        }
        if (!any) continue;
        for (let k = 0; k < n; k++) {
          if (tau[k] <= 0) continue;
          const sx = x * SS + (k % SS), sy = y * SS + Math.floor(k / SS);
          const i = (sy * T.W + sx) * 3;
          const tr = Math.exp(-tau[k]);
          const a = (1 - tr) / tau[k];
          T.rgb[i] = T.rgb[i] * tr + acR[k] * a + emR[k];
          T.rgb[i + 1] = T.rgb[i + 1] * tr + acG[k] * a + emG[k];
          T.rgb[i + 2] = T.rgb[i + 2] * tr + acB[k] * a + emB[k];
        }
      }
    }
  }
}
