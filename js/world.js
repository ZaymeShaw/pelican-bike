import * as THREE from 'three';
import { canvasTexture, std, fbm, hash1, smooth, clamp, rand } from './util.js';
import { ROAD_EDGE, beachHeight, SEA_LEVEL } from './ocean.js';
import { U } from './env.js';

export const ROAD_W = 8.4;      // 路面中心 x=0，[-4.2, 4.2]
export const LANES = [-2.6, 0, 2.6];
const TILE = 12;                // 路面纹理一个周期的长度

/** 按 "格子" 放置的重复物体：位置完全由骑手 z 推导，无状态 */
class Slots {
  constructor(spacing, count, make, place) {
    this.spacing = spacing; this.items = []; this.place = place;
    for (let i = 0; i < count; i++) this.items.push(make(i));
  }
  update(bikeZ, behind = 30) {
    const first = Math.floor((-bikeZ - behind) / this.spacing);
    for (let i = 0; i < this.items.length; i++) {
      const cell = first + i;
      const it = this.items[i];
      if (it.userData.cell !== cell) { it.userData.cell = cell; this.place(it, cell, -cell * this.spacing); }
    }
  }
}

function roadTexture() {
  return canvasTexture(512, 512 * TILE / ROAD_W, (c, w, h) => {
    c.fillStyle = '#3a3c40'; c.fillRect(0, 0, w, h);
    const img = c.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 34 + (Math.random() < 0.02 ? 30 : 0);
      img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n + 2;
    }
    c.putImageData(img, 0, 0);
    // 修补痕迹
    for (let i = 0; i < 5; i++) { c.fillStyle = `rgba(20,20,24,${rand(0.15, 0.3)})`; c.fillRect(rand(0, w), rand(0, h), rand(30, 120), rand(10, 60)); }
    const px = (x) => (x + ROAD_W / 2) / ROAD_W * w;
    c.fillStyle = '#e9e6dc';
    for (const x of [-3.95, 3.95]) c.fillRect(px(x) - 4, 0, 8, h);
    c.fillStyle = '#f2c230';
    for (const x of [-1.3, 1.3]) c.fillRect(px(x) - 4, 0, 8, h * 0.45);
  }, { repeat: true });
}

function sandTexture() {
  return canvasTexture(256, 256, (c, w, h) => {
    c.fillStyle = '#d8c09a'; c.fillRect(0, 0, w, h);
    const img = c.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 30;
      img.data[i] += n; img.data[i + 1] += n * 0.9; img.data[i + 2] += n * 0.7;
    }
    c.putImageData(img, 0, 0);
    c.strokeStyle = 'rgba(150,120,80,0.15)';
    for (let i = 0; i < 30; i++) { c.beginPath(); const y = rand(0, h); c.moveTo(0, y); c.bezierCurveTo(w / 3, y + rand(-8, 8), w * 2 / 3, y + rand(-8, 8), w, y); c.stroke(); }
  }, { repeat: true });
}

