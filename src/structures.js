// Generated structures: villages, temples, underground fortress, Unterwelt fortress, Sternenstadt.
// All layouts are original designs built procedurally and deterministically from the world seed.
import { hash3, mulberry32 } from './noise.js';
import { B, itemByKey } from './blocks.js';

const CS = 16, CH = 128, SEA = 48;
// biome ids (kept local to avoid circular import with worldgen)
const BI = { OCEAN: 0, BEACH: 1, PLAINS: 2, FOREST: 3, BIRCH: 4, TAIGA: 5, DESERT: 6, SNOW: 7, MOUNTAINS: 8, SWAMP: 9, JUNGLE: 10 };

// ---------------- loot ----------------
const LOOT = {
  village: [['bread', 1, 4, 0.7], ['apple', 1, 3, 0.5], ['wheat', 2, 6, 0.4], ['iron_ingot', 1, 3, 0.3], ['wheat_seeds', 2, 5, 0.5], ['oak_sapling', 1, 2, 0.3], ['emerald_none', 0, 0, 0]],
  smith: [['iron_ingot', 2, 5, 0.8], ['bread', 1, 3, 0.5], ['iron_pickaxe', 1, 1, 0.2], ['iron_sword', 1, 1, 0.2], ['iron_chestplate', 1, 1, 0.12], ['iron_helmet', 1, 1, 0.15], ['gold_ingot', 1, 3, 0.25], ['diamond', 1, 2, 0.08], ['obsidian', 1, 4, 0.2]],
  desert: [['bone', 2, 6, 0.8], ['rotten_flesh', 2, 6, 0.7], ['gold_ingot', 2, 6, 0.5], ['iron_ingot', 1, 5, 0.5], ['diamond', 1, 3, 0.2], ['golden_apple', 1, 1, 0.12], ['sand', 2, 8, 0.4], ['lapis', 3, 8, 0.3]],
  jungle: [['bone', 2, 6, 0.7], ['rotten_flesh', 2, 6, 0.6], ['gold_ingot', 2, 6, 0.5], ['iron_ingot', 1, 4, 0.4], ['diamond', 1, 3, 0.18], ['golden_apple', 1, 1, 0.1], ['jungle_sapling', 1, 3, 0.4]],
  stronghold: [['bread', 1, 3, 0.5], ['apple', 1, 3, 0.5], ['iron_ingot', 1, 5, 0.6], ['gold_ingot', 1, 3, 0.4], ['diamond', 1, 3, 0.15], ['iron_sword', 1, 1, 0.15], ['iron_chestplate', 1, 1, 0.1], ['explorer_compass', 1, 1, 0.3], ['book', 1, 3, 0.4], ['paper', 2, 6, 0.4]],
  library: [['book', 2, 6, 0.9], ['paper', 2, 8, 0.7], ['explorer_compass', 1, 1, 0.4], ['golden_apple', 1, 1, 0.1]],
  fortress: [['gold_ingot', 2, 6, 0.7], ['iron_ingot', 1, 5, 0.6], ['diamond', 1, 3, 0.25], ['obsidian', 2, 6, 0.4], ['golden_sword', 1, 1, 0.2], ['golden_chestplate', 1, 1, 0.15], ['quartz', 4, 12, 0.5], ['glowing_crystal', 2, 6, 0.4]],
  city: [['diamond', 2, 7, 0.6], ['iron_ingot', 4, 8, 0.6], ['gold_ingot', 3, 8, 0.6], ['diamond_sword', 1, 1, 0.25], ['diamond_pickaxe', 1, 1, 0.25], ['diamond_chestplate', 1, 1, 0.15], ['diamond_helmet', 1, 1, 0.15], ['golden_apple', 1, 2, 0.3], ['glowing_crystal', 2, 5, 0.4]],
};
function rollLoot(table, rnd) {
  const slots = new Array(27).fill(null);
  for (const [k, mn, mx, p] of LOOT[table]) {
    if (k.endsWith('_none') || rnd() > p) continue;
    let id;
    try { id = itemByKey(k); } catch (e) { continue; }
    const n = mn + Math.floor(rnd() * (mx - mn + 1));
    let i = Math.floor(rnd() * 27), tries = 0;
    while (slots[i] && tries++ < 27) i = (i + 1) % 27;
    slots[i] = { id, count: n, dmg: 0 };
  }
  return slots;
}

// ---------------- per-chunk writer ----------------
function writer(chunk, gen, sid) {
  const x0 = chunk.cx * CS, z0 = chunk.cz * CS, b = chunk.blocks;
  const inside = (x, y, z) => x >= x0 && x < x0 + CS && z >= z0 && z < z0 + CS && y >= 0 && y < CH;
  const I = (x, y, z) => (y * CS + (z - z0)) * CS + (x - x0);
  const val = (id, x, y, z) => (typeof id === 'function' ? id(x, y, z) : id);
  const S = {
    gen,
    set(x, y, z, id) { if (inside(x, y, z)) b[I(x, y, z)] = val(id, x, y, z); },
    get(x, y, z) { return inside(x, y, z) ? b[I(x, y, z)] : -1; },
    inside,
    fill(xa, ya, za, xb, yb, zb, id) {
      const ax = Math.max(Math.min(xa, xb), x0), bx = Math.min(Math.max(xa, xb), x0 + CS - 1);
      const az = Math.max(Math.min(za, zb), z0), bz = Math.min(Math.max(za, zb), z0 + CS - 1);
      const ay = Math.max(Math.min(ya, yb), 0), by = Math.min(Math.max(ya, yb), CH - 1);
      for (let y = ay; y <= by; y++) for (let z = az; z <= bz; z++) for (let x = ax; x <= bx; x++) b[I(x, y, z)] = val(id, x, y, z);
    },
    // hollow box: shell of `wall`, inside `inner`
    box(xa, ya, za, xb, yb, zb, wall, inner = 0) {
      S.fill(xa, ya, za, xb, yb, zb, wall);
      if (inner !== null) S.fill(xa + 1, ya + 1, za + 1, xb - 1, yb - 1, zb - 1, inner);
    },
    chest(x, y, z, table, facing = 0) {
      if (!inside(x, y, z)) return;
      b[I(x, y, z)] = B.chest;
      const rnd = mulberry32((hash3(x, y, z, gen.seed) * 4294967296) >>> 0);
      (chunk.pendingTiles = chunk.pendingTiles || []).push([x + ',' + y + ',' + z, { type: 'chest', facing, slots: rollLoot(table, rnd) }]);
    },
    mob(type, x, y, z) {
      if (!inside(Math.floor(x), Math.floor(y), Math.floor(z))) return;
      (chunk.pendingMobs = chunk.pendingMobs || []).push({ sid, type, x, y, z });
    },
    // foundation: fill below y down to terrain
    found(x, y, z, id) {
      const g = gen.groundY(x, z);
      for (let yy = y; yy > Math.max(1, Math.min(g, y) - 1) && yy > y - 20; yy--) {
        const cur = S.get(x, yy, z);
        if (cur > 0 && cur !== B.water && cur !== B.lava && cur !== B.tall_grass && yy <= g) break;
        S.set(x, yy, z, id);
      }
    },
  };
  return S;
}

