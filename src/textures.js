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

const K = 2;              // fine pixels per unit (16 units -> 32 px)
export const RES = TS * K; // real tile resolution

class Px {
  constructor(name) {
    this.d = new Uint8ClampedArray(RES * RES * 4);
    this.rnd = mulberry32(hashString(name));
  }
  // fine pixel
  setF(x, y, c) {
    if (x < 0 || y < 0 || x >= RES || y >= RES) return;
    const i = ((y | 0) * RES + (x | 0)) * 4;
    this.d[i] = c[0]; this.d[i + 1] = c[1]; this.d[i + 2] = c[2]; this.d[i + 3] = c[3] === undefined ? 255 : c[3];
  }
  // unit pixel (2x2 fine), slight per-fine-pixel grain for a richer look
  set(x, y, c) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= TS || y >= TS) return;
    for (let b = 0; b < K; b++) for (let a = 0; a < K; a++) {
      const g = c[3] === 0 ? c : shade(c, 1 + (this.r() - 0.5) * 0.05 + (a === 0 && b === 0 ? 0.02 : 0) - (a === K - 1 && b === K - 1 ? 0.02 : 0));
      this.setF(x * K + a, y * K + b, g);
    }
  }
  getF(x, y) { const i = (y * RES + x) * 4; return [this.d[i], this.d[i + 1], this.d[i + 2], this.d[i + 3]]; }
  r() { return this.rnd(); }
  // iterate fine pixels; fn(ux, uy, fx, fy) gets unit coordinates of the pixel centre; return colour or null
  eachF(fn) {
    for (let fy = 0; fy < RES; fy++) for (let fx = 0; fx < RES; fx++) {
      const c = fn((fx + 0.5) / K, (fy + 0.5) / K, fx, fy);
      if (c) this.setF(fx, fy, c);
    }
    return this;
  }
  noise(base, v = 0.12, alpha = 255) {
    // two-scale noise: coarse unit variation + fine grain
    const coarse = [];
    for (let i = 0; i < TS * TS; i++) coarse.push((this.r() * 2 - 1) * v);
    return this.eachF((ux, uy) => {
      const f = 1 + coarse[Math.floor(uy) * TS + Math.floor(ux)] * 0.75 + (this.r() * 2 - 1) * v * 0.45;
      const c = shade(base, f); c[3] = alpha; return c;
    });
  }
  specks(color, count, size = 1) {
    for (let i = 0; i < count * 2; i++) {
      const x = Math.floor(this.r() * RES), y = Math.floor(this.r() * RES);
      const sz = size * K - (this.r() < 0.5 ? 1 : 0);
      for (let a = 0; a < sz; a++) for (let b = 0; b < sz; b++) this.setF((x + a) % RES, (y + b) % RES, shade(color, 0.88 + this.r() * 0.24));
    }
    return this;
  }
  blobs(colors, count, rmin, rmax) {
    for (let i = 0; i < count; i++) {
      const cx = this.r() * TS, cy = this.r() * TS, rr = rmin + this.r() * (rmax - rmin);
      const col = colors[Math.floor(this.r() * colors.length)];
      for (let fy = -10; fy <= 10; fy++) for (let fx = -10; fx <= 10; fx++) {
        const ux = fx / K, uy = fy / K;
        const d = Math.sqrt(ux * ux + uy * uy) + (this.r() - 0.5) * 0.6;
        if (d <= rr) {
          const px = Math.floor(cx * K + fx), py = Math.floor(cy * K + fy);
          this.setF(((px % RES) + RES) % RES, ((py % RES) + RES) % RES, shade(col, 0.9 + this.r() * 0.2 - d / rr * 0.08));
        }
      }
    }
    return this;
  }
  rect(x0, y0, w, h, c, v = 0) {
    for (let fy = Math.round(y0 * K); fy < Math.round((y0 + h) * K); fy++) for (let fx = Math.round(x0 * K); fx < Math.round((x0 + w) * K); fx++) {
      this.setF(fx, fy, v ? shade(c, 1 + (this.r() * 2 - 1) * v) : c);
    }
    return this;
  }
  border(c, w = 1) {
    const fw = w * K;
    for (let i = 0; i < RES; i++) for (let k = 0; k < fw; k++) {
      const g = shade(c, 0.95 + this.r() * 0.1);
      this.setF(i, k, g); this.setF(i, RES - 1 - k, g); this.setF(k, i, g); this.setF(RES - 1 - k, i, g);
    }
    return this;
  }
  clear() { this.d.fill(0); return this; }
  // ore clusters: shiny gem pixels with highlight and shadow
  ore(color, dark, n = 5) {
    for (let i = 0; i < n; i++) {
      const cx = 2 + Math.floor(this.r() * 12), cy = 2 + Math.floor(this.r() * 12);
      const pts = [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [0, -1]];
      for (const [dx, dy] of pts) {
        if (this.r() < 0.75) {
          const ux = cx + dx, uy = cy + dy;
          for (let b = 0; b < K; b++) for (let a = 0; a < K; a++) {
            let c = shade(color, 0.85 + this.r() * 0.25);
            if (a === 0 && b === 0) c = shade(color, 1.35);
            if (a === K - 1 && b === K - 1) c = dark;
            this.setF(ux * K + a, uy * K + b, c);
          }
        }
      }
    }
    return this;
  }
  // voronoi stones with rounded shading
  cells(n, baseCols, line, jitter = 0.18) {
    const pts = [];
    for (let i = 0; i < n; i++) pts.push([this.r() * TS, this.r() * TS, baseCols[Math.floor(this.r() * baseCols.length)]]);
    return this.eachF((ux, uy) => {
      let d1 = 1e9, d2 = 1e9, c = null, bx = 0, by = 0;
      for (const p of pts) {
        for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
          const dx = ux - (p[0] + ox * TS), dy = uy - (p[1] + oy * TS);
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < d1) { d2 = d1; d1 = d; c = p[2]; bx = dx; by = dy; } else if (d < d2) d2 = d;
        }
      }
      const edge = d2 - d1;
      if (edge < 0.7) return shade(line, 0.9 + this.r() * 0.2);
      // light from top-left: pixels on the upper-left side of a stone are brighter
      const lightF = (-bx - by) / (d1 + 0.5) * 0.08;
      const rim = edge < 1.3 ? -0.08 : 0;
      return shade(c, 1.06 - d1 * 0.035 + lightF + rim + (this.r() * 2 - 1) * jitter * 0.4);
    });
  }
  // outline + bevel for item sprites (fine resolution)
  outline(darkF = 0.45) {
    const copy = new Uint8ClampedArray(this.d);
    const A = (x, y) => (x < 0 || y < 0 || x >= RES || y >= RES) ? 0 : copy[(y * RES + x) * 4 + 3];
    for (let y = 0; y < RES; y++) for (let x = 0; x < RES; x++) {
      const i = (y * RES + x) * 4;
      if (copy[i + 3] === 0) continue;
      const c = [copy[i], copy[i + 1], copy[i + 2], 255];
      if (!A(x - 1, y) || !A(x, y - 1) || !A(x + 1, y) || !A(x, y + 1)) this.setF(x, y, shade(c, darkF));
      else if (!A(x - 2, y - 2) || !A(x - 3, y) || !A(x, y - 3)) this.setF(x, y, shade(c, 1.28));
      else if (!A(x + 2, y + 2) || !A(x + 3, y) || !A(x, y + 3)) this.setF(x, y, shade(c, 0.78));
    }
    return this;
  }
  line(x0, y0, x1, y1, t, c, v = 0.06) {
    const dx = x1 - x0, dy = y1 - y0, L = dx * dx + dy * dy || 1;
    const minX = Math.min(x0, x1) - t, maxX = Math.max(x0, x1) + t, minY = Math.min(y0, y1) - t, maxY = Math.max(y0, y1) + t;
    return this.eachF((px, py) => {
      if (px < minX || px > maxX || py < minY || py > maxY) return null;
      let tt = ((px - x0) * dx + (py - y0) * dy) / L; tt = Math.max(0, Math.min(1, tt));
      const qx = x0 + tt * dx - px, qy = y0 + tt * dy - py;
      return qx * qx + qy * qy <= (t / 2) * (t / 2) ? shade(c, 1 + (this.r() * 2 - 1) * v) : null;
    });
  }
  poly(pts, c, v = 0.06) {
    return this.eachF((px, py) => {
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside ? shade(c, 1 + (this.r() * 2 - 1) * v) : null;
    });
  }
  circle(cx, cy, r, c, v = 0.06) {
    return this.eachF((px, py) => {
      const dx = px - cx, dy = py - cy;
      return dx * dx + dy * dy <= r * r ? shade(c, 1 + (this.r() * 2 - 1) * v - (dx + dy) / r * 0.06) : null;
    });
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
P.stone = (p) => {
  p.noise(C.stone, 0.05).blobs([C.stoneD, C.stoneL, hex('#86868a')], 11, 0.5, 1.7);
  // fine hairline cracks
  for (let i = 0; i < 3; i++) { let x = p.r() * 16, y = p.r() * 16; for (let k = 0; k < 6; k++) { const nx = x + (p.r() - 0.4) * 2.2, ny = y + (p.r() - 0.5) * 2.2; p.line(x, y, nx, ny, 0.45, shade(C.stoneD, 0.85), 0.03); x = nx; y = ny; } }
  p.specks(C.stoneL, 10);
};
P.cobblestone = (p) => p.cells(9, [C.stone, C.stoneL, hex('#6e6e72'), hex('#8a8a8e')], hex('#3a3a3e'));
P.mossy_cobblestone = (p) => { P.cobblestone(p); p.blobs([hex('#4f7a2e'), hex('#5f8f37'), hex('#6aa040')], 10, 0.7, 1.9); };
P.dirt = (p) => {
  p.noise(C.dirt, 0.1).blobs([C.dirtD, hex('#6a4a30')], 8, 0.5, 1.3);
  p.specks(C.dirtD, 20).specks(C.dirtL, 12);
  for (let i = 0; i < 4; i++) { const x = p.r() * 15, y = p.r() * 15; p.circle(x, y, 0.55, hex('#8f8a84'), 0.1); }
};
P.grass_top = (p) => {
  p.noise(C.grass, 0.1);
  // little blades of grass, lit from the top-left
  for (let i = 0; i < 90; i++) {
    const x = p.r() * 16, y = p.r() * 16, l = 0.6 + p.r() * 0.9, a = -0.6 + p.r() * 1.2;
    const col = p.r() < 0.5 ? C.grassL : p.r() < 0.5 ? C.grassD : shade(C.grass, 1.12);
    p.line(x, y, x + Math.sin(a) * l, y - Math.cos(a) * l, 0.5, col, 0.05);
  }
  p.specks(hex('#8ad15a'), 6);
};
function grassOverhang(p, top, dark) {
  const edge = [];
  for (let fx = 0; fx < RES; fx++) edge.push(4 + Math.floor(p.r() * 5) + (fx % 7 === 0 ? 3 : 0) + (fx % 11 === 3 ? 2 : 0));
  p.eachF((ux, uy, fx, fy) => {
    const h = edge[fx];
    if (fy < h - 1) return shade(top, 0.9 + p.r() * 0.2 - fy * 0.008);
    if (fy === h - 1) return shade(dark, 0.95 + p.r() * 0.1);
    if (fy === h && p.r() < 0.5) return shade(C.dirtD, 0.8);
    return null;
  });
}
P.grass_side = (p) => { P.dirt(p); grassOverhang(p, C.grass, C.grassD); };
P.snowy_grass_side = (p) => { P.dirt(p); grassOverhang(p, C.snow, hex('#cfdbe8')); };
P.snow = (p) => p.noise(C.snow, 0.025).specks(hex('#dfe8f2'), 16).specks(hex('#ffffff'), 10);
P.ice = (p) => { p.noise(C.ice, 0.04); for (let i = 0; i < 5; i++) { const x = p.r() * 12; p.line(x, 2 + p.r() * 4, x + 4, 6 + p.r() * 8, 0.5, hex('#e2f2ff')); } p.specks(hex('#c8e2ff'), 10); };
P.bedrock = (p) => p.noise(hex('#4a4a4a'), 0.15).blobs([hex('#2a2a2a'), hex('#6a6a6a'), hex('#1d1d1d')], 14, 0.8, 2);
P.sand = (p) => {
  p.noise(C.sand, 0.04);
  p.eachF((ux, uy) => { const w = Math.sin(uy * 1.4 + Math.sin(ux * 0.7) * 1.5); return w > 0.85 ? shade(C.sand, 0.94) : null; });
  p.specks(C.sandD, 26).specks(hex('#f2e8bc'), 14).specks(hex('#b8a070'), 4);
};
P.gravel = (p) => p.cells(16, [hex('#8a8380'), hex('#6f6865'), hex('#9a948f'), hex('#5e5a58'), hex('#7a7068')], hex('#45403e'), 0.3);
P.sandstone = (p) => { p.noise(hex('#d6c88d'), 0.035); for (const y of [3, 4, 9, 13]) p.rect(0, y, 16, 1, hex('#c3b278'), 0.05); p.rect(0, 15, 16, 1, hex('#b3a26a')); p.rect(0, 0, 16, 0.5, hex('#e2d6a2')); p.specks(hex('#c8b97e'), 10); };
P.sandstone_top = (p) => p.noise(hex('#dccf96'), 0.04).specks(hex('#c8b97e'), 16).specks(hex('#ece2b2'), 8);
function planks(p, base) {
  p.noise(base, 0.035);
  // wood grain
  p.eachF((ux, uy) => {
    const g = Math.sin(ux * 2.1 + Math.sin(uy * 3.1 + ux * 0.3) * 1.6 + Math.floor(uy / 4) * 2.3);
    return g > 0.75 ? shade(base, 0.9 + p.r() * 0.04) : g < -0.9 ? shade(base, 1.06) : null;
  });
  for (let row = 0; row < 4; row++) {
    const y0 = row * 4;
    p.rect(0, y0 + 3.5, 16, 0.5, shade(base, 0.55));
    p.rect(0, y0, 16, 0.5, shade(base, 1.12));
    const off = row % 2 ? 4 : 11;
    p.rect(off, y0, 0.5, 3.5, shade(base, 0.62)); p.rect(off + 0.5, y0, 0.5, 3.5, shade(base, 1.08));
    // nail heads
    p.rect(off - 1.5, y0 + 1.5, 0.5, 0.5, shade(base, 0.5)); p.rect(off + 1.5, y0 + 1.5, 0.5, 0.5, shade(base, 0.5));
  }
}
P.oak_planks = (p) => planks(p, C.oak);
P.birch_planks = (p) => planks(p, C.birchP);
P.spruce_planks = (p) => planks(p, C.spruceP);
function logSide(p, base, dark) {
  const cols = [];
  for (let fx = 0; fx < RES; fx++) cols.push(0.82 + p.r() * 0.3);
  p.eachF((ux, uy, fx) => {
    const furrow = Math.sin(ux * 1.6 + Math.sin(uy * 0.45 + fx * 0.2) * 1.2);
    const c = furrow > 0.55 ? dark : base;
    return shade(c, cols[fx] * (0.93 + p.r() * 0.12) * (furrow < -0.8 ? 1.12 : 1));
  });
}
function logTop(p, inner, bark) {
  p.eachF((ux, uy) => {
    const dx = ux - 8, dy = uy - 8;
    const d = Math.sqrt(dx * dx + dy * dy) + Math.sin(Math.atan2(dy, dx) * 5) * 0.25;
    const sq = Math.max(Math.abs(dx), Math.abs(dy));
    if (sq > 7) return shade(bark, 0.85 + p.r() * 0.25);
    const ring = Math.sin(d * 2.2);
    return shade(inner, (ring > 0.6 ? 0.82 : 1) * (0.95 + p.r() * 0.08) * (1.04 - d * 0.012));
  });
}
P.oak_log = (p) => logSide(p, C.bark, C.barkD);
P.oak_log_top = (p) => logTop(p, C.oak, C.bark);
P.birch_log = (p) => {
  p.noise(C.birch, 0.035);
  p.eachF((ux, uy) => (Math.sin(uy * 3.3 + Math.sin(ux) * 0.5) > 0.93 ? shade(C.birch, 0.86) : null));
  for (let i = 0; i < 8; i++) { const x = p.r() * 13, y = p.r() * 15.5; p.rect(x, y, 1.5 + p.r() * 2.5, 0.5 + (p.r() < 0.4 ? 0.5 : 0), hex('#2e2a26')); }
};
P.birch_log_top = (p) => logTop(p, hex('#d6c486'), C.birch);
P.spruce_log = (p) => logSide(p, C.spruce, hex('#24190e'));
P.spruce_log_top = (p) => logTop(p, C.spruceP, C.spruce);
function leaves(p, base) {
  p.clear();
  // clusters of small leaves, each with a light and a dark side
  for (let i = 0; i < 150; i++) {
    const x = p.r() * 16, y = p.r() * 16, r = 0.55 + p.r() * 0.6;
    const f = 0.78 + p.r() * 0.35;
    p.eachF((ux, uy) => {
      let dx = ux - x, dy = uy - y;
      if (dx > 8) dx -= 16; if (dx < -8) dx += 16; if (dy > 8) dy -= 16; if (dy < -8) dy += 16;
      const d = Math.sqrt(dx * dx * 1.3 + dy * dy);
      if (d > r) return null;
      return shade(base, f * (1.12 - (dx + dy) / r * 0.12 - d / r * 0.15));
    });
  }
  // sparse holes keep it airy
  for (let i = 0; i < 40; i++) { const fx = Math.floor(p.r() * RES), fy = Math.floor(p.r() * RES); p.setF(fx, fy, T); p.setF((fx + 1) % RES, fy, T); p.setF(fx, (fy + 1) % RES, T); }
  p.specks(shade(base, 1.35), 8);
}
P.oak_leaves = (p) => leaves(p, C.leaf);
P.birch_leaves = (p) => leaves(p, C.birchLeaf);
P.spruce_leaves = (p) => leaves(p, C.spruceLeaf);
P.glass = (p) => {
  p.clear();
  p.eachF((ux, uy) => [210, 235, 245, 28]);
  p.border(hex('#d7eef4'));
  p.rect(0.5, 0.5, 15, 0.5, [255, 255, 255, 255]);
  p.line(3, 6, 6, 3, 0.6, [255, 255, 255, 210]); p.line(3.5, 8.5, 8.5, 3.5, 0.4, [255, 255, 255, 170]);
  p.line(10, 13, 13, 10, 0.5, [235, 248, 252, 170]);
};
function oreTile(color, dark) { return (p) => { P.stone(p); p.ore(color, dark, 6); }; }
P.coal_ore = oreTile(hex('#1c1c1e'), hex('#000000'));
P.iron_ore = oreTile(C.iron, hex('#9b7552'));
P.gold_ore = oreTile(C.gold, hex('#b88f12'));
P.diamond_ore = oreTile(C.diamond, hex('#1f9993'));
P.copper_ore = oreTile(C.copper, hex('#4c9a7a'));
P.lapis_ore = oreTile(C.lapis, hex('#162b70'));
P.water = (p) => p.eachF((ux, uy) => {
  const w = Math.sin((ux + uy * 0.5) * 0.8) * 0.06 + Math.sin(uy * 1.3 - ux * 0.4) * 0.05 + Math.sin(ux * 2.1 + uy * 1.7) * 0.03;
  const c = shade(C.water, 1 + w + p.r() * 0.04); c[3] = 170; return c;
});
P.lava = (p) => p.eachF((ux, uy) => {
  const w = Math.sin(ux * 0.9 + Math.cos(uy * 0.7) * 2) * 0.5 + 0.5 + Math.sin(ux * 2.3 - uy * 1.9) * 0.15;
  const crust = Math.sin(ux * 1.7 + uy * 0.6) * Math.sin(uy * 1.3 - ux * 0.4) > 0.55;
  return crust ? mix(hex('#5a1a0a'), hex('#a8321a'), p.r()) : mix(hex('#c8321a'), hex('#ffd04a'), Math.min(1, w * 0.85 + p.r() * 0.15));
});
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
    for (let y = 0; y < RES - off * K; y++) for (let x = 0; x < RES; x++) { const i = (y * RES + x) * 4; if (copy[i + 3]) p.setF(x, y + off * K, [copy[i], copy[i + 1], copy[i + 2], 255]); }
    p.outline();
    return;
  }
  P.missing(p);
}

