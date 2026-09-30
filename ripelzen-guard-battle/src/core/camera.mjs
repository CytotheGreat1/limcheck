// Pinhole camera with vertical lens shift (keeps verticals vertical, like a painter's perspective).
import { norm, cross, rotAxis } from './math.mjs';

export class Camera {
  constructor({ pos, yaw = 0, pitch = 0, fovX = 55, W, H, horizon = 0.47 }) {
    this.pos = pos;
    this.W = W; this.H = H;
    this.f = (W / 2) / Math.tan((fovX * Math.PI) / 360);
    this.cx = W / 2;
    this.cy = horizon * H;
    let fwd = [Math.sin(yaw), 0, Math.cos(yaw)];
    let right = [fwd[2], 0, -fwd[0]];
    fwd = rotAxis(fwd, right, -pitch);
    const up = cross(fwd, right);
    this.fwd = norm(fwd); this.right = norm(right); this.up = norm(up);
    this.near = 0.05;
  }
  // world -> view (x right, y up, z depth)
  view(p) {
    const dx = p[0] - this.pos[0], dy = p[1] - this.pos[1], dz = p[2] - this.pos[2];
    const r = this.right, u = this.up, f = this.fwd;
    return [dx * r[0] + dy * r[1] + dz * r[2], dx * u[0] + dy * u[1] + dz * u[2], dx * f[0] + dy * f[1] + dz * f[2]];
  }
  project(p) {
    const v = this.view(p);
    return [this.cx + (this.f * v[0]) / v[2], this.cy - (this.f * v[1]) / v[2], v[2]];
  }
  // pixel -> world ray direction
  ray(sx, sy) {
    const x = (sx - this.cx) / this.f, y = -(sy - this.cy) / this.f;
    const r = this.right, u = this.up, f = this.fwd;
    return norm([r[0] * x + u[0] * y + f[0], r[1] * x + u[1] * y + f[1], r[2] * x + u[2] * y + f[2]]);
  }
  // pixels per metre at view depth z
  scaleAt(z) { return this.f / z; }
}
