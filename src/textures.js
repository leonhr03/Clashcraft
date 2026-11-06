// Procedurally painted 16x16 pixel-art textures (all original), packed into one atlas.
import { mulberry32, hashString } from './noise.js';
import { BLOCKS, ITEMS, TIERS } from './blocks.js';

export const TS = 16;          // tile size
export const ATLAS_COLS = 32;  // tiles per row
export const ATLAS_PX = TS * ATLAS_COLS;

const tiles = new Map(); // name -> index
let atlasCanvas = null;

// ---------- color helpers ----------
function hex(h) {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}
function shade(c, f) { return [clamp(c[0] * f), clamp(c[1] * f), clamp(c[2] * f), c[3]]; }
function mix(a, b, t) { return [clamp(a[0] + (b[0] - a[0]) * t), clamp(a[1] + (b[1] - a[1]) * t), clamp(a[2] + (b[2] - a[2]) * t), clamp(a[3] + (b[3] - a[3]) * t)]; }
function clamp(v) { return Math.max(0, Math.min(255, Math.round(v))); }
const T = [0, 0, 0, 0];

class Px {
  constructor(name) {
    this.d = new Uint8ClampedArray(TS * TS * 4);
    this.rnd = mulberry32(hashString(name));
  }
  set(x, y, c) {
    if (x < 0 || y < 0 || x >= TS || y >= TS) return;
    const i = ((y | 0) * TS + (x | 0)) * 4;
    this.d[i] = c[0]; this.d[i + 1] = c[1]; this.d[i + 2] = c[2]; this.d[i + 3] = c[3] === undefined ? 255 : c[3];
  }
  get(x, y) {
    x = ((x % TS) + TS) % TS; y = ((y % TS) + TS) % TS;
    const i = (y * TS + x) * 4;
    return [this.d[i], this.d[i + 1], this.d[i + 2], this.d[i + 3]];
  }
  alpha(x, y) { if (x < 0 || y < 0 || x >= TS || y >= TS) return 0; return this.d[(y * TS + x) * 4 + 3]; }
  r() { return this.rnd(); }
  // fill with base color & random brightness variation
  noise(base, v = 0.12, alpha = 255) {
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
      const f = 1 + (this.r() * 2 - 1) * v;
      const c = shade(base, f); c[3] = alpha;
      this.set(x, y, c);
    }
    return this;
  }
  specks(color, count, size = 1) {
    for (let i = 0; i < count; i++) {
      const x = Math.floor(this.r() * TS), y = Math.floor(this.r() * TS);
      for (let a = 0; a < size; a++) for (let b = 0; b < size; b++) this.set((x + a) % TS, (y + b) % TS, shade(color, 0.9 + this.r() * 0.2));
    }
    return this;
  }
  blobs(colors, count, rmin, rmax) {
    for (let i = 0; i < count; i++) {
      const cx = this.r() * TS, cy = this.r() * TS, rr = rmin + this.r() * (rmax - rmin);
      const col = colors[Math.floor(this.r() * colors.length)];
      for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) {
        if (x * x + y * y <= rr * rr) {
          const px = Math.floor(cx + x), py = Math.floor(cy + y);
          this.set(((px % TS) + TS) % TS, ((py % TS) + TS) % TS, shade(col, 0.92 + this.r() * 0.16));
        }
      }
    }
    return this;
  }
  rect(x0, y0, w, h, c, v = 0) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, v ? shade(c, 1 + (this.r() * 2 - 1) * v) : c);
    return this;
  }
  border(c, w = 1) {
    for (let i = 0; i < TS; i++) for (let k = 0; k < w; k++) {
      this.set(i, k, c); this.set(i, TS - 1 - k, c); this.set(k, i, c); this.set(TS - 1 - k, i, c);
    }
    return this;
  }
  clear() { this.d.fill(0); return this; }
  // ore clusters on top of existing texture
  ore(color, dark, n = 5) {
    for (let i = 0; i < n; i++) {
      const cx = 2 + Math.floor(this.r() * 12), cy = 2 + Math.floor(this.r() * 12);
      const pts = [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [0, -1]];
      for (const [dx, dy] of pts) {
        if (this.r() < 0.75) {
          this.set(cx + dx, cy + dy, shade(color, 0.85 + this.r() * 0.3));
          if (this.r() < 0.4) this.set(cx + dx + 1, cy + dy + 1, dark);
        }
      }
    }
    return this;
  }
  // voronoi stone pattern for cobblestone-like blocks
  cells(n, baseCols, line, jitter = 0.18) {
    const pts = [];
    for (let i = 0; i < n; i++) pts.push([this.r() * TS, this.r() * TS, baseCols[Math.floor(this.r() * baseCols.length)]]);
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
      let d1 = 1e9, d2 = 1e9, c = null;
      for (const p of pts) {
        for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
          const dx = x + 0.5 - (p[0] + ox * TS), dy = y + 0.5 - (p[1] + oy * TS);
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < d1) { d2 = d1; d1 = d; c = p[2]; } else if (d < d2) d2 = d;
        }
      }
      if (d2 - d1 < 1.1) this.set(x, y, shade(line, 0.9 + this.r() * 0.2));
      else {
        const f = 1.12 - d1 * 0.05 + (this.r() * 2 - 1) * jitter * 0.5;
        this.set(x, y, shade(c, f));
      }
    }
    return this;
  }
  // automatic outline + bevel shading for sprites drawn on transparent background
  outline(darkF = 0.45) {
    const copy = new Uint8ClampedArray(this.d);
    const A = (x, y) => (x < 0 || y < 0 || x >= TS || y >= TS) ? 0 : copy[(y * TS + x) * 4 + 3];
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
      const i = (y * TS + x) * 4;
      if (copy[i + 3] === 0) continue;
      const c = [copy[i], copy[i + 1], copy[i + 2], 255];
      if (!A(x - 1, y) || !A(x, y - 1) || !A(x + 1, y) || !A(x, y + 1)) {
        // edge pixel: dark outline
        this.set(x, y, shade(c, darkF));
      } else if (!A(x - 1, y - 1) || !A(x - 2, y) || !A(x, y - 2)) {
        this.set(x, y, shade(c, 1.3));
      } else if (!A(x + 1, y + 1) || !A(x + 2, y) || !A(x, y + 2)) {
        this.set(x, y, shade(c, 0.78));
      }
    }
    return this;
  }
  // rasterize thick line segment
  line(x0, y0, x1, y1, t, c, v = 0.06) {
    const minX = Math.floor(Math.min(x0, x1) - t), maxX = Math.ceil(Math.max(x0, x1) + t);
    const minY = Math.floor(Math.min(y0, y1) - t), maxY = Math.ceil(Math.max(y0, y1) + t);
    const dx = x1 - x0, dy = y1 - y0, L = dx * dx + dy * dy || 1;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      let tt = ((px - x0) * dx + (py - y0) * dy) / L; tt = Math.max(0, Math.min(1, tt));
      const qx = x0 + tt * dx - px, qy = y0 + tt * dy - py;
      if (qx * qx + qy * qy <= (t / 2) * (t / 2)) this.set(x, y, shade(c, 1 + (this.r() * 2 - 1) * v));
    }
    return this;
  }
  poly(pts, c, v = 0.06) {
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
      const px = x + 0.5, py = y + 0.5;
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) this.set(x, y, shade(c, 1 + (this.r() * 2 - 1) * v));
    }
    return this;
  }
  circle(cx, cy, r, c, v = 0.06) {
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r * r) this.set(x, y, shade(c, 1 + (this.r() * 2 - 1) * v));
    }
    return this;
  }
  mask(rows, map) {
    rows.forEach((row, y) => {
      for (let x = 0; x < Math.min(16, row.length); x++) {
        const ch = row[x];
        if (map[ch]) this.set(x, y, shade(map[ch], 1 + (this.r() * 2 - 1) * 0.05));
      }
    });
    return this;
  }
}

