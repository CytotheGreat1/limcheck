// Z-buffered software triangle rasteriser with perspective-correct attribute
// interpolation and a per-fragment material callback.

export class Target {
  constructor(W, H, { gbuf = false } = {}) {
    this.W = W; this.H = H;
    this.rgb = new Float32Array(W * H * 3);
    this.z = new Float32Array(W * H).fill(Infinity);
    this.tag = new Uint8Array(W * H); // coarse material class for post effects
    // reference buffers for the painter (what a painter would read off a posed model)
    if (gbuf) {
      const N = W * H;
      this.g = {
        alb: new Float32Array(N * 3), // local colour
        sun: new Float32Array(N), // direct light incl. cast shadows
        amb: new Float32Array(N), // sky light / occlusion
        spec: new Float32Array(N), // highlight strength
        fog: new Float32Array(N), // aerial perspective amount
        haze: new Float32Array(N * 3),
        nx: new Float32Array(N), ny: new Float32Array(N), // screen-space surface orientation
        oid: new Uint32Array(N), // which object (edges between figures)
        smA: new Float32Array(N), smC: new Float32Array(N * 3), // smoke veil in front
      };
    }
  }
}

// current object id for G-buffer writes
export const RS = { oid: 1 };
export function writeG(T, idx, Fr) {
  const G = T.g;
  G.alb[idx * 3] = Fr.ar; G.alb[idx * 3 + 1] = Fr.ag; G.alb[idx * 3 + 2] = Fr.ab;
  G.sun[idx] = Fr.lsun; G.amb[idx] = Fr.lamb; G.spec[idx] = Fr.lspec; G.fog[idx] = Fr.fog;
  G.haze[idx * 3] = Fr.hr; G.haze[idx * 3 + 1] = Fr.hg; G.haze[idx * 3 + 2] = Fr.hb;
  G.nx[idx] = Fr.snx; G.ny[idx] = Fr.sny;
  G.oid[idx] = RS.oid;
}

// Shared fragment record handed to materials.
export const F = {
  x: 0, y: 0, z: 0,
  px: 0, py: 0, pz: 0,
  nx: 0, ny: 0, nz: 1,
  u: 0, v: 0, ex: 0,
  tx: 1, ty: 0, tz: 0,
  ar: 0, ag: 0, ab: 0, lsun: 0, lamb: 0, lspec: 0, fog: 0, hr: 0, hg: 0, hb: 0, snx: 0, sny: 0,
  r: 0, g: 0, b: 0,
  discard: false,
  tag: 0,
};

let cap = 0;
let SX, SY, IZ, AT; // scratch per-vertex arrays
const NA = 12; // attributes per vertex: px py pz nx ny nz u v ex tx ty tz
function ensure(n) {
  if (n <= cap) return;
  cap = Math.max(n, cap * 2, 4096);
  SX = new Float64Array(cap); SY = new Float64Array(cap); IZ = new Float64Array(cap);
  AT = new Float64Array(cap * NA);
}

export function drawMesh(T, cam, mesh) {
  const n = mesh.nv;
  ensure(n + 64);
  const P = mesh.pos, N = mesh.nrm, UV = mesh.uv, EX = mesh.ex, TG = mesh.tan;
  const r = cam.right, u = cam.up, f = cam.fwd, cp = cam.pos;
  const fl = cam.f, cx = cam.cx, cy = cam.cy, near = cam.near;
  const VZ = new Float64Array(n), VX = new Float64Array(n), VY = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const dx = P[i * 3] - cp[0], dy = P[i * 3 + 1] - cp[1], dz = P[i * 3 + 2] - cp[2];
    const vx = dx * r[0] + dy * r[1] + dz * r[2];
    const vy = dx * u[0] + dy * u[1] + dz * u[2];
    const vz = dx * f[0] + dy * f[1] + dz * f[2];
    VX[i] = vx; VY[i] = vy; VZ[i] = vz;
    if (vz > near) {
      IZ[i] = 1 / vz;
      SX[i] = cx + fl * vx * IZ[i];
      SY[i] = cy - fl * vy * IZ[i];
    }
    const o = i * NA;
    AT[o] = P[i * 3]; AT[o + 1] = P[i * 3 + 1]; AT[o + 2] = P[i * 3 + 2];
    AT[o + 3] = N[i * 3]; AT[o + 4] = N[i * 3 + 1]; AT[o + 5] = N[i * 3 + 2];
    AT[o + 6] = UV[i * 2]; AT[o + 7] = UV[i * 2 + 1]; AT[o + 8] = EX[i];
    AT[o + 9] = TG[i * 3]; AT[o + 10] = TG[i * 3 + 1]; AT[o + 11] = TG[i * 3 + 2];
  }
  const I = mesh.idx, mat = mesh.material;
  const cull = mesh.cull;
  for (let t = 0; t < mesh.nt; t++) {
    const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2];
    const za = VZ[a] > near, zb = VZ[b] > near, zc = VZ[c] > near;
    if (za && zb && zc) {
      rasterTri(T, a, b, c, mat, cull);
    } else if (za || zb || zc) {
      clipTri(T, cam, [a, b, c], [VX, VY, VZ], n, mat, cull);
    }
  }
}