const mix = (seed, a, list) => (x, y, z) => {
  const r = hash3(x, y, z, seed);
  let acc = 0;
  for (const [id, p] of list) { acc += p; if (r < acc) return id; }
  return a;
};

// local (rotated) builder helper for houses. facing f: direction from house to road.
function local(S, cx, cy, cz, f) {
  // forward vector (towards road) and right vector
  const F = [[0, 1], [1, 0], [0, -1], [-1, 0]][f];
  const R = [-F[1], F[0]];
  const W = (ax, az) => [cx + ax * R[0] + az * F[0], cz + ax * R[1] + az * F[1]];
  return {
    set(ax, ay, az, id) { const [x, z] = W(ax, az); S.set(x, cy + ay, z, id); },
    get(ax, ay, az) { const [x, z] = W(ax, az); return S.get(x, cy + ay, z); },
    fill(a0, y0, b0, a1, y1, b1, id) { for (let a = Math.min(a0, a1); a <= Math.max(a0, a1); a++) for (let c = Math.min(b0, b1); c <= Math.max(b0, b1); c++) for (let y = y0; y <= y1; y++) this.set(a, y, c, id); },
    found(ax, az, id) { const [x, z] = W(ax, az); S.found(x, cy - 1, z, id); },
    chest(ax, ay, az, t) { const [x, z] = W(ax, az); S.chest(x, cy + ay, z, t, f); },
    world: W,
  };
}

// ---------------- structure types ----------------
const TYPES = {
  overworld: [
    {
      type: 'village', name: 'Dorf', region: 22, radius: 52,
      find(gen, x, z) {
        const c = gen.column(x, z);
        let style = null;
        if (c.biome === BI.PLAINS) style = 'plains';
        else if (c.biome === BI.DESERT) style = 'desert';
        else if (c.biome === BI.TAIGA || c.biome === BI.SNOW) style = 'taiga';
        if (!style || c.h <= SEA + 1) return null;
        for (const [dx, dz] of [[16, 0], [-16, 0], [0, 16], [0, -16], [11, 11], [-11, -11], [11, -11], [-11, 11]]) {
          const h = gen.column(x + dx, z + dz).h;
          if (h <= SEA || Math.abs(h - c.h) > 6) return null;
        }
        return { y: c.h, style };
      },
      plan: planVillage,
    },
    {
      type: 'desert_temple', name: 'Wüstentempel', region: 18, radius: 14,
      find(gen, x, z) {
        const c = gen.column(x, z);
        if (c.biome !== BI.DESERT || c.h <= SEA + 1) return null;
        for (const [dx, dz] of [[12, 12], [-12, 12], [12, -12], [-12, -12], [0, 14], [0, -14], [14, 0], [-14, 0]]) { const o = gen.column(x + dx, z + dz); if (o.h <= SEA + 1 || o.biome !== BI.DESERT) return null; }
        return { y: c.h };
      },
      plan: planDesertTemple,
    },
    {
      type: 'jungle_temple', name: 'Dschungeltempel', region: 16, radius: 12,
      find(gen, x, z) {
        const c = gen.column(x, z);
        if (c.biome !== BI.JUNGLE || c.h <= SEA + 1) return null;
        for (const [dx, dz] of [[8, 9], [-8, 9], [8, -9], [-8, -9]]) if (gen.column(x + dx, z + dz).h <= SEA + 1) return null;
        return { y: c.h };
      },
      plan: planJungleTemple,
    },
    {
      type: 'stronghold', name: 'Untergrundfestung', region: 40, radius: 90,
      find(gen, x, z) { return { y: 18 + Math.floor(hash3(x, 1, z, gen.seed) * 12) }; },
      plan: planStronghold,
    },
  ],
  nether: [
    {
      type: 'fortress', name: 'Glutfestung', region: 18, radius: 80,
      find(gen, x, z) { return { y: 62 + Math.floor(hash3(x, 2, z, gen.seed) * 10) }; },
      plan: planFortress,
    },
  ],
  end: [
    {
      type: 'end_center', name: 'Rückkehrportal', region: 4096, radius: 8, fixed: [0, 0],
      find(gen) { const e = gen.endColumn(0, 0); return { y: e ? e.top : 58 }; },
      plan: planEndCenter,
    },
    {
      type: 'end_city', name: 'Sternenstadt', region: 22, radius: 26,
      find(gen, x, z) {
        if (Math.hypot(x, z) < 300) return null;
        const e = gen.endColumn(x, z);
        if (!e || e.top - e.bottom < 5) return null;
        for (const [dx, dz] of [[6, 0], [-6, 0], [0, 6], [0, -6]]) { const f = gen.endColumn(x + dx, z + dz); if (!f || Math.abs(f.top - e.top) > 3) return null; }
        return { y: e.top };
      },
      plan: planEndCity,
    },
  ],
};

export class Structures {
  constructor(gen) { this.gen = gen; this.cache = new Map(); }

  types() { return TYPES[this.gen.dim] || []; }

  // structure for region (or null)
  get(T, rx, rz) {
    const key = T.type + ':' + rx + ':' + rz;
    if (this.cache.has(key)) return this.cache.get(key);
    let st = null;
    const R = T.region * CS;
    let x, z;
    if (T.fixed) { if (rx === 0 && rz === 0) { x = T.fixed[0]; z = T.fixed[1]; } }
    else {
      const margin = Math.min(R / 2 - 1, T.radius + 8);
      x = rx * R + margin + Math.floor(hash3(rx, 11 + T.type.length, rz, this.gen.seed) * (R - 2 * margin));
      z = rz * R + margin + Math.floor(hash3(rx, 23 + T.type.length, rz, this.gen.seed) * (R - 2 * margin));
    }
    if (x !== undefined) {
      const f = T.find(this.gen, x, z);
      if (f) {
        const rnd = mulberry32((hash3(x, 5, z, this.gen.seed) * 4294967296) >>> 0);
        st = { type: T.type, name: T.name, x, z, y: f.y, id: key, pieces: [] };
        T.plan(st, this.gen, f, rnd);
      }
    }
    if (this.cache.size > 400) this.cache.clear();
    this.cache.set(key, st);
    return st;
  }

