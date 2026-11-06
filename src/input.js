// Keyboard/mouse + touch controls.
import { initAudio } from './audio.js';

export class Input {
  constructor(ui) {
    this.ui = ui;
    this.forward = 0; this.strafe = 0;
    this.jump = false; this.sneak = false; this.sprint = false; this.autoSprint = true;
    this.primary = false; this.secondary = false;
    this.lookDX = 0; this.lookDY = 0;
    this._use = false; this._tap = false; this._fly = false;
    this.keys = new Set();
    this.touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    this.sneakToggle = false; this.lastJumpTap = 0;
    this.joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.look = new Map();
    this.btnJump = false; this.btnAttack = false;
    this.bindKeyboard();
    this.bindTouch();
  }

  get sens() { return (this.ui.settings.sensitivity || 1); }

  poll() {
    if (this.touch && this.joy.id !== null) {
      const R = 55;
      let dx = (this.joy.x - this.joy.ox) / R, dy = (this.joy.y - this.joy.oy) / R;
      const l = Math.hypot(dx, dy);
      if (l > 1) { dx /= l; dy /= l; }
      this.forward = -dy; this.strafe = dx;
      if (Math.abs(this.forward) < 0.12) this.forward = 0;
      if (Math.abs(this.strafe) < 0.12) this.strafe = 0;
    } else if (this.keys.size || !this.touch) {
      const k = this.keys;
      this.forward = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
      this.strafe = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    } else { this.forward = 0; this.strafe = 0; }
    this.jump = this.keys.has('Space') || this.btnJump;
    this.sneak = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.sneakToggle;
    this.sprint = this.keys.has('ControlLeft') || this.keys.has('KeyR');
    this.autoSprint = this.touch;
    let held = this.btnAttack || this.mouseDown;
    for (const t of this.look.values()) if (t.holding) held = true;
    this.primary = held;
  }
  consumeUse() { const u = this._use; this._use = false; return u; }
  consumeTap() { const u = this._tap; this._tap = false; return u; }
  consumeFlyToggle() { const u = this._fly; this._fly = false; return u; }

  bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (e.target && e.target.tagName === 'INPUT') return;
      const ui = this.ui;
      if (e.code === 'Escape') { if (ui.screenOpen) ui.closeScreen(); return; }
      if (e.code === 'KeyE') { if (ui.screenOpen) ui.closeScreen(); else if (ui.game && !ui.paused) ui.openInventory(); e.preventDefault(); return; }
      if (ui.screenOpen || !ui.game) return;
      if (e.code === 'Space' && !e.repeat) {
        const now = performance.now();
        if (now - this.lastJumpTap < 300) this._fly = true;
        this.lastJumpTap = now;
      }
      if (e.code.startsWith('Digit')) { const n = +e.code.slice(5); if (n >= 1 && n <= 9) ui.selectSlot(n - 1); }
      if (e.code === 'KeyQ') ui.game.dropHeld(e.ctrlKey);
      if (e.code === 'F3') { ui.toggleDebug(); e.preventDefault(); }
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouseDown = false; });
    const canvasEvents = (el) => {
      el.addEventListener('mousedown', (e) => {
        if (this.touch && e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) return;
        initAudio();
        if (document.pointerLockElement !== el) { if (!this.ui.screenOpen && !this.ui.paused) el.requestPointerLock && el.requestPointerLock(); return; }
        if (e.button === 0) this.mouseDown = true;
        if (e.button === 2) { this._use = true; this.secondary = true; }
      });
      window.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouseDown = false; if (e.button === 2) this.secondary = false; });
      window.addEventListener('mousemove', (e) => {
        if (document.pointerLockElement === el) {
          this.lookDX += e.movementX * 0.0025 * this.sens;
          this.lookDY += e.movementY * 0.0025 * this.sens;
        }
      });
      el.addEventListener('contextmenu', (e) => e.preventDefault());
      window.addEventListener('wheel', (e) => {
        if (!this.ui.game || this.ui.screenOpen) return;
        const p = this.ui.game.player;
        this.ui.selectSlot((p.sel + (e.deltaY > 0 ? 1 : 8)) % 9);
      });
      document.addEventListener('pointerlockchange', () => {
        if (!document.pointerLockElement && this.ui.game && !this.ui.screenOpen && !this.ui.paused && !this.touch) this.ui.pause();
      });
    };
    this.bindCanvas = canvasEvents;
  }

  bindTouch() {
    const zone = document.getElementById('touchzone');
    const joyBase = document.getElementById('joy');
    const joyKnob = document.getElementById('joyknob');
    if (!zone) return;
    const isLeft = (x, y) => x < window.innerWidth * 0.4 && y > window.innerHeight * 0.35;
    zone.addEventListener('touchstart', (e) => {
      initAudio();
      for (const t of e.changedTouches) {
        if (this.joy.id === null && isLeft(t.clientX, t.clientY)) {
          this.joy.id = t.identifier; this.joy.ox = t.clientX; this.joy.oy = t.clientY; this.joy.x = t.clientX; this.joy.y = t.clientY;
          joyBase.style.left = t.clientX + 'px'; joyBase.style.top = t.clientY + 'px'; joyBase.classList.add('active');
          joyKnob.style.transform = 'translate(-50%,-50%)';
        } else {
          const lt = { x: t.clientX, y: t.clientY, sx: t.clientX, sy: t.clientY, t0: performance.now(), moved: false, holding: false };
          lt.timer = setTimeout(() => { if (!lt.moved) lt.holding = true; }, 260);
          this.look.set(t.identifier, lt);
        }
      }
      e.preventDefault();
    }, { passive: false });
    zone.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.joy.id) {
          this.joy.x = t.clientX; this.joy.y = t.clientY;
          let dx = t.clientX - this.joy.ox, dy = t.clientY - this.joy.oy;
          const l = Math.hypot(dx, dy);
          if (l > 55) { dx = dx / l * 55; dy = dy / l * 55; }
          joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
          continue;
        }
        const lt = this.look.get(t.identifier);
        if (!lt) continue;
        const dx = t.clientX - lt.x, dy = t.clientY - lt.y;
        lt.x = t.clientX; lt.y = t.clientY;
        if (Math.hypot(t.clientX - lt.sx, t.clientY - lt.sy) > 14) lt.moved = true;
        this.lookDX += dx * 0.0065 * this.sens;
        this.lookDY += dy * 0.0065 * this.sens;
      }
      e.preventDefault();
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.joy.id) {
          this.joy.id = null; joyBase.classList.remove('active');
          joyKnob.style.transform = 'translate(-50%,-50%)';
          continue;
        }
        const lt = this.look.get(t.identifier);
        if (!lt) continue;
        clearTimeout(lt.timer);
        if (!lt.moved && !lt.holding && performance.now() - lt.t0 < 260) this._tap = true;
        this.look.delete(t.identifier);
      }
      e.preventDefault();
    };
    zone.addEventListener('touchend', end, { passive: false });
    zone.addEventListener('touchcancel', end, { passive: false });

    // buttons
    const hold = (id, on, off) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('touchstart', (e) => { initAudio(); on(); el.classList.add('down'); e.preventDefault(); e.stopPropagation(); }, { passive: false });
      const up = (e) => { off && off(); el.classList.remove('down'); e.preventDefault(); e.stopPropagation(); };
      el.addEventListener('touchend', up, { passive: false });
      el.addEventListener('touchcancel', up, { passive: false });
      el.addEventListener('mousedown', (e) => { on(); e.preventDefault(); });
      el.addEventListener('mouseup', (e) => { off && off(); e.preventDefault(); });
    };
    hold('btn-jump', () => {
      this.btnJump = true;
      const now = performance.now();
      if (now - this.lastJumpTap < 300) this._fly = true;
      this.lastJumpTap = now;
    }, () => { this.btnJump = false; });
    hold('btn-sneak', () => { this.sneakToggle = !this.sneakToggle; document.getElementById('btn-sneak').classList.toggle('on', this.sneakToggle); });
    hold('btn-attack', () => { this.btnAttack = true; }, () => { this.btnAttack = false; });
    hold('btn-use', () => { this._use = true; this.secondary = true; }, () => { this.secondary = false; });
    hold('btn-inv', () => this.ui.openInventory());
    hold('btn-pause', () => this.ui.pause());
    hold('btn-drop', () => this.ui.game && this.ui.game.dropHeld(false));
  }
}