// ---------- palettes ----------
const C = {
  stone: hex('#7d7d80'), stoneD: hex('#5f5f63'), stoneL: hex('#929296'),
  dirt: hex('#7a5638'), dirtD: hex('#5e3f27'), dirtL: hex('#91683f'),
  grass: hex('#5fa83a'), grassD: hex('#4a8a2c'), grassL: hex('#79c049'),
  oak: hex('#b08950'), oakD: hex('#7d5f32'), bark: hex('#5f4428'), barkD: hex('#3f2c19'),
  birch: hex('#d8d1b4'), birchP: hex('#c8b47a'), spruce: hex('#3c2a18'), spruceP: hex('#7a5732'),
  sand: hex('#ddd09a'), sandD: hex('#c4b47c'), water: hex('#2f6fd8'), lava: hex('#e8641a'),
  leaf: hex('#3f8a2a'), birchLeaf: hex('#6aa548'), spruceLeaf: hex('#2f5e33'),
  coal: hex('#262628'), iron: hex('#d9b08c'), gold: hex('#f6d23a'), diamond: hex('#4fe3dc'),
  copper: hex('#d17a4a'), lapis: hex('#2a4fbf'), snow: hex('#f2f6fb'), ice: hex('#9cc4f5'),
  white: hex('#ffffff'), black: hex('#141414'),
  wood: hex('#8c6a3c'), ironT: hex('#d8d8d8'), goldT: hex('#f2cc2e'), diamondT: hex('#45d9d1'), stoneT: hex('#8a8a8a'),
  leather: hex('#8b5a2b'),
};
const TIER_COL = { wooden: hex('#a47d46'), stone: hex('#8f8f8f'), iron: hex('#e1e1e1'), golden: hex('#f4cf3a'), diamond: hex('#4be0d6'), leather: hex('#9a6234') };

