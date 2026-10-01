import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { DayNight, createSky, U } from './env.js';
import { createOcean } from './ocean.js';
import { World } from './world.js';
import { Rig } from './rig.js';
import { ClothRibbon } from './cloth.js';
import { Game } from './game.js';
import { CameraDirector, MODES } from './camera.js';
import { Particles } from './particles.js';
import { AudioEngine } from './audio.js';
import { Achievements, ACHIEVEMENTS } from './achievements.js';
import { Quality } from './quality.js';
import { Input } from './input.js';
import { std, clamp } from './util.js';

const $ = (id) => document.getElementById(id);

// —— 渲染器
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x000000, 0.006);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 2000);

// —— 环境
const dn = new DayNight();
const sky = createSky(); scene.add(sky);
let ocean = createOcean(1); scene.add(ocean);
const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1); scene.add(hemi);
const key = new THREE.DirectionalLight(0xffffff, 2);
key.castShadow = true;
key.shadow.camera.left = -14; key.shadow.camera.right = 14; key.shadow.camera.top = 14; key.shadow.camera.bottom = -14;
key.shadow.camera.near = 1; key.shadow.camera.far = 80; key.shadow.bias = -0.0004; key.shadow.normalBias = 0.03;
scene.add(key, key.target);
// 角色补光：只照骑手附近（distance 衰减），夜里让鹈鹕从背景中读得出来
const fill = new THREE.PointLight(0xa8b8ff, 0, 9, 1.6);
scene.add(fill);

const world = new World(scene);
const rig = new Rig(); scene.add(rig.root);

// 围巾：两条布料尾巴
const scarfMat = new THREE.MeshStandardMaterial({ color: 0xd2182a, roughness: 0.8, side: THREE.DoubleSide });
{
  const tex = document.createElement('canvas'); tex.width = 64; tex.height = 256;
  const c = tex.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, 64, 256);
  c.fillStyle = 'rgba(0,0,0,.12)'; for (let y = 0; y < 256; y += 32) c.fillRect(0, y, 64, 6);
  c.fillStyle = 'rgba(255,255,255,.6)'; for (let x = 0; x < 64; x += 8) c.fillRect(x, 244, 4, 12); // 流苏
  const t = new THREE.CanvasTexture(tex); t.colorSpace = THREE.SRGBColorSpace; scarfMat.map = t;
}
const scarves = [
  new ClothRibbon(scarfMat, { cols: 4, rows: 16, width: 0.12, length: 0.95, seed: 1 }),
  new ClothRibbon(scarfMat, { cols: 4, rows: 13, width: 0.11, length: 0.72, seed: 4 }),
];
for (const s of scarves) scene.add(s.mesh);

const particles = new Particles(1500); scene.add(particles.points);

// —— 事件总线
const bus = { h: {}, on(n, f) { (this.h[n] ||= []).push(f); }, emit(n, d) { (this.h[n] || []).forEach(f => f(d)); } };
const game = new Game(scene, rig, bus);
const S = game.st;
const director = new CameraDirector(camera);
const audio = new AudioEngine();
const input = new Input();
let started = false, paused = false;

// —— 后期
const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.6, 0.92);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const quality = new Quality((lv) => {
  const pr = Math.min(lv.pr, window.devicePixelRatio || 1);
  renderer.setPixelRatio(pr); composer.setPixelRatio(pr);
  composer.setSize(innerWidth, innerHeight);
  bloom.enabled = lv.bloom;
  key.castShadow = lv.shadow > 0;
  if (lv.shadow && key.shadow.mapSize.x !== lv.shadow) {
    key.shadow.mapSize.set(lv.shadow, lv.shadow); key.shadow.map?.dispose(); key.shadow.map = null;
  }
  particles.limit = Math.round(particles.max * lv.particles);
  updateQualityTag();
});
quality.apply(quality.cur);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
});

