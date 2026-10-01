const KEY = 'pelican-bike-achievements-v1';

/** 14 个成就：test(stats) 返回 true 即解锁 */
export const ACHIEVEMENTS = [
  { id: 'first', icon: '🐟', name: '开张大吉', desc: '抓到第一条鱼', test: s => s.fish >= 1 },
  { id: 'fish10', icon: '🧺', name: '车筐满满', desc: '累计抓到 10 条鱼', test: s => s.fish >= 10 },
  { id: 'fish50', icon: '🦩', name: '海岸渔王', desc: '累计抓到 50 条鱼', test: s => s.fish >= 50 },
  { id: 'gold', icon: '✨', name: '金光一闪', desc: '抓到一条金鱼', test: s => s.golden >= 1 },
  { id: 'combo5', icon: '🔥', name: '连击 ×5', desc: '连续抓到 5 条不失手', test: s => s.bestCombo >= 5 },
  { id: 'combo12', icon: '⚡', name: '停不下来', desc: '连续抓到 12 条', test: s => s.bestCombo >= 12 },
  { id: 'speed', icon: '💨', name: '风驰电掣', desc: '时速达到 60 km/h', test: s => s.maxSpeed * 3.6 >= 60 },
  { id: 'km1', icon: '🛣️', name: '一公里', desc: '骑行 1 km', test: s => s.ride >= 1000 },
  { id: 'km5', icon: '🏁', name: '海岸长征', desc: '骑行 5 km', test: s => s.ride >= 5000 },
  { id: 'air', icon: '🪽', name: '空中接鱼', desc: '跳在空中时抓到鱼', test: s => s.airCatch >= 1 },
  { id: 'wheelie', icon: '🤸', name: '独轮艺人', desc: '展翅翘前轮持续 3 秒', test: s => s.bestWheelie >= 3 },
  { id: 'night', icon: '🌙', name: '星夜骑士', desc: '骑进星空月夜', test: s => s.night > 0.9 },
  { id: 'director', icon: '🎬', name: '导演', desc: '用过全部 5 种镜头', test: s => s.cams >= 5 },
  { id: 'auto', icon: '🤖', name: '放手也行', desc: '自动驾驶抓到 5 条鱼', test: s => s.autoFish >= 5 },
];

export class Achievements {
  constructor(onUnlock) {
    this.onUnlock = onUnlock;
    try { this.got = new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { this.got = new Set(); }
  }
  check(stats) {
    for (const a of ACHIEVEMENTS) {
      if (!this.got.has(a.id) && a.test(stats)) {
        this.got.add(a.id);
        try { localStorage.setItem(KEY, JSON.stringify([...this.got])); } catch { /* 隐私模式下忽略 */ }
        this.onUnlock(a);
      }
    }
  }
  reset() { this.got.clear(); try { localStorage.removeItem(KEY); } catch { /* ignore */ } }
}