// ---------- classic 16x16 look ----------
// Crisp, hand-pixelled style: every texel is one clean 16x16 pixel, picked from a small palette and
// clustered with smoothed noise. Overrides the softer painters above for the most common blocks.
const pal = (...h) => h.map(hex);
function smooth16(p, passes = 2) {
  let g = new Float32Array(256).map(() => p.r());
  for (let k = 0; k < passes; k++) {
    const n = new Float32Array(256);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += g[((y + dy + 16) % 16) * 16 + ((x + dx + 16) % 16)] * (dx || dy ? 1 : 2);
      n[y * 16 + x] = s / 10;
    }
    g = n;
  }
  // normalise to 0..1
  let lo = 1, hi = 0; for (const v of g) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  return g.map((v) => (v - lo) / (hi - lo || 1));
}
// palette ordered dark -> light; mix of clustered noise and per-pixel randomness
function texel(p, palette, mixRnd = 0.45, passes = 2) {
  const g = smooth16(p, passes);
  const out = [];
  for (let i = 0; i < 256; i++) {
    const v = g[i] * (1 - mixRnd) + p.r() * mixRnd;
    out.push(palette[Math.min(palette.length - 1, Math.floor(v * palette.length))]);
  }
  return out;
}
function paint16(p, cols) { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (cols[y * 16 + x]) p.set(x, y, cols[y * 16 + x]); }