// ---------- block tile painters ----------
const P = {};
P.stone = (p) => { p.noise(C.stone, 0.06).blobs([C.stoneD, C.stoneL], 9, 0.6, 1.6); };
P.cobblestone = (p) => p.cells(9, [C.stone, C.stoneL, hex('#6e6e72')], hex('#3e3e42'));
P.mossy_cobblestone = (p) => { P.cobblestone(p); p.blobs([hex('#4f7a2e'), hex('#5f8f37')], 9, 0.8, 1.8); };
P.dirt = (p) => p.noise(C.dirt, 0.1).specks(C.dirtD, 18).specks(C.dirtL, 10).specks(hex('#8f8f8f'), 3);
P.grass_top = (p) => p.noise(C.grass, 0.12).specks(C.grassD, 30).specks(C.grassL, 20);
P.grass_side = (p) => {
  P.dirt(p);
  for (let x = 0; x < TS; x++) {
    const h = 3 + Math.floor(p.r() * 3) + (x % 3 === 0 ? 1 : 0);
    for (let y = 0; y < h; y++) p.set(x, y, shade(y === h - 1 ? C.grassD : C.grass, 0.9 + p.r() * 0.2));
  }
};
P.snowy_grass_side = (p) => {
  P.dirt(p);
  for (let x = 0; x < TS; x++) {
    const h = 3 + Math.floor(p.r() * 3);
    for (let y = 0; y < h; y++) p.set(x, y, shade(C.snow, 0.92 + p.r() * 0.08));
  }
};
P.snow = (p) => p.noise(C.snow, 0.03).specks(hex('#dfe8f2'), 14);
P.ice = (p) => { p.noise(C.ice, 0.05); for (let i = 0; i < 4; i++) { const x = Math.floor(p.r() * 12); p.line(x, 2 + p.r() * 4, x + 4, 6 + p.r() * 8, 1, hex('#d8ecff')); } };
P.bedrock = (p) => p.noise(hex('#4a4a4a'), 0.15).blobs([hex('#2a2a2a'), hex('#6a6a6a'), hex('#1d1d1d')], 14, 0.8, 2);
P.sand = (p) => p.noise(C.sand, 0.06).specks(C.sandD, 22).specks(hex('#eee2b0'), 10);
P.gravel = (p) => p.cells(14, [hex('#8a8380'), hex('#6f6865'), hex('#9a948f'), hex('#5e5a58')], hex('#4a4644'), 0.3);
P.sandstone = (p) => { p.noise(hex('#d6c88d'), 0.04); for (const y of [3, 4, 9, 13]) p.rect(0, y, 16, 1, hex('#c3b278'), 0.05); p.rect(0, 15, 16, 1, hex('#b3a26a')); };
P.sandstone_top = (p) => p.noise(hex('#dccf96'), 0.05).specks(hex('#c8b97e'), 14);
function planks(p, base) {
  p.noise(base, 0.05);
  for (let row = 0; row < 4; row++) {
    const y0 = row * 4;
    p.rect(0, y0 + 3, 16, 1, shade(base, 0.62));
    const off = row % 2 ? 4 : 11;
    p.rect(off, y0, 1, 3, shade(base, 0.7));
    for (let k = 0; k < 3; k++) { const x = Math.floor(p.r() * 14); p.rect(x, y0 + Math.floor(p.r() * 3), 2 + Math.floor(p.r() * 3), 1, shade(base, 0.86)); }
  }
}
P.oak_planks = (p) => planks(p, C.oak);
P.birch_planks = (p) => planks(p, C.birchP);
P.spruce_planks = (p) => planks(p, C.spruceP);
function logSide(p, base, dark) {
  for (let x = 0; x < TS; x++) {
    const f = 0.85 + p.r() * 0.3;
    for (let y = 0; y < TS; y++) p.set(x, y, shade(x % 4 === 0 || p.r() < 0.12 ? dark : base, f * (0.94 + p.r() * 0.12)));
  }
}
function logTop(p, inner, bark) {
  for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    if (d > 6.5) p.set(x, y, shade(bark, 0.9 + p.r() * 0.2));
    else p.set(x, y, shade(inner, (Math.floor(d) % 2 ? 0.86 : 1) * (0.95 + p.r() * 0.1)));
  }
}
P.oak_log = (p) => logSide(p, C.bark, C.barkD);
P.oak_log_top = (p) => logTop(p, C.oak, C.bark);
P.birch_log = (p) => {
  p.noise(C.birch, 0.04);
  for (let i = 0; i < 7; i++) { const x = Math.floor(p.r() * 13), y = Math.floor(p.r() * 16); p.rect(x, y, 2 + Math.floor(p.r() * 3), 1, hex('#2e2a26')); }
};
P.birch_log_top = (p) => logTop(p, hex('#d6c486'), C.birch);
P.spruce_log = (p) => logSide(p, C.spruce, hex('#24190e'));
P.spruce_log_top = (p) => logTop(p, C.spruceP, C.spruce);
function leaves(p, base) {
  for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
    const r = p.r();
    if (r < 0.14) p.set(x, y, T);
    else p.set(x, y, shade(base, r < 0.35 ? 0.72 : r > 0.88 ? 1.25 : 0.95 + p.r() * 0.1));
  }
}
P.oak_leaves = (p) => leaves(p, C.leaf);
P.birch_leaves = (p) => leaves(p, C.birchLeaf);
P.spruce_leaves = (p) => leaves(p, C.spruceLeaf);
P.glass = (p) => {
  p.clear();
  p.border(hex('#d7eef4'));
  for (let i = 0; i < 4; i++) p.set(3 + i, 3 + i, [255, 255, 255, 200]);
  p.set(4, 3, [255, 255, 255, 200]); p.set(11, 10, [230, 245, 250, 180]); p.set(12, 11, [230, 245, 250, 180]);
};
function oreTile(color, dark) { return (p) => { P.stone(p); p.ore(color, dark, 6); }; }
P.coal_ore = oreTile(hex('#1c1c1e'), hex('#000000'));
P.iron_ore = oreTile(C.iron, hex('#9b7552'));
P.gold_ore = oreTile(C.gold, hex('#b88f12'));
P.diamond_ore = oreTile(C.diamond, hex('#1f9993'));
P.copper_ore = oreTile(C.copper, hex('#4c9a7a'));
P.lapis_ore = oreTile(C.lapis, hex('#162b70'));
P.water = (p) => {
  for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
    const w = Math.sin((x + y * 0.5) * 0.8) * 0.06 + Math.sin(y * 1.3 - x * 0.4) * 0.05;
    const c = shade(C.water, 1 + w + p.r() * 0.05); c[3] = 175; p.set(x, y, c);
  }
};
P.lava = (p) => {
  for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
    const w = Math.sin(x * 0.9 + Math.cos(y * 0.7) * 2) * 0.5 + 0.5;
    p.set(x, y, mix(hex('#c8321a'), hex('#ffb12a'), w * 0.8 + p.r() * 0.2));
  }
};
P.cactus_side = (p) => {
  p.noise(hex('#4b8f2f'), 0.06);
  for (const x of [0, 15]) p.rect(x, 0, 1, 16, hex('#2f6620'));
  for (const x of [4, 11]) p.rect(x, 0, 1, 16, hex('#3a7726'));
  for (let i = 0; i < 6; i++) p.set(1 + Math.floor(p.r() * 14), Math.floor(p.r() * 16), hex('#e8e4b8'));
};
P.cactus_top = (p) => { p.noise(hex('#5aa23a'), 0.06); p.border(hex('#2f6620')); p.rect(6, 6, 4, 4, hex('#77ba4c')); };
P.crafting_top = (p) => {
  planks(p, C.oak);
  p.border(hex('#5d4223'));
  p.rect(1, 1, 14, 14, shade(C.oak, 0.9), 0.05);
  p.rect(1, 5, 14, 1, hex('#6e4f2a')); p.rect(1, 10, 14, 1, hex('#6e4f2a'));
  p.rect(5, 1, 1, 14, hex('#6e4f2a')); p.rect(10, 1, 1, 14, hex('#6e4f2a'));
};
P.crafting_side = (p) => {
  planks(p, C.oak);
  p.rect(0, 0, 16, 3, hex('#6e4f2a'), 0.05);
  // hanging saw + hammer
  p.line(3, 5, 3, 12, 1, hex('#5a3c1e')); p.rect(2, 9, 3, 4, C.ironT, 0.05);
  p.line(11, 5, 11, 13, 1, hex('#5a3c1e')); p.rect(9, 5, 5, 2, hex('#7a7a7a'), 0.05);
};
P.crafting_front = (p) => {
  planks(p, C.oak);
  p.rect(0, 0, 16, 3, hex('#6e4f2a'), 0.05);
  p.rect(3, 6, 10, 1, hex('#5a3c1e')); p.rect(4, 7, 1, 6, hex('#5a3c1e')); p.rect(11, 7, 1, 6, hex('#5a3c1e'));
  p.line(6, 8, 10, 12, 1, C.ironT);
};
function furnaceBase(p) { p.cells(10, [hex('#848488'), hex('#76767a')], hex('#4c4c50')); }
P.furnace_side = (p) => { furnaceBase(p); };
P.furnace_top = (p) => { p.noise(hex('#7a7a7e'), 0.06); p.border(hex('#56565a')); };
P.furnace_front = (p) => { furnaceBase(p); p.rect(3, 8, 10, 6, hex('#1e1e1e')); p.rect(3, 8, 10, 1, hex('#4a4a4a')); p.rect(4, 3, 8, 2, hex('#3a3a3a')); };
P.furnace_front_lit = (p) => {
  furnaceBase(p); p.rect(3, 8, 10, 6, hex('#2a1408')); p.rect(4, 3, 8, 2, hex('#3a3a3a'));
  for (let x = 4; x < 12; x++) { const h = 2 + Math.floor(p.r() * 4); for (let y = 0; y < h; y++) p.set(x, 13 - y, mix(hex('#ffd34a'), hex('#e0461a'), y / h)); }
};
P.chest_side = (p) => { planks(p, hex('#a8722f')); p.border(hex('#4a2c10')); p.rect(0, 5, 16, 1, hex('#4a2c10')); };
P.chest_top = (p) => { planks(p, hex('#a8722f')); p.border(hex('#4a2c10')); };
P.chest_front = (p) => { P.chest_side(p); p.rect(7, 4, 2, 4, hex('#c8c8c8')); p.set(7, 7, hex('#333')); };
P.torch = (p) => {
  p.clear();
  p.rect(7, 6, 2, 10, hex('#7a5530'), 0.08);
  p.rect(7, 4, 2, 2, hex('#ffdc5a')); p.set(7, 3, hex('#fff1a0')); p.set(8, 3, hex('#ffb22e'));
  p.set(6, 5, hex('#ff9a2a')); p.set(9, 5, hex('#ff9a2a'));
};
P.lantern = (p) => {
  p.clear();
  p.rect(7, 1, 2, 2, hex('#3a3a40'));
  p.rect(5, 3, 6, 1, hex('#2c2c32')); p.rect(4, 4, 8, 9, hex('#2c2c32'));
  p.rect(5, 5, 6, 7, hex('#ffcb52')); p.rect(6, 6, 4, 5, hex('#fff2b0'));
  p.rect(4, 13, 8, 1, hex('#2c2c32'));
};
P.glowing_crystal = (p) => {
  p.noise(hex('#7d5dbf'), 0.1);
  for (let i = 0; i < 6; i++) { const x = Math.floor(p.r() * 14), y = Math.floor(p.r() * 14); p.rect(x, y, 2, 2, hex('#f6e8ff')); p.set(x + 2, y + 1, hex('#c9a8ff')); }
  p.blobs([hex('#b892ff'), hex('#e0ccff')], 6, 0.6, 1.4);
};
function plant(p, f) { p.clear(); f(p); }
P.tall_grass = (p) => plant(p, () => {
  for (let i = 0; i < 9; i++) {
    const x = 1 + Math.floor(p.r() * 14), h = 5 + Math.floor(p.r() * 10), lean = (p.r() - 0.5) * 3;
    p.line(x, 16, x + lean, 16 - h, 1, p.r() < 0.5 ? C.grass : C.grassD, 0.1);
  }
});
function flower(p, petal, center) {
  plant(p, () => {
    p.line(8, 16, 8, 8, 1, hex('#3c7d25')); p.line(8, 13, 11, 11, 1, hex('#4c962e')); p.line(8, 12, 5, 10, 1, hex('#4c962e'));
    p.rect(6, 4, 4, 4, petal); p.set(5, 5, petal); p.set(10, 6, petal); p.set(7, 3, petal); p.set(8, 8, petal);
    p.rect(7, 5, 2, 2, center);
  });
}
P.poppy = (p) => flower(p, hex('#d8291f'), hex('#2b1a10'));
P.dandelion = (p) => flower(p, hex('#f5d222'), hex('#e09a12'));
P.blue_flower = (p) => flower(p, hex('#4f6fe8'), hex('#f0e070'));
P.dead_bush = (p) => plant(p, () => {
  const c = hex('#8a6233');
  p.line(8, 16, 8, 9, 1, c); p.line(8, 11, 4, 6, 1, c); p.line(8, 10, 12, 5, 1, c); p.line(5, 8, 3, 8, 1, c); p.line(11, 7, 13, 8, 1, c);
});
function sapling(p, leafC, trunk) { plant(p, () => { p.line(8, 16, 8, 9, 1.4, trunk); p.circle(8, 7, 3.6, leafC, 0.18); p.circle(5.5, 9, 2, leafC, 0.15); p.circle(10.5, 9, 2, leafC, 0.15); }); }
P.oak_sapling = (p) => sapling(p, C.leaf, C.bark);
P.birch_sapling = (p) => sapling(p, C.birchLeaf, C.birch);
P.spruce_sapling = (p) => plant(p, () => { p.line(8, 16, 8, 10, 1.4, C.spruce); p.poly([[8, 1], [13, 11], [3, 11]], C.spruceLeaf, 0.15); });
P.bricks = (p) => {
  p.noise(hex('#a0a09a'), 0.04);
  for (let row = 0; row < 4; row++) {
    const off = row % 2 ? 4 : 0;
    for (let b = -1; b < 3; b++) p.rect(b * 8 + off + 1, row * 4, 7, 3, hex('#9a4a37'), 0.1);
  }
};
P.stone_bricks = (p) => {
  p.noise(hex('#58585c'), 0.04);
  for (let row = 0; row < 2; row++) {
    const off = row % 2 ? 4 : 0;
    for (let b = -1; b < 2; b++) p.rect(b * 8 + off + 1, row * 8 + 1, 7, 6, C.stone, 0.06);
  }
};
P.smooth_stone = (p) => { p.noise(hex('#9d9da1'), 0.03); p.border(hex('#7c7c80')); };
P.bookshelf = (p) => {
  planks(p, C.oak);
  const cols = ['#8a2a22', '#2a4a8a', '#2a7a3a', '#c8a032', '#6a2a7a', '#cfcfcf'];
  for (const y0 of [1, 9]) {
    let x = 1;
    while (x < 15) {
      const w = 1 + Math.floor(p.r() * 2), h = 4 + Math.floor(p.r() * 3);
      p.rect(x, y0 + (6 - h), w, h, hex(cols[Math.floor(p.r() * cols.length)]), 0.05);
      x += w;
    }
    p.rect(0, y0 + 6, 16, 1, hex('#5d4223'));
  }
};
const WOOLCOL = { white: '#e9ecec', red: '#a12722', yellow: '#f8c627', blue: '#35399d', green: '#546d1b', black: '#151519', orange: '#f07613', purple: '#7a2aad' };
for (const [k, c] of Object.entries(WOOLCOL)) {
  P[k + '_wool'] = (p) => {
    p.noise(hex(c), 0.05);
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) if ((x + y * 3) % 5 === 0) p.set(x, y, shade(hex(c), 0.88));
  };
}
function metalBlock(p, c) {
  p.noise(c, 0.03);
  p.border(shade(c, 0.7)); p.rect(1, 1, 14, 1, shade(c, 1.2)); p.rect(1, 1, 1, 14, shade(c, 1.15));
  p.rect(2, 7, 12, 1, shade(c, 0.85)); p.rect(3, 3, 3, 1, shade(c, 1.3));
}
P.iron_block = (p) => metalBlock(p, hex('#d6d6d6'));
P.gold_block = (p) => metalBlock(p, hex('#f5cd30'));
P.diamond_block = (p) => metalBlock(p, hex('#5de6dc'));
P.copper_block = (p) => metalBlock(p, hex('#c76f45'));
P.coal_block = (p) => p.noise(hex('#1d1d1f'), 0.15).specks(hex('#3a3a3e'), 12);
P.lapis_block = (p) => { p.noise(hex('#1f42a8'), 0.08).specks(hex('#3a64d8'), 16).specks(hex('#c8a832'), 3); };
P.farmland = (p) => { p.noise(hex('#4f3420'), 0.08); for (let y = 1; y < 16; y += 4) p.rect(0, y, 16, 1, hex('#3a2616')); };
for (let s = 0; s < 4; s++) {
  P['wheat_' + s] = (p) => plant(p, () => {
    const h = 4 + s * 3.5;
    const col = s === 3 ? hex('#c9a53a') : s === 2 ? hex('#a0a83a') : hex('#4f9a2e');
    for (let x = 1; x < 16; x += 3) {
      p.line(x + 0.5, 16, x + 0.5 + (p.r() - 0.5), 16 - h, 1, col, 0.1);
      if (s === 3) p.rect(x, 16 - h - 1, 2, 3, hex('#e2c25a'));
    }
  });
}
P.clay = (p) => p.noise(hex('#a0a6b4'), 0.05).specks(hex('#8f95a3'), 12);
P.terracotta = (p) => p.noise(hex('#9a5a3e'), 0.05).specks(hex('#8a4e34'), 10);
P.obsidian = (p) => { p.noise(hex('#140f1f'), 0.1).blobs([hex('#2d1f45'), hex('#3c2a5c')], 8, 0.6, 1.6); };
P.bed_top = (p) => { p.noise(hex('#b02e26'), 0.05); p.rect(1, 1, 14, 5, hex('#eeeeee'), 0.03); p.rect(0, 0, 16, 1, hex('#7a5a30')); };
P.bed_side = (p) => { p.clear(); p.rect(0, 7, 16, 4, hex('#b02e26'), 0.05); p.rect(0, 7, 4, 2, hex('#eeeeee')); p.rect(0, 11, 16, 2, hex('#8a6a3a'), 0.05); p.rect(0, 13, 2, 3, hex('#6a4a2a')); p.rect(14, 13, 2, 3, hex('#6a4a2a')); };
P.granite = (p) => p.noise(hex('#9a6b57'), 0.06).specks(hex('#b88874'), 20).specks(hex('#6e4a3c'), 12);
P.diorite = (p) => p.noise(hex('#c4c4c6'), 0.05).specks(hex('#8a8a8c'), 22).specks(hex('#eeeeee'), 12);
P.andesite = (p) => p.noise(hex('#88888b'), 0.05).specks(hex('#6e6e70'), 20).specks(hex('#a2a2a4'), 14);
P.pumpkin_side = (p) => { p.noise(hex('#d6801a'), 0.05); for (const x of [0, 4, 8, 12]) p.rect(x, 0, 1, 16, hex('#a85e10')); };
P.pumpkin_top = (p) => { p.noise(hex('#d6801a'), 0.05); p.rect(7, 6, 2, 3, hex('#5a4a1a')); };
P.melon_side = (p) => { p.noise(hex('#6f9a26'), 0.06); for (let x = 1; x < 16; x += 4) p.rect(x, 0, 2, 16, hex('#a8c83a'), 0.05); };
P.melon_top = (p) => { p.noise(hex('#7aa52a'), 0.06); p.circle(8, 8, 3, hex('#a8c83a')); };
P.red_mushroom = (p) => plant(p, () => { p.rect(7, 9, 2, 6, hex('#e8e0d0')); p.poly([[3, 10], [8, 4], [13, 10]], hex('#c8281e')); p.set(6, 7, hex('#fff')); p.set(9, 8, hex('#fff')); });
P.brown_mushroom = (p) => plant(p, () => { p.rect(7, 10, 2, 5, hex('#e8e0d0')); p.circle(8, 10, 4, hex('#9a6b48')); p.rect(3, 10, 10, 1, T); p.rect(3, 11, 10, 4, T); p.rect(7, 10, 2, 5, hex('#e8e0d0')); });
P.sugar_cane = (p) => plant(p, () => {
  for (const x of [3, 8, 12]) { p.rect(x, 0, 2, 16, hex('#8bc35a'), 0.08); for (let y = 2; y < 16; y += 5) p.rect(x, y, 2, 1, hex('#5f9a36')); }
  p.line(5, 6, 7, 3, 1, hex('#6cab3e'));
});
P.hay_side = (p) => { p.noise(hex('#c4a43a'), 0.08); for (let i = 0; i < 20; i++) { const x = Math.floor(p.r() * 16); p.rect(x, Math.floor(p.r() * 12), 1, 3, hex('#a8862a')); } p.rect(0, 3, 16, 1, hex('#8a3a1e')); p.rect(0, 12, 16, 1, hex('#8a3a1e')); };
P.hay_top = (p) => { p.noise(hex('#c4a43a'), 0.1).specks(hex('#9a7a22'), 30); };
P.fence = (p) => { p.clear(); p.rect(2, 0, 3, 16, C.oak, 0.06); p.rect(11, 0, 3, 16, C.oak, 0.06); p.rect(0, 3, 16, 2, shade(C.oak, 0.9), 0.06); p.rect(0, 10, 16, 2, shade(C.oak, 0.9), 0.06); };
P.ladder = (p) => { p.clear(); p.rect(2, 0, 2, 16, C.oakD, 0.06); p.rect(12, 0, 2, 16, C.oakD, 0.06); for (let y = 1; y < 16; y += 4) p.rect(2, y, 12, 2, C.oak, 0.06); };
P.missing = (p) => { p.noise(hex('#ff00ff'), 0); p.rect(0, 0, 8, 8, C.black); p.rect(8, 8, 8, 8, C.black); };
for (let s = 0; s < 10; s++) {
  P['crack_' + s] = (p) => {
    p.clear();
    const rnd = mulberry32(77);
    const n = 2 + s * 2;
    for (let i = 0; i < n; i++) {
      let x = 8 + (rnd() - 0.5) * 6, y = 8 + (rnd() - 0.5) * 6;
      for (let k = 0; k < 3 + s; k++) {
        p.set(x, y, [20, 20, 20, 190]);
        x += Math.round((rnd() - 0.5) * 2.4); y += Math.round((rnd() - 0.5) * 2.4);
      }
    }
  };
}

