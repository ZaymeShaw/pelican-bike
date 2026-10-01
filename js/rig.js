import * as THREE from 'three';
import { placeBetween, std, clamp, lerp, damp, canvasTexture } from './util.js';

const WHEEL_R = 0.34;
export const RIG = { WHEEL_R, GEAR: 4.2 };

const CYL = new THREE.CylinderGeometry(1, 1, 1, 10);
const SPH = new THREE.SphereGeometry(1, 24, 16);

function tube(mat, r) { const m = new THREE.Mesh(CYL, mat); m.userData.r = r; m.castShadow = true; return m; }
function tubeBetween(parent, mat, r, a, b) {
  const m = tube(mat, r); placeBetween(m, a, b); m.scale.x = m.scale.z = r; parent.add(m); return m;
}
function ball(parent, mat, sx, sy, sz, x, y, z) {
  const m = new THREE.Mesh(SPH, mat); m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m;
}
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

/** 鱼模型（共享） */
export function makeFish(golden = false) {
  const g = new THREE.Group();
  const body = std(golden ? 0xffc23a : 0x8fb4cf, {
    metalness: golden ? 0.9 : 0.55, roughness: golden ? 0.25 : 0.35,
    emissive: golden ? 0xff9a00 : 0x000000, emissiveIntensity: golden ? 0.6 : 0,
  });
  const fin = std(golden ? 0xffa000 : 0x4f7894, { metalness: 0.4, roughness: 0.5, side: THREE.DoubleSide });
  ball(g, body, 0.09, 0.075, 0.22, 0, 0, 0);
  const belly = std(golden ? 0xfff0b0 : 0xe8eef2, { metalness: 0.3, roughness: 0.4 });
  ball(g, belly, 0.07, 0.05, 0.18, 0, -0.025, 0.01);
  const tail = new THREE.Group(); tail.position.z = -0.2; g.add(tail);
  const tg = new THREE.ConeGeometry(0.1, 0.16, 3); tg.rotateX(Math.PI / 2); tg.scale(0.25, 1, 1);
  const t = new THREE.Mesh(tg, fin); t.position.z = -0.06; t.rotation.z = Math.PI / 2; tail.add(t);
  const dg = new THREE.ConeGeometry(0.05, 0.12, 3); dg.scale(0.2, 1, 1);
  const d = new THREE.Mesh(dg, fin); d.position.set(0, 0.08, -0.02); d.rotation.x = -0.5; g.add(d);
  const eye = std(0x111111, { roughness: 0.2 });
  ball(g, eye, 0.018, 0.018, 0.018, 0.06, 0.02, 0.13);
  ball(g, eye, 0.018, 0.018, 0.018, -0.06, 0.02, 0.13);
  g.userData.tail = tail;
  return g;
}

export class Rig {
  constructor() {
    this.root = new THREE.Group();       // 世界位置 + 转向偏航
    this.lean = new THREE.Group();       // 侧倾
    this.pivot = new THREE.Group();      // 翘头（绕后轮着地点）
    this.root.add(this.lean); this.lean.add(this.pivot);
    // 让 +z 局部 = 前进方向，root 自身旋转 π 使其朝向世界 -z
    this.root.rotation.y = Math.PI;
    this.rearZ = -0.52; this.frontZ = 0.52;
    this.pivot.position.z = this.rearZ;
    this.body = new THREE.Group(); this.body.position.z = -this.rearZ; this.pivot.add(this.body);

    this.pouchBulge = 0; this.flapPhase = 0; this.spread = 0; this.headYaw = 0;
    this.buildBike();
    this.buildPelican();
  }