  apply(chunk) {
    const x0 = chunk.cx * CS, z0 = chunk.cz * CS;
    for (const T of this.types()) {
      const R = T.region * CS;
      const rxa = Math.floor((x0 - T.radius) / R), rxb = Math.floor((x0 + CS - 1 + T.radius) / R);
      const rza = Math.floor((z0 - T.radius) / R), rzb = Math.floor((z0 + CS - 1 + T.radius) / R);
      for (let rx = rxa; rx <= rxb; rx++) for (let rz = rza; rz <= rzb; rz++) {
        const st = this.get(T, rx, rz);
        if (!st) continue;
        const S = writer(chunk, this.gen, st.id);
        for (const p of st.pieces) {
          const [ax, , az, bx, , bz] = p.box;
          if (bx < x0 || ax > x0 + CS - 1 || bz < z0 || az > z0 + CS - 1) continue;
          p.build(S);
        }
      }
    }
  }

  // nearest structure of each type (for the explorer compass)
  nearest(px, pz) {
    const out = [];
    for (const T of this.types()) {
      const R = T.region * CS;
      const prx = Math.floor(px / R), prz = Math.floor(pz / R);
      let best = null, bd = Infinity;
      const maxR = T.fixed ? 0 : Math.max(2, Math.ceil(2500 / R));
      for (let r = 0; r <= maxR; r++) {
        for (let rx = prx - r; rx <= prx + r; rx++) for (let rz = prz - r; rz <= prz + r; rz++) {
          if (Math.max(Math.abs(rx - prx), Math.abs(rz - prz)) !== r) continue;
          const st = T.fixed ? this.get(T, 0, 0) : this.get(T, rx, rz);
          if (!st) continue;
          const d = Math.hypot(st.x - px, st.z - pz);
          if (d < bd) { bd = d; best = st; }
        }
        if (best && bd < (r - 0.5) * R) break;
      }
      if (best) out.push({ name: T.name, x: best.x, y: best.y, z: best.z, dist: bd });
    }
    return out.sort((a, b) => a.dist - b.dist);
  }
}

// =====================================================================
// Village
// =====================================================================
const STYLES = {
  plains: { wall: B.oak_planks, log: B.oak_log, found: B.cobblestone, roof: B.spruce_planks, floor: B.oak_planks, path: B.dirt_path, glass: B.glass },
  taiga: { wall: B.spruce_planks, log: B.spruce_log, found: B.cobblestone, roof: B.spruce_log, floor: B.spruce_planks, path: B.dirt_path, glass: B.glass },
  desert: { wall: B.sandstone, log: B.chiseled_sandstone, found: B.sandstone, roof: B.smooth_stone, floor: B.smooth_stone, path: B.gravel, glass: B.glass, flat: true },
};

function planVillage(st, gen, f, rnd) {
  const M = STYLES[f.style];
  const { x, z } = st;
  const y = f.y;
  // well
  st.pieces.push({
    box: [x - 3, 0, z - 3, x + 3, 0, z + 3],
    build(S) {
      S.fill(x - 3, y + 1, z - 3, x + 3, y + 6, z + 3, 0);
      for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) { S.found(x + dx, y - 1, z + dz, M.found); S.set(x + dx, y, z + dz, M.path); }
      S.fill(x - 2, y - 3, z - 2, x + 2, y + 1, z + 2, M.found);
      S.fill(x - 1, y - 2, z - 1, x + 1, y, z + 1, B.water);
      for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) S.fill(x + dx, y + 2, z + dz, x + dx, y + 3, z + dz, B.fence);
      S.fill(x - 2, y + 4, z - 2, x + 2, y + 4, z + 2, M.found);
      S.set(x, y + 5, z, B.torch);
    },
  });
  st.pieces.push({ box: [x - 4, 0, z - 4, x + 4, 0, z + 4], build(S) { for (const [dx, dz] of [[4, 0], [-4, 0], [0, 4], [0, -4], [4, 4]]) S.mob('villager', x + dx + 0.5, y + 1.2, z + dz + 0.5); } });

  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let smithPlaced = false;
  dirs.forEach(([fx, fz], di) => {
    const L = 18 + Math.floor(rnd() * 16);
    const rx = -fz, rz = fx;
    // road
    st.pieces.push({
      box: [Math.min(x + fx * 4, x + fx * L) - 1, 0, Math.min(z + fz * 4, z + fz * L) - 1, Math.max(x + fx * 4, x + fx * L) + 1, 0, Math.max(z + fz * 4, z + fz * L) + 1],
      build(S) {
        for (let t = 4; t <= L; t++) for (let w = -1; w <= 1; w++) {
          const wx = x + fx * t + rx * w, wz = z + fz * t + rz * w;
          const h = gen.column(wx, wz).h;
          if (h < SEA) { S.set(wx, SEA, wz, M.floor); continue; }
          S.set(wx, h, wz, M.path);
          for (let k = 1; k <= 3; k++) S.set(wx, h + k, wz, 0);
        }
      },
    });
    // lamp post
    {
      const lx = x + fx * 6 + rx * 2, lz = z + fz * 6 + rz * 2;
      st.pieces.push({ box: [lx, 0, lz, lx, 0, lz], build(S) { const h = gen.column(lx, lz).h; S.fill(lx, h + 1, lz, lx, h + 2, lz, B.fence); S.set(lx, h + 3, lz, B.lantern); } });
    }
    // buildings along the road
    for (let t = 10, side = di % 2 ? 1 : -1; t <= L - 2; t += 9 + Math.floor(rnd() * 3), side = -side) {
      if (rnd() < 0.15) continue;
      const off = 6;
      const hx = x + fx * t + rx * side * off, hz = z + fz * t + rz * side * off;
      // facing: from house towards road = -side * r
      const toRoad = [-rx * side, -rz * side];
      const facing = toRoad[1] === 1 ? 0 : toRoad[0] === 1 ? 1 : toRoad[1] === -1 ? 2 : 3;
      let kind = rnd();
      kind = kind < 0.42 ? 'small' : kind < 0.62 ? 'big' : kind < 0.85 ? 'farm' : 'smith';
      if (kind === 'smith') { if (smithPlaced) kind = 'small'; else smithPlaced = true; }
      const hy = gen.column(hx, hz).h;
      if (hy <= SEA) continue;
      const seed = (hash3(hx, 3, hz, gen.seed) * 4294967296) >>> 0;
      const R = kind === 'big' ? 5 : kind === 'farm' ? 5 : 4;
      st.pieces.push({ box: [hx - R, 0, hz - R, hx + R, 0, hz + R], build(S) { BUILD[kind](local(S, hx, hy, hz, facing), M, mulberry32(seed), S); } });
    }
  });
}