// (late tiles appended below)
// ---------- item sprite painters ----------
const STICK = hex('#7a5530');
function handle(p, x1 = 10.5, y1 = 5.5) { p.line(2.5, 13.5, x1, y1, 1.7, STICK); }
const TOOL_HEAD = {
  pickaxe: (p, c) => { handle(p); p.line(4, 3.5, 7.5, 2.2, 2.2, c); p.line(7.5, 2.2, 11, 3, 2.2, c); p.line(11, 3, 13, 5, 2.2, c); p.line(13, 5, 13.8, 8.5, 2.2, c); p.line(13.8, 8.5, 12.6, 12, 2.2, c); },
  axe: (p, c) => { handle(p, 11.5, 4.5); p.poly([[6.5, 3], [9.5, 0.8], [13.5, 4.8], [11.5, 8], [9, 7]], c); },
  shovel: (p, c) => { handle(p, 9, 7); p.poly([[8.5, 5.5], [12, 1.8], [14.5, 4.2], [10.8, 8]], c); p.line(9.5, 6.5, 13, 3, 1.5, shade(c, 1.15)); },
  sword: (p, c) => { p.line(2.5, 13.5, 5, 11, 1.7, STICK); p.line(3.6, 8.8, 7.4, 12.6, 1.8, shade(c, 0.8)); p.line(5.5, 10.5, 13.8, 2.2, 2.6, c); p.line(6.8, 9.2, 13.2, 2.8, 0.9, shade(c, 1.25)); },
  hoe: (p, c) => { handle(p, 11, 5); p.line(11.5, 4.5, 7.5, 1.8, 2.2, c); p.line(7.5, 1.8, 6.6, 4, 2, c); },
};
const ARMOR_MASK = [
  ['................', '................', '.....######.....', '...##########...', '...##########...', '...##########...', '...###....###...', '...###....###...', '...##......##...'],
  ['..####....####..', '.#####....#####.', '.##############.', '.##############.', '.##############.', '..############..', '...##########...', '...##########...', '...##########...', '...##########...', '...##########...', '...##########...', '...##########...'],
  ['...##########...', '...##########...', '...##########...', '...####..####...', '...####..####...', '...###....###...', '...###....###...', '...###....###...', '...###....###...', '...###....###...', '...###....###...', '...###....###...'],
  ['................', '................', '................', '................', '................', '................', '...###....###...', '...###....###...', '...###....###...', '..####....####..', '.#####....#####.', '.#####....#####.'],
];
const IP = {};
IP.stick = (p) => p.line(3, 13, 13, 3, 1.7, STICK);
IP.coal = (p) => { p.circle(8, 8.5, 4.6, hex('#2a2a2c'), 0.2); p.specks(hex('#4a4a50'), 0); };
IP.charcoal = (p) => p.circle(8, 8.5, 4.6, hex('#3a2c22'), 0.2);
const lump = (c) => (p) => { p.circle(7.5, 9, 4.2, c, 0.12); p.circle(10, 7, 2.6, shade(c, 1.1), 0.1); };
IP.raw_iron = lump(hex('#c9a283')); IP.raw_gold = lump(hex('#e6bc2c')); IP.raw_copper = lump(hex('#c46a3c'));
const ingot = (c) => (p) => { p.poly([[2, 10], [5, 6], [14, 6], [11, 10]], c, 0.03); p.poly([[2, 10], [11, 10], [11, 12], [2, 12]], shade(c, 0.8), 0.03); p.poly([[11, 10], [14, 6], [14, 8], [11, 12]], shade(c, 0.65), 0.03); };
IP.iron_ingot = ingot(hex('#dedede')); IP.gold_ingot = ingot(hex('#f6d23a')); IP.copper_ingot = ingot(hex('#d57a4c')); IP.brick = ingot(hex('#a5523c'));
IP.diamond = (p) => { p.poly([[8, 2], [14, 7], [8, 14], [2, 7]], C.diamond, 0.05); p.poly([[8, 2], [11, 7], [8, 7], [5, 7]], shade(C.diamond, 1.3)); };
IP.lapis = (p) => { p.circle(6, 9, 3, C.lapis, 0.1); p.circle(10.5, 6, 2.5, shade(C.lapis, 1.15), 0.1); p.circle(10, 11, 2.2, C.lapis, 0.1); };
IP.flint = (p) => p.poly([[6, 2], [12, 6], [11, 13], [4, 12], [3, 6]], hex('#3c3c40'), 0.12);
IP.wheat_seeds = (p) => { for (const [x, y] of [[5, 6], [9, 5], [7, 9], [11, 9], [5, 12], [9, 12]]) { p.rect(x, y, 2, 2, hex('#5f9a36')); p.set(x + 1, y + 1, hex('#3a6a1e')); } };
IP.wheat = (p) => { for (let i = 0; i < 5; i++) p.line(3 + i, 14, 9 + i * 1.2, 3, 1, hex('#c9a53a'), 0.15); p.line(4, 10, 10, 10, 1.4, hex('#8a6a22')); };
IP.bread = (p) => { p.poly([[2, 11], [4, 6], [10, 4], [14, 7], [12, 12], [5, 13]], hex('#b8803a'), 0.06); p.line(6, 7, 7, 9, 1, hex('#e0b060')); p.line(9, 6, 10, 8, 1, hex('#e0b060')); };
const appleP = (c) => (p) => { p.circle(8, 9.5, 5, c, 0.06); p.line(8, 5, 9, 2, 1, hex('#5a3a1a')); p.line(9, 4, 12, 3, 1.4, hex('#4c962e')); p.set(5, 7, hex('#ffffff')); };
IP.apple = appleP(hex('#d8281e')); IP.golden_apple = appleP(hex('#f4cc2a'));
const meat = (c, fat) => (p) => { p.poly([[3, 6], [8, 3], [13, 5], [13, 11], [7, 13], [3, 10]], c, 0.08); p.line(4, 10, 12, 6, 1, fat); };
IP.porkchop = meat(hex('#e88a8a'), hex('#f8d8d8')); IP.cooked_porkchop = meat(hex('#9a5a2e'), hex('#d8b080'));
IP.beef = meat(hex('#c8302a'), hex('#f0c8c0')); IP.steak = meat(hex('#6a3a1e'), hex('#b07a4a'));
IP.mutton = meat(hex('#d84a3a'), hex('#f0e0d0')); IP.cooked_mutton = meat(hex('#8a4a26'), hex('#d0a070'));
const leg = (c) => (p) => { p.circle(9.5, 6.5, 4, c, 0.08); p.line(8, 8, 3.5, 12.5, 2, hex('#f0ead8')); p.circle(3, 13, 1.4, hex('#f0ead8')); };
IP.chicken = leg(hex('#f0b0a0')); IP.cooked_chicken = leg(hex('#b8743a'));
IP.rotten_flesh = meat(hex('#7a6a3a'), hex('#5a8a3a'));
IP.melon_slice = (p) => { p.poly([[2, 4], [14, 4], [8, 14]], hex('#e8463a'), 0.05); p.line(2, 4, 14, 4, 1.4, hex('#5a9a2a')); for (const [x, y] of [[6, 6], [9, 7], [8, 10]]) p.set(x, y, hex('#1a1a1a')); };
IP.pumpkin_pie = (p) => { p.poly([[2, 12], [8, 4], [14, 12]], hex('#d88a2a'), 0.05); p.line(2, 12, 14, 12, 1.6, hex('#b0702a')); };
IP.bone = (p) => { p.line(4, 12, 12, 4, 2, hex('#ece6d4')); for (const [x, y] of [[3, 11], [5, 13], [11, 3], [13, 5]]) p.circle(x, y, 1.6, hex('#ece6d4'), 0.03); };
IP.bone_meal = (p) => { p.poly([[3, 13], [8, 5], [13, 13]], hex('#f0ece0'), 0.06); };
IP.string = (p) => { let x = 3, y = 3; for (let i = 0; i < 6; i++) { const nx = x + 2, ny = y + (i % 2 ? -1 : 3); p.line(x, y, nx, ny, 1, hex('#f0f0f0')); x = nx; y = ny; } };
IP.feather = (p) => { p.poly([[3, 13], [6, 7], [12, 2], [13, 4], [9, 10]], hex('#f4f4f4'), 0.04); p.line(3, 14, 12, 3, 0.9, hex('#b0b0b0')); };
IP.leather = (p) => p.poly([[3, 4], [7, 3], [13, 4], [12, 9], [13, 13], [7, 12], [3, 13], [4, 8]], C.leather, 0.08);
IP.arrow = (p) => { p.line(3, 13, 12, 4, 1, hex('#8a6a3a')); p.poly([[10, 3], [14, 2], [13, 6]], hex('#9a9a9a')); p.line(2, 11, 4, 13, 1, hex('#f0f0f0')); p.line(3, 10, 5, 12, 1, hex('#f0f0f0')); };
IP.bow = (p) => { p.line(3, 2, 8, 3.5, 1.5, hex('#7a5530')); p.line(8, 3.5, 12.5, 8, 1.5, hex('#7a5530')); p.line(12.5, 8, 14, 13, 1.5, hex('#7a5530')); p.line(3, 2.5, 13.5, 13, 0.7, hex('#e0e0e0')); };
IP.paper = (p) => { p.poly([[3, 3], [13, 2], [13, 13], [3, 14]], hex('#f2f0e6'), 0.02); for (const y of [5, 8, 11]) p.line(5, y, 11, y - 0.3, 0.8, hex('#c8c4b4')); };
IP.book = (p) => { p.rect(3, 2, 10, 12, hex('#7a3a1e'), 0.05); p.rect(11, 3, 2, 11, hex('#f0ece0')); p.rect(5, 5, 4, 1, hex('#e0b040')); };
IP.sugar = (p) => p.poly([[3, 13], [8, 6], [13, 13]], hex('#fafafa'), 0.04);
IP.clay_ball = (p) => p.circle(8, 8.5, 4.4, hex('#a4aab8'), 0.06);
const bucket = (inner) => (p) => { p.poly([[3, 4], [13, 4], [11.5, 14], [4.5, 14]], hex('#b8b8b8'), 0.04); p.rect(4, 4, 8, 2, inner || hex('#3a3a3a')); p.line(3, 4, 8, 1, 0.8, hex('#8a8a8a')); p.line(8, 1, 13, 4, 0.8, hex('#8a8a8a')); };
IP.bucket = bucket(); IP.water_bucket = bucket(hex('#3a6ae0')); IP.lava_bucket = bucket(hex('#f07a20'));
IP.shears = (p) => { p.line(4, 12, 12, 4, 1.6, hex('#d0d0d0')); p.line(4, 4, 12, 12, 1.6, hex('#d0d0d0')); p.circle(4, 12, 1.8, hex('#7a3a2a')); p.circle(12, 12, 1.8, hex('#7a3a2a')); };
IP.egg = (p) => { p.circle(8, 9, 4.2, hex('#f2e2c0'), 0.04); p.circle(8, 6.5, 3, hex('#f2e2c0'), 0.04); };
const dye = (c) => (p) => { p.circle(8, 10, 4.4, c, 0.1); p.circle(8, 6.5, 2.6, shade(c, 1.15), 0.1); };
IP.red_dye = dye(hex('#c8281e')); IP.yellow_dye = dye(hex('#f0c820')); IP.green_dye = dye(hex('#4f7a1e')); IP.black_dye = dye(hex('#222226'));
IP.orange_dye = dye(hex('#f07a1a')); IP.purple_dye = dye(hex('#8a2ab8')); IP.blue_dye = dye(hex('#2a42c0'));


