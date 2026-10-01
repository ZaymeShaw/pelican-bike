import * as THREE from 'three';
import { damp, clamp, lerp } from './util.js';

export const MODES = [
  { id: 'chase', name: '追尾镜头' },
  { id: 'side', name: '侧面跟拍' },
  { id: 'drone', name: '航拍俯视' },
  { id: 'cine', name: '电影运镜' },
  { id: 'pov', name: '鹈鹕视角' },
];
const SHOTS = ['dolly', 'orbit', 'wheel', 'crane', 'flyby', 'sunset'];

export class CameraDirector {
  constructor(camera) {
    this.cam = camera;
    this.mode = 0;
    this.used = new Set([0]);
    this.off = new THREE.Vector3(0, 3, 7);
    this.look = new THREE.Vector3();
    this.shot = 0; this.shotT = 0; this.cut = true;
    this.anchor = new THREE.Vector3();
    this.shake = 0;
    this._v = new THREE.Vector3(); this._q = new THREE.Quaternion();
  }
  set(i) { this.mode = (i + MODES.length) % MODES.length; this.used.add(this.mode); this.cut = true; this.shotT = 0; }
  next() { this.set(this.mode + 1); }
  get name() { return MODES[this.mode].name + (MODES[this.mode].id === 'cine' ? ` · ${SHOT_NAMES[SHOTS[this.shot]]}` : ''); }
  get id() { return MODES[this.mode].id; }

  update(dt, t, st, rig) {
    const cam = this.cam;
    const P = this._v.set(st.x, st.y, st.z);
    const sp = st.speed;
    let fov = 55, wantOff = null, look = new THREE.Vector3(), snap = this.cut;
    const id = this.id;
    if (id === 'chase') {
      wantOff = new THREE.Vector3(-st.x * 0.35 + 0.6, 2.4 + sp * 0.03, 6.2 + sp * 0.12);
      look.set(st.x * 0.6, st.y * 0.5 + 1.1, st.z - 6);
      fov = 52 + sp * 0.9;
    } else if (id === 'side') {
      wantOff = new THREE.Vector3(6.5 - st.x, 1.4, -1.5);
      look.set(st.x, st.y + 1.0, st.z - 0.6);
      fov = 48;
    } else if (id === 'drone') {
      wantOff = new THREE.Vector3(4 + Math.sin(t * 0.2) * 3, 16, 9);
      look.set(st.x + 1, 0.5, st.z - 8);
      fov = 50;
    } else if (id === 'cine') {
      this.shotT += dt;
      if (this.shotT > 6.5) { this.shotT = 0; this.shot = (this.shot + 1) % SHOTS.length; snap = true; }
      const u = this.shotT / 6.5;
      switch (SHOTS[this.shot]) {
        case 'dolly': // 前方倒退跟拍，低机位
          wantOff = new THREE.Vector3(-1.2 + u * 2.4, 0.9, -4.5 + u * 1.5);
          look.set(st.x, st.y + 1.2, st.z); fov = 40; break;
        case 'orbit': { // 环绕
          const a = u * Math.PI * 1.2 - 0.6;
          wantOff = new THREE.Vector3(Math.sin(a) * 4.5, 1.8, Math.cos(a) * 4.5);
          look.set(st.x, st.y + 1.1, st.z); fov = 45; snap = snap || false; break;
        }
        case 'wheel': // 车轮特写，贴地
          wantOff = new THREE.Vector3(1.4, 0.35, 0.6 - u * 1.4);
          look.set(st.x, st.y + 0.5, st.z - 0.2); fov = 38; break;
        case 'crane': // 升降摇臂：从低到高拉开
          wantOff = new THREE.Vector3(3 + u * 4, 0.8 + u * 12, 4 + u * 8);
          look.set(st.x, st.y + 1, st.z - u * 6); fov = 50; break;
        case 'flyby': { // 固定机位，骑手呼啸而过
          if (this.shotT < dt * 1.5 || snap) this.anchor.set(-3.6, 0.6, st.z - Math.max(sp, 4) * 3.2);
          cam.position.copy(this.anchor);
          look.set(st.x, st.y + 1.0, st.z);
          fov = 34; wantOff = null; break;
        }
        case 'sunset': // 海面一侧低角度，把夕阳/月亮放在画面里
          wantOff = new THREE.Vector3(-4.5, 1.0, 5.5 - u * 3);
          look.set(st.x + 6, st.y + 2.2, st.z - 10); fov = 50; break;
      }
    } else if (id === 'pov') {
      rig.root.updateMatrixWorld(true);
      rig.eye.getWorldPosition(cam.position);
      rig.head.getWorldQuaternion(this._q);
      cam.quaternion.copy(this._q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
      cam.rotateX(-0.12);
      cam.fov = damp(cam.fov, 78 + sp * 0.5, 4, dt);
      cam.near = 0.03; cam.updateProjectionMatrix();
      this.cut = false;
      return;
    }
    cam.near = 0.1;
    if (wantOff) {
      if (snap) this.off.copy(wantOff); else {
        const k = id === 'cine' ? 2.5 : 4;
        this.off.x = damp(this.off.x, wantOff.x, k, dt); this.off.y = damp(this.off.y, wantOff.y, k, dt); this.off.z = damp(this.off.z, wantOff.z, k, dt);
      }
      cam.position.copy(P).add(this.off);
      cam.position.y = Math.max(cam.position.y, 0.25);
    }
    if (snap) this.look.copy(look); else this.look.lerp(look, 1 - Math.exp(-8 * dt));
    // 撞击震屏
    this.shake = Math.max(0, this.shake - dt * 2.5);
    if (this.shake > 0) cam.position.add(new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.5), 0).multiplyScalar(this.shake * 0.25));
    cam.lookAt(this.look);
    cam.fov = snap ? fov : damp(cam.fov, fov, 3, dt);
    cam.updateProjectionMatrix();
    this.cut = false;
  }
}

const SHOT_NAMES = { dolly: '前置跟拍', orbit: '环绕', wheel: '车轮特写', crane: '摇臂升起', flyby: '路边掠过', sunset: '海天逆光' };