function glowTexture(inner = 'rgba(255,240,200,1)') {
  return canvasTexture(128, 128, (c, w, h) => {
    const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, inner); g.addColorStop(0.25, 'rgba(255,200,120,0.35)'); g.addColorStop(1, 'rgba(255,180,100,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  });
}

function cloudTexture() {
  return canvasTexture(256, 128, (c, w, h) => {
    for (let i = 0; i < 14; i++) {
      const x = rand(w * 0.2, w * 0.8), y = rand(h * 0.4, h * 0.65), r = rand(18, 46);
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
    }
  });
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group(); scene.add(this.group);
    this.nightMats = [];
    this.buildRoad();
    this.buildBeach();
    this.buildTerrain();
    this.buildProps();
    this.buildSeaLife();
  }

  buildRoad() {
    this.roadTex = roadTexture();
    const len = 600;
    this.roadTex.repeat.set(1, len / TILE);
    const road = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, len), std(0xffffff, { map: this.roadTex, roughness: 0.82 }));
    road.rotation.x = -Math.PI / 2; road.receiveShadow = true;
    this.road = road; this.roadLen = len; this.group.add(road);
    // 路缘
    const curbMat = std(0xbdb6a8, { roughness: 0.8 });
    this.curbs = [];
    for (const x of [-ROAD_W / 2 - 0.15, ROAD_W / 2 + 0.15]) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, len), curbMat);
      c.position.set(x, 0.05, 0); c.receiveShadow = true; this.group.add(c); this.curbs.push(c);
    }
  }

  buildBeach() {
    this.sandTex = sandTexture();
    const x0 = ROAD_EDGE - 0.6, x1 = 45, len = 600, nx = 40, nz = 4;
    const g = new THREE.PlaneGeometry(x1 - x0, len, nx, nz);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position, uv = g.attributes.uv;
    const col = new Float32Array(pos.count * 3);
    const dry = new THREE.Color(0xd9c49c).convertSRGBToLinear(), wet = new THREE.Color(0x8a7356).convertSRGBToLinear();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + (x0 + x1) / 2;
      pos.setX(i, x); pos.setY(i, beachHeight(x));
      uv.setXY(i, x / 8, -pos.getZ(i) / 8);
      const h = beachHeight(x);
      const c = dry.clone().lerp(wet, smooth(SEA_LEVEL + 0.5, SEA_LEVEL + 0.05, h));
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, std(0xffffff, { map: this.sandTex, vertexColors: true, roughness: 0.95 }));
    m.receiveShadow = true; this.beach = m; this.group.add(m);
  }

  terrainH(x, z) {
    const d = -x - ROAD_W / 2 - 0.3; // 距路缘
    if (d < 0) return 0.05;
    const n = fbm(x * 0.03, z * 0.03, 4);
    const ramp = smooth(3, 40, d);
    return 0.05 + d * 0.01 + ramp * (n * 26 + smooth(30, 120, d) * 30) + fbm(x * 0.2, z * 0.2, 2) * 0.4 * smooth(1, 4, d);
  }

  buildTerrain() {
    const nx = 60, nz = 70, w = 220, len = 560;
    this.tStep = len / nz;
    const g = new THREE.PlaneGeometry(w, len, nx, nz);
    g.rotateX(-Math.PI / 2);
    g.translate(-ROAD_W / 2 - 0.3 - w / 2, 0, 0);
    // x 非均匀：靠路边更密
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const t = clamp((-pos.getX(i) - ROAD_W / 2 - 0.3) / w, 0, 1);
      pos.setX(i, -ROAD_W / 2 - 0.3 - Math.pow(t, 1.7) * w);
    }
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3));
    this.baseX = Float32Array.from({ length: pos.count }, (_, i) => pos.getX(i));
    this.baseZ = Float32Array.from({ length: pos.count }, (_, i) => pos.getZ(i));
    const m = new THREE.Mesh(g, std(0xffffff, { vertexColors: true, roughness: 0.95, flatShading: true }));
    m.receiveShadow = true;
    this.terrain = m; this.group.add(m);
    this.terrainCell = null;
    this.grassA = new THREE.Color(0x5f8a3a).convertSRGBToLinear();
    this.grassB = new THREE.Color(0x3d6a2c).convertSRGBToLinear();
    this.rock = new THREE.Color(0x8a8070).convertSRGBToLinear();
  }

  rebuildTerrain(z0) {
    const g = this.terrain.geometry, pos = g.attributes.position, col = g.attributes.color;
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = this.baseX[i], z = this.baseZ[i] + z0;
      const h = this.terrainH(x, z);
      pos.setY(i, h);
      const n = fbm(x * 0.08 + 7, z * 0.08, 2);
      c.copy(this.grassA).lerp(this.grassB, n);
      c.lerp(this.rock, smooth(14, 30, h) * 0.8);
      col.setXYZ(i, c.r, c.g, c.b);
    }
    pos.needsUpdate = true; col.needsUpdate = true;
    g.computeVertexNormals();
    g.computeBoundingSphere();
    this.terrain.position.z = z0;
  }

  buildProps() {
    const G = this.group;
    // —— 护栏（海侧）
    const railMat = std(0xc9cdd2, { metalness: 0.7, roughness: 0.35 });
    this.rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 600), railMat);
    this.rail.position.set(ROAD_W / 2 + 0.55, 0.62, 0); this.rail.castShadow = true; G.add(this.rail);
    const postG = new THREE.BoxGeometry(0.08, 0.7, 0.08);
    this.posts = new Slots(4, 70, () => { const m = new THREE.Mesh(postG, railMat); m.castShadow = true; G.add(m); return m; },
      (m, cell, z) => m.position.set(ROAD_W / 2 + 0.55, 0.35, z));

    // —— 路灯（陆侧）
    const poleMat = std(0x2c3036, { metalness: 0.6, roughness: 0.4 });
    this.bulbMat = std(0xfff0d0, { emissive: 0xffd9a0, emissiveIntensity: 0 });
    const glowTex = glowTexture();
    const poolTex = canvasTexture(128, 128, (c, w, h) => {
      const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,215,150,0.9)'); g.addColorStop(1, 'rgba(255,200,130,0)');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
    });
    this.glowMats = [];
    this.poolMat = new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
    const poleG = new THREE.CylinderGeometry(0.06, 0.09, 6, 8);
    const armG = new THREE.CylinderGeometry(0.04, 0.04, 1.8, 6); armG.rotateZ(Math.PI / 2);
    const headG = new THREE.BoxGeometry(0.5, 0.12, 0.25);
    const poolG = new THREE.PlaneGeometry(7, 7); poolG.rotateX(-Math.PI / 2);
    const glowMat = new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
    this.glowMat = glowMat;
    this.lamps = new Slots(36, 18, () => {
      const g = new THREE.Group();
      const pole = new THREE.Mesh(poleG, poleMat); pole.position.y = 3; pole.castShadow = true; g.add(pole);
      const arm = new THREE.Mesh(armG, poleMat); arm.position.set(0.85, 5.9, 0); g.add(arm);
      const head = new THREE.Mesh(headG, this.bulbMat); head.position.set(1.7, 5.85, 0); g.add(head);
      const glow = new THREE.Sprite(glowMat); glow.scale.setScalar(3.2); glow.position.set(1.7, 5.7, 0); g.add(glow);
      const pool = new THREE.Mesh(poolG, this.poolMat); pool.position.set(1.9, 0.02, 0); g.add(pool);
      G.add(g); return g;
    }, (g, cell, z) => g.position.set(-ROAD_W / 2 - 0.9, 0, z));

    // —— 棕榈树
    const trunkMat = std(0x7a5a3a, { roughness: 0.9 });
    const leafMat = std(0x3f7a33, { roughness: 0.8, side: THREE.DoubleSide });
    const leafG = new THREE.PlaneGeometry(0.5, 2.6, 1, 6);
    { const p = leafG.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i) + 1.3; p.setY(i, y); p.setZ(i, -y * y * 0.12); p.setX(i, p.getX(i) * Math.sin(y / 2.6 * Math.PI) * 1.4); } leafG.computeVertexNormals(); }
    const makePalm = () => {
      const g = new THREE.Group();
      const pts = []; for (let i = 0; i <= 6; i++) pts.push(new THREE.Vector3(Math.sin(i * 0.35) * 0.5, i * 1.1, 0));
      const trunk = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.13, 6), trunkMat);
      trunk.castShadow = true; g.add(trunk);
      const top = pts[pts.length - 1];
      for (let i = 0; i < 8; i++) {
        const l = new THREE.Mesh(leafG, leafMat); l.position.copy(top);
        l.rotation.set(-0.9 + (i % 2) * 0.3, i / 8 * Math.PI * 2, 0, 'YXZ'); l.castShadow = true; g.add(l);
      }
      G.add(g); return g;
    };
    this.palms = new Slots(22, 26, makePalm, (g, cell, z) => {
      const h = hash1(cell * 3.1);
      const left = h < 0.75;
      const x = left ? -ROAD_W / 2 - 3 - hash1(cell) * 9 : ROAD_EDGE + 2 + hash1(cell + 9) * 3;
      g.position.set(x, left ? this.terrainH(x, z) : beachHeight(x), z + hash1(cell + 1) * 12);
      g.rotation.y = hash1(cell + 4) * 6.28;
      g.scale.setScalar(0.8 + hash1(cell + 2) * 0.5);
      g.visible = hash1(cell + 7) > 0.2;
    });

    // —— 海滩礁石
    const rockMat = std(0x6e6a64, { roughness: 0.95, flatShading: true });
    const rockG = new THREE.DodecahedronGeometry(1, 0);
    this.rocks = new Slots(15, 40, () => { const m = new THREE.Mesh(rockG, rockMat); m.castShadow = true; m.receiveShadow = true; G.add(m); return m; },
      (m, cell, z) => {
        const x = ROAD_EDGE + 4 + hash1(cell * 1.7) * 12;
        const s = 0.3 + hash1(cell * 2.3) * 0.9;
        m.position.set(x, beachHeight(x) + s * 0.2, z + hash1(cell) * 10);
        m.scale.set(s * 1.3, s * 0.8, s);
        m.rotation.set(hash1(cell + 1) * 3, hash1(cell + 2) * 3, 0);
      });

    // —— 灯塔（每 700m 一座，位于海中礁石岬角）
    const lh = new THREE.Group();
    const stripeTex = canvasTexture(64, 256, (c, w, h) => { for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#c62828' : '#f4f1ea'; c.fillRect(0, i * h / 8, w, h / 8); } });
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 2.1, 16, 20), std(0xffffff, { map: stripeTex, roughness: 0.6 }));
    tower.position.y = 8; tower.castShadow = true; lh.add(tower);
    const base = new THREE.Mesh(new THREE.DodecahedronGeometry(6, 1), rockMat); base.scale.set(1.4, 0.5, 1.2); base.position.y = -0.5; lh.add(base);
    this.lanternMat = std(0xfff4c0, { emissive: 0xffe6a0, emissiveIntensity: 0.2 });
    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 1.4, 12), this.lanternMat); lantern.position.y = 16.7; lh.add(lantern);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.3, 1.4, 12), std(0x2a2a2a)); roof.position.y = 18.1; lh.add(roof);
    const beamG = new THREE.ConeGeometry(2.6, 60, 24, 1, true); beamG.translate(0, -30, 0); beamG.rotateZ(Math.PI / 2);
    this.beamMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uOpacity: { value: 0 } },
      vertexShader: 'varying float vL; void main(){ vL = clamp(position.x / 60.0, 0.0, 1.0); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform float uOpacity; varying float vL; void main(){ gl_FragColor = vec4(vec3(1.0,0.92,0.7) * (1.0 - vL) * uOpacity, 1.0); }',
    });
    const beam = new THREE.Group(); beam.position.y = 16.7; lh.add(beam);
    for (const r of [0, Math.PI]) { const b = new THREE.Mesh(beamG, this.beamMat); b.rotation.y = r; beam.add(b); }
    this.beam = beam;
    const lhGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    lhGlow.scale.setScalar(10); lhGlow.position.y = 16.7; lh.add(lhGlow); this.lhGlow = lhGlow;
    G.add(lh);
    this.lh = lh;

    // —— 远方岛屿
    const islandMat = std(0x51606a, { roughness: 1, flatShading: true });
    this.islands = new Slots(180, 6, () => {
      const m = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 7, 2), islandMat); G.add(m); return m;
    }, (m, cell, z) => {
      const s = 30 + hash1(cell * 5.1) * 60;
      m.position.set(260 + hash1(cell) * 250, -2, z);
      m.scale.set(s, 10 + hash1(cell + 3) * 30, s * 0.7);
      m.rotation.y = hash1(cell + 2) * 3;
    });
  }

  buildSeaLife() {
    const G = this.group;
    // —— 帆船
    const hullMat = std(0xf2efe8, { roughness: 0.5 });
    const sailMat = std(0xffffff, { roughness: 0.7, side: THREE.DoubleSide });
    this.boatLightMat = std(0xffd890, { emissive: 0xffc070, emissiveIntensity: 0 });
    const sailG = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.6, 0), new THREE.Vector3(0, 6, 0), new THREE.Vector3(0, 0.6, 2.8)]);
    sailG.computeVertexNormals();
    this.boats = new Slots(140, 6, () => {
      const g = new THREE.Group();
      const hull = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.6, 4.5), hullMat); g.add(hull);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 6.5), std(0x8a7a6a)); mast.position.y = 3.3; g.add(mast);
      const sail = new THREE.Mesh(sailG, sailMat); sail.position.z = -1.6; g.add(sail);
      const light = new THREE.Mesh(new THREE.SphereGeometry(0.15), this.boatLightMat); light.position.y = 6.6; g.add(light);
      const glow = new THREE.Sprite(this.glowMat); glow.scale.setScalar(3); glow.position.y = 6.6; g.add(glow);
      G.add(g); return g;
    }, (g, cell, z) => {
      g.position.set(45 + hash1(cell * 9.3) * 140, SEA_LEVEL, z);
      g.rotation.y = hash1(cell) * 6.28;
      g.userData.ph = hash1(cell + 5) * 10;
    });

    // —— 海鸥
    const gullMat = std(0xffffff, { roughness: 0.8, side: THREE.DoubleSide });
    const wingG = new THREE.PlaneGeometry(0.9, 0.22); wingG.translate(0.45, 0, 0);
    this.gulls = [];
    for (let i = 0; i < 7; i++) {
      const g = new THREE.Group();
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), gullMat); b.scale.set(1, 0.8, 2.5); g.add(b);
      const wl = new THREE.Mesh(wingG, gullMat), wr = new THREE.Mesh(wingG, gullMat);
      wl.rotation.x = wr.rotation.x = -Math.PI / 2; wr.scale.x = -1;
      const pl = new THREE.Group(), pr = new THREE.Group(); pl.add(wl); pr.add(wr); g.add(pl, pr);
      g.userData = { pl, pr, r: rand(8, 22), h: rand(7, 16), sp: rand(0.25, 0.5) * (i % 2 ? 1 : -1), ph: rand(0, 6.28), off: rand(-10, 30) };
      G.add(g); this.gulls.push(g);
    }

    // —— 云
    const ct = cloudTexture();
    this.clouds = [];
    for (let i = 0; i < 14; i++) {
      const m = new THREE.SpriteMaterial({ map: ct, transparent: true, depthWrite: false, fog: false, opacity: 0.8 });
      const s = new THREE.Sprite(m);
      const sc = rand(80, 200); s.scale.set(sc, sc * 0.4, 1);
      s.userData = { ang: rand(-1.2, 1.4), dist: rand(450, 700), h: rand(60, 170), drift: rand(0.002, 0.006) };
      this.group.add(s); this.clouds.push(s);
    }
  }

  update(dt, t, bikeZ, cam, dn) {
    const night = dn.night;
    // 路面 / 沙滩跟随骑手，并用 UV 偏移滚动
    this.road.position.z = bikeZ - 150;
    this.roadTex.offset.y = (bikeZ - 150) / TILE;
    for (const c of this.curbs) c.position.z = bikeZ - 150;
    this.rail.position.z = bikeZ - 150;
    this.beach.position.z = bikeZ - 150;
    this.sandTex.offset.y = -(bikeZ - 150) / 8;
    
    // 地形：按网格步长吸附后重算高度
    const cell = Math.round((bikeZ - 180) / this.tStep);
    if (cell !== this.terrainCell) { this.terrainCell = cell; this.rebuildTerrain(cell * this.tStep); }

    this.posts.update(bikeZ, 40);
    this.lamps.update(bikeZ, 40);
    this.palms.update(bikeZ, 40);
    this.rocks.update(bikeZ, 40);
    this.islands.update(bikeZ, 200);
    this.boats.update(bikeZ, 200);

    // 灯塔：总在前方 250~950m 的海岬上
    const k = Math.floor((-bikeZ + 250) / 700) + 1;
    this.lh.position.set(70, SEA_LEVEL, -k * 700 + 250);
    this.beam.rotation.y = t * 0.9;
    this.beamMat.uniforms.uOpacity.value = night * 0.35;
    this.lhGlow.material.opacity = night;
    this.lanternMat.emissiveIntensity = 0.3 + night * 8;

    // 夜灯
    const lampOn = smooth(0.15, 0.45, night);
    this.bulbMat.emissiveIntensity = lampOn * 10;
    this.glowMat.opacity = lampOn * 0.9;
    this.poolMat.opacity = lampOn * 0.55;
    this.boatLightMat.emissiveIntensity = lampOn * 8;

    for (const b of this.boats.items) {
      const ph = b.userData.ph;
      b.position.y = SEA_LEVEL + Math.sin(t * 0.9 + ph) * 0.25;
      b.rotation.z = Math.sin(t * 0.7 + ph) * 0.06;
      b.position.x += dt * 0.6;
    }
    for (const g of this.gulls) {
      const u = g.userData; u.ph += dt * u.sp;
      const cx = 14, cz = bikeZ - 20 - u.off;
      g.position.set(cx + Math.cos(u.ph) * u.r, u.h + Math.sin(t * 0.5 + u.off) * 1.2, cz + Math.sin(u.ph) * u.r);
      g.rotation.y = -u.ph + (u.sp > 0 ? Math.PI : 0);
      const f = Math.sin(t * 6 + u.off) * 0.5;
      u.pl.rotation.z = f; u.pr.rotation.z = -f;
    }
    // 云：天穹上缓慢漂移，跟随相机
    const sunCol = U.uSunColor.value, amb = U.uAmbient.value;
    for (const c of this.clouds) {
      const u = c.userData; u.ang += dt * u.drift * 0.1;
      c.position.set(cam.position.x + Math.cos(u.ang) * u.dist, u.h, cam.position.z - Math.sin(u.ang) * u.dist * 0.9 - 100);
      c.material.color.copy(amb).multiplyScalar(0.9).add(sunCol.clone().multiplyScalar(0.5 * (1 - night)));
      c.material.opacity = 0.75 - night * 0.45;
    }
  }
}