  buildBike() {
    const B = this.body;
    const paint = new THREE.MeshPhysicalMaterial({ color: 0x11a6a0, metalness: 0.5, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08 });
    const chrome = std(0xdfe4ea, { metalness: 1, roughness: 0.18 });
    const dark = std(0x1b1d22, { roughness: 0.85 });
    const leather = std(0x2a1d16, { roughness: 0.55 });
    this.chrome = chrome;
    const rh = v3(0, WHEEL_R, this.rearZ), fh = v3(0, WHEEL_R, this.frontZ);
    const bb = v3(0, 0.3, -0.05), st = v3(0, 0.80, -0.22), ht = v3(0, 0.84, 0.36), htB = v3(0, 0.66, 0.40);
    this.pts = { rh, fh, bb, st, ht };
    tubeBetween(B, paint, 0.022, bb, st);      // 立管
    tubeBetween(B, paint, 0.024, st, ht);      // 上管
    tubeBetween(B, paint, 0.026, bb, htB);     // 下管
    tubeBetween(B, paint, 0.03, htB, ht);      // 头管
    for (const s of [-1, 1]) {
      tubeBetween(B, paint, 0.012, v3(0.04 * s, 0.3, -0.05), v3(0.05 * s, WHEEL_R, this.rearZ));   // 后下叉
      tubeBetween(B, paint, 0.011, v3(0.03 * s, 0.78, -0.22), v3(0.05 * s, WHEEL_R, this.rearZ));  // 后上叉
    }
    // 座管 + 鞍座
    tubeBetween(B, chrome, 0.014, st, v3(0, 0.88, -0.26));
    const seat = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8), leather);
    seat.scale.set(0.09, 0.03, 0.15); seat.position.set(0, 0.9, -0.24); seat.castShadow = true; B.add(seat);

    // 转向组（前叉 + 车把 + 前轮 + 车筐 + 车灯）
    const steer = new THREE.Group(); steer.position.copy(ht); B.add(steer); this.steer = steer;
    const axis = new THREE.Vector3().subVectors(ht, htB).normalize();
    this.steerAxis = axis;
    const local = (p) => p.clone().sub(ht);
    for (const s of [-1, 1]) tubeBetween(steer, chrome, 0.012, local(v3(0.05 * s, 0.66, 0.41)), local(v3(0.05 * s, WHEEL_R, this.frontZ)));
    tubeBetween(steer, chrome, 0.014, local(ht), local(v3(0, 0.98, 0.32)));
    // 复古弯把
    const barPts = [v3(-0.26, 0.98, 0.20), v3(-0.2, 1.0, 0.3), v3(0, 0.98, 0.33), v3(0.2, 1.0, 0.3), v3(0.26, 0.98, 0.20)].map(local);
    const bar = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(barPts), 24, 0.012, 8), chrome);
    bar.castShadow = true; steer.add(bar);
    for (const s of [-1, 1]) {
      const g = tube(dark, 0.018); placeBetween(g, local(v3(0.2 * s, 0.995, 0.24)), local(v3(0.28 * s, 0.975, 0.17))); g.scale.x = g.scale.z = 0.018; steer.add(g);
    }
    this.gripL = local(v3(0.25, 0.985, 0.2)); this.gripR = local(v3(-0.25, 0.985, 0.2));
    // 铃铛
    const bell = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), std(0xffd24a, { metalness: 1, roughness: 0.2 }));
    bell.position.copy(local(v3(0.14, 1.0, 0.31))); steer.add(bell);
    // 车筐（藤编纹理）
    const weave = canvasTexture(128, 128, (c, w, h) => {
      c.fillStyle = '#6b4424'; c.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 16) for (let x = 0; x < w; x += 16) {
        c.fillStyle = ((x + y) / 16) % 2 ? '#c99358' : '#a8743f';
        c.fillRect(x + 1, y + 2, 14, 12);
      }
    }, { repeat: true });
    weave.repeat.set(2, 1);
    const wicker = std(0xffffff, { map: weave, roughness: 0.9, side: THREE.DoubleSide });
    const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.14, 0.18, 14, 1, true), wicker);
    basket.position.copy(local(v3(0, 0.88, 0.58))); basket.castShadow = true; steer.add(basket);
    const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.14, 14), wicker); bottom.rotation.x = -Math.PI / 2; bottom.position.y = -0.09; basket.add(bottom);
    tubeBetween(steer, chrome, 0.008, local(v3(0, 0.8, 0.5)), local(v3(0, 0.66, 0.42)));
    this.basketFish = [];
    for (let i = 0; i < 6; i++) {
      const f = makeFish(i === 5);
      f.scale.setScalar(0.7);
      f.position.set((i % 3 - 1) * 0.07, 0.02 + Math.floor(i / 3) * 0.04, (i % 2 ? 0.03 : -0.03));
      f.rotation.set(-1.2 + (i % 3) * 0.3, i * 1.3, 0.4 * (i % 2 ? 1 : -1));
      f.visible = false; basket.add(f); this.basketFish.push(f);
    }
    // 前灯
    const lampMat = std(0xfff6d8, { emissive: 0xfff2c0, emissiveIntensity: 0 });
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.05, 12), lampMat);
    lamp.rotation.x = Math.PI / 2; lamp.position.copy(local(v3(0, 0.8, 0.44))); steer.add(lamp);
    this.lampMat = lampMat;
    this.headlight = new THREE.SpotLight(0xfff0d0, 0, 38, 0.42, 0.55, 1.3);
    this.headlight.position.copy(lamp.position);
    const tgt = new THREE.Object3D(); tgt.position.copy(local(v3(0, 0, 9))); steer.add(tgt);
    this.headlight.target = tgt; steer.add(this.headlight);
    // 尾灯
    this.tailMat = std(0x330000, { emissive: 0xff1a1a, emissiveIntensity: 0 });
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.02), this.tailMat);
    tail.position.set(0, 0.78, -0.3); B.add(tail);

    // 车轮
    this.wheels = [];
    const tireMat = std(0x141414, { roughness: 0.9 });
    const rimMat = std(0xc9ced6, { metalness: 1, roughness: 0.25 });
    const spokeMat = new THREE.LineBasicMaterial({ color: 0xbfc5cc, transparent: true, opacity: 0.8 });
    const tireG = new THREE.TorusGeometry(WHEEL_R - 0.02, 0.022, 10, 48); tireG.rotateY(Math.PI / 2);
    const rimG = new THREE.TorusGeometry(WHEEL_R - 0.045, 0.008, 6, 48); rimG.rotateY(Math.PI / 2);
    const sp = [];
    for (let i = 0; i < 32; i++) {
      const a = i / 32 * Math.PI * 2, side = i % 2 ? 0.03 : -0.03;
      sp.push(new THREE.Vector3(side, Math.cos(a + 0.3) * 0.03, Math.sin(a + 0.3) * 0.03), new THREE.Vector3(0, Math.cos(a) * (WHEEL_R - 0.05), Math.sin(a) * (WHEEL_R - 0.05)));
    }
    const spokeG = new THREE.BufferGeometry().setFromPoints(sp);
    const hubG = new THREE.CylinderGeometry(0.03, 0.03, 0.09, 12); hubG.rotateZ(Math.PI / 2);
    // 反光片：夜里在车轮上闪一下
    const reflG = new THREE.BoxGeometry(0.01, 0.025, 0.06);
    const reflMat = std(0xffaa00, { emissive: 0xff8800, emissiveIntensity: 0.3 });
    for (const [p, parent] of [[rh, B], [fh, steer]]) {
      const w = new THREE.Group(); w.position.copy(parent === steer ? local(p) : p); parent.add(w);
      const tire = new THREE.Mesh(tireG, tireMat); tire.castShadow = true; w.add(tire);
      w.add(new THREE.Mesh(rimG, rimMat));
      w.add(new THREE.LineSegments(spokeG, spokeMat));
      w.add(new THREE.Mesh(hubG, chrome));
      const rf = new THREE.Mesh(reflG, reflMat); rf.position.set(0.02, WHEEL_R - 0.12, 0); w.add(rf);
      this.wheels.push(w);
    }
    this.reflMat = reflMat;

    // 牙盘 + 曲柄 + 脚踏
    const crank = new THREE.Group(); crank.position.copy(bb); B.add(crank); this.crank = crank;
    const ringG = new THREE.TorusGeometry(0.09, 0.008, 6, 32); ringG.rotateY(Math.PI / 2);
    const ring = new THREE.Mesh(ringG, chrome); ring.position.x = -0.05; crank.add(ring);
    this.pedals = [];
    for (const s of [1, -1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.17, 0.03), chrome);
      arm.position.set(0.07 * s, s * 0.085, 0); crank.add(arm);
      const ped = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 0.06), dark);
      ped.position.set(0.11 * s, s * 0.17, 0); crank.add(ped);
      this.pedals.push(ped);
    }
    // 链条（静态环线）
    const ch = [];
    const cr = 0.09, cg = 0.04;
    for (let i = 0; i <= 20; i++) { const a = Math.PI / 2 + i / 20 * Math.PI; ch.push(v3(-0.05, bb.y + Math.sin(a) * cr, bb.z + Math.cos(a) * cr * -1)); }
    for (let i = 0; i <= 20; i++) { const a = -Math.PI / 2 + i / 20 * Math.PI; ch.push(v3(-0.05, rh.y + Math.sin(a) * cg, rh.z - Math.cos(a) * cg)); }
    ch.push(ch[0].clone());
    B.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ch), new THREE.LineBasicMaterial({ color: 0x555a60 })));
  }

  buildPelican() {
    const B = this.body;
    const feather = std(0xf4f1ea, { roughness: 0.92 });
    const featherShade = std(0xd9d2c4, { roughness: 0.95 });
    const blackF = std(0x1e1e22, { roughness: 0.8 });
    const orange = std(0xf29a2e, { roughness: 0.6 });
    const beakMat = std(0xf2b33d, { roughness: 0.45 });
    const pouchMat = std(0xee8a52, { roughness: 0.55, transparent: true, opacity: 0.96 });
    const scarfRed = std(0xd2182a, { roughness: 0.75 });
    this.mats = { feather, scarfRed };

    // 身体：前倾的卵形
    const torso = new THREE.Group(); torso.position.set(0, 1.2, -0.12); torso.rotation.x = 0.55; B.add(torso);
    this.torso = torso;
    ball(torso, feather, 0.24, 0.36, 0.26, 0, 0, 0);
    ball(torso, featherShade, 0.2, 0.22, 0.12, 0, -0.06, -0.18); // 背羽
    // 尾羽
    for (let i = -1; i <= 1; i++) {
      const t = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.26, 4), i === 0 ? featherShade : feather);
      t.position.set(i * 0.07, -0.36, -0.08); t.rotation.set(Math.PI + 0.5, 0, i * 0.3); t.castShadow = true; torso.add(t);
    }

    // 脖子 + 头
    const neckBase = v3(0, 1.42, 0.02), neckTop = v3(0, 1.72, 0.18);
    const neckCurve = new THREE.CatmullRomCurve3([neckBase, v3(0, 1.58, 0.0), v3(0, 1.68, 0.06), neckTop]);
    const neck = new THREE.Mesh(new THREE.TubeGeometry(neckCurve, 16, 0.085, 10), feather); neck.castShadow = true; B.add(neck);
    this.neckTop = neckTop;
    const head = new THREE.Group(); head.position.copy(neckTop); B.add(head); this.head = head;
    ball(head, feather, 0.12, 0.11, 0.14, 0, 0.04, 0.04);
    // 头顶淡黄羽冠
    ball(head, std(0xf5e6a8, { roughness: 0.9 }), 0.08, 0.05, 0.09, 0, 0.12, -0.02);

    // 喙：上喙 + 喉囊
    const beakLen = 0.62;
    const upperG = new THREE.CylinderGeometry(0.025, 0.05, beakLen, 10, 1);
    upperG.translate(0, beakLen / 2, 0); upperG.rotateX(Math.PI / 2); upperG.scale(1.1, 0.55, 1);
    const upper = new THREE.Mesh(upperG, beakMat); upper.position.set(0, 0.04, 0.12); upper.rotation.x = 0.32; upper.castShadow = true; head.add(upper);
    const hook = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), std(0xd8442a, { roughness: 0.4 }));
    hook.position.set(0, -0.005, beakLen); hook.scale.set(1, 0.8, 1.2); upper.add(hook);
    const pouch = new THREE.Mesh(SPH, pouchMat);
    pouch.position.set(0, -0.05, beakLen * 0.5); pouch.scale.set(0.055, 0.07, beakLen * 0.46); pouch.castShadow = true;
    upper.add(pouch);
    this.pouch = pouch; this.pouchBase = pouch.scale.clone();
    this.beakTip = new THREE.Object3D(); this.beakTip.position.set(0, -0.04, beakLen * 0.9); upper.add(this.beakTip);
    // 眼睛位置（第一人称镜头用）
    this.eye = new THREE.Object3D(); this.eye.position.set(0, 0.14, 0.12); head.add(this.eye);

    // 头盔
    const helmetMat = new THREE.MeshPhysicalMaterial({ color: 0xffc61a, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 });
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.15, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), helmetMat);
    helmet.scale.set(1, 0.8, 1.2); helmet.position.set(0, 0.075, 0.0); helmet.rotation.x = -0.12; helmet.castShadow = true; head.add(helmet);
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.012, 6, 32, Math.PI), std(0x1b1d22));
    stripe.rotation.y = Math.PI / 2; stripe.scale.set(1, 0.8, 1.2); helmet.add(stripe);
    for (let i = 0; i < 4; i++) {
      const vent = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.07), std(0x1b1d22));
      const a = (i - 1.5) * 0.35;
      vent.position.set(Math.sin(a) * 0.12, 0.09, -0.02); vent.rotation.z = -a; helmet.add(vent);
    }
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.012, 0.07), helmetMat);
    visor.position.set(0, 0.07, 0.17); visor.rotation.x = 0.25; head.add(visor);
    // 头盔系带
    for (const s of [-1, 1]) tubeBetween(head, std(0x1b1d22), 0.006, v3(0.115 * s, 0.07, 0.03), v3(0.08 * s, -0.08, 0.1));

    // 墨镜（两侧眼位，镜面反射）
    const lensMat = new THREE.MeshPhysicalMaterial({ color: 0x0a0a12, metalness: 0.9, roughness: 0.05, clearcoat: 1, iridescence: 0.8, iridescenceIOR: 1.6 });
    const frameMat = std(0x111111, { roughness: 0.3, metalness: 0.4 });
    const lensG = new THREE.CylinderGeometry(0.05, 0.05, 0.012, 20); lensG.rotateZ(Math.PI / 2);
    for (const s of [-1, 1]) {
      const l = new THREE.Mesh(lensG, lensMat); l.position.set(0.11 * s, 0.05, 0.08); l.rotation.y = -0.35 * s; l.scale.set(1, 0.8, 1.15); head.add(l);
      const fr = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.007, 6, 20), frameMat);
      fr.rotation.y = Math.PI / 2 - 0.35 * s; fr.scale.set(1.15, 0.8, 1); fr.position.copy(l.position); head.add(fr);
      tubeBetween(head, frameMat, 0.005, v3(0.115 * s, 0.06, 0.02), v3(0.1 * s, 0.06, -0.08));
    }
    tubeBetween(head, frameMat, 0.006, v3(-0.09, 0.07, 0.13), v3(0.09, 0.07, 0.13));

    // 围巾结（布料尾巴由 Cloth 模块生成）
    const knot = new THREE.Mesh(new THREE.TorusGeometry(0.095, 0.035, 10, 24), scarfRed);
    knot.position.set(0, 1.5, 0.02); knot.rotation.x = Math.PI / 2 + 0.6; knot.castShadow = true; B.add(knot);
    ball(B, scarfRed, 0.05, 0.045, 0.04, 0, 1.5, -0.08);
    // 布料锚点（身体局部坐标）
    this.scarfAnchors = [v3(-0.05, 1.5, -0.1), v3(0.05, 1.5, -0.1)];

    // 翅膀
    this.wings = [];
    for (const s of [1, -1]) {
      const shoulder = v3(0.2 * s, 1.36, -0.04);
      const pivot = new THREE.Group(); pivot.position.copy(shoulder); B.add(pivot);
      const wing = new THREE.Group(); pivot.add(wing);
      ball(wing, feather, 0.16, 0.035, 0.12, 0.13, 0, 0);
      ball(wing, featherShade, 0.13, 0.03, 0.1, 0.32, 0, -0.01);
      for (let i = 0; i < 5; i++) {
        const f = new THREE.Mesh(SPH, blackF);
        f.scale.set(0.11, 0.015, 0.035);
        f.position.set(0.44 + i * 0.012, 0, -0.06 + i * 0.03);
        f.rotation.y = -0.4 + i * 0.18;
        f.castShadow = true; wing.add(f);
      }
      const grip = s > 0 ? this.gripL : this.gripR;
      this.wings.push({ s, pivot, wing, shoulder, grip });
    }

    // 腿
    this.legs = [];
    for (const s of [1, -1]) {
      const thigh = tube(feather, 0.055); B.add(thigh);
      const shin = tube(orange, 0.022); B.add(shin);
      const footG = new THREE.ConeGeometry(0.07, 0.12, 3); footG.rotateX(Math.PI / 2); footG.scale(1, 0.25, 1);
      const foot = new THREE.Mesh(footG, orange); foot.castShadow = true; B.add(foot);
      this.legs.push({ s, thigh, shin, foot, hip: v3(0.1 * s, 0.98, -0.2) });
    }
  }

  /** 每帧更新姿态 */
  update(dt, st, t) {
    const { crank, wheelAngle, laneVel, wheelie, wobble, spread, y, vy } = st;
    this.root.position.set(st.x, y, st.z);
    this.root.rotation.y = Math.PI - laneVel * 0.05 + Math.sin(wobble * 30) * wobble * 0.15;
    this.lean.rotation.z = clamp(laneVel * 0.06, -0.35, 0.35) + Math.sin(t * 1.7) * 0.01;
    const air = y > 0.01 ? clamp(vy * 0.04, -0.15, 0.2) : 0;
    this.pivot.rotation.x = wheelie * 0.55 + air;
    this.steer.setRotationFromAxisAngle(this.steerAxis, clamp(-laneVel * 0.08, -0.4, 0.4) + Math.sin(wobble * 40) * wobble * 0.5);

    this.wheels[0].rotation.x = wheelAngle;
    this.wheels[1].rotation.x = wheelAngle;
    this.crank.rotation.x = crank;
    for (const p of this.pedals) p.rotation.x = -crank;

    // 骑行起伏
    const bob = Math.sin(crank * 2) * 0.012;
    this.torso.position.y = 1.2 + bob;
    this.head.position.y = this.neckTop.y + bob * 1.4 + Math.sin(t * 2.3) * 0.006;
    this.headYaw = damp(this.headYaw, clamp(-laneVel * 0.12, -0.5, 0.5) + (st.lookYaw || 0), 6, dt);
    this.head.rotation.set(-wheelie * 0.4 - 0.05 + Math.sin(crank * 2) * 0.03, this.headYaw, 0);

    // 喉囊鼓起
    this.pouchBulge = damp(this.pouchBulge, 0, 2.5, dt);
    const pb = this.pouchBulge;
    this.pouch.scale.set(this.pouchBase.x * (1 + pb * 1.4), this.pouchBase.y * (1 + pb * 2.2), this.pouchBase.z * (1 + pb * 0.15));
    this.pouch.position.y = -0.05 - pb * 0.06;

    // 翅膀：握把 ↔ 展开扇动
    this.spread = damp(this.spread, spread, 7, dt);
    this.flapPhase += dt * (6 + spread * 4);
    for (const w of this.wings) this.poseWing(w, this.spread, this.flapPhase);

    // 腿：两骨 IK 到脚踏
    const pedalWorld = new THREE.Vector3();
    for (let i = 0; i < 2; i++) {
      const L = this.legs[i];
      const a = crank + (i ? Math.PI : 0);
      // 曲柄局部 (0, s*0.17, 0) 绕 x 旋转 crank
      const r = 0.17, sgn = i ? -1 : 1;
      pedalWorld.set(0.11 * L.s, this.pts.bb.y + Math.cos(crank) * r * sgn, this.pts.bb.z + Math.sin(crank) * r * sgn);
      const hip = L.hip.clone(); hip.y += bob;
      const foot = pedalWorld.clone(); foot.y += 0.03; foot.x = 0.1 * L.s;
      const knee = solveKnee(hip, foot, 0.45, 0.45);
      placeBetween(L.thigh, hip, knee); L.thigh.scale.x = L.thigh.scale.z = 0.055;
      placeBetween(L.shin, knee, foot); L.shin.scale.x = L.shin.scale.z = 0.022;
      L.foot.position.copy(foot).add(v3(0, 0, 0.03));
      L.foot.rotation.x = -0.15 + Math.sin(a) * 0.15;
    }

    // 灯光
    const night = st.night;
    this.headlight.intensity = night * 55;
    this.lampMat.emissiveIntensity = night * 6;
    this.tailMat.emissiveIntensity = night * (Math.sin(t * 8) > 0 ? 6 : 1);
    this.reflMat.emissiveIntensity = 0.3 + night * 2;

    // 车筐里的鱼
    for (let i = 0; i < this.basketFish.length; i++) {
      const f = this.basketFish[i];
      f.visible = i === 5 ? st.golden > 0 : i < Math.min(st.fish, 5);
      if (f.visible) f.userData.tail.rotation.y = Math.sin(t * 9 + i) * 0.3;
    }
  }

  poseWing(w, spread, phase) {
    const { s, wing, shoulder, grip } = w;
    // 折叠：指向握把（握把在转向组内，近似用静态位置）
    const gripB = grip.clone().add(this.pts.ht);
    const dirF = gripB.sub(shoulder);
    const lenF = dirF.length(); dirF.normalize();
    const flap = Math.sin(phase) * 0.55;
    const dirS = v3(s * Math.cos(flap) * 0.95, Math.sin(flap) + 0.15, -0.25).normalize();
    const dir = dirF.clone().lerp(dirS, spread).normalize();
    // 本地 x 轴 = 翼展方向（左翼镜像）
    const xAxis = dir.clone().multiplyScalar(s);
    let up = v3(s, 0, 0).lerp(v3(0, 1, 0), spread).normalize();
    up.sub(xAxis.clone().multiplyScalar(up.dot(xAxis))).normalize();
    const zAxis = new THREE.Vector3().crossVectors(xAxis, up);
    const m = new THREE.Matrix4().makeBasis(xAxis, up, zAxis);
    wing.quaternion.setFromRotationMatrix(m);
    const span = lerp(lenF / 0.5, 1.6, spread);
    wing.scale.set(s * span, 1, 1);
  }
}

/** 膝盖：在 yz 平面内求两骨 IK，膝向前弯 */
function solveKnee(hip, foot, l1, l2) {
  const dy = foot.y - hip.y, dz = foot.z - hip.z;
  let d = Math.hypot(dy, dz);
  d = Math.min(d, l1 + l2 - 1e-3);
  const a = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
  const base = Math.atan2(dz, dy);
  const ang = base - a; // 膝向 +z（前）
  const ang2 = base + a;
  // 取 z 更大的解（膝盖朝前）
  const k1 = v3(hip.x, hip.y + Math.cos(ang) * l1, hip.z + Math.sin(ang) * l1);
  const k2 = v3(hip.x, hip.y + Math.cos(ang2) * l1, hip.z + Math.sin(ang2) * l1);
  const k = k1.z > k2.z ? k1 : k2;
  k.x = (hip.x + foot.x) / 2 * 1.25;
  return k;
}