const BUILD = {
  small(H, M, rnd) {
    // 5x5 house, front at az=+2 (towards road)
    H.fill(-3, 1, -3, 3, 7, 3, 0);
    for (let a = -2; a <= 2; a++) for (let c = -2; c <= 2; c++) { H.found(a, c, M.found); H.set(a, 0, c, M.floor); }
    for (let y = 1; y <= 3; y++) for (let a = -2; a <= 2; a++) for (let c = -2; c <= 2; c++) {
      if (Math.abs(a) < 2 && Math.abs(c) < 2) continue;
      const corner = Math.abs(a) === 2 && Math.abs(c) === 2;
      H.set(a, y, c, corner ? M.log : (y === 2 && (a === 0 || c === 0) ? M.glass : M.wall));
    }
    H.set(0, 1, 2, 0); H.set(0, 2, 2, 0); // door
    H.set(0, 3, 3, B.torch);
    if (M.flat) { H.fill(-2, 4, -2, 2, 4, 2, M.roof); H.fill(-2, 5, -2, 2, 5, 2, M.wall); H.fill(-1, 5, -1, 1, 5, 1, 0); }
    else {
      H.fill(-3, 4, -3, 3, 4, 3, M.roof);
      H.fill(-2, 5, -2, 2, 5, 2, M.roof);
      H.fill(-1, 6, -1, 1, 6, 1, M.roof);
      H.set(0, 7, 0, M.roof);
    }
    H.set(-1, 1, -1, B.bed); H.set(1, 1, -1, B.crafting_table); H.set(1, 1, 1, B.torch);
  },
  big(H, M, rnd) {
    H.fill(-5, 1, -4, 5, 9, 4, 0);
    for (let a = -4; a <= 4; a++) for (let c = -3; c <= 3; c++) { H.found(a, c, M.found); H.set(a, 0, c, M.floor); }
    for (let y = 1; y <= 4; y++) for (let a = -4; a <= 4; a++) for (let c = -3; c <= 3; c++) {
      if (Math.abs(a) < 4 && Math.abs(c) < 3) continue;
      const corner = Math.abs(a) === 4 && Math.abs(c) === 3;
      H.set(a, y, c, corner || (a === 0 && y < 4) ? M.log : (y >= 2 && y <= 3 && (a % 2 === 0) && !corner ? M.glass : M.wall));
    }
    // interior wall
    for (let y = 1; y <= 3; y++) for (let c = -2; c <= 2; c++) if (c !== 0) H.set(0, y, c, M.wall);
    H.set(-2, 1, 3, 0); H.set(-2, 2, 3, 0);
    if (M.flat) { H.fill(-4, 5, -3, 4, 5, 3, M.roof); for (let a = -4; a <= 4; a += 2) H.set(a, 6, 3, M.wall); }
    else for (let k = 0; k < 4; k++) H.fill(-5 + k, 5 + k, -4 + k, 5 - k, 5 + k, 4 - k, M.roof);
    H.set(-3, 1, -2, B.bed); H.set(-1, 1, -2, B.bed);
    H.set(3, 1, -2, B.furnace); H.chest(2, 1, -2, 'village');
    H.set(3, 1, 2, B.bookshelf); H.set(3, 2, 2, B.bookshelf);
    H.set(-3, 3, 2, B.torch); H.set(2, 3, 0, B.torch);
    H.set(1, 1, 2, B.crafting_table);
  },
  farm(H, M, rnd) {
    H.fill(-4, 1, -3, 4, 3, 3, 0);
    for (let a = -4; a <= 4; a++) for (let c = -3; c <= 3; c++) {
      H.found(a, c, B.dirt);
      const edge = Math.abs(a) === 4 || Math.abs(c) === 3;
      if (edge) H.set(a, 0, c, M.log);
      else if (c === 0) H.set(a, 0, c, B.water);
      else { H.set(a, 0, c, B.farmland); H.set(a, 1, c, B.wheat_0 + Math.floor(rnd() * 4)); }
    }
    H.set(-4, 1, -3, B.torch); H.set(4, 1, 3, B.torch); H.set(4, 1, -3, B.hay_block);
  },
  smith(H, M, rnd) {
    H.fill(-4, 1, -4, 4, 7, 4, 0);
    for (let a = -3; a <= 3; a++) for (let c = -3; c <= 3; c++) { H.found(a, c, B.cobblestone); H.set(a, 0, c, B.cobblestone); }
    for (let y = 1; y <= 3; y++) for (let a = -3; a <= 3; a++) for (let c = -3; c <= 3; c++) {
      if (c === 3 && Math.abs(a) < 3) continue; // open front
      if (Math.abs(a) < 3 && Math.abs(c) < 3) continue;
      H.set(a, y, c, Math.abs(a) === 3 && Math.abs(c) === 3 ? M.log : B.cobblestone);
    }
    H.fill(-3, 4, -3, 3, 4, 3, M.roof);
    H.set(-2, 1, -2, B.furnace); H.set(-1, 1, -2, B.furnace); H.chest(2, 1, -2, 'smith');
    H.set(2, 1, 0, B.iron_block); H.set(-2, 1, 1, B.lava); H.set(-2, 0, 1, B.cobblestone);
    H.set(0, 3, -2, B.torch); H.set(1, 1, 2, B.crafting_table);
  },
};