const GRASS = pal('#3f7a22', '#4a8a2a', '#56992f', '#5fa636', '#6bb33f', '#79c04a');
const DIRT = pal('#58391f', '#694629', '#79553a', '#866143', '#946d4c');
const STONE = pal('#626264', '#6e6e70', '#7a7a7c', '#848486', '#8f8f91', '#9b9b9d');
const SAND = pal('#c9bd85', '#d4c992', '#dcd29c', '#e3daa8', '#ebe3b6');
const OAKP = { hi: hex('#bf9a63'), a: hex('#b08b55'), b: hex('#a07c48'), lo: hex('#8a6a3b'), seam: hex('#664c29') };

P.grass_top = (p) => {
  paint16(p, texel(p, GRASS, 0.5));
  for (let i = 0; i < 10; i++) p.set(Math.floor(p.r() * 16), Math.floor(p.r() * 16), hex('#86cc56'));
};
P.dirt = (p) => {
  paint16(p, texel(p, DIRT, 0.55));
  for (let i = 0; i < 5; i++) { const x = Math.floor(p.r() * 15), y = Math.floor(p.r() * 15); p.set(x, y, hex('#9a948c')); if (p.r() < 0.5) p.set(x + 1, y, hex('#7d7872')); }
};
function overhang(p, palette, edgeCol) {
  for (let x = 0; x < 16; x++) {
    let h = 3 + Math.floor(p.r() * 2);
    if (p.r() < 0.25) h += 1 + Math.floor(p.r() * 2);
    for (let y = 0; y < h; y++) p.set(x, y, palette[Math.max(0, Math.min(palette.length - 1, palette.length - 1 - Math.floor(p.r() * 3) - (y >= h - 1 ? 2 : 0)))]);
    p.set(x, h, edgeCol);
  }
}
P.grass_side = (p) => { P.dirt(p); overhang(p, GRASS, hex('#4f3a22')); };
P.snowy_grass_side = (p) => { P.dirt(p); overhang(p, pal('#c9d6e3', '#dbe5ef', '#e8eff6', '#f4f8fc'), hex('#a8b4c0')); };
P.stone = (p) => {
  paint16(p, texel(p, STONE, 0.4));
  for (let i = 0; i < 7; i++) {
    const x = Math.floor(p.r() * 16), y = Math.floor(p.r() * 16), l = 2 + Math.floor(p.r() * 3);
    for (let k = 0; k < l; k++) p.set((x + k) % 16, y, STONE[p.r() < 0.5 ? 0 : 1]);
  }
};
P.sand = (p) => { paint16(p, texel(p, SAND, 0.6, 1)); for (let i = 0; i < 6; i++) p.set(Math.floor(p.r() * 16), Math.floor(p.r() * 16), hex('#b8aa72')); };
P.dirt_path_top = (p) => paint16(p, texel(p, pal('#7d6234', '#8c6f3d', '#9a7c46', '#a88952', '#b4955e'), 0.55));
P.dirt_path_side = (p) => { P.dirt(p); const t = pal('#8c6f3d', '#9a7c46', '#a88952'); for (let x = 0; x < 16; x++) { const h = 2 + (p.r() < 0.3 ? 1 : 0); for (let y = 0; y < h; y++) p.set(x, y, t[Math.floor(p.r() * 3)]); } };