// ---- new biome / structure / dimension tiles ----
P.jungle_log = (p) => { logSide(p, hex('#5a4524'), hex('#3c2c14')); for (let i = 0; i < 6; i++) p.rect(Math.floor(p.r() * 15), Math.floor(p.r() * 15), 1, 2, hex('#4f6a2a')); };
P.jungle_log_top = (p) => logTop(p, hex('#b07a4e'), hex('#5a4524'));
P.jungle_leaves = (p) => leaves(p, hex('#2f9a20'));
P.jungle_planks = (p) => planks(p, hex('#a8704a'));
P.jungle_sapling = (p) => sapling(p, hex('#2f9a20'), hex('#5a4524'));
P.dirt_path_top = (p) => p.noise(hex('#9a7a44'), 0.07).specks(hex('#b0905a'), 18).specks(hex('#7a5e30'), 12);
P.dirt_path_side = (p) => { P.dirt(p); p.rect(0, 0, 16, 2, hex('#9a7a44'), 0.07); };
P.glutgestein = (p) => { p.noise(hex('#6e2a26'), 0.1).blobs([hex('#5a1e1c'), hex('#85342e')], 10, 0.6, 1.5).specks(hex('#9a4038'), 8); };
P.aschesand = (p) => { p.noise(hex('#4f3e33'), 0.12).specks(hex('#3a2c24'), 30).specks(hex('#6a5646'), 12); };
P.glutquarz_erz = (p) => { P.glutgestein(p); p.ore(hex('#ece4d8'), hex('#c8bca8'), 6); };
P.glutziegel = (p) => {
  p.noise(hex('#2a1214'), 0.05);
  for (let row = 0; row < 4; row++) { const off = row % 2 ? 4 : 0; for (let b = -1; b < 3; b++) p.rect(b * 8 + off + 1, row * 4, 7, 3, hex('#4a1c20'), 0.1); }
};
P.glutzaun = (p) => { p.clear(); p.rect(2, 0, 3, 16, hex('#4a1c20'), 0.08); p.rect(11, 0, 3, 16, hex('#4a1c20'), 0.08); p.rect(0, 3, 16, 2, hex('#3a1418'), 0.06); p.rect(0, 10, 16, 2, hex('#3a1418'), 0.06); };
P.glutpilz = (p) => plant(p, () => { p.rect(7, 9, 2, 6, hex('#5a2a1a')); p.circle(8, 8, 4, hex('#e0541e'), 0.15); p.set(6, 6, hex('#ffd060')); p.set(9, 7, hex('#ffd060')); p.rect(3, 10, 10, 1, T); p.rect(7, 9, 2, 6, hex('#5a2a1a')); });
P.leerenstein = (p) => p.noise(hex('#d9d6a2'), 0.06).specks(hex('#c2bd84'), 22).specks(hex('#ece9c0'), 10);
P.leerenstein_ziegel = (p) => {
  p.noise(hex('#b8b48a'), 0.04);
  for (let row = 0; row < 2; row++) { const off = row ? 4 : 0; for (let b = -1; b < 2; b++) p.rect(b * 8 + off + 1, row * 8 + 1, 7, 6, hex('#dedaa8'), 0.05); }
};
P.sternenziegel = (p) => { p.noise(hex('#9a7ab8'), 0.05); for (let y = 0; y < 16; y += 4) p.rect(0, y, 16, 1, hex('#7a5a9a')); for (let y = 0; y < 16; y += 4) p.rect((y / 4) % 2 ? 4 : 12, y, 1, 4, hex('#7a5a9a')); };
P.sternensaeule = (p) => { p.noise(hex('#a684c4'), 0.04); for (const x of [0, 5, 10, 15]) p.rect(x, 0, 1, 16, hex('#80609e')); };
P.sternensaeule_top = (p) => { p.noise(hex('#a684c4'), 0.04); p.border(hex('#80609e')); p.rect(5, 5, 6, 6, hex('#b898d6'), 0.04); };
P.glutportal = (p) => {
  for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
    const a = Math.atan2(y - 7.5, x - 7.5), d = Math.hypot(x - 7.5, y - 7.5);
    const w = Math.sin(a * 3 + d * 0.9) * 0.5 + 0.5;
    p.set(x, y, mix(hex('#8a1a0a'), hex('#ffb040'), w * 0.8 + p.r() * 0.2));
  }
};
P.leerenportal = (p) => {
  p.noise(hex('#0c0618'), 0.2);
  for (let i = 0; i < 14; i++) p.set(Math.floor(p.r() * 16), Math.floor(p.r() * 16), [p.r() < 0.5 ? hex('#7ae0d0') : hex('#d8b0ff')][0]);
};
P.leerenrahmen_side = (p) => { P.leerenstein(p); p.rect(0, 0, 16, 4, hex('#2f6a5a'), 0.08); p.rect(0, 3, 16, 1, hex('#1f4a3e')); };
P.leerenrahmen_top = (p) => { p.noise(hex('#2f6a5a'), 0.08); p.border(hex('#1f4a3e')); p.rect(5, 5, 6, 6, hex('#7ae0d0'), 0.1); p.rect(6, 6, 4, 4, hex('#0c0618')); };
P.chiseled_sandstone = (p) => {
  p.noise(hex('#d6c88d'), 0.04);
  p.rect(0, 0, 16, 2, hex('#c3b278')); p.rect(0, 14, 16, 2, hex('#c3b278'));
  p.rect(4, 4, 8, 8, hex('#c3b278')); p.rect(6, 6, 4, 4, hex('#d6c88d')); p.rect(7, 7, 2, 2, hex('#a8955e'));
};
P.mossy_stone_bricks = (p) => { P.stone_bricks(p); p.blobs([hex('#4f7a2e'), hex('#5f8f37')], 7, 0.8, 1.8); };
P.cracked_stone_bricks = (p) => { P.stone_bricks(p); p.line(3, 1, 7, 7, 1, hex('#3a3a3e')); p.line(7, 7, 6, 14, 1, hex('#3a3a3e')); p.line(10, 9, 14, 12, 1, hex('#3a3a3e')); };
IP.quartz = (p) => { p.poly([[4, 13], [3, 6], [7, 2], [11, 4], [13, 11], [9, 14]], hex('#ece4d8'), 0.05); p.line(6, 5, 9, 11, 1, hex('#ffffff')); };
IP.explorer_compass = (p) => { p.circle(8, 8, 6.2, hex('#9a9a9a'), 0.04); p.circle(8, 8, 4.8, hex('#e8e2cc'), 0.03); p.poly([[8, 3.5], [9.3, 8], [6.7, 8]], hex('#d02a1e')); p.poly([[8, 12.5], [9.3, 8], [6.7, 8]], hex('#3a3a3a')); };

