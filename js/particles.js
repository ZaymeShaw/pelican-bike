import * as THREE from 'three';

/** 单 draw call 的 CPU 粒子池：水花、鱼鳞闪光、撞击碎屑、落地尘土 */
export class Particles {
  constructor(max = 1500) {
    this.max = max; this.limit = max; this.next = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.base = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 400 } },
      vertexShader: /* glsl */`
        attribute float size; attribute vec3 color; varying vec3 vC; uniform float uScale;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / max(-mv.z, 0.1); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */`
        varying vec3 vC;
        void main(){ vec2 d = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(d));
          gl_FragColor = vec4(vC * a, a); }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.mat = mat;
  }

  emit(n, origin, { spread = 1, up = 2, speed = 2, color = [1, 1, 1], size = 0.12, life = 1, gravity = 9.8, jitter = 0.1, vel } = {}) {
    n = Math.ceil(n * this.limit / this.max);
    for (let i = 0; i < n; i++) {
      const k = this.next; this.next = (this.next + 1) % this.max;
      const a = Math.random() * Math.PI * 2, r = Math.random() * spread;
      this.pos[k * 3] = origin.x + (Math.random() - 0.5) * jitter;
      this.pos[k * 3 + 1] = origin.y + (Math.random() - 0.5) * jitter;
      this.pos[k * 3 + 2] = origin.z + (Math.random() - 0.5) * jitter;
      this.vel[k * 3] = Math.cos(a) * r * speed + (vel ? vel.x : 0);
      this.vel[k * 3 + 1] = up * (0.5 + Math.random()) + (vel ? vel.y : 0);
      this.vel[k * 3 + 2] = Math.sin(a) * r * speed + (vel ? vel.z : 0);
      const cv = 0.85 + Math.random() * 0.3;
      this.col[k * 3] = color[0] * cv; this.col[k * 3 + 1] = color[1] * cv; this.col[k * 3 + 2] = color[2] * cv;
      this.base[k] = size * (0.6 + Math.random() * 0.8);
      this.life[k] = this.maxLife[k] = life * (0.6 + Math.random() * 0.6);
      this.grav[k] = gravity;
    }
  }

  update(dt) {
    for (let k = 0; k < this.max; k++) {
      if (this.life[k] <= 0) { this.size[k] = 0; continue; }
      this.life[k] -= dt;
      this.vel[k * 3 + 1] -= this.grav[k] * dt;
      const drag = 1 - dt * 0.8;
      this.vel[k * 3] *= drag; this.vel[k * 3 + 2] *= drag;
      this.pos[k * 3] += this.vel[k * 3] * dt;
      this.pos[k * 3 + 1] += this.vel[k * 3 + 1] * dt;
      this.pos[k * 3 + 2] += this.vel[k * 3 + 2] * dt;
      const t = Math.max(this.life[k] / this.maxLife[k], 0);
      this.size[k] = this.base[k] * Math.sqrt(t);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
  }
}