// stones with dark outlines and light top-left edges
function stones(p, seeds, palette, mortar, mortar2) {
  const pts = [];
  for (let i = 0; i < seeds; i++) pts.push([p.r() * 16, p.r() * 16, Math.floor(p.r() * palette.length)]);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    let d1 = 99, d2 = 99, best = null, bx = 0, by = 0;
    for (const s of pts) for (let ox = -16; ox <= 16; ox += 16) for (let oy = -16; oy <= 16; oy += 16) {
      const dx = x + 0.5 - (s[0] + ox), dy = y + 0.5 - (s[1] + oy), d = Math.hypot(dx * 1.15, dy);
      if (d < d1) { d2 = d1; d1 = d; best = s; bx = dx; by = dy; } else if (d < d2) d2 = d;
    }
    if (d2 - d1 < 1.0) { p.set(x, y, p.r() < 0.6 ? mortar : mortar2); continue; }
    let idx = best[2] + (bx + by < -1.2 ? 1 : bx + by > 1.6 ? -1 : 0) + (p.r() < 0.2 ? (p.r() < 0.5 ? 1 : -1) : 0);
    p.set(x, y, palette[Math.max(0, Math.min(palette.length - 1, idx))]);
  }
}
P.cobblestone = (p) => stones(p, 9, pal('#6a6a6c', '#7a7a7c', '#8a8a8c', '#9a9a9c', '#a8a8aa'), hex('#3e3e40'), hex('#4c4c4e'));
P.gravel = (p) => stones(p, 15, pal('#5e5856', '#6f6865', '#7f7774', '#8f8784', '#a09793'), hex('#4a4442'), hex('#534c4a'));

