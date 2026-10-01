import * as THREE from 'three';
import { vnoise } from './util.js';

/**
 * 围巾尾巴：Verlet 布料（结构 + 剪切 + 弯曲约束）
 * 顶行粒子钉在世界空间锚点上，受重力、相对气流阻力、湍流与身体球体碰撞影响。
 */
export class ClothRibbon {
  constructor(material, { cols = 4, rows = 16, width = 0.13, length = 0.85, seed = 0 } = {}) {
    this.cols = cols; this.rows = rows; this.seed = seed;
    this.rest = length / (rows - 1);
    this.restW = width / (cols - 1);
    const n = cols * rows;
    this.p = new Float32Array(n * 3);
    this.prev = new Float32Array(n * 3);
    this.inited = false;
    // 约束 [i, j, restLen, stiffness]
    this.cons = [];
    const id = (c, r) => r * cols + c;
    const diag = Math.hypot(this.rest, this.restW);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (c < cols - 1) this.cons.push([id(c, r), id(c + 1, r), this.restW, 1]);
      if (r < rows - 1) this.cons.push([id(c, r), id(c, r + 1), this.rest, 1]);
      if (c < cols - 1 && r < rows - 1) {
        this.cons.push([id(c, r), id(c + 1, r + 1), diag, 0.6]);
        this.cons.push([id(c + 1, r), id(c, r + 1), diag, 0.6]);
      }
      if (r < rows - 2) this.cons.push([id(c, r), id(c, r + 2), this.rest * 2, 0.25]);
    }
    // 网格
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    const uv = new Float32Array(n * 2);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { uv[id(c, r) * 2] = c / (cols - 1); uv[id(c, r) * 2 + 1] = r / (rows - 1); }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const idx = [];
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
      const a = id(c, r), b = id(c + 1, r), d = id(c, r + 1), e = id(c + 1, r + 1);
      idx.push(a, d, b, b, d, e);
    }
    geo.setIndex(idx);
    this.geo = geo;
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.acc = 0;
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3();
  }

  reset(a, b) {
    const { cols, rows, p, prev } = this;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const t = c / (cols - 1), k = (r * cols + c) * 3;
      p[k] = a.x + (b.x - a.x) * t; p[k + 1] = a.y + (b.y - a.y) * t - r * this.rest; p[k + 2] = a.z + (b.z - a.z) * t;
    }
    prev.set(p);
    this.inited = true;
  }

  /**
   * @param a,b 世界空间锚点  @param vel 骑手速度（世界）  @param colliders [{c:Vector3, r}]
   */
  update(dt, a, b, vel, colliders, time) {
    if (!this.inited) this.reset(a, b);
    // 固定步长子步进，避免卡顿时爆炸
    this.acc = Math.min(this.acc + dt, 1 / 15);
    const h = 1 / 120;
    while (this.acc >= h) { this.step(h, a, b, vel, colliders, time); this.acc -= h; }
    this.writeMesh();
  }

  step(h, a, b, vel, colliders, time) {
    const { cols, rows, p, prev } = this;
    const n = cols * rows;
    const drag = 3.2, damping = 0.985;
    for (let i = 0; i < n; i++) {
      const k = i * 3, r = Math.floor(i / cols);
      if (r === 0) continue;
      const x = p[k], y = p[k + 1], z = p[k + 2];
      const vx = (x - prev[k]) / h, vy = (y - prev[k + 1]) / h, vz = (z - prev[k + 2]) / h;
      // 湍流风：低频噪声 + 沿布料传播的拍打
      const tt = time * 3 + this.seed * 10;
      const turb = (vnoise(tt + r * 0.35, this.seed) - 0.5) * 2;
      const turb2 = (vnoise(tt * 1.3, r * 0.3 + this.seed + 5) - 0.5) * 2;
      const speed = Math.hypot(vel.x, vel.z);
      const wx = turb * (1.5 + speed * 0.35) + Math.sin(time * 9 - r * 0.7 + this.seed) * speed * 0.15;
      const wy = turb2 * (1 + speed * 0.25);
      // 空气静止 + 湍流；粒子随骑手前进(-z)，相对气流把布料向后吹
      const rx = vx - wx, ry = vy - wy, rz = vz;
      const ax = -rx * drag, ay = -9.8 - ry * drag * 0.6, az = -rz * drag;
      prev[k] = x; prev[k + 1] = y; prev[k + 2] = z;
      p[k] = x + vx * h * damping + ax * h * h;
      p[k + 1] = y + vy * h * damping + ay * h * h;
      p[k + 2] = z + vz * h * damping + az * h * h;
    }
    // 钉住顶行
    for (let c = 0; c < cols; c++) {
      const t = c / (cols - 1), k = c * 3;
      prev[k] = p[k]; prev[k + 1] = p[k + 1]; prev[k + 2] = p[k + 2];
      p[k] = a.x + (b.x - a.x) * t; p[k + 1] = a.y + (b.y - a.y) * t; p[k + 2] = a.z + (b.z - a.z) * t;
    }
    // 约束迭代
    for (let it = 0; it < 4; it++) {
      for (const [i, j, rest, s] of this.cons) {
        const ki = i * 3, kj = j * 3;
        const dx = p[kj] - p[ki], dy = p[kj + 1] - p[ki + 1], dz = p[kj + 2] - p[ki + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        const diff = (d - rest) / d * 0.5 * s;
        const wi = i < cols ? 0 : 1, wj = j < cols ? 0 : 1;
        const sum = wi + wj; if (!sum) continue;
        const fi = diff * 2 * wi / sum, fj = diff * 2 * wj / sum;
        p[ki] += dx * fi; p[ki + 1] += dy * fi; p[ki + 2] += dz * fi;
        p[kj] -= dx * fj; p[kj + 1] -= dy * fj; p[kj + 2] -= dz * fj;
      }
      // 碰撞：身体球体
      for (const col of colliders) {
        const cx = col.c.x, cy = col.c.y, cz = col.c.z, rr = col.r;
        for (let i = cols; i < n; i++) {
          const k = i * 3;
          const dx = p[k] - cx, dy = p[k + 1] - cy, dz = p[k + 2] - cz;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < rr * rr) { const d = Math.sqrt(d2) || 1e-6, f = rr / d; p[k] = cx + dx * f; p[k + 1] = cy + dy * f; p[k + 2] = cz + dz * f; }
        }
      }
    }
  }

  writeMesh() {
    this.posAttr.array.set(this.p);
    this.posAttr.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.geo.computeBoundingSphere();
  }
}