// —— UI
const achievements = new Achievements((a) => {
  toast(a.icon, `成就解锁：${a.name}`, a.desc);
  audio.achievement();
  renderAch();
});
function toast(icon, title, sub) {
  const el = document.createElement('div');
  el.className = 'toast glass';
  el.innerHTML = `<span class="i"></span><div><b></b><small></small></div>`;
  el.querySelector('.i').textContent = icon; el.querySelector('b').textContent = title; el.querySelector('small').textContent = sub || '';
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 4000);
}
function renderAch() {
  const ul = $('achList'); ul.innerHTML = '';
  for (const a of ACHIEVEMENTS) {
    const li = document.createElement('li'); if (achievements.got.has(a.id)) li.className = 'got';
    li.innerHTML = '<span class="i"></span><div><b></b><small></small></div>';
    li.querySelector('.i').textContent = a.icon; li.querySelector('b').textContent = a.name; li.querySelector('small').textContent = a.desc;
    ul.appendChild(li);
  }
  $('achCount').textContent = `${achievements.got.size} / ${ACHIEVEMENTS.length}`;
  $('sAch').textContent = `${achievements.got.size}/${ACHIEVEMENTS.length}`;
}
renderAch();
function updateQualityTag() { $('qName').textContent = `画质 ${quality.auto ? '自动·' : ''}${quality.cur.name}`; }
const _p = new THREE.Vector3();
function popup(pos, text, gold) {
  _p.copy(pos).project(camera);
  if (_p.z > 1) return;
  const el = document.createElement('div');
  el.className = 'pop' + (gold ? ' gold' : '');
  el.textContent = text;
  el.style.left = `${(_p.x * 0.5 + 0.5) * innerWidth}px`; el.style.top = `${(-_p.y * 0.5 + 0.5) * innerHeight}px`;
  $('hud').appendChild(el); setTimeout(() => el.remove(), 1000);
}
function toggle(id, force) {
  const el = $(id); const show = force ?? el.hidden; el.hidden = !show;
  if (show) el.querySelector('button')?.focus();
}
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => { b.closest('.overlay').hidden = true; }));
$('achReset').addEventListener('click', () => { achievements.reset(); renderAch(); });
$('bCam').addEventListener('click', () => cycleCam());
$('bAch').addEventListener('click', () => toggle('ach'));
$('bHelp').addEventListener('click', () => toggle('help'));
$('bMute').addEventListener('click', () => toggleMute());
function toggleMute() { audio.setMuted(!audio.muted); $('bMute').textContent = audio.muted ? '🔇' : '🔊'; }
function cycleCam() { director.next(); input.idle = 0; }

// —— 键位
input.on('KeyC', cycleCam);
for (let i = 0; i < 5; i++) input.on(`Digit${i + 1}`, () => director.set(i));
input.on('KeyM', toggleMute);
input.on('KeyJ', () => toggle('ach'));
input.on('KeyH', () => toggle('help'));
input.on('KeyB', () => audio.bell());
input.on('KeyQ', () => { quality.cycle(); updateQualityTag(); });
input.on('KeyP', () => { paused = !paused; });
input.on('Escape', () => { $('help').hidden = true; $('ach').hidden = true; });
input.on('KeyT', () => audio.flap());

// 触屏
if (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window) document.body.classList.add('touch');
for (const [id, code] of [['tW', 'KeyW'], ['tS', 'KeyS'], ['tA', 'KeyA'], ['tD', 'KeyD'], ['tT', 'KeyT'], ['tJ', 'Space']]) input.bindTouch($(id), code);

// 开始
function start() {
  if (started) return;
  started = true;
  $('start').hidden = true;
  audio.init();
  game.reset();
  S.autopilot = false;
  input.idle = 0;
  director.set(0);
}
$('go').addEventListener('click', start);
addEventListener('keydown', (e) => { if (!started && (e.code === 'Enter' || e.code === 'Space')) { e.preventDefault(); start(); } });
$('go').focus();

// —— 游戏事件 → 音效 / 粒子 / UI
bus.on('catch', (e) => {
  audio.catch(e.golden, e.combo);
  particles.emit(e.golden ? 60 : 30, e.pos, { color: e.golden ? [1.6, 1.1, 0.3] : [0.7, 0.9, 1.2], speed: 2.5, up: 2, size: e.golden ? 0.16 : 0.1, life: 0.8, gravity: 4 });
  popup(e.pos, `+${e.pts}${e.combo >= 3 ? ` ×${1 + Math.floor(e.combo / 3)}` : ''}`, e.golden);
});
bus.on('launch', (e) => {
  audio.splash(0.12);
  particles.emit(40, new THREE.Vector3(e.x, -0.4, e.z), { color: [0.75, 0.85, 0.95], spread: 0.6, up: 3.5, speed: 1.5, size: 0.14, life: 1.2 });
});
bus.on('jump', () => { audio.jump(); });
bus.on('land', (e) => {
  audio.land(e.v);
  if (e.v > 3) particles.emit(20, new THREE.Vector3(S.x, 0.05, S.z), { color: [0.5, 0.45, 0.4], spread: 1, up: 0.8, speed: 2, size: 0.12, life: 0.6, gravity: 2 });
});
bus.on('hit', (e) => {
  audio.hit(); director.shake = 1;
  particles.emit(35, e.pos.clone().setY(0.4), { color: e.kind === 'crab' ? [1.2, 0.3, 0.15] : [1.3, 0.6, 0.2], spread: 1, up: 3, speed: 3, size: 0.1, life: 0.9 });
  const f = $('flash'); f.style.opacity = 1; setTimeout(() => f.style.opacity = 0, 160);
});
bus.on('lane', () => audio.lane());
bus.on('miss', () => {});

// —— 主循环
const clock = new THREE.Clock();
let t = 0, flapCd = 0;
const colliders = [{ c: new THREE.Vector3(), r: 0.27 }, { c: new THREE.Vector3(), r: 0.2 }, { c: new THREE.Vector3(), r: 0.13 }];
const anchorA = new THREE.Vector3(), anchorB = new THREE.Vector3(), anchorA2 = new THREE.Vector3(), anchorB2 = new THREE.Vector3();
const velV = new THREE.Vector3();
const _o = new THREE.Vector3();