function planks16(p, c) {
  for (let board = 0; board < 4; board++) {
    const seamX = board % 2 ? 4 : 12;
    for (let yy = 0; yy < 4; yy++) {
      const y = board * 4 + yy;
      for (let x = 0; x < 16; x++) {
        let col = yy === 3 ? c.seam : yy === 0 ? c.hi : p.r() < 0.5 ? c.a : c.b;
        if (yy > 0 && yy < 3 && p.r() < 0.12) col = c.lo;
        if (x === seamX && yy < 3) col = c.seam;
        p.set(x, y, col);
      }
      // grain streaks
      if (yy === 1 || yy === 2) { const sx = Math.floor(p.r() * 12), l = 3 + Math.floor(p.r() * 4); for (let k = 0; k < l; k++) if ((sx + k) % 16 !== seamX) p.set((sx + k) % 16, y, c.lo); }
    }
  }
}
P.oak_planks = (p) => planks16(p, OAKP);
P.spruce_planks = (p) => planks16(p, { hi: hex('#856038'), a: hex('#76532f'), b: hex('#6b4a29'), lo: hex('#5a3d21'), seam: hex('#3e2914') });
P.birch_planks = (p) => planks16(p, { hi: hex('#d8c98d'), a: hex('#cdbc80'), b: hex('#c2b075'), lo: hex('#ad9a62'), seam: hex('#8f7c48') });
P.jungle_planks = (p) => planks16(p, { hi: hex('#bb8a62'), a: hex('#ad7c55'), b: hex('#a0704b'), lo: hex('#8a5e3d'), seam: hex('#6a4528') });

