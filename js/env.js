import * as THREE from 'three';
import { clamp, lerp, smooth } from './util.js';

// 昼夜循环：从黄昏开始 → 日落 → 星空月夜 → 黎明 → 白天 → 黄昏
export const CYCLE_SECONDS = 1200; // 一整天 20 分钟：黄昏→星夜约 80 秒
const START_PHASE = 0.467; // 太阳仰角约 +12°（phase 0.5 = 日落）

// 按太阳仰角（度）插值的调色板（sRGB hex）
const KEYS = [
  { e: -90, zen: 0x02040b, hor: 0x0a1226, sun: 0x9fb4ff, amb: 0x5a6aa0, gnd: 0x1c2234 },
  { e: -14, zen: 0x040816, hor: 0x111c3a, sun: 0x9fb4ff, amb: 0x5c6ea6, gnd: 0x1e2436 },
  { e: -6,  zen: 0x0d1638, hor: 0x5a3c66, sun: 0xff7a50, amb: 0x7a70a8, gnd: 0x2a2232 },
  { e: 0,   zen: 0x22305e, hor: 0xff6a3c, sun: 0xff5a2a, amb: 0x8a6e8e, gnd: 0x3a2a22 },
  { e: 6,   zen: 0x3a5a96, hor: 0xffa060, sun: 0xff9a55, amb: 0x8a7a90, gnd: 0x3a2a1c },
  { e: 16,  zen: 0x4f86c6, hor: 0xf3d2a0, sun: 0xffd9a8, amb: 0xa8b8d0, gnd: 0x4a3a2a },
  { e: 40,  zen: 0x3d7fd0, hor: 0xbcd8f2, sun: 0xfff4e6, amb: 0xbfd4ee, gnd: 0x5a4a38 },
  { e: 90,  zen: 0x2f6fc8, hor: 0xb4d2f0, sun: 0xffffff, amb: 0xc4d8f0, gnd: 0x5a4a38 },
];
const KEY_COLORS = KEYS.map(k => ({
  e: k.e,
  zen: new THREE.Color(k.zen), hor: new THREE.Color(k.hor), sun: new THREE.Color(k.sun),
  amb: new THREE.Color(k.amb), gnd: new THREE.Color(k.gnd),
}));

function sampleKeys(e, field, out) {
  for (let i = 0; i < KEY_COLORS.length - 1; i++) {
    const a = KEY_COLORS[i], b = KEY_COLORS[i + 1];
    if (e <= b.e) { const t = clamp((e - a.e) / (b.e - a.e), 0, 1); return out.copy(a[field]).lerp(b[field], t); }
  }
  return out.copy(KEY_COLORS[KEY_COLORS.length - 1][field]);
}

/** 所有共享着色器 uniform（天空 / 海面共用一份） */
export const U = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3() },
  uMoonDir: { value: new THREE.Vector3() },
  uZenith: { value: new THREE.Color() },
  uHorizon: { value: new THREE.Color() },
  uSunColor: { value: new THREE.Color() },
  uAmbient: { value: new THREE.Color() },
  uNight: { value: 0 },
  uFogColor: { value: new THREE.Color() },
  uFogDensity: { value: 0.006 },
  uBikeZ: { value: 0 },
};

export const SKY_GLSL = /* glsl */`
uniform vec3 uSunDir; uniform vec3 uMoonDir; uniform vec3 uZenith; uniform vec3 uHorizon;
uniform vec3 uSunColor; uniform float uNight;
vec3 skyColor(vec3 d){
  float h = d.y;
  float t = pow(clamp(h, 0.0, 1.0), 0.45);
  vec3 c = mix(uHorizon, uZenith, t);
  c = mix(c, uHorizon * 0.35, smoothstep(0.0, -0.25, h));      // 地平线以下
  float sd = max(dot(d, uSunDir), 0.0);
  float low = 1.0 - smoothstep(-0.1, 0.45, uSunDir.y);
  c += uSunColor * (pow(sd, 5.0) * 0.55 * low + pow(sd, 64.0) * 0.6);  // 日晕
  float md = max(dot(d, uMoonDir), 0.0);
  c += vec3(0.55, 0.65, 0.9) * pow(md, 24.0) * 0.18 * uNight;       // 月晕
  return c;
}`;

export class DayNight {
  constructor() {
    this.phase = START_PHASE;
    this.speed = 1;
    this.sunDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3();
    this.keyDir = new THREE.Vector3();
    this.keyColor = new THREE.Color();
    this.keyIntensity = 1;
    this.hemiSky = new THREE.Color();
    this.hemiGround = new THREE.Color();
    this.hemiIntensity = 1;
    this.exposure = 1;
    this.night = 0;
    this.sunElev = 0;
    this._c = new THREE.Color();
    this.update(0);
  }

  /** 24 小时制显示：phase 0.5 = 18:00 日落 */
  get clock() {
    const h = ((this.phase * 24 + 6) % 24 + 24) % 24;
    const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }

  update(dt) {
    this.phase = (this.phase + dt * this.speed / CYCLE_SECONDS) % 1;
    const a = this.phase * Math.PI * 2;
    // 太阳从陆地一侧(-x)升起，在海面一侧(+x)、略偏前方(-z)落下：追尾镜头能看到日落
    this.sunDir.set(-Math.cos(a) * 0.82, Math.sin(a), -0.55).normalize();
    this.moonDir.set(Math.cos(a) * 0.7, -Math.sin(a) * 0.85, -0.9).normalize();
    const e = Math.asin(this.sunDir.y) * 180 / Math.PI;
    this.sunElev = e;
    this.night = 1 - smooth(-12, -2, e);
    const day = smooth(-3, 8, e);

    sampleKeys(e, 'zen', U.uZenith.value);
    sampleKeys(e, 'hor', U.uHorizon.value);
    sampleKeys(e, 'sun', U.uSunColor.value);
    sampleKeys(e, 'amb', this.hemiSky);
    sampleKeys(e, 'gnd', this.hemiGround);
    U.uAmbient.value.copy(this.hemiSky).multiplyScalar(lerp(0.35, 1.0, day));
    U.uSunDir.value.copy(this.sunDir);
    U.uMoonDir.value.copy(this.moonDir);
    U.uNight.value = this.night;
    U.uFogColor.value.copy(U.uHorizon.value).lerp(U.uZenith.value, 0.15);
    U.uFogDensity.value = lerp(0.0055, 0.0075, this.night);

    // 主光：太阳在地平线上时用太阳，否则切换为月光（强度在交接处都接近 0，所以过渡无跳变）
    // 太阳与月光按强度交叉淡入淡出，方向在交接时插值，避免日落时刻的"全黑"空档
    const sunI = smooth(-4, 10, e) * 3.2;
    const moonI = smooth(-8, -1, -e) * 0.7;
    const w = sunI / Math.max(sunI + moonI, 1e-4);
    this.keyDir.copy(this.moonDir).lerp(this.sunDir, w).normalize();
    this.keyColor.setRGB(0.55, 0.65, 1.0).lerp(U.uSunColor.value, w);
    this.keyIntensity = Math.max(sunI, moonI, 0.25);
    this.hemiIntensity = lerp(0.85, 1.3, day);
    this.exposure = lerp(1.0, 1.8, smooth(3, -9, e)); // 日落后人眼适应：提前提高曝光
  }
}

export function createSky() {
  const geo = new THREE.SphereGeometry(900, 48, 24);
  const mat = new THREE.ShaderMaterial({
    uniforms: U,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main(){
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime;
      varying vec3 vDir;
      ${SKY_GLSL}
      float h31(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
      float stars(vec3 d){
        vec3 p = d * 220.0; vec3 i = floor(p); vec3 f = fract(p) - 0.5;
        float r = h31(i);
        if (r < 0.965) return 0.0;
        vec3 o = vec3(h31(i + 1.3), h31(i + 2.7), h31(i + 5.1)) - 0.5;
        float dd = length(f - o * 0.6);
        float tw = 0.6 + 0.4 * sin(uTime * (1.5 + r * 6.0) + r * 80.0);
        return smoothstep(0.12, 0.0, dd) * tw * (r - 0.965) * 28.0;
      }
      void main(){
        vec3 d = normalize(vDir);
        vec3 c = skyColor(d);
        // 星空 + 银河带
        float above = smoothstep(-0.02, 0.15, d.y);
        float s = stars(d) * uNight * above;
        vec3 mw = normalize(vec3(0.35, 0.8, -0.5));
        float band = exp(-pow(dot(d, mw) * 4.0, 2.0));
        float n = h31(floor(d * 90.0)) * 0.5 + h31(floor(d * 30.0)) * 0.5;
        c += vec3(0.45, 0.5, 0.75) * band * n * 0.12 * uNight * above;
        c += vec3(1.0, 0.95, 0.9) * s;
        // 太阳圆盘
        float sd = dot(d, uSunDir);
        c += uSunColor * smoothstep(0.9993, 0.9997, sd) * 18.0 * (1.0 - uNight);
        // 月亮：带明暗与月海纹理
        float md = dot(d, uMoonDir);
        if (md > 0.997) {
          vec3 up = vec3(0.0, 1.0, 0.0);
          vec3 tx = normalize(cross(up, uMoonDir)); vec3 ty = cross(uMoonDir, tx);
          vec2 q = vec2(dot(d, tx), dot(d, ty)) / 0.0245;
          float r = length(q);
          if (r < 1.0) {
            vec3 nrm = vec3(q, sqrt(1.0 - r * r));
            float lit = clamp(dot(nrm, normalize(vec3(-0.55, 0.25, 0.8))), 0.0, 1.0);
            float maria = h31(floor(vec3(q * 5.0, 1.0))) * 0.25 + h31(floor(vec3(q * 11.0, 2.0))) * 0.15;
            vec3 mc = vec3(1.0, 0.97, 0.88) * (0.12 + lit * (1.0 - maria)) * 2.6;
            c = mix(c, mc, smoothstep(1.0, 0.94, r) * max(uNight, 0.25));
          }
        }
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}