function clipTri(T, cam, ids, V, n, mat, cull) {
  const [VX, VY, VZ] = V;
  const near = cam.near + 1e-4;
  // Build polygon of (view xyz + attrs), clip against z = near
  const poly = ids.map((i) => ({ x: VX[i], y: VY[i], z: VZ[i], a: Array.from(AT.subarray(i * NA, i * NA + NA)) }));
  const out = [];
  for (let k = 0; k < poly.length; k++) {
    const p = poly[k], q = poly[(k + 1) % poly.length];
    const pin = p.z > near, qin = q.z > near;
    if (pin) out.push(p);
    if (pin !== qin) {
      const t = (near - p.z) / (q.z - p.z);
      out.push({
        x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, z: near,
        a: p.a.map((v, j) => v + (q.a[j] - v) * t),
      });
    }
  }
  if (out.length < 3) return;
  ensure(n + out.length + 8);
  const base = n + 8;
  for (let k = 0; k < out.length; k++) {
    const i = base + k, p = out[k];
    IZ[i] = 1 / p.z;
    SX[i] = cam.cx + cam.f * p.x * IZ[i];
    SY[i] = cam.cy - cam.f * p.y * IZ[i];
    for (let j = 0; j < NA; j++) AT[i * NA + j] = p.a[j];
  }
  for (let k = 1; k + 1 < out.length; k++) rasterTri(T, base, base + k, base + k + 1, mat, cull);
}

function rasterTri(T, a, b, c, mat, cull) {
  const x0 = SX[a], y0 = SY[a], x1 = SX[b], y1 = SY[b], x2 = SX[c], y2 = SY[c];
  const area = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
  if (!(Math.abs(area) > 1e-12)) return;
  if (cull && area > 0) return;
  const W = T.W, H = T.H;
  let minY = Math.min(y0, y1, y2), maxY = Math.max(y0, y1, y2);
  let yS = Math.max(0, Math.ceil(minY - 0.5)), yE = Math.min(H - 1, Math.floor(maxY - 0.5));
  if (yS > yE) return;
  const minX = Math.min(x0, x1, x2), maxX = Math.max(x0, x1, x2);
  if (maxX < 0 || minX > W) return;
  const inv = 1 / area;
  // w_a = ((x2-x1)(y-y1) - (y2-y1)(x-x1)) / area  = A0 x + B0(y)
  const A0 = -(y2 - y1) * inv, A1 = -(y0 - y2) * inv, A2 = -(y1 - y0) * inv;
  const iza = IZ[a], izb = IZ[b], izc = IZ[c];
  const ZB = T.z, RGB = T.rgb, TAG = T.tag;
  const oa = a * NA, ob = b * NA, oc = c * NA;
  const Fr = F;
  for (let py = yS; py <= yE; py++) {
    const yc = py + 0.5;
    const B0 = ((x2 - x1) * (yc - y1) + (y2 - y1) * x1) * inv;
    const B1 = ((x0 - x2) * (yc - y2) + (y0 - y2) * x2) * inv;
    const B2 = ((x1 - x0) * (yc - y0) + (y1 - y0) * x0) * inv;
    let xl = minX - 1, xr = maxX + 1;
    if (A0 > 0) xl = Math.max(xl, -B0 / A0); else if (A0 < 0) xr = Math.min(xr, -B0 / A0); else if (B0 < 0) continue;
    if (A1 > 0) xl = Math.max(xl, -B1 / A1); else if (A1 < 0) xr = Math.min(xr, -B1 / A1); else if (B1 < 0) continue;
    if (A2 > 0) xl = Math.max(xl, -B2 / A2); else if (A2 < 0) xr = Math.min(xr, -B2 / A2); else if (B2 < 0) continue;
    let xS = Math.max(0, Math.ceil(xl - 0.5 - 1e-9)), xE = Math.min(W - 1, Math.floor(xr - 0.5 + 1e-9));
    const row = py * W;
    for (let px = xS; px <= xE; px++) {
      const xc = px + 0.5;
      let w0 = A0 * xc + B0, w1 = A1 * xc + B1, w2 = A2 * xc + B2;
      const izp = w0 * iza + w1 * izb + w2 * izc;
      if (izp <= 0) continue;
      const z = 1 / izp;
      const idx = row + px;
      if (z >= ZB[idx]) continue;
      const b0 = w0 * iza * z, b1 = w1 * izb * z, b2 = w2 * izc * z;
      Fr.x = px; Fr.y = py; Fr.z = z;
      Fr.px = AT[oa] * b0 + AT[ob] * b1 + AT[oc] * b2;
      Fr.py = AT[oa + 1] * b0 + AT[ob + 1] * b1 + AT[oc + 1] * b2;
      Fr.pz = AT[oa + 2] * b0 + AT[ob + 2] * b1 + AT[oc + 2] * b2;
      Fr.nx = AT[oa + 3] * b0 + AT[ob + 3] * b1 + AT[oc + 3] * b2;
      Fr.ny = AT[oa + 4] * b0 + AT[ob + 4] * b1 + AT[oc + 4] * b2;
      Fr.nz = AT[oa + 5] * b0 + AT[ob + 5] * b1 + AT[oc + 5] * b2;
      Fr.u = AT[oa + 6] * b0 + AT[ob + 6] * b1 + AT[oc + 6] * b2;
      Fr.v = AT[oa + 7] * b0 + AT[ob + 7] * b1 + AT[oc + 7] * b2;
      Fr.ex = AT[oa + 8] * b0 + AT[ob + 8] * b1 + AT[oc + 8] * b2;
      Fr.tx = AT[oa + 9] * b0 + AT[ob + 9] * b1 + AT[oc + 9] * b2;
      Fr.ty = AT[oa + 10] * b0 + AT[ob + 10] * b1 + AT[oc + 10] * b2;
      Fr.tz = AT[oa + 11] * b0 + AT[ob + 11] * b1 + AT[oc + 11] * b2;
      Fr.discard = false;
      Fr.tag = 0;
      mat.shade(Fr);
      if (Fr.discard) continue;
      ZB[idx] = z;
      RGB[idx * 3] = Fr.r; RGB[idx * 3 + 1] = Fr.g; RGB[idx * 3 + 2] = Fr.b;
      TAG[idx] = Fr.tag;
      if (T.g) writeG(T, idx, Fr);
    }
  }
}