function bark16(p, palette) {
  for (let x = 0; x < 16; x++) {
    let ci = Math.floor(p.r() * palette.length);
    for (let y = 0; y < 16; y++) {
      if (p.r() < 0.18) ci = Math.max(0, Math.min(palette.length - 1, ci + (p.r() < 0.5 ? 1 : -1)));
      p.set(x, y, palette[x % 4 === 0 && p.r() < 0.7 ? 0 : ci]);
    }
  }
}
function rings16(p, inner, bark) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const r = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    if (r > 6.5) { p.set(x, y, bark[Math.floor(p.r() * bark.length)]); continue; }
    const ring = Math.floor(r) % 2;
    p.set(x, y, inner[ring === 0 ? (p.r() < 0.85 ? 1 : 2) : 0]);
  }
}
P.oak_log = (p) => bark16(p, pal('#3f2e1a', '#4f3a22', '#5d452a', '#6a5032'));
P.oak_log_top = (p) => rings16(p, pal('#8a6a3b', '#b08b55', '#bf9a63'), pal('#4f3a22', '#5d452a'));
P.spruce_log = (p) => bark16(p, pal('#22170c', '#2e2012', '#3a2a18', '#46331e'));
P.spruce_log_top = (p) => rings16(p, pal('#5a3d21', '#76532f', '#856038'), pal('#2e2012', '#3a2a18'));
P.birch_log = (p) => {
  paint16(p, texel(p, pal('#c9c5b8', '#d8d5ca', '#e4e2da', '#efede7'), 0.6, 1));
  for (let i = 0; i < 9; i++) { const x = Math.floor(p.r() * 14), y = Math.floor(p.r() * 16), l = 1 + Math.floor(p.r() * 3); for (let k = 0; k < l; k++) p.set(x + k, y, hex(k === 0 ? '#24201c' : '#3a3530')); }
};
P.birch_log_top = (p) => rings16(p, pal('#b8a26a', '#d2bf86', '#ddcc96'), pal('#d8d5ca', '#e4e2da'));
function leaves16(p, palette, holes = 0.14) {
  const cols = texel(p, palette, 0.55, 1);
  for (let i = 0; i < 256; i++) if (p.r() < holes) cols[i] = null;
  p.clear();
  paint16(p, cols);
}
P.oak_leaves = (p) => leaves16(p, pal('#1f4f14', '#2a6219', '#36741f', '#428627', '#529a31'));
P.birch_leaves = (p) => leaves16(p, pal('#3a6a26', '#4a7e30', '#5a923a', '#6aa446', '#7ab452'));
P.spruce_leaves = (p) => leaves16(p, pal('#16301a', '#1f3f22', '#294e2b', '#335d34'));
P.jungle_leaves = (p) => leaves16(p, pal('#24601a', '#2f7521', '#3b8a2a', '#4aa034', '#5ab43f'), 0.08);

