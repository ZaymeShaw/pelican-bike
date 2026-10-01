/** 键盘 + 触屏输入，统一成 {throttle, brake, left, right, jump, wings} 每帧快照 */
export class Input {
  constructor() {
    this.held = new Set();
    this.pressed = new Set();
    this.idle = 999;          // 距最后一次操作的秒数
    this.handlers = {};
    addEventListener('keydown', (e) => {
      if (e.target.closest && e.target.closest('input,textarea')) return;
      const k = e.code;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) e.preventDefault();
      if (!e.repeat) { this.pressed.add(k); this.handlers[k]?.(); }
      this.held.add(k); this.idle = 0;
    });
    addEventListener('keyup', (e) => this.held.delete(e.code));
    addEventListener('blur', () => this.held.clear());
  }
  on(code, fn) { this.handlers[code] = fn; }

  /** 触屏按钮：按下=held，按下瞬间=pressed */
  bindTouch(el, code) {
    const down = (e) => { e.preventDefault(); this.held.add(code); this.pressed.add(code); this.idle = 0; el.classList.add('on'); this.handlers[code]?.(); };
    const up = (e) => { e.preventDefault(); this.held.delete(code); el.classList.remove('on'); };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
  }

  frame(dt) {
    const h = (...c) => c.some(x => this.held.has(x));
    const p = (...c) => c.some(x => this.pressed.has(x));
    const snap = {
      throttle: h('KeyW', 'ArrowUp'), brake: h('KeyS', 'ArrowDown'),
      left: p('KeyA', 'ArrowLeft'), right: p('KeyD', 'ArrowRight'),
      jump: p('Space'), wings: h('KeyT'),
    };
    this.pressed.clear();
    if (this.held.size) this.idle = 0; else this.idle += dt;
    return snap;
  }
}
