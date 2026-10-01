/** 按帧率自适应画质：每 2 秒评估一次平均帧时间，带迟滞地升降档 */
export const LEVELS = [
  { name: '低', pr: 0.75, shadow: 0, bloom: false, particles: 0.3 },
  { name: '中', pr: 1.0, shadow: 1024, bloom: false, particles: 0.6 },
  { name: '高', pr: 1.5, shadow: 2048, bloom: true, particles: 1 },
  { name: '极致', pr: 2.0, shadow: 2048, bloom: true, particles: 1 },
];

export class Quality {
  constructor(apply) {
    this.apply = apply;
    this.auto = true;
    const mobile = matchMedia('(pointer: coarse)').matches;
    this.level = mobile ? 1 : 2;
    this.acc = 0; this.frames = 0; this.cool = 3; this.goodStreak = 0;
    this.fps = 60;
  }
  get cur() { return LEVELS[this.level]; }
  set(l) { this.level = Math.max(0, Math.min(LEVELS.length - 1, l)); this.apply(this.cur); this.cool = 3; }
  cycle() {
    // 自动 → 低 → 中 → 高 → 极致 → 自动
    if (this.auto) { this.auto = false; this.set(0); }
    else if (this.level === LEVELS.length - 1) { this.auto = true; }
    else this.set(this.level + 1);
  }
  sample(rawDt) {
    this.acc += rawDt; this.frames++;
    if (this.acc < 2) return;
    this.fps = this.frames / this.acc;
    this.acc = 0; this.frames = 0;
    if (!this.auto) return;
    if (this.cool > 0) { this.cool -= 2; return; }
    const maxPr = Math.min(window.devicePixelRatio || 1, 2);
    if (this.fps < 45 && this.level > 0) { this.set(this.level - 1); this.goodStreak = 0; }
    else if (this.fps > 58) {
      this.goodStreak++;
      const next = LEVELS[this.level + 1];
      if (this.goodStreak >= 3 && next && next.pr <= maxPr + 0.01) { this.set(this.level + 1); this.goodStreak = 0; }
    } else this.goodStreak = 0;
  }
}