function bricks16(p, rowH, joints, fill, mortar, hi, lo) {
  for (let y = 0; y < 16; y++) {
    const row = Math.floor(y / rowH), yy = y % rowH;
    for (let x = 0; x < 16; x++) {
      const jx = joints[row % joints.length];
      if (yy === rowH - 1 || jx.includes(x)) { p.set(x, y, mortar); continue; }
      let c = fill[Math.floor(p.r() * fill.length)];
      if (yy === 0 || jx.includes(x - 1)) c = hi;
      else if (yy === rowH - 2 || jx.includes(x + 1)) c = lo;
      p.set(x, y, c);
    }
  }
}
P.stone_bricks = (p) => bricks16(p, 8, [[7, 15], [3, 11]], pal('#7c7c7e', '#868688', '#909092', '#828284'), hex('#4e4e50'), hex('#a4a4a6'), hex('#6a6a6c'));
P.bricks = (p) => bricks16(p, 4, [[7, 15], [3, 11]], pal('#963f2e', '#a24834', '#8c3a2a', '#ab5039'), hex('#b8b0a4'), hex('#b85c44'), hex('#7a3224'));
P.smooth_stone = (p) => {
  paint16(p, texel(p, pal('#9a9a9c', '#a2a2a4', '#aaaaac'), 0.5, 1));
  for (let i = 0; i < 16; i++) { p.set(i, 0, hex('#b6b6b8')); p.set(0, i, hex('#b6b6b8')); p.set(i, 15, hex('#78787a')); p.set(15, i, hex('#78787a')); }
};
function metal16(p, base, light, dark, shine) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    let c = base;
    if (x === 0 || y === 0) c = light; else if (x === 15 || y === 15) c = dark;
    else if ((x + y) % 7 === 0 && x > 2 && y > 2) c = shine;
    else if (p.r() < 0.12) c = shade(base, 0.94);
    p.set(x, y, c);
  }
  for (const [x, y] of [[2, 2], [3, 2], [2, 3]]) p.set(x, y, shine);
}
P.gold_block = (p) => metal16(p, hex('#f2c62e'), hex('#fde78a'), hex('#b8860f'), hex('#fff4b8'));
P.iron_block = (p) => metal16(p, hex('#d2d2d2'), hex('#f0f0f0'), hex('#9a9a9a'), hex('#ffffff'));
P.diamond_block = (p) => metal16(p, hex('#56dcd2'), hex('#a8f4ee'), hex('#2a9a92'), hex('#e0fffc'));
P.water = (p) => {
  const cols = texel(p, pal('#2a5cc0', '#2f68cc', '#3574d6', '#3d80de'), 0.35, 2);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    let c = cols[y * 16 + x];
    if ((x + Math.floor(y * 2.3)) % 9 === 0 && p.r() < 0.6) c = hex('#5a9aea');
    const o = [c[0], c[1], c[2], 175];
    p.set(x, y, o);
  }
};
P.pumpkin_side = (p) => {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const rib = x % 4 === 0;
    let c = rib ? hex('#a65a0e') : x % 4 === 2 ? hex('#e08c22') : hex('#d17b16');
    if (y === 0) c = shade(c, 1.1); if (y === 15) c = shade(c, 0.8);
    if (!rib && p.r() < 0.12) c = hex('#c26f12');
    p.set(x, y, c);
  }
};
P.pumpkin_top = (p) => { paint16(p, texel(p, pal('#b8650f', '#c87314', '#d17b16', '#dc8a22'), 0.5)); for (const [x, y] of [[7, 6], [8, 6], [7, 7], [8, 7], [7, 8]]) p.set(x, y, hex('#5a4a1a')); };
P.hay_side = (p) => {
  for (let x = 0; x < 16; x++) { const base = pal('#b8952c', '#c4a338', '#cfb044', '#a8862a')[Math.floor(p.r() * 4)]; for (let y = 0; y < 16; y++) p.set(x, y, p.r() < 0.15 ? shade(base, 0.85) : base); }
  for (const y of [2, 3, 12, 13]) for (let x = 0; x < 16; x++) p.set(x, y, y % 2 ? hex('#6a2c14') : hex('#8a3a1e'));
};
P.hay_top = (p) => { paint16(p, texel(p, pal('#9a7a22', '#b8952c', '#c4a338', '#d4b54c'), 0.6, 1)); };

