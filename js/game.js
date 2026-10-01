import * as THREE from 'three';
import { clamp, damp, lerp, rand, std } from './util.js';
import { LANES } from './world.js';
import { makeFish, RIG } from './rig.js';
import { SEA_LEVEL } from './ocean.js';

export const MAX_SPEED = 19;      // m/s ≈ 68 km/h
const CRUISE = 8;
const JUMP_V = 5.6, GRAV = 16;

function makeCone() {
  const g = new THREE.Group();
  const orange = std(0xff5a1a, { roughness: 0.5 }), white = std(0xffffff, { roughness: 0.4, emissive: 0x444444 });
  const c = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.65, 16), orange); c.position.y = 0.33; c.castShadow = true; g.add(c);
  const s = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.12, 16), white); s.position.y = 0.33; g.add(s);
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.5), orange); b.position.y = 0.025; g.add(b);
  return g;
}
function makeCrab() {
  const g = new THREE.Group();
  const red = std(0xd23a1e, { roughness: 0.45 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 10), red); body.scale.set(1.3, 0.55, 1); body.position.y = 0.2; body.castShadow = true; g.add(body);
  const legs = [];
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.015, 0.3), red);
    l.position.set(s * 0.28, 0.12, (i - 1) * 0.11); l.rotation.z = s * 0.9; g.add(l); legs.push(l);
  }
  for (const s of [-1, 1]) {
    const cl = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), red); cl.scale.set(1, 0.7, 1.4); cl.position.set(s * 0.2, 0.28, 0.24); g.add(cl);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03), std(0x111111)); eye.position.set(s * 0.07, 0.36, 0.16); g.add(eye);
  }
  g.userData.legs = legs;
  return g;
}

export class Game {
  constructor(scene, rig, events) {
    this.scene = scene; this.rig = rig; this.ev = events;
    this.st = {
      x: 0, y: 0, z: 0, dist: 0, speed: 0, targetSpeed: CRUISE, lane: 1, laneVel: 0, vy: 0,
      wheelie: 0, spread: 0, crank: 0, wheelAngle: 0, wobble: 0, airTime: 0, onGround: true,
      fish: 0, golden: 0, score: 0, combo: 0, bestCombo: 0, cadence: 0, night: 0, lookYaw: 0,
      jumps: 0, wheelieTime: 0, bestWheelie: 0, maxSpeed: 0, autopilot: true, autoFish: 0, airCatch: 0, misses: 0,
    };
    this.fishes = []; this.obstacles = [];
    this.nextSpawn = 40;
    this.autoLaneCd = 0;
    this.beak = new THREE.Vector3();
    this.tmp = new THREE.Vector3();
    this.pool = { fish: [], gold: [], cone: [], crab: [] };
  }

  reset() {
    const s = this.st;
    for (const f of this.fishes) this.release(f); for (const o of this.obstacles) this.release(o);
    this.fishes = []; this.obstacles = [];
    Object.assign(s, { fish: 0, golden: 0, score: 0, combo: 0, bestCombo: 0, jumps: 0, bestWheelie: 0, maxSpeed: 0, autoFish: 0, airCatch: 0, misses: 0 });
    this.startDist = s.dist;
    this.nextSpawn = s.dist + 30;
  }

  obtain(kind) {
    const p = this.pool[kind];
    let m = p.pop();
    if (!m) m = kind === 'fish' ? makeFish(false) : kind === 'gold' ? makeFish(true) : kind === 'cone' ? makeCone() : makeCrab();
    m.visible = true; m.userData.kind = kind; m.rotation.set(0, 0, 0); m.scale.setScalar(1);
    this.scene.add(m);
    return m;
  }
  release(e) { e.mesh.visible = false; this.scene.remove(e.mesh); this.pool[e.mesh.userData.kind].push(e.mesh); }

