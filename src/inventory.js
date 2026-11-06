// Item stacks and inventories.
import { ITEMS, maxStack } from './blocks.js';

export function stack(id, count = 1, dmg = 0) { return { id, count, dmg }; }
export function cloneStack(s) { return s ? { id: s.id, count: s.count, dmg: s.dmg || 0 } : null; }
export function sameItem(a, b) { return a && b && a.id === b.id && !ITEMS[a.id].durability; }

export class Inventory {
  constructor(size) { this.slots = new Array(size).fill(null); }
  // add stack; returns leftover count
  add(id, count, dmg = 0, order) {
    const ms = maxStack(id);
    const idxs = order || this.slots.map((_, i) => i);
    if (!ITEMS[id].durability) {
      for (const i of idxs) {
        const s = this.slots[i];
        if (s && s.id === id && s.count < ms) {
          const n = Math.min(count, ms - s.count);
          s.count += n; count -= n;
          if (!count) return 0;
        }
      }
    }
    for (const i of idxs) {
      if (!this.slots[i]) {
        const n = Math.min(count, ms);
        this.slots[i] = stack(id, n, dmg);
        count -= n;
        if (!count) return 0;
      }
    }
    return count;
  }
  count(id) { return this.slots.reduce((a, s) => a + (s && s.id === id ? s.count : 0), 0); }
  remove(id, n) {
    for (let i = 0; i < this.slots.length && n > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id) { const k = Math.min(n, s.count); s.count -= k; n -= k; if (!s.count) this.slots[i] = null; }
    }
    return n === 0;
  }
  toJSON() { return this.slots.map((s) => (s ? [s.id, s.count, s.dmg || 0] : 0)); }
  load(arr) { if (!arr) return; arr.forEach((v, i) => { if (i < this.slots.length) this.slots[i] = v ? stack(v[0], v[1], v[2]) : null; }); }
}

// player inventory: 0..8 hotbar, 9..35 main
export const HOTBAR_ORDER = [...Array(36).keys()];