// ---------- atlas build ----------
export function tileIndex(name) {
  const i = tiles.get(name);
  return i === undefined ? tiles.get('missing') : i;
}

export function buildAtlas() {
  if (atlasCanvas) return atlasCanvas; // tiles are only painted once (shared by world + arena)
  const canvas = document.createElement('canvas');
  canvas.width = RES * ATLAS_COLS; canvas.height = RES * ATLAS_COLS;
  const ctx = canvas.getContext('2d');
  let idx = 0;
  const put = (name, painter) => {
    if (tiles.has(name)) return;
    const p = new Px(name);
    painter(p);
    const img = new ImageData(p.d, RES, RES);
    ctx.putImageData(img, (idx % ATLAS_COLS) * RES, Math.floor(idx / ATLAS_COLS) * RES);
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

// Mip levels built by halving the whole atlas; every tile is a power of two and aligned,
// so a 2x downscale never mixes neighbouring tiles (no colour bleeding at distance).
export function buildMipmaps(canvas) {
  const levels = [canvas];
  let cur = canvas;
  while (cur.width / ATLAS_COLS > 1) {
    const n = document.createElement('canvas');
    n.width = cur.width / 2; n.height = cur.height / 2;
    const ctx = n.getContext('2d');
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'low';
    ctx.drawImage(cur, 0, 0, n.width, n.height);
    levels.push(n);
    cur = n;
  }
  return levels;
}

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
  ctx.drawImage(atlasCanvas, (i % ATLAS_COLS) * RES, Math.floor(i / ATLAS_COLS) * RES, RES, RES, dx, dy, size, size);
}
export function itemTileName(id) {
  const d = ITEMS[id];
  if (!d) return 'missing';
  if (!d.isBlock) return 'item_' + d.key;
  return blockFaceTile(id, 4);
}
export function getIcon(id) {
  if (iconCache.has(id)) return iconCache.get(id);
  const S = 64;
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
    const s = 32;
    const off = document.createElement('canvas'); off.width = 32; off.height = 32;
    const oc = off.getContext('2d');
    const face = (name, a, bb, cc, dd, e, f, dark) => {
      oc.clearRect(0, 0, 32, 32);
      const i = tileIndex(name);
      oc.drawImage(atlasCanvas, (i % ATLAS_COLS) * RES, Math.floor(i / ATLAS_COLS) * RES, RES, RES, 0, 0, 32, 32);
      if (dark) { oc.globalCompositeOperation = 'source-atop'; oc.fillStyle = `rgba(0,0,0,${dark})`; oc.fillRect(0, 0, 32, 32); oc.globalCompositeOperation = 'source-over'; }
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
