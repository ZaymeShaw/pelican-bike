/**
 * 全部声音都在浏览器里实时合成（WebAudio），无任何音频文件。
 * 音乐：16 步音序器，BPM = 踏频（转/分）× 1.4，踏得越快节奏越快；夜晚自动变成柔和氛围编曲。
 */
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// 一段明快的海岸 I–V–vi–IV（C 大调），夜里换成 vi–IV–I–V 的 maj7 色彩
const PROG_DAY = [[48, [60, 64, 67, 72]], [43, [59, 62, 67, 71]], [45, [60, 64, 69, 72]], [41, [60, 65, 69, 72]]];
const PROG_NIGHT = [[45, [64, 67, 71, 72]], [41, [64, 65, 69, 72]], [48, [64, 67, 71, 74]], [43, [62, 66, 67, 71]]];

export class AudioEngine {
  constructor() { this.ctx = null; this.muted = false; this.step = 0; this.bpm = 90; this.cadence = 0; this.night = 0; this.speed = 0; }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain(); this.master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.music = ctx.createGain(); this.music.gain.value = 0.5; this.music.connect(this.master);
    this.sfx = ctx.createGain(); this.sfx.gain.value = 0.8; this.sfx.connect(this.master);
    // 混响：程序生成的脉冲响应
    this.verb = ctx.createConvolver(); this.verb.buffer = this.impulse(2.8);
    this.verbIn = ctx.createGain(); this.verbIn.gain.value = 0.35;
    this.verbIn.connect(this.verb).connect(this.master);
    // 乒乓延迟
    this.delay = ctx.createDelay(1); this.delayFb = ctx.createGain(); this.delayFb.gain.value = 0.35;
    this.delayOut = ctx.createGain(); this.delayOut.gain.value = 0.3;
    this.delay.connect(this.delayFb).connect(this.delay); this.delay.connect(this.delayOut).connect(this.music);
    this.noiseBuf = this.makeNoise(2);
    this.ambient();
    this.nextTime = ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 25);
    document.addEventListener('visibilitychange', () => { if (!this.ctx) return; document.hidden ? this.ctx.suspend() : (!this.muted && this.ctx.resume()); });
  }

  setMuted(m) { this.muted = m; if (this.ctx) m ? this.ctx.suspend() : this.ctx.resume(); }

  impulse(sec) {
    const ctx = this.ctx, len = ctx.sampleRate * sec, b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
    return b;
  }
  makeNoise(sec) {
    const ctx = this.ctx, b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  noiseSrc() { const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true; return s; }

  ambient() {
    const ctx = this.ctx;
    // 风声：带通噪声，频率/音量随车速
    const w = this.noiseSrc(); this.windF = ctx.createBiquadFilter(); this.windF.type = 'bandpass'; this.windF.Q.value = 0.6;
    this.windG = ctx.createGain(); this.windG.gain.value = 0;
    w.connect(this.windF).connect(this.windG).connect(this.master); w.start();
    // 海浪：低通噪声 + 慢 LFO 涌动
    const o = this.noiseSrc(); const of = ctx.createBiquadFilter(); of.type = 'lowpass'; of.frequency.value = 500;
    this.oceanG = ctx.createGain(); this.oceanG.gain.value = 0.12;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.11; const lg = ctx.createGain(); lg.gain.value = 0.09;
    lfo.connect(lg).connect(this.oceanG.gain); lfo.start();
    const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.07; const lg2 = ctx.createGain(); lg2.gain.value = 300;
    lfo2.connect(lg2).connect(of.frequency); lfo2.start();
    o.connect(of).connect(this.oceanG).connect(this.master); o.start();
    this.ratchetT = 0; // 飞轮棘轮声（滑行时）
  }

  update(dt, { speed, cadence, night, coasting }) {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    this.speed = speed; this.cadence = cadence; this.night = night;
    const w = clamp(speed / 19, 0, 1);
    this.windG.gain.setTargetAtTime(0.02 + w * w * 0.22, now, 0.2);
    this.windF.frequency.setTargetAtTime(300 + w * 1400, now, 0.2);
    this.oceanG.gain.setTargetAtTime(0.1 + night * 0.06, now, 0.5);
    // 踏频 → BPM
    const target = cadence > 20 ? clamp(cadence * 1.4, 72, 168) : 72;
    this.bpm += (target - this.bpm) * Math.min(1, dt * 1.5);
    // 滑行棘轮
    if (coasting && speed > 1) {
      this.ratchetT -= dt;
      if (this.ratchetT <= 0) { this.ratchetT = clamp(0.5 / speed, 0.02, 0.15); this.click(now, 3200, 0.035); }
    }
  }

  schedule() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    while (this.nextTime < ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextTime);
      this.nextTime += 60 / this.bpm / 4;
      this.step = (this.step + 1) % 64;
    }
  }

  playStep(step, t) {
    const s16 = step % 16, bar = (step >> 4) % 4;
    const night = this.night, moving = this.cadence > 20;
    const prog = night > 0.5 ? PROG_NIGHT : PROG_DAY;
    const [root, chord] = prog[bar];
    const drums = moving ? 1 - night * 0.65 : 0;
    if (drums > 0.05) {
      if (s16 % 4 === 0) this.kick(t, 0.9 * drums);
      if (s16 === 4 || s16 === 12) this.snare(t, 0.35 * drums);
      if (s16 % 2 === 1) this.hat(t, (s16 % 4 === 3 ? 0.12 : 0.07) * drums);
      if (this.bpm > 130 && s16 % 2 === 0) this.hat(t, 0.04 * drums);
    }
    // 贝斯
    const bassPat = { 0: 0, 3: 0, 6: 12, 8: 0, 10: 7, 14: 12 };
    if (moving && bassPat[s16] !== undefined) this.bass(t, mtof(root - 12 + bassPat[s16]), 0.32 * (1 - night * 0.4));
    // 拨弦琶音（带延迟）
    const arp = night > 0.5 ? s16 % 4 === 0 : s16 % 2 === 0;
    if (arp) {
      const order = [0, 1, 2, 3, 2, 1, 3, 1];
      const n = chord[order[(s16 >> 1) % 8]] + (s16 >= 8 && night < 0.5 ? 12 : 0);
      this.pluck(t, mtof(n), moving ? 0.12 : 0.08);
    }
    // 铺底和弦
    if (s16 === 0) for (const n of chord) this.pad(t, mtof(n - 12), 60 / this.bpm * 4, 0.05 + night * 0.04);
  }

  env(g, t, a, peak, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }

  kick(t, v) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    this.env(g, t, 0.003, v, 0.28); o.connect(g).connect(this.music); o.start(t); o.stop(t + 0.32);
  }
  snare(t, v) {
    const ctx = this.ctx, n = this.noiseSrc(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'highpass'; f.frequency.value = 1500; this.env(g, t, 0.002, v, 0.16);
    n.connect(f).connect(g); g.connect(this.music); g.connect(this.verbIn); n.start(t); n.stop(t + 0.2);
    const o = ctx.createOscillator(), og = ctx.createGain(); o.frequency.value = 190; this.env(og, t, 0.002, v * 0.5, 0.08);
    o.connect(og).connect(this.music); o.start(t); o.stop(t + 0.1);
  }
  hat(t, v) {
    const ctx = this.ctx, n = this.noiseSrc(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'highpass'; f.frequency.value = 7000; this.env(g, t, 0.001, v, 0.04);
    n.connect(f).connect(g).connect(this.music); n.start(t); n.stop(t + 0.06);
  }
  bass(t, freq, v) {
    const ctx = this.ctx, o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = freq;
    f.type = 'lowpass'; f.Q.value = 6; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(160, t + 0.2);
    this.env(g, t, 0.005, v, 0.22); o.connect(f).connect(g).connect(this.music); o.start(t); o.stop(t + 0.3);
  }
  pluck(t, freq, v) {
    const ctx = this.ctx, o = ctx.createOscillator(), o2 = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'triangle'; o.frequency.value = freq; o2.type = 'square'; o2.frequency.value = freq * 1.003;
    const g2 = ctx.createGain(); g2.gain.value = 0.25; o2.connect(g2).connect(f);
    f.type = 'lowpass'; f.frequency.setValueAtTime(4000, t); f.frequency.exponentialRampToValueAtTime(600, t + 0.3);
    this.env(g, t, 0.003, v, 0.45);
    o.connect(f).connect(g); g.connect(this.music); g.connect(this.delay); g.connect(this.verbIn);
    this.delay.delayTime.setValueAtTime(60 / this.bpm * 0.75, t);
    o.start(t); o2.start(t); o.stop(t + 0.5); o2.stop(t + 0.5);
  }
  pad(t, freq, dur, v) {
    const ctx = this.ctx, g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 900 + (1 - this.night) * 800;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + dur * 0.3); g.gain.linearRampToValueAtTime(0.0001, t + dur * 1.05);
    for (const d of [-7, 7]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq; o.detune.value = d;
      o.connect(f); o.start(t); o.stop(t + dur * 1.1);
    }
    f.connect(g); g.connect(this.music); g.connect(this.verbIn);
  }
  click(t, freq, v) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square'; o.frequency.value = freq; this.env(g, t, 0.001, v, 0.012);
    o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.02);
  }

  // —— 音效
  tone(freq, dur, v, type = 'sine', when = 0, slide) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + when, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    this.env(g, t, 0.005, v, dur); o.connect(g); g.connect(this.sfx); g.connect(this.verbIn); o.start(t); o.stop(t + dur + 0.05);
  }
  noiseHit(dur, v, type, f0, f1, when = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + when, n = this.noiseSrc(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    f.type = type; f.Q.value = 1.2; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    this.env(g, t, 0.01, v, dur); n.connect(f).connect(g).connect(this.sfx); n.start(t); n.stop(t + dur + 0.05);
  }
  catch(golden, combo) {
    const base = 72 + Math.min(combo, 12);
    const notes = golden ? [0, 4, 7, 12, 16, 19] : [0, 7, 12];
    notes.forEach((n, i) => this.tone(mtof(base + n), golden ? 0.35 : 0.2, golden ? 0.16 : 0.18, golden ? 'triangle' : 'sine', i * 0.05));
    this.tone(220, 0.12, 0.25, 'sine', 0.02, 70); // 吞咽 "咕嘟"
  }
  splash(v = 0.25) { this.noiseHit(0.5, v, 'bandpass', 2500, 400); }
  jump() { this.noiseHit(0.3, 0.2, 'bandpass', 400, 2400); this.tone(300, 0.15, 0.08, 'triangle', 0, 600); }
  land(v) { this.tone(110, 0.15, clamp(v * 0.06, 0.08, 0.4), 'sine', 0, 50); this.noiseHit(0.12, 0.15, 'lowpass', 1500, 200); }
  hit() {
    this.noiseHit(0.35, 0.5, 'lowpass', 3000, 200);
    this.tone(160, 0.3, 0.25, 'square', 0, 60);
    this.honk(0.06);
  }
  honk(when = 0) { // 鹈鹕叫
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + when, o = this.ctx.createOscillator(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    const lfo = this.ctx.createOscillator(), lg = this.ctx.createGain(); lfo.frequency.value = 28; lg.gain.value = 40;
    lfo.connect(lg).connect(o.frequency);
    o.type = 'sawtooth'; o.frequency.setValueAtTime(330, t); o.frequency.linearRampToValueAtTime(240, t + 0.3);
    f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 3;
    this.env(g, t, 0.02, 0.25, 0.32); o.connect(f).connect(g).connect(this.sfx);
    o.start(t); lfo.start(t); o.stop(t + 0.4); lfo.stop(t + 0.4);
  }
  flap() { this.noiseHit(0.12, 0.12, 'bandpass', 900, 300); }
  lane() { this.noiseHit(0.08, 0.05, 'highpass', 3000, 6000); }
  bell() { for (const [f, d] of [[2093, 0], [2637, 0.12]]) { this.tone(f, 0.9, 0.12, 'sine', d); this.tone(f * 2.76, 0.4, 0.03, 'sine', d); } }
  achievement() { [0, 4, 7, 11, 14].forEach((n, i) => this.tone(mtof(79 + n), 0.6, 0.1, 'triangle', i * 0.07)); }
}