// ---------------- depth-only orthographic rasteriser (shadow maps) ----------------
export class ShadowMap {
  // dir: unit vector TOWARD the light. centre + half extent define the ortho box.
  constructor(dir, centre, halfW, halfH, res) {
    this.dir = dir;
    const up0 = Math.abs(dir[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
    // light looks along -dir
    const fz = [-dir[0], -dir[1], -dir[2]];
    let rx = [up0[1] * fz[2] - up0[2] * fz[1], up0[2] * fz[0] - up0[0] * fz[2], up0[0] * fz[1] - up0[1] * fz[0]];
    let l = Math.hypot(...rx); rx = rx.map((v) => v / l);
    const uy = [fz[1] * rx[2] - fz[2] * rx[1], fz[2] * rx[0] - fz[0] * rx[2], fz[0] * rx[1] - fz[1] * rx[0]];
    this.rx = rx; this.uy = uy; this.fz = fz;
    this.c = centre; this.hw = halfW; this.hh = halfH; this.res = res;
    this.resY = Math.round(res * halfH / halfW);
    this.d = new Float32Array(res * this.resY).fill(Infinity);
    this.sx = res / (2 * halfW); this.sy = this.resY / (2 * halfH);
  }
  toLight(x, y, z, out) {
    const dx = x - this.c[0], dy = y - this.c[1], dz = z - this.c[2];
    out[0] = (dx * this.rx[0] + dy * this.rx[1] + dz * this.rx[2]) * this.sx + this.res / 2;
    out[1] = -(dx * this.uy[0] + dy * this.uy[1] + dz * this.uy[2]) * this.sy + this.resY / 2;
    out[2] = dx * this.fz[0] + dy * this.fz[1] + dz * this.fz[2];
  }
  drawMesh(mesh) {
    const n = mesh.nv, P = mesh.pos;
    const LX = new Float64Array(n), LY = new Float64Array(n), LZ = new Float64Array(n);
    const o = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      this.toLight(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], o);
      LX[i] = o[0]; LY[i] = o[1]; LZ[i] = o[2];
    }
    const I = mesh.idx, W = this.res, H = this.resY, D = this.d;
    for (let t = 0; t < mesh.nt; t++) {
      const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2];
      const x0 = LX[a], y0 = LY[a], x1 = LX[b], y1 = LY[b], x2 = LX[c], y2 = LY[c];
      const area = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
      if (!(Math.abs(area) > 1e-12)) continue;
      const minX = Math.min(x0, x1, x2), maxX = Math.max(x0, x1, x2);
      const minY = Math.min(y0, y1, y2), maxY = Math.max(y0, y1, y2);
      if (maxX < 0 || minX > W || maxY < 0 || minY > H) continue;
      const inv = 1 / area;
      const A0 = -(y2 - y1) * inv, A1 = -(y0 - y2) * inv, A2 = -(y1 - y0) * inv;
      const za = LZ[a], zb = LZ[b], zc = LZ[c];
      const yS = Math.max(0, Math.ceil(minY - 0.5)), yE = Math.min(H - 1, Math.floor(maxY - 0.5));
      for (let py = yS; py <= yE; py++) {
        const yc = py + 0.5;
        const B0 = ((x2 - x1) * (yc - y1) + (y2 - y1) * x1) * inv;
        const B1 = ((x0 - x2) * (yc - y2) + (y0 - y2) * x2) * inv;
        const B2 = ((x1 - x0) * (yc - y0) + (y1 - y0) * x0) * inv;
        let xl = minX - 1, xr = maxX + 1;
        if (A0 > 0) xl = Math.max(xl, -B0 / A0); else if (A0 < 0) xr = Math.min(xr, -B0 / A0); else if (B0 < 0) continue;
        if (A1 > 0) xl = Math.max(xl, -B1 / A1); else if (A1 < 0) xr = Math.min(xr, -B1 / A1); else if (B1 < 0) continue;
        if (A2 > 0) xl = Math.max(xl, -B2 / A2); else if (A2 < 0) xr = Math.min(xr, -B2 / A2); else if (B2 < 0) continue;
        const xS = Math.max(0, Math.ceil(xl - 0.5 - 1e-9)), xE = Math.min(W - 1, Math.floor(xr - 0.5 + 1e-9));
        const row = py * W;
        for (let px = xS; px <= xE; px++) {
          const xc = px + 0.5;
          const z = (A0 * xc + B0) * za + (A1 * xc + B1) * zb + (A2 * xc + B2) * zc;
          if (z < D[row + px]) D[row + px] = z;
        }
      }
    }
  }
  inside(x, y, z, margin = 4) {
    const o = SMO;
    this.toLight(x, y, z, o);
    return o[0] > margin && o[1] > margin && o[0] < this.res - margin && o[1] < this.resY - margin;
  }
  // Soft visibility in [0,1] using a PCF disc; radius in texels.
  vis(x, y, z, bias = 0.02, radius = 1.5) {
    const o = SMO;
    this.toLight(x, y, z, o);
    const W = this.res, H = this.resY, D = this.d;
    const lx = o[0] - 0.5, ly = o[1] - 0.5, lz = o[2] - bias;
    if (lx < 1 || ly < 1 || lx >= W - 2 || ly >= H - 2) return 1;
    let lit = 0, tot = 0;
    for (let k = 0; k < PCF.length; k += 2) {
      const sx = lx + PCF[k] * radius, sy = ly + PCF[k + 1] * radius;
      let xi = Math.floor(sx), yi = Math.floor(sy);
      if (xi < 0 || yi < 0 || xi >= W - 1 || yi >= H - 1) { lit += 1; tot += 1; continue; }
      const fx = sx - xi, fy = sy - yi;
      const i = yi * W + xi;
      const s00 = D[i] > lz ? 1 : 0, s10 = D[i + 1] > lz ? 1 : 0;
      const s01 = D[i + W] > lz ? 1 : 0, s11 = D[i + W + 1] > lz ? 1 : 0;
      lit += (s00 * (1 - fx) + s10 * fx) * (1 - fy) + (s01 * (1 - fx) + s11 * fx) * fy;
      tot += 1;
    }
    return lit / tot;
  }
}
const SMO = [0, 0, 0];
const PCF = [];
{
  // 12-tap poisson-ish disc
  const pts = [[0, 0], [0.53, 0.2], [-0.42, 0.44], [-0.1, -0.62], [0.72, -0.5], [-0.8, -0.2], [0.25, 0.9], [-0.55, -0.85], [0.95, 0.35], [-0.95, 0.6], [0.4, -0.95], [0.05, 0.4]];
  for (const p of pts) PCF.push(p[0], p[1]);
}