// =====================================================================
// Desert temple (stepped sandstone pyramid with towers and a hidden vault)
// =====================================================================
function planDesertTemple(st, gen, f) {
  const { x, z } = st, y = f.y;
  st.pieces.push({
    box: [x - 11, 0, z - 11, x + 11, 0, z + 11],
    build(S) {
      const SS = B.sandstone, CH_ = B.chiseled_sandstone, TC = B.terracotta, LP = B.lapis_block;
      // clear & foundation
      S.fill(x - 11, y + 1, z - 11, x + 11, y + 20, z + 11, 0);
      for (let dx = -10; dx <= 10; dx++) for (let dz = -10; dz <= 10; dz++) S.found(x + dx, y - 1, z + dz, SS);
      S.fill(x - 10, y - 3, z - 10, x + 10, y, z + 10, SS);
      // pyramid body: vertical base then steps
      for (let k = 1; k <= 12; k++) {
        const h = k <= 4 ? 10 : 14 - k;
        if (h < 1) break;
        S.fill(x - h, y + k, z - h, x + h, y + k, z + h, SS);
      }
      // hall
      S.fill(x - 6, y + 1, z - 6, x + 6, y + 6, z + 6, 0);
      for (const [dx, dz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) S.fill(x + dx, y + 1, z + dz, x + dx, y + 6, z + dz, CH_);
      // decorated band inside the hall
      for (let d = -6; d <= 6; d++) for (const [ax, az] of [[d, -7], [d, 7], [-7, d], [7, d]]) S.set(x + ax, y + 3, z + az, Math.abs(d) % 2 ? TC : LP);
      // floor pattern
      for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
        const r = Math.max(Math.abs(dx), Math.abs(dz));
        S.set(x + dx, y, z + dz, r === 3 ? TC : r === 2 ? SS : r === 1 ? TC : LP);
      }
      // entrance tunnel + facade
      S.fill(x - 1, y + 1, z + 6, x + 1, y + 4, z + 11, 0);
      S.fill(x - 3, y + 5, z + 10, x + 3, y + 5, z + 10, CH_);
      for (let dx = -9; dx <= 9; dx++) if (Math.abs(dx) > 2) S.set(x + dx, y + 2, z + 10, Math.abs(dx) % 2 ? TC : LP);
      S.fill(x - 1, y, z + 11, x + 1, y, z + 13, SS);
      // towers at the front corners
      for (const sx of [-1, 1]) {
        const tx = x + sx * 8, tz = z + 8;
        S.box(tx - 2, y, tz - 2, tx + 2, y + 13, tz + 2, SS);
        S.fill(tx - 2, y + 9, tz - 2, tx + 2, y + 9, tz + 2, TC);
        S.fill(tx - 1, y + 9, tz - 1, tx + 1, y + 9, tz + 1, 0);
        S.fill(tx - 1, y + 1, tz - 1, tx + 1, y + 12, tz + 1, 0);
        for (const [cx, cz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) S.set(tx + cx, y + 14, tz + cz, CH_);
        S.set(tx, y + 11, tz + 2, 0); S.set(tx, y + 11, tz - 2, 0); S.set(tx + 2, y + 11, tz, 0); S.set(tx - 2, y + 11, tz, 0);
        S.fill(tx, y + 1, tz + 2, tx, y + 2, tz + 2, 0);
        for (let yy = y + 1; yy <= y + 12; yy++) S.set(tx, yy, tz - 1, B.ladder);
      }
      // hidden vault under the centre (break the blue tile, climb down)
      S.box(x - 4, y - 10, z - 4, x + 4, y - 4, z + 4, SS);
      S.fill(x - 3, y - 9, z - 3, x + 3, y - 9, z + 3, TC);
      for (let yy = y - 1; yy >= y - 9; yy--) S.set(x, yy, z, B.ladder);
      S.set(x, y - 9, z, TC);
      S.chest(x, y - 8, z - 3, 'desert'); S.chest(x, y - 8, z + 3, 'desert', 2);
      S.chest(x - 3, y - 8, z, 'desert', 1); S.chest(x + 3, y - 8, z, 'desert', 3);
      S.set(x - 3, y - 6, z - 3, B.torch);
    },
  });
}

// =====================================================================
// Jungle temple (mossy stone temple with two floors and a basement)
// =====================================================================
function planJungleTemple(st, gen, f) {
  const { x, z } = st, y = f.y;
  st.pieces.push({
    box: [x - 8, 0, z - 9, x + 8, 0, z + 10],
    build(S) {
      const W = mix(gen.seed + 1, B.cobblestone, [[B.mossy_cobblestone, 0.55]]);
      const C = mix(gen.seed + 2, B.stone_bricks, [[B.mossy_stone_bricks, 0.35], [B.cracked_stone_bricks, 0.15]]);
      S.fill(x - 7, y + 1, z - 8, x + 7, y + 15, z + 9, 0);
      for (let dx = -6; dx <= 6; dx++) for (let dz = -7; dz <= 7; dz++) S.found(x + dx, y - 1, z + dz, W);
      // basement
      S.box(x - 5, y - 5, z - 6, x + 5, y, z + 6, W);
      S.chest(x - 4, y - 4, z - 5, 'jungle'); S.chest(x + 4, y - 4, z + 5, 'jungle', 2);
      S.set(x, y - 4, z, B.glowing_crystal);
      // ground floor
      S.box(x - 6, y, z - 7, x + 6, y + 5, z + 7, W);
      for (const dx of [-3, 3]) S.fill(x + dx, y + 1, z - 6, x + dx, y + 4, z + 4, C);
      S.fill(x - 3, y + 1, z - 1, x + 3, y + 3, z + 1, 0);
      S.fill(x - 3, y + 1, z + 4, x + 3, y + 3, z + 4, 0);
      for (let yy = y; yy >= y - 4; yy--) S.set(x - 4, yy, z + 5, B.ladder); // into basement
      S.chest(x - 5, y + 1, z - 6, 'jungle');
      // entrance + steps
      S.fill(x - 1, y + 1, z + 7, x + 1, y + 3, z + 7, 0);
      S.fill(x - 2, y, z + 8, x + 2, y, z + 9, W);
      // second floor
      S.box(x - 5, y + 5, z - 6, x + 5, y + 10, z + 6, W);
      S.fill(x - 1, y + 6, z + 6, x + 1, y + 8, z + 6, 0);
      for (let yy = y + 1; yy <= y + 5; yy++) S.set(x + 4, yy, z - 5, B.ladder);
      for (let yy = y + 1; yy <= y + 6; yy++) S.set(x + 2, yy, z + 8, B.ladder);
      S.fill(x - 4, y + 6, z - 5, x + 4, y + 9, z + 5, 0);
      for (const dx of [-2, 2]) for (const dz of [-3, 3]) S.fill(x + dx, y + 6, z + dz, x + dx, y + 9, z + dz, C);
      S.set(x, y + 6, z - 4, B.glowing_crystal);
      // stepped roof
      S.fill(x - 4, y + 11, z - 5, x + 4, y + 11, z + 5, W);
      S.fill(x - 3, y + 12, z - 3, x + 3, y + 12, z + 3, W);
      S.fill(x - 1, y + 13, z - 1, x + 1, y + 13, z + 1, C);
      for (const [dx, dz] of [[-4, -5], [4, -5], [-4, 5], [4, 5]]) S.set(x + dx, y + 12, z + dz, C);
      // overgrowth
      for (let dx = -6; dx <= 6; dx++) for (let dz = -7; dz <= 7; dz++) {
        if (hash3(x + dx, y, z + dz, gen.seed) < 0.1 && S.get(x + dx, y + 11, z + dz) > 0 && S.get(x + dx, y + 12, z + dz) === 0) S.set(x + dx, y + 12, z + dz, B.jungle_leaves);
      }
    },
  });
}

// =====================================================================
// Underground fortress (rooms + corridors + portal room to the Leere)
// =====================================================================
const ROOM_HALF = { cross: 4, library: 7, chests: 4, fountain: 5, portal: 7, start: 4 };
const ROOM_H = { cross: 6, library: 9, chests: 5, fountain: 7, portal: 9, start: 6 };

function planStronghold(st, gen, f, rnd) {
  const y = f.y;
  const rooms = [];
  const corridors = [];
  const overlaps = (cx, cz, h) => rooms.some((r) => Math.abs(r.x - cx) < r.h + h + 3 && Math.abs(r.z - cz) < r.h + h + 3);
  const start = { x: st.x, z: st.z, type: 'start', h: 4, depth: 0, from: -1 };
  rooms.push(start);
  const queue = [start];
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let portalPlaced = false;
  while (queue.length) {
    const r = queue.shift();
    for (let d = 0; d < 4; d++) {
      if (d === r.from) continue;
      if (r.depth >= 3 || rnd() > (r.depth === 0 ? 0.95 : 0.6)) continue;
      const [dx, dz] = DIRS[d];
      let type = ['cross', 'cross', 'library', 'chests', 'fountain'][Math.floor(rnd() * 5)];
      if (!portalPlaced && r.depth >= 1 && rnd() < 0.5) type = 'portal';
      const h = ROOM_HALF[type];
      const len = 10 + Math.floor(rnd() * 12);
      const nx = r.x + dx * (r.h + len + h), nz = r.z + dz * (r.h + len + h);
      if (overlaps(nx, nz, h)) continue;
      if (type === 'portal') portalPlaced = true;
      const nr = { x: nx, z: nz, type, h, depth: r.depth + 1, from: d ^ 1 };
      rooms.push(nr); queue.push(nr);
      corridors.push({ ax: r.x + dx * r.h, az: r.z + dz * r.h, bx: nx - dx * h, bz: nz - dz * h, dx, dz });
    }
  }
  if (!portalPlaced) {
    // attach a portal room to the start room in a free direction
    for (let d = 0; d < 4 && !portalPlaced; d++) {
      const [dx, dz] = DIRS[d];
      const h = 7, len = 12;
      const nx = start.x + dx * (start.h + len + h), nz = start.z + dz * (start.h + len + h);
      if (overlaps(nx, nz, h)) continue;
      rooms.push({ x: nx, z: nz, type: 'portal', h, depth: 1 });
      corridors.push({ ax: start.x + dx * start.h, az: start.z + dz * start.h, bx: nx - dx * h, bz: nz - dz * h, dx, dz });
      portalPlaced = true;
    }
  }
  const W = mix(gen.seed + 7, B.stone_bricks, [[B.mossy_stone_bricks, 0.18], [B.cracked_stone_bricks, 0.14]]);
  for (const r of rooms) {
    st.pieces.push({ box: [r.x - r.h, 0, r.z - r.h, r.x + r.h, 0, r.z + r.h], build(S) { buildRoom(S, r, y, W, gen); } });
  }
  for (const c of corridors) {
    const x0 = Math.min(c.ax, c.bx), x1 = Math.max(c.ax, c.bx), z0 = Math.min(c.az, c.bz), z1 = Math.max(c.az, c.bz);
    st.pieces.push({
      box: [x0 - 2, 0, z0 - 2, x1 + 2, 0, z1 + 2],
      build(S) {
        const along = c.dx !== 0;
        if (along) { S.fill(x0, y, z0 - 2, x1, y + 4, z0 + 2, W); S.fill(x0, y + 1, z0 - 1, x1, y + 3, z0 + 1, 0); }
        else { S.fill(x0 - 2, y, z0, x0 + 2, y + 4, z1, W); S.fill(x0 - 1, y + 1, z0, x0 + 1, y + 3, z1, 0); }
        const len = along ? x1 - x0 : z1 - z0;
        for (let t = 4; t < len; t += 7) {
          const tx = along ? x0 + t : x0 - 1, tz = along ? z0 - 1 : z0 + t;
          S.set(tx, y + 1, tz, B.torch);
        }
      },
    });
  }
}

function buildRoom(S, r, y, W, gen) {
  const { x, z, h } = r;
  const H = ROOM_H[r.type];
  S.box(x - h, y, z - h, x + h, y + H, z + h, W);
  if (r.type === 'start' || r.type === 'cross') {
    S.fill(x, y + 1, z, x, y + H - 1, z, W);
    for (const [dx, dz] of [[-h + 1, -h + 1], [h - 1, h - 1]]) S.set(x + dx, y + 1, z + dz, B.torch);
  } else if (r.type === 'library') {
    for (let yy = y + 1; yy <= y + 4; yy++) for (let d = -h + 1; d <= h - 1; d++) {
      for (const [ax, az] of [[d, -h + 1], [d, h - 1], [-h + 1, d], [h - 1, d]]) if (Math.abs(d) > 1) S.set(x + ax, yy, z + az, B.bookshelf);
    }
    for (const dz of [-3, 0, 3]) S.fill(x - 3, y + 1, z + dz, x + 3, y + 3, z + dz, B.bookshelf);
    S.fill(x - 3, y + 1, z - 1, x + 3, y + 3, z - 1, 0); S.fill(x - 3, y + 1, z + 1, x + 3, y + 3, z + 1, 0);
    S.fill(x - 4, y + 5, z - 4, x + 4, y + 5, z + 4, B.oak_planks);
    S.fill(x - 3, y + 5, z - 3, x + 3, y + 5, z + 3, 0);
    for (let yy = y + 1; yy <= y + 5; yy++) S.set(x + 4, yy, z + 5, B.ladder);
    S.chest(x - 5, y + 1, z, 'library'); S.chest(x + 3, y + 6, z - 4, 'library');
    S.set(x, y + 1, z - 4, B.lantern); S.set(x, y + 6, z + 4, B.lantern); S.set(x - 5, y + 6, z - 5, B.lantern);
  } else if (r.type === 'chests') {
    S.chest(x - 3, y + 1, z, 'stronghold', 1); S.chest(x + 3, y + 1, z, 'stronghold', 3);
    S.set(x, y + 1, z, B.iron_block); S.set(x, y + 3, z - 3, B.torch);
  } else if (r.type === 'fountain') {
    S.fill(x - 2, y + 1, z - 2, x + 2, y + 1, z + 2, W);
    S.fill(x - 1, y + 1, z - 1, x + 1, y + 1, z + 1, B.water);
    S.fill(x, y + 2, z, x, y + 4, z, W); S.set(x, y + 5, z, B.water);
    for (const [dx, dz] of [[-4, -4], [4, 4], [-4, 4], [4, -4]]) S.set(x + dx, y + 1, z + dz, B.torch);
  } else if (r.type === 'portal') {
    // lava channels along two walls
    S.fill(x - h + 1, y, z - h + 1, x - h + 2, y, z + h - 1, B.lava);
    S.fill(x + h - 2, y, z - h + 1, x + h - 1, y, z + h - 1, B.lava);
    // raised dais with frame ring and active portal
    S.fill(x - 3, y + 1, z - 3, x + 3, y + 1, z + 3, W);
    S.fill(x - 2, y + 2, z - 2, x + 2, y + 2, z + 2, B.leerenrahmen);
    S.fill(x - 1, y + 2, z - 1, x + 1, y + 2, z + 1, B.leerenportal);
    S.fill(x - 1, y + 1, z + 4, x + 1, y + 1, z + 4, W);
    for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) { S.fill(x + dx, y + 2, z + dz, x + dx, y + 4, z + dz, B.stone_bricks); S.set(x + dx, y + 5, z + dz, B.lantern); }
  }
}

