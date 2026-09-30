// Mesh container + parametric surface builders.
// A mesh holds world-space positions, normals, uv and one extra scalar per vertex.

export class Mesh {
  constructor(nv, nt) {
    this.pos = new Float32Array(nv * 3);
    this.nrm = new Float32Array(nv * 3);
    this.uv = new Float32Array(nv * 2);
    this.ex = new Float32Array(nv);
    this.tan = new Float32Array(nv * 3);
    this.idx = new Uint32Array(nt * 3);
    this.nv = nv; this.nt = nt;
    this.material = null;
    this.cull = true;
    this.castShadow = true;
    this.key = 0; // depth sort key
  }
  bounds() {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    const p = this.pos;
    for (let i = 0; i < this.nv; i++) {
      const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    return [x0, y0, z0, x1, y1, z1];
  }
  centroid() {
    const b = this.bounds();
    return [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
  }
}

// Build a grid surface. fn(u, v) returns [x,y,z]; u in [0,1] around (wrapU closes it), v in [0,1] along.
// Normals are computed from the tessellated geometry (central differences in parameter space).
// exFn optional per-vertex scalar.
export function gridSurface(nu, nv, fn, { wrapU = false, flip = false, exFn = null, uvScale = [1, 1] } = {}) {
  const cu = wrapU ? nu : nu + 1; // columns of vertices
  const cv = nv + 1;
  const m = new Mesh(cu * cv, nu * nv * 2);
  const P = m.pos;
  for (let j = 0; j < cv; j++) {
    const v = j / nv;
    for (let i = 0; i < cu; i++) {
      const u = i / nu;
      const p = fn(u, v);
      const k = j * cu + i;
      P[k * 3] = p[0]; P[k * 3 + 1] = p[1]; P[k * 3 + 2] = p[2];
      m.uv[k * 2] = u * uvScale[0]; m.uv[k * 2 + 1] = v * uvScale[1];
      if (exFn) m.ex[k] = exFn(u, v);
    }
  }
  // normals from neighbours
  const N = m.nrm;
  for (let j = 0; j < cv; j++) {
    for (let i = 0; i < cu; i++) {
      const k = j * cu + i;
      let iu0, iu1;
      if (wrapU) { iu0 = (i - 1 + cu) % cu; iu1 = (i + 1) % cu; }
      else { iu0 = Math.max(0, i - 1); iu1 = Math.min(cu - 1, i + 1); }
      const jv0 = Math.max(0, j - 1), jv1 = Math.min(cv - 1, j + 1);
      const a = (j * cu + iu1) * 3, b = (j * cu + iu0) * 3;
      const c = (jv1 * cu + i) * 3, d = (jv0 * cu + i) * 3;
      let tux = P[a] - P[b], tuy = P[a + 1] - P[b + 1], tuz = P[a + 2] - P[b + 2];
      let tvx = P[c] - P[d], tvy = P[c + 1] - P[d + 1], tvz = P[c + 2] - P[d + 2];
      // degenerate (poles): fall back to a wider stencil
      let nx = tuy * tvz - tuz * tvy, ny = tuz * tvx - tux * tvz, nz = tux * tvy - tuy * tvx;
      let l = Math.hypot(nx, ny, nz);
      if (l < 1e-12) {
        const jj = j === 0 ? Math.min(cv - 1, 1) : Math.max(0, cv - 2);
        const a2 = (jj * cu + iu1) * 3, b2 = (jj * cu + iu0) * 3;
        tux = P[a2] - P[b2]; tuy = P[a2 + 1] - P[b2 + 1]; tuz = P[a2 + 2] - P[b2 + 2];
        nx = tuy * tvz - tuz * tvy; ny = tuz * tvx - tux * tvz; nz = tux * tvy - tuy * tvx;
        l = Math.hypot(nx, ny, nz) || 1;
      }
      const s = flip ? -1 / l : 1 / l;
      N[k * 3] = nx * s; N[k * 3 + 1] = ny * s; N[k * 3 + 2] = nz * s;
      const tl = Math.hypot(tux, tuy, tuz) || 1;
      m.tan[k * 3] = tux / tl; m.tan[k * 3 + 1] = tuy / tl; m.tan[k * 3 + 2] = tuz / tl;
    }
  }
  const I = m.idx;
  let t = 0;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const i1 = wrapU ? (i + 1) % cu : i + 1;
      const a = j * cu + i, b = j * cu + i1, c = (j + 1) * cu + i, d = (j + 1) * cu + i1;
      if (flip) { I[t++] = a; I[t++] = c; I[t++] = b; I[t++] = b; I[t++] = c; I[t++] = d; }
      else { I[t++] = a; I[t++] = b; I[t++] = c; I[t++] = b; I[t++] = d; I[t++] = c; }
    }
  }
  m.cull = false; // parametric winding varies; rely on z-buffer
  return m;
}

// Merge meshes sharing one material.
export function mergeMeshes(list) {
  let nv = 0, nt = 0;
  for (const m of list) { nv += m.nv; nt += m.nt; }
  const out = new Mesh(nv, nt);
  let ov = 0, ot = 0;
  for (const m of list) {
    out.pos.set(m.pos, ov * 3);
    out.nrm.set(m.nrm, ov * 3);
    out.uv.set(m.uv, ov * 2);
    out.ex.set(m.ex, ov);
    out.tan.set(m.tan, ov * 3);
    for (let i = 0; i < m.nt * 3; i++) out.idx[ot * 3 + i] = m.idx[i] + ov;
    ov += m.nv; ot += m.nt;
  }
  out.cull = list.every((m) => m.cull);
  out.material = list[0]?.material ?? null;
  return out;
}