function frame() {
  requestAnimationFrame(frame);
  const raw = clock.getDelta();
  quality.sample(raw);
  if (paused) { composer.render(); return; }
  const dt = Math.min(raw, 1 / 20);
  t += dt;

  // 输入 / 自动驾驶
  const human = input.frame(dt);
  const idleLimit = started ? 6 : 0;
  S.autopilot = input.idle > idleLimit;
  const ctl = S.autopilot ? game.autopilot(dt, t) : human;
  if (S.autopilot && !started && director.id !== 'cine') director.set(3);
  dn.speed = input.held.has('KeyN') ? 25 : 1;

  game.update(dt, t, ctl);
  dn.update(dt);
  S.night = dn.night;
  U.uTime.value = t;
  U.uBikeZ.value = S.z;

  // 光照
  hemi.color.copy(dn.hemiSky); hemi.groundColor.copy(dn.hemiGround); hemi.intensity = dn.hemiIntensity;
  key.color.copy(dn.keyColor); key.intensity = dn.keyIntensity;
  key.position.set(S.x, 0, S.z).addScaledVector(dn.keyDir, 40);
  key.target.position.set(S.x, 0, S.z);
  scene.fog.color.copy(U.uFogColor.value); scene.fog.density = U.uFogDensity.value;
  renderer.toneMappingExposure = dn.exposure;
  fill.intensity = 0.6 + dn.night * 5;
  fill.color.setRGB(1, 0.85, 0.7).lerp(new THREE.Color(0.65, 0.72, 1), dn.night);
  fill.position.copy(camera.position).lerp(_o.set(S.x, S.y + 1.3, S.z), 0.55).add(_o.set(0, 1.2, 0));

  // 姿态 + 世界
  rig.update(dt, S, t);
  rig.root.updateMatrixWorld(true);
  world.update(dt, t, S.z, camera, dn);
  ocean.position.z = Math.round(S.z);
  sky.position.copy(camera.position);

  // 布料
  velV.set(0, S.vy, -S.speed);
  rig.body.localToWorld(anchorA.copy(rig.scarfAnchors[0]));
  rig.body.localToWorld(anchorB.copy(rig.scarfAnchors[1]));
  rig.body.localToWorld(anchorA2.copy(rig.scarfAnchors[0]).add(_o.set(0.05, -0.02, 0)));
  rig.body.localToWorld(anchorB2.copy(rig.scarfAnchors[1]).add(_o.set(0.07, -0.02, 0)));
  rig.torso.getWorldPosition(colliders[0].c);
  rig.body.localToWorld(colliders[1].c.set(0, 0.95, -0.25)); // 座位 / 臀部
  rig.body.localToWorld(colliders[2].c.set(0, 0.85, -0.45)); // 后轮上方
  scarves[0].update(dt, anchorA, anchorB, velV, colliders, t);
  scarves[1].update(dt, anchorA2, anchorB2, velV, colliders, t + 3);

  // 翅膀扇动音效
  if (ctl.wings) { flapCd -= dt; if (flapCd <= 0) { audio.flap(); flapCd = 0.42; } } else flapCd = 0;

  particles.update(dt);
  particles.mat.uniforms.uScale.value = innerHeight * renderer.getPixelRatio() * 0.6;
  director.update(dt, t, S, rig);
  document.body.classList.toggle('cine', director.id === 'cine');

  audio.update(dt, { speed: S.speed, cadence: S.cadence, night: dn.night, coasting: S.cadence < 5 });

  if (started) {
    achievements.check({ ...S, ride: S.dist - game.startDist, cams: director.used.size });
  }
  hud();
  composer.render();
}

let hudT = 0;
const SKY_NAMES = (e) => e > 15 ? '白天' : e > 3 ? '黄昏' : e > -3 ? '日落' : e > -10 ? '暮色' : '星空月夜';
function hud() {
  hudT -= 1;
  $('kmh').textContent = Math.round(S.speed * 3.6);
  $('bar').firstElementChild.style.width = `${clamp(S.speed / 19, 0, 1) * 100}%`;
  if (hudT > 0) return;
  hudT = 6;
  $('score').textContent = S.score.toLocaleString();
  $('combo').textContent = S.combo >= 2 ? `连击 ×${S.combo}` : '';
  $('sFish').textContent = S.fish; $('sGold').textContent = S.golden;
  const ride = started ? S.dist - game.startDist : S.dist;
  $('sDist').textContent = ride > 1000 ? `${(ride / 1000).toFixed(2)} km` : `${Math.round(ride)} m`;
  $('rpm').textContent = Math.round(S.cadence);
  $('clock').textContent = dn.clock;
  $('sky').textContent = SKY_NAMES(dn.sunElev) + (dn.speed > 1 ? ' ⏩' : '');
  $('auto').classList.toggle('on', S.autopilot);
  $('camName').textContent = director.name;
  $('qName').title = `${Math.round(quality.fps)} fps`;
}

frame();
window.__pelican = { game, director, dn, quality, renderer, scene };