function paintItem(p, def) {
  if (IP[def.key]) { p.clear(); IP[def.key](p); p.outline(); return; }
  if (def.toolType && TOOL_HEAD[def.toolType]) { p.clear(); TOOL_HEAD[def.toolType](p, TIER_COL[def.tier]); p.outline(); return; }
  if (def.armorSlot !== undefined) {
    p.clear();
    const rows = ARMOR_MASK[def.armorSlot];
    const off = def.armorSlot === 0 ? 3 : def.armorSlot === 3 ? 2 : 2;
    p.mask(rows.map((r) => r), { '#': TIER_COL[def.tier] });
    // shift down
    const copy = new Uint8ClampedArray(p.d); p.clear();
    for (let y = 0; y < TS - off; y++) for (let x = 0; x < TS; x++) { const i = (y * TS + x) * 4; if (copy[i + 3]) p.set(x, y + off, [copy[i], copy[i + 1], copy[i + 2], 255]); }
    p.outline();
    return;
  }
  P.missing(p);
}

// ---------- atlas build ----------
export function tileIndex(name) {
  const i = tiles.get(name);
  return i === undefined ? tiles.get('missing') : i;
}

export function buildAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_PX; canvas.height = ATLAS_PX;
  const ctx = canvas.getContext('2d');
  let idx = 0;
  const put = (name, painter) => {
    if (tiles.has(name)) return;
    const p = new Px(name);
    painter(p);
    const img = new ImageData(p.d, TS, TS);
    ctx.putImageData(img, (idx % ATLAS_COLS) * TS, Math.floor(idx / ATLAS_COLS) * TS);
    tiles.set(name, idx++);
  };
  put('missing', P.missing);
  for (const k of Object.keys(P)) put(k, P[k]);
  for (const def of ITEMS) {
    if (!def || def.isBlock) continue;
    put('item_' + def.key, (p) => paintItem(p, def));
  }
  atlasCanvas = canvas;
  return canvas;
}