// =====================================================================
// Glutfestung (Unterwelt): central hall, bridges, towers
// =====================================================================
function planFortress(st, gen, f, rnd) {
  const { x, z } = st, y = f.y;
  const BR = B.glutziegel, FE = B.glutzaun;
  st.pieces.push({
    box: [x - 8, 0, z - 8, x + 8, 0, z + 8],
    build(S) {
      S.box(x - 8, y, z - 8, x + 8, y + 8, z + 8, BR);
      S.fill(x - 7, y + 1, z - 7, x + 7, y + 7, z + 7, 0);
      for (let d = -6; d <= 6; d += 3) for (const [ax, az] of [[d, -8], [d, 8], [-8, d], [8, d]]) S.fill(x + ax, y + 3, z + az, x + ax, y + 5, z + az, FE);
      for (const [ax, az] of [[0, -8], [0, 8], [-8, 0], [8, 0]]) S.fill(x + ax - (az ? 1 : 0), y + 1, z + az - (ax ? 1 : 0), x + ax + (az ? 1 : 0), y + 4, z + az + (ax ? 1 : 0), 0);
      // courtyard with fire mushrooms on ash sand
      S.fill(x - 2, y, z - 2, x + 2, y, z + 2, B.aschesand);
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (hash3(x + dx, y, z + dz, gen.seed) < 0.6) S.set(x + dx, y + 1, z + dz, B.glutpilz);
      S.chest(x - 6, y + 1, z - 6, 'fortress'); S.chest(x + 6, y + 1, z + 6, 'fortress', 2);
      for (const [dx, dz] of [[-6, 6], [6, -6]]) S.set(x + dx, y + 1, z + dz, B.lantern);
      supports(S, x - 8, z - 8, x + 8, z + 8, y - 1, BR, 4);
    },
  });
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [dx, dz] of DIRS) {
    if (rnd() < 0.15) continue;
    const L = 24 + Math.floor(rnd() * 30);
    const covered = rnd() < 0.5;
    const ax = x + dx * 9, az = z + dz * 9, bx = x + dx * (9 + L), bz = z + dz * (9 + L);
    const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), z0 = Math.min(az, bz), z1 = Math.max(az, bz);
    const along = dx !== 0;
    st.pieces.push({
      box: [x0 - 2, 0, z0 - 2, x1 + 2, 0, z1 + 2],
      build(S) {
        const ex0 = along ? x0 : x0 - 2, ex1 = along ? x1 : x1 + 2, ez0 = along ? z0 - 2 : z0, ez1 = along ? z1 + 2 : z1;
        S.fill(ex0, y + 1, ez0, ex1, y + 5, ez1, 0);
        S.fill(ex0, y, ez0, ex1, y, ez1, BR);
        if (covered) {
          if (along) { S.fill(x0, y + 1, z0 - 2, x1, y + 4, z0 - 2, BR); S.fill(x0, y + 1, z1 + 2, x1, y + 4, z1 + 2, BR); }
          else { S.fill(x0 - 2, y + 1, z0, x0 - 2, y + 4, z1, BR); S.fill(x1 + 2, y + 1, z0, x1 + 2, y + 4, z1, BR); }
          S.fill(ex0, y + 5, ez0, ex1, y + 5, ez1, BR);
          const len = along ? x1 - x0 : z1 - z0;
          for (let t = 2; t < len; t += 4) {
            if (along) { S.set(x0 + t, y + 2, z0 - 2, FE); S.set(x0 + t, y + 2, z1 + 2, FE); }
            else { S.set(x0 - 2, y + 2, z0 + t, FE); S.set(x1 + 2, y + 2, z0 + t, FE); }
          }
        } else {
          if (along) { S.fill(x0, y + 1, z0 - 2, x1, y + 1, z0 - 2, FE); S.fill(x0, y + 1, z1 + 2, x1, y + 1, z1 + 2, FE); }
          else { S.fill(x0 - 2, y + 1, z0, x0 - 2, y + 1, z1, FE); S.fill(x1 + 2, y + 1, z0, x1 + 2, y + 1, z1, FE); }
        }
        // support pillars every 7 blocks
        const len = along ? x1 - x0 : z1 - z0;
        for (let t = 3; t < len; t += 7) {
          const px = along ? x0 + t : x0, pz = along ? z0 : z0 + t;
          supports(S, px - (along ? 0 : 1), pz - (along ? 1 : 0), px + (along ? 0 : 1), pz + (along ? 1 : 0), y - 1, BR, 1);
        }
      },
    });
    // tower at the end of the bridge
    const tx = x + dx * (9 + L + 4), tz = z + dz * (9 + L + 4);
    st.pieces.push({
      box: [tx - 4, 0, tz - 4, tx + 4, 0, tz + 4],
      build(S) {
        S.box(tx - 4, y, tz - 4, tx + 4, y + 10, tz + 4, BR);
        S.fill(tx - 3, y + 1, tz - 3, tx + 3, y + 9, tz + 3, 0);
        S.fill(tx - dx * 4 - (dz ? 1 : 0), y + 1, tz - dz * 4 - (dx ? 1 : 0), tx - dx * 4 + (dz ? 1 : 0), y + 3, tz - dz * 4 + (dx ? 1 : 0), 0);
        for (const [ax, az] of [[0, -4], [0, 4], [-4, 0], [4, 0]]) S.fill(tx + ax, y + 6, tz + az, tx + ax, y + 7, tz + az, FE);
        S.chest(tx, y + 1, tz, 'fortress');
        S.set(tx + 2, y + 1, tz + 2, B.lantern);
        for (let yy = y + 1; yy <= y + 10; yy++) S.set(tx - 3, yy, tz - 3, B.ladder);
        S.fill(tx - 4, y + 11, tz - 4, tx + 4, y + 11, tz + 4, FE);
        S.fill(tx - 3, y + 11, tz - 3, tx + 3, y + 11, tz + 3, 0);
        supports(S, tx - 4, tz - 4, tx + 4, tz + 4, y - 1, BR, 4);
      },
    });
  }
}