  /** input: {throttle, brake, left, right, jump, wings} 均为布尔，left/right/jump 为单次触发 */
  update(dt, t, input) {
    const s = this.st;
    // —— 速度
    if (input.throttle) s.targetSpeed = Math.min(MAX_SPEED, s.targetSpeed + 7 * dt);
    if (input.brake) s.targetSpeed = Math.max(0, s.targetSpeed - 12 * dt);
    const accel = s.targetSpeed > s.speed ? 3.2 : 6;
    s.speed = damp(s.speed, s.targetSpeed, accel * 0.35, dt);
    if (s.wheelie > 0.5) s.speed = Math.max(0, s.speed - dt * 0.15);
    s.maxSpeed = Math.max(s.maxSpeed, s.speed);
    s.dist += s.speed * dt;
    s.z = -s.dist;

    // —— 车道
    if (input.left && s.lane > 0) { s.lane--; this.ev.emit('lane'); }
    if (input.right && s.lane < 2) { s.lane++; this.ev.emit('lane'); }
    const tx = LANES[s.lane];
    const prevX = s.x;
    s.x = damp(s.x, tx, 7, dt);
    s.laneVel = (s.x - prevX) / Math.max(dt, 1e-4);

    // —— 跳跃
    if (input.jump && s.onGround) {
      s.vy = JUMP_V + s.speed * 0.06; s.onGround = false; s.jumps++; this.ev.emit('jump');
    }
    if (!s.onGround) {
      const g = input.wings ? GRAV * 0.55 : GRAV; // 展翅滑翔
      s.vy -= g * dt; s.y += s.vy * dt; s.airTime += dt;
      if (s.y <= 0) { s.y = 0; s.onGround = true; this.ev.emit('land', { v: -s.vy, air: s.airTime }); s.vy = 0; s.airTime = 0; }
    }
    // —— 展翅 / 翘前轮
    s.spread = input.wings ? 1 : 0;
    const wantWheelie = input.wings && s.onGround && s.speed > 2;
    s.wheelie = damp(s.wheelie, wantWheelie ? 1 : 0, wantWheelie ? 4 : 8, dt);
    if (s.wheelie > 0.6) { s.wheelieTime += dt; s.bestWheelie = Math.max(s.bestWheelie, s.wheelieTime); } else s.wheelieTime = 0;

    // —— 踏频 / 车轮
    const pedaling = s.targetSpeed >= s.speed - 0.3 && s.speed > 0.3;
    s.wheelAngle += s.speed / RIG.WHEEL_R * dt;
    const crankRate = s.speed / RIG.WHEEL_R / RIG.GEAR;
    if (pedaling) s.crank += crankRate * dt;
    s.cadence = damp(s.cadence, pedaling ? crankRate * 60 / (Math.PI * 2) : 0, 4, dt);
    s.wobble = Math.max(0, s.wobble - dt * 1.2);

    this.spawn();
    this.updateFish(dt, t);
    this.updateObstacles(dt, t);
  }

  spawn() {
    const s = this.st;
    while (this.nextSpawn < s.dist + 140) {
      const d = this.nextSpawn;
      const r = Math.random();
      const early = d - (this.startDist || 0) < 120;
      if (!early && r < 0.3) {
        const lane = (Math.random() * 3) | 0;
        this.addObstacle(lane, d, Math.random() < 0.45 ? 'crab' : 'cone');
        if (Math.random() < 0.35) this.addFish((lane + 1 + (Math.random() * 2 | 0)) % 3, d + 4, false, false);
        this.nextSpawn += rand(16, 26);
      } else if (r < 0.48) {
        // 鱼群：连续三条，蛇形走位
        let lane = (Math.random() * 3) | 0;
        for (let i = 0; i < 3; i++) { this.addFish(lane, d + i * 9, false, false); lane = clamp(lane + (Math.random() < 0.5 ? -1 : 1), 0, 2); }
        this.nextSpawn += 36;
      } else {
        const golden = Math.random() < 0.09;
        this.addFish((Math.random() * 3) | 0, d, golden, !golden && Math.random() < 0.25);
        this.nextSpawn += rand(12, 22);
      }
    }
  }

  addFish(lane, dist, golden, high) {
    const mesh = this.obtain(golden ? 'gold' : 'fish');
    mesh.visible = false;
    this.fishes.push({ mesh, lane, dist, golden, high, state: 'wait', t: 0, p: 0, catchH: high ? 2.6 : 1.55, pos: new THREE.Vector3(), vel: new THREE.Vector3() });
  }
  addObstacle(lane, dist, kind) {
    const mesh = this.obtain(kind);
    mesh.position.set(LANES[lane], 0, -dist);
    mesh.rotation.y = rand(0, 6);
    this.obstacles.push({ mesh, lane, dist, kind, hit: false, vx: 0, vy: 0, spin: 0, ph: rand(0, 6) });
  }

  updateFish(dt, t) {
    const s = this.st;
    this.rig.beakTip.getWorldPosition(this.beak);
    const launch = clamp(s.speed * 1.9, 10, 34);
    for (let i = this.fishes.length - 1; i >= 0; i--) {
      const f = this.fishes[i];
      const ahead = f.dist - s.dist;
      const laneX = LANES[f.lane];
      if (f.state === 'wait') {
        if (ahead < launch) { f.state = 'fly'; f.launch = ahead; f.t = 0; f.mesh.visible = true; this.ev.emit('launch', { x: 14, z: -f.dist + 3 }); }
        else continue;
      }
      if (f.state === 'fly') {
        f.t += dt;
        // 以骑手距离推进（鱼在骑手到达时恰好飞到车道上空），同时有时间兜底
        const pd = 1 - ahead / f.launch;
        f.p = Math.max(pd, f.t / 3.2);
        const p = clamp(f.p, 0, 1.6);
        const sx = 14, x = p <= 1 ? lerp(sx, laneX, p) : laneX - (p - 1) * 8;
        const h0 = SEA_LEVEL, apex = f.catchH;
        const y = p <= 1 ? lerp(h0, apex, 1 - (1 - p) * (1 - p)) + Math.sin(p * Math.PI) * 0.6 : apex - (p - 1) * (p - 1) * 30;
        const prev = f.mesh.position.clone();
        f.mesh.position.set(x, y, -f.dist);
        f.vel.subVectors(f.mesh.position, prev);
        if (f.vel.lengthSq() > 1e-8) f.mesh.lookAt(this.tmp.copy(f.mesh.position).add(f.vel));
        f.mesh.userData.tail.rotation.y = Math.sin(t * 22 + i) * 0.5;
        if (f.golden) f.mesh.rotation.z += Math.sin(t * 10) * 0.2;
        // 抓取判定
        const d = this.beak.distanceTo(f.mesh.position);
        if (d < (f.golden ? 0.95 : 0.8)) { this.catchFish(f); this.fishes.splice(i, 1); continue; }
        if (ahead < -6 || y < -2) {
          this.st.combo = 0; this.st.misses++; this.ev.emit('miss', f);
          this.release(f); this.fishes.splice(i, 1);
        }
      }
      if (f.state === 'eaten') {}
    }
  }