export function getAtlasCanvas() { return atlasCanvas; }

// UV rectangle (u0,v0,u1,v1) for a tile in GL coordinates (v flipped)
export function tileUV(name) {
  const i = tileIndex(name);
  const e = 0.0005;
  const u0 = (i % ATLAS_COLS) / ATLAS_COLS + e, u1 = (i % ATLAS_COLS + 1) / ATLAS_COLS - e;
  const v1 = 1 - Math.floor(i / ATLAS_COLS) / ATLAS_COLS - e, v0 = 1 - (Math.floor(i / ATLAS_COLS) + 1) / ATLAS_COLS + e;
  return [u0, v0, u1, v1];
}

export function blockFaceTile(id, face) {
  // face: 0 +x,1 -x,2 +y(top),3 -y(bottom),4 +z,5 -z
  const t = BLOCKS[id].tex;
  if (t.all) return t.all;
  if (face === 2) return t.top || t.side;
  if (face === 3) return t.bottom || t.side;
  return t.side;
}

// ---------- UI icons ----------
const iconCache = new Map();
function drawTile(ctx, name, dx, dy, size) {
  const i = tileIndex(name);
  ctx.drawImage(atlasCanvas, (i % ATLAS_COLS) * TS, Math.floor(i / ATLAS_COLS) * TS, TS, TS, dx, dy, size, size);
}
export function itemTileName(id) {
  const d = ITEMS[id];
  if (!d) return 'missing';
  if (!d.isBlock) return 'item_' + d.key;
  return blockFaceTile(id, 4);
}
export function getIcon(id) {
  if (iconCache.has(id)) return iconCache.get(id);
  const S = 48;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const d = ITEMS[id];
  const b = d && d.isBlock ? BLOCKS[id] : null;
  if (b && (b.shape === 'cube' || b.shape === 'cactus' || b.shape === 'flat' || b.shape === 'bed' || b.shape === 'liquid')) {
    // isometric cube
    const top = blockFaceTile(id, 2), side = blockFaceTile(id, 0);
    const front = b.tex.front || side;
    const s = 16;
    const off = document.createElement('canvas'); off.width = 16; off.height = 16;
    const oc = off.getContext('2d');
    const face = (name, a, bb, cc, dd, e, f, dark) => {
      oc.clearRect(0, 0, 16, 16);
      const i = tileIndex(name);
      oc.drawImage(atlasCanvas, (i % ATLAS_COLS) * TS, Math.floor(i / ATLAS_COLS) * TS, TS, TS, 0, 0, 16, 16);
      if (dark) { oc.globalCompositeOperation = 'source-atop'; oc.fillStyle = `rgba(0,0,0,${dark})`; oc.fillRect(0, 0, 16, 16); oc.globalCompositeOperation = 'source-over'; }
      ctx.setTransform(a, bb, cc, dd, e, f);
      ctx.drawImage(off, 0, 0);
    };
    const k = S / 48;
    // top: maps (0,0)->(24,3) (16,0)->(44,13) (0,16)->(4,13)
    face(top, 20 / s * k, 10 / s * k, -20 / s * k, 10 / s * k, 24 * k, 3 * k, 0);
    // left face: (0,0)->(4,13) (16,0)->(24,23) (0,16)->(4,35)
    face(front, 20 / s * k, 10 / s * k, 0, 22 / s * k, 4 * k, 13 * k, 0.25);
    // right face: (0,0)->(24,23) (16,0)->(44,13) (0,16)->(24,45)
    face(side, 20 / s * k, -10 / s * k, 0, 22 / s * k, 24 * k, 23 * k, 0.45);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  } else {
    drawTile(ctx, itemTileName(id), 4, 4, 40);
  }
  const url = c.toDataURL();
  iconCache.set(id, url);
  return url;
}