// pillars going down until solid ground (inside current chunk)
function supports(S, x0, z0, x1, z1, yTop, id, step) {
  for (let x = x0; x <= x1; x += step) for (let z = z0; z <= z1; z += step) {
    for (let y = yTop; y > 1; y--) {
      const b = S.get(x, y, z);
      if (b === -1) break;
      if (b !== 0 && b !== B.lava) break;
      S.set(x, y, z, id);
    }
  }
}

// =====================================================================
// Leere: return portal platform + Sternenstadt
// =====================================================================
function planEndCenter(st, gen, f) {
  const y = f.y;
  st.pieces.push({
    box: [-4, 0, -4, 4, 0, 4],
    build(S) {
      S.fill(-4, y + 1, -4, 4, y + 6, 4, 0);
      S.fill(-3, y, -3, 3, y, 3, B.leerenstein_ziegel);
      S.fill(-1, y, -1, 1, y, 1, B.leerenportal);
      for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) { S.fill(dx, y + 1, dz, dx, y + 3, dz, B.sternensaeule); S.set(dx, y + 4, dz, B.glowing_crystal); }
    },
  });
}

function planEndCity(st, gen, f, rnd) {
  const { x, z } = st, y = f.y;
  const SZ = B.sternenziegel, SA = B.sternensaeule;
  const tower = (tx, tz, segs, chestTop) => (S) => {
    let yy = y;
    for (let i = 0; i < segs.length; i++) {
      const [h, H] = segs[i];
      S.box(tx - h, yy, tz - h, tx + h, yy + H, tz + h, SZ);
      S.fill(tx - h + 1, yy + 1, tz - h + 1, tx + h - 1, yy + H - 1, tz + h - 1, 0);
      for (const [cx, cz] of [[-h, -h], [h, -h], [-h, h], [h, h]]) S.fill(tx + cx, yy, tz + cz, tx + cx, yy + H, tz + cz, SA);
      // windows
      for (let d = -h + 2; d <= h - 2; d += 2) for (const [ax, az] of [[d, -h], [d, h], [-h, d], [h, d]]) S.set(tx + ax, yy + Math.floor(H / 2), tz + az, B.glass);
      S.set(tx + h - 1, yy + 1, tz, B.glowing_crystal);
      yy += H;
    }
    for (let k = y + 1; k < yy; k++) S.set(tx - 2, k, tz - 2, B.ladder);
    const h = segs[segs.length - 1][0];
    for (let k = 0; k <= h; k++) S.fill(tx - h + k, yy + k, tz - h + k, tx + h - k, yy + k, tz + h - k, SZ);
    if (chestTop) { const top = yy - segs[segs.length - 1][1]; S.chest(tx, top + 1, tz, 'city'); S.chest(tx + 1, top + 1, tz, 'city'); }
  };
  const mainSegs = [[5, 6], [4, 6], [4, 6], [3, 5]];
  st.pieces.push({
    box: [x - 6, 0, z - 6, x + 6, 0, z + 6],
    build(S) {
      S.fill(x - 6, y + 1, z - 6, x + 6, y + 40, z + 6, 0);
      for (let dx = -5; dx <= 5; dx++) for (let dz = -5; dz <= 5; dz++) S.found(x + dx, y, z + dz, B.leerenstein_ziegel);
      tower(x, z, mainSegs, true)(S);
      S.fill(x - 1, y + 1, z + 5, x + 1, y + 3, z + 5, 0); // entrance
    },
  });
  // side tower + bridge
  const sx = x + 16 * (rnd() < 0.5 ? 1 : -1);
  st.pieces.push({
    box: [sx - 4, 0, z - 4, sx + 4, 0, z + 4],
    build(S) {
      S.fill(sx - 4, y + 1, z - 4, sx + 4, y + 26, z + 4, 0);
      for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) S.found(sx + dx, y, z + dz, B.leerenstein_ziegel);
      tower(sx, z, [[3, 6], [3, 6], [3, 6]], true)(S);
      S.fill(sx - 1, y + 1, z + 3, sx + 1, y + 3, z + 3, 0);
    },
  });
  const bx0 = Math.min(x, sx) + 4, bx1 = Math.max(x, sx) - 4, by = y + 12;
  st.pieces.push({
    box: [bx0 - 1, 0, z - 2, bx1 + 1, 0, z + 2],
    build(S) {
      S.fill(bx0 - 1, by, z - 1, bx1 + 1, by, z + 1, SZ);
      S.fill(bx0 - 1, by + 1, z - 1, bx1 + 1, by + 1, z - 1, B.glass);
      S.fill(bx0 - 1, by + 1, z + 1, bx1 + 1, by + 1, z + 1, B.glass);
      S.fill(bx0 - 1, by + 1, z, bx1 + 1, by + 3, z, 0);
      S.fill(bx0 - 2, by + 1, z, bx0 - 1, by + 2, z, 0); S.fill(bx1 + 1, by + 1, z, bx1 + 2, by + 2, z, 0);
    },
  });
}