  catchFish(f) {
    const s = this.st;
    s.combo++; s.bestCombo = Math.max(s.bestCombo, s.combo);
    s.fish++; if (f.golden) s.golden++;
    if (!s.onGround) s.airCatch++;
    if (s.autopilot) s.autoFish++;
    const mult = 1 + Math.floor(s.combo / 3);
    const pts = (f.golden ? 500 : 100) * mult;
    s.score += pts;
    this.rig.pouchBulge = 1;
    this.ev.emit('catch', { pos: f.mesh.position.clone(), golden: f.golden, pts, combo: s.combo, air: !s.onGround });
    this.release(f);
  }

  updateObstacles(dt, t) {
    const s = this.st;
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const o = this.obstacles[i];
      const m = o.mesh;
      if (o.kind === 'crab' && !o.hit) {
        o.ph += dt;
        m.position.x = LANES[o.lane] + Math.sin(o.ph * 1.5) * 0.35;
        for (const [j, l] of m.userData.legs.entries()) l.rotation.x = Math.sin(o.ph * 14 + j) * 0.4;
        m.rotation.y = Math.PI / 2 + Math.sin(o.ph * 0.7) * 0.3;
      }
      if (!o.hit) {
        const dz = o.dist - s.dist;
        if (Math.abs(dz) < 0.6 && Math.abs(s.x - m.position.x) < 0.75 && s.y < 0.45) {
          o.hit = true; o.vx = (Math.random() - 0.5) * 6; o.vy = 4; o.spin = rand(-10, 10);
          s.speed *= 0.4; s.targetSpeed = Math.max(4, s.targetSpeed * 0.7);
          s.combo = 0; s.wobble = 1;
          this.ev.emit('hit', { pos: m.position.clone(), kind: o.kind });
        } else if (dz < -0.6 && !o.passed) {
          o.passed = true; if (s.y > 0.3) this.ev.emit('dodge', o);
        }
      } else {
        o.vy -= 12 * dt;
        m.position.x += o.vx * dt; m.position.y = Math.max(0, m.position.y + o.vy * dt);
        m.position.z -= s.speed * 0.6 * dt;
        m.rotation.x += o.spin * dt; m.rotation.z += o.spin * 0.5 * dt;
      }
      if (o.dist < s.dist - 20) { this.release(o); this.obstacles.splice(i, 1); }
    }
  }

  /** 自动驾驶：追最近的鱼、避障、跳高鱼 */
  autopilot(dt, t) {
    const s = this.st;
    const out = { throttle: false, brake: false, left: false, right: false, jump: false, wings: false };
    const target = 9.5 + Math.sin(t * 0.13) * 3;
    if (s.targetSpeed < target - 0.3) out.throttle = true; else if (s.targetSpeed > target + 0.3) out.brake = true;
    let goal = s.lane, best = 1e9;
    for (const f of this.fishes) {
      const ahead = f.dist - s.dist;
      if (ahead > 1 && ahead < 45 && ahead < best) { best = ahead; goal = f.lane; }
    }
    const danger = (lane, range) => this.obstacles.some(o => !o.hit && o.lane === lane && o.dist - s.dist > 0 && o.dist - s.dist < range);
    if (danger(goal, 14)) {
      const alts = [s.lane, s.lane - 1, s.lane + 1].filter(l => l >= 0 && l <= 2 && !danger(l, 14));
      if (alts.length) goal = alts[0];
    }
    this.autoLaneCd -= dt;
    if (goal !== s.lane && this.autoLaneCd <= 0) {
      if (goal < s.lane) out.left = true; else out.right = true;
      this.autoLaneCd = 0.35;
    }
    // 跳：前方障碍不可绕时，或高位鱼来临
    const speed = Math.max(s.speed, 1);
    for (const o of this.obstacles) {
      const dz = o.dist - s.dist;
      if (!o.hit && o.lane === s.lane && dz > 0 && dz / speed < 0.28) out.jump = true;
    }
    for (const f of this.fishes) {
      const dz = f.dist - s.dist;
      if (f.high && f.lane === s.lane && Math.abs(s.x - LANES[f.lane]) < 0.4 && dz > 0 && dz / speed < 0.4) out.jump = true;
    }
    // 空闲时秀一下翘头
    if (best > 30 && Math.sin(t * 0.37) > 0.92) out.wings = true;
    return out;
  }
}
