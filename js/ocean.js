import * as THREE from 'three';
import { U, SKY_GLSL } from './env.js';

// 海岸几何（JS 与 GLSL 必须一致）：路面东侧 x=ROAD_EDGE，沙滩向海倾斜
export const ROAD_EDGE = 4.9;
export const SEA_LEVEL = -0.6;
export function beachHeight(x) {
  const d = Math.max(x - ROAD_EDGE, 0);
  return 0.05 - d * 0.075 - d * d * 0.0011;
}
const BEACH_GLSL = /* glsl */`
float beachH(float x){ float d = max(x - ${ROAD_EDGE.toFixed(2)}, 0.0); return 0.05 - d * 0.075 - d * d * 0.0011; }`;

/** 非均匀网格：靠近岸线与骑手处更密 */
function oceanGeometry(nx, nz) {
  const x0 = 6, x1 = 900, z0 = -900, z1 = 280;
  const xs = [], zs = [];
  for (let i = 0; i <= nx; i++) { const t = i / nx; xs.push(x0 + (x1 - x0) * Math.pow(t, 2.6)); }
  // z 方向以 0 为中心对称加密
  for (let j = 0; j <= nz; j++) {
    const t = j / nz * 2 - 1; // -1..1
    const s = Math.sign(t) * Math.pow(Math.abs(t), 2.2);
    zs.push(s < 0 ? -s * z0 : s * z1);
  }
  const pos = new Float32Array((nx + 1) * (nz + 1) * 3);
  let k = 0;
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) { pos[k++] = xs[i]; pos[k++] = 0; pos[k++] = zs[j]; }
  const idx = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

export function createOcean(detail = 1) {
  const geo = oceanGeometry(Math.round(170 * detail), Math.round(240 * detail));
  const mat = new THREE.ShaderMaterial({
    uniforms: U,
    transparent: true,
    depthWrite: true,
    vertexShader: /* glsl */`
      uniform float uTime;
      varying vec3 vWorld; varying vec3 vNormal2; varying float vFoam; varying float vDepth;
      ${BEACH_GLSL}
      // Gerstner 波：返回位移，累加偏导
      vec3 gerstner(vec2 p, vec2 dir, float L, float A, float Q, float spd, inout vec3 dX, inout vec3 dZ){
        float k = 6.2831853 / L;
        float ph = k * dot(dir, p) - spd * k * uTime;
        float c = cos(ph), s = sin(ph);
        dX += vec3(-Q * dir.x * dir.x * k * A * s, dir.x * k * A * c, -Q * dir.x * dir.y * k * A * s);
        dZ += vec3(-Q * dir.x * dir.y * k * A * s, dir.y * k * A * c, -Q * dir.y * dir.y * k * A * s);
        return vec3(Q * A * dir.x * c, A * s, Q * A * dir.y * c);
      }
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vec2 p = wp.xz;
        float depth = ${SEA_LEVEL.toFixed(2)} - beachH(p.x); // 静水面到沙底的深度
        float shoal = smoothstep(0.0, 4.0, depth);
        vec3 dX = vec3(1.0, 0.0, 0.0), dZ = vec3(0.0, 0.0, 1.0);
        vec3 d = vec3(0.0);
        // 涌浪朝岸（-x）推进
        d += gerstner(p, normalize(vec2(-1.0, 0.18)), 26.0, 0.55, 0.55, 1.0, dX, dZ);
        d += gerstner(p, normalize(vec2(-1.0, -0.32)), 13.0, 0.28, 0.6, 1.0, dX, dZ);
        d += gerstner(p, normalize(vec2(-0.7, 0.7)), 7.0, 0.12, 0.5, 1.0, dX, dZ);
        d += gerstner(p, normalize(vec2(-0.4, -0.9)), 4.1, 0.06, 0.45, 1.0, dX, dZ);
        d += gerstner(p, normalize(vec2(0.9, 0.4)), 2.3, 0.025, 0.4, 1.0, dX, dZ);
        // 浅水区：振幅衰减，但近岸碎浪带变陡
        float sw = mix(0.25, 1.0, shoal);
        d *= sw;
        // 拍岸浪：沿 x 向岸推进的一条条浪线
        float bx = p.x * 0.45 + uTime * 1.3 + sin(p.y * 0.07) * 1.5;
        float breaker = pow(0.5 + 0.5 * sin(bx), 6.0) * (1.0 - shoal) * smoothstep(0.02, 0.6, depth);
        d.y += breaker * 0.35;
        // 冲刷：水面整体在岸边涨落
        float swash = sin(uTime * 0.8 + p.y * 0.05) * 0.5 + 0.5;
        d.y += (1.0 - smoothstep(0.0, 1.5, depth)) * swash * 0.22;
        wp.xyz += d;
        vec3 n = normalize(cross(dZ, dX));
        n = normalize(mix(vec3(0.0, 1.0, 0.0), n, sw));
        vNormal2 = n;
        vWorld = wp.xyz;
        vDepth = depth;
        vFoam = breaker + smoothstep(0.35, 0.75, d.y) * 0.6;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform vec3 uAmbient; uniform vec3 uFogColor; uniform float uFogDensity;
      varying vec3 vWorld; varying vec3 vNormal2; varying float vFoam; varying float vDepth;
      ${SKY_GLSL}
      ${BEACH_GLSL}
      float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
      float fbm2(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ v += a * vn(p); p *= 2.07; a *= 0.5; } return v; }
      void main(){
        vec3 V = normalize(cameraPosition - vWorld);
        float dist = length(cameraPosition - vWorld);
        // 细节法线：两层滚动噪声
        vec2 q = vWorld.xz;
        float e = 0.15;
        float h0 = fbm2(q * 0.6 + vec2(uTime * 0.3, uTime * 0.1)) + fbm2(q * 1.7 - vec2(uTime * 0.2, -uTime * 0.25)) * 0.5;
        float hx = fbm2((q + vec2(e, 0)) * 0.6 + vec2(uTime * 0.3, uTime * 0.1)) + fbm2((q + vec2(e, 0)) * 1.7 - vec2(uTime * 0.2, -uTime * 0.25)) * 0.5;
        float hz = fbm2((q + vec2(0, e)) * 0.6 + vec2(uTime * 0.3, uTime * 0.1)) + fbm2((q + vec2(0, e)) * 1.7 - vec2(uTime * 0.2, -uTime * 0.25)) * 0.5;
        float detail = 0.35 * (1.0 - smoothstep(30.0, 220.0, dist));
        vec3 N = normalize(vNormal2 + vec3(h0 - hx, 0.0, h0 - hz) / e * detail);

        float depth = vWorld.y - beachH(vWorld.x);
        float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
        vec3 R = reflect(-V, N); R.y = abs(R.y);
        vec3 refl = skyColor(normalize(R));
        float lightK = max(uSunDir.y + 0.15, 0.0) * (1.0 - uNight) + uNight * 0.18;
        vec3 deep = vec3(0.004, 0.035, 0.07);
        vec3 shallow = vec3(0.02, 0.22, 0.24);
        vec3 water = mix(shallow, deep, smoothstep(0.2, 6.0, depth)) * (uAmbient * 0.9 + uSunColor * lightK * 0.6);
        // 次表面散射：浪峰背光透亮
        float sss = pow(max(dot(V, -uSunDir), 0.0), 4.0) * smoothstep(-0.1, 0.4, vWorld.y + 0.6) * (1.0 - uNight);
        water += vec3(0.05, 0.3, 0.25) * sss * uSunColor;
        vec3 col = mix(water, refl, fres);
        // 太阳/月亮高光
        vec3 Hs = normalize(uSunDir + V);
        col += uSunColor * pow(max(dot(N, Hs), 0.0), 380.0) * 6.0 * smoothstep(-0.05, 0.05, uSunDir.y);
        vec3 Hm = normalize(uMoonDir + V);
        col += vec3(0.7, 0.8, 1.0) * pow(max(dot(N, Hm), 0.0), 220.0) * 2.5 * uNight * smoothstep(-0.05, 0.1, uMoonDir.y);

        // 泡沫：浪峰泡沫 + 岸边冲刷白边
        float fn = fbm2(vWorld.xz * vec2(0.9, 0.5) + vec2(uTime * 0.4, 0.0));
        float edge = 1.0 - smoothstep(0.0, 0.35 + fn * 0.25, depth);
        float lace = smoothstep(0.45, 0.75, fn) * (1.0 - smoothstep(0.2, 2.5, depth));
        float foam = clamp(vFoam * smoothstep(0.35, 0.7, fn + vFoam * 0.4) + edge * 0.9 + lace * 0.6, 0.0, 1.0);
        vec3 foamCol = uAmbient * 0.9 + uSunColor * max(uSunDir.y, 0.0) * 1.2 + vec3(0.05);
        col = mix(col, foamCol, foam * 0.92);

        float alpha = clamp(smoothstep(-0.02, 0.4, depth) * 0.85 + foam * 0.5 + fres * 0.3, 0.0, 1.0);
        float f = 1.0 - exp(-pow(uFogDensity * dist, 2.0));
        col = mix(col, uFogColor, f);
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.position.y = SEA_LEVEL;
  return mesh;
}
