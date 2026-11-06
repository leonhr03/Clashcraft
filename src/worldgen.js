// Terrain generator: biomes, caves, ores, trees, plants.
import { Simplex, hash3, mulberry32 } from './noise.js';
import { B } from './blocks.js';

export const CS = 16;          // chunk size x/z
export const CH = 128;         // world height
export const SEA = 48;

export const BIOMES = {
  OCEAN: 0, BEACH: 1, PLAINS: 2, FOREST: 3, BIRCH: 4, TAIGA: 5, DESERT: 6, SNOW: 7, MOUNTAINS: 8, SWAMP: 9,
};
export const BIOME_NAMES = ['Ozean', 'Strand', 'Ebene', 'Wald', 'Birkenwald', 'Taiga', 'Wüste', 'Schneetundra', 'Berge', 'Sumpf'];

export class WorldGen {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.n1 = new Simplex(seed);
    this.n2 = new Simplex(seed + 1);
    this.n3 = new Simplex(seed + 2);
    this.n4 = new Simplex(seed + 3);
    this.n5 = new Simplex(seed + 4);
    this.cave1 = new Simplex(seed + 10);
    this.cave2 = new Simplex(seed + 11);
    this.cave3 = new Simplex(seed + 12);
    this.colCache = new Map();
  }

  // returns {h, biome, temp, hum}
  column(x, z) {
    const key = x * 73856093 ^ z * 19349663;
    const c = this.colCache.get(key);
    if (c && c.x === x && c.z === z) return c;
    const cont = this.n1.fbm2(x / 600, z / 600, 4);       // continentalness
    const ero = this.n2.fbm2(x / 300, z / 300, 3);        // erosion / mountains
    const det = this.n3.fbm2(x / 60, z / 60, 4);          // detail
    const temp = this.n4.fbm2(x / 500, z / 500, 2);
    const hum = this.n5.fbm2(x / 420 + 100, z / 420 - 100, 2);

    let h = SEA + 6 + cont * 26 + det * 6;
    const mountain = Math.max(0, ero - 0.15) * 1.8;
    h += mountain * mountain * 70 * (cont > -0.1 ? 1 : 0.3);
    if (cont < -0.25) h = SEA - 4 + (cont + 0.25) * 50 + det * 4; // ocean basins

    h = Math.max(4, Math.min(CH - 8, Math.floor(h)));

    let biome;
    if (h < SEA - 1) biome = BIOMES.OCEAN;
    else if (h <= SEA + 1 && cont < 0) biome = BIOMES.BEACH;
    else if (mountain > 0.35 && h > SEA + 30) biome = BIOMES.MOUNTAINS;
    else if (temp > 0.35 && hum < 0.1) biome = BIOMES.DESERT;
    else if (temp < -0.4) biome = BIOMES.SNOW;
    else if (temp < -0.15) biome = BIOMES.TAIGA;
    else if (hum > 0.45 && h < SEA + 6) biome = BIOMES.SWAMP;
    else if (hum > 0.2) biome = temp > 0.1 ? BIOMES.FOREST : BIOMES.BIRCH;
    else if (hum > -0.05) biome = BIOMES.FOREST;
    else biome = BIOMES.PLAINS;

    if (biome === BIOMES.SWAMP) h = Math.min(h, SEA + 1);
    const r = { x, z, h, biome, temp, hum };
    if (this.colCache.size > 20000) this.colCache.clear();
    this.colCache.set(key, r);
    return r;
  }

  isCave(x, y, z, surface) {
    if (y < 2) return false;
    // spaghetti caves
    const a = this.cave1.noise3(x / 45, y / 30, z / 45);
    const b = this.cave2.noise3(x / 45, y / 30, z / 45);
    if (a * a + b * b < 0.012 * (y < surface - 6 ? 1 : 0.5)) return true;
    // cheese caves deep down
    if (y < 40) {
      const c = this.cave3.noise3(x / 70, y / 35, z / 70);
      if (c > 0.62) return true;
    }
    return false;
  }

  treeAt(x, z, col) {
    if (col.h <= SEA) return null;
    const r = hash3(x, 7, z, this.seed);
    let chance = 0, type = null;
    switch (col.biome) {
      case BIOMES.FOREST: chance = 0.022; type = r * 1000 % 1 < 0.2 ? 'birch' : 'oak'; break;
      case BIOMES.BIRCH: chance = 0.022; type = 'birch'; break;
      case BIOMES.TAIGA: chance = 0.03; type = 'spruce'; break;
      case BIOMES.SNOW: chance = 0.004; type = 'spruce'; break;
      case BIOMES.PLAINS: chance = 0.0015; type = 'oak'; break;
      case BIOMES.SWAMP: chance = 0.01; type = 'oak'; break;
      case BIOMES.MOUNTAINS: chance = 0.004; type = 'spruce'; break;
      default: return null;
    }
    if (r >= chance) return null;
    const hr = hash3(x, 9, z, this.seed);
    return { type, height: type === 'spruce' ? 6 + Math.floor(hr * 4) : 4 + Math.floor(hr * 3) };
  }

  generate(chunk) {
    const { cx, cz, blocks } = chunk;
    const x0 = cx * CS, z0 = cz * CS;
    const rnd = mulberry32((this.seed ^ (cx * 341873128712 + cz * 132897987541)) >>> 0);
    const idx = (x, y, z) => (y * CS + z) * CS + x;

    for (let lz = 0; lz < CS; lz++) for (let lx = 0; lx < CS; lx++) {
      const wx = x0 + lx, wz = z0 + lz;
      const col = this.column(wx, wz);
      const h = col.h;
      let top, filler, fillerDepth = 3;
      switch (col.biome) {
        case BIOMES.OCEAN: top = h < SEA - 8 ? B.gravel : B.sand; filler = B.sand; break;
        case BIOMES.BEACH: top = B.sand; filler = B.sand; break;
        case BIOMES.DESERT: top = B.sand; filler = B.sand; fillerDepth = 4; break;
        case BIOMES.SNOW: top = B.snowy_grass; filler = B.dirt; break;
        case BIOMES.MOUNTAINS: top = h > 95 ? B.snow_block : (h > 80 ? B.stone : B.grass); filler = h > 80 ? B.stone : B.dirt; break;
        case BIOMES.SWAMP: top = B.grass; filler = B.dirt; break;
        default: top = B.grass; filler = B.dirt;
      }
      for (let y = 0; y <= Math.max(h, SEA); y++) {
        let id;
        if (y === 0) id = B.bedrock;
        else if (y < 4 && rnd() < 0.5) id = B.bedrock;
        else if (y > h) id = y <= SEA ? (col.biome === BIOMES.SNOW && y === SEA ? B.ice : B.water) : 0;
        else if (y === h) id = top;
        else if (y > h - fillerDepth) id = filler;
        else if (col.biome === BIOMES.DESERT && y > h - fillerDepth - 3) id = B.sandstone;
        else id = B.stone;
        if (id === B.grass && h < SEA) id = B.dirt;
        if (id !== 0 && id !== B.water && id !== B.bedrock && id !== B.ice && y <= h && y < h + 1) {
          if (this.isCave(wx, y, wz, h) && !(y >= h - 1 && h <= SEA + 1)) id = y < 11 ? B.lava : 0;
        }
        blocks[idx(lx, y, lz)] = id;
      }
    }

    // ores & stone variants
    const ores = [
      [B.coal_ore, 20, 5, 120, 12],
      [B.copper_ore, 8, 30, 90, 8],
      [B.iron_ore, 12, 5, 70, 8],
      [B.lapis_ore, 2, 5, 32, 6],
      [B.gold_ore, 2, 5, 32, 7],
      [B.diamond_ore, 1.5, 3, 16, 6],
      [B.granite, 2, 5, 80, 30],
      [B.diorite, 2, 5, 80, 30],
      [B.andesite, 2, 5, 80, 30],
      [B.gravel, 2, 5, 70, 25],
      [B.dirt, 2, 20, 90, 25],
    ];
    for (const [ore, per, ymin, ymax, size] of ores) {
      const count = Math.floor(per) + (rnd() < per % 1 ? 1 : 0);
      for (let i = 0; i < count; i++) {
        let x = Math.floor(rnd() * CS), y = ymin + Math.floor(rnd() * (ymax - ymin)), z = Math.floor(rnd() * CS);
        for (let k = 0; k < size; k++) {
          if (x >= 0 && x < CS && z >= 0 && z < CS && y > 0 && y < CH) {
            const j = idx(x, y, z);
            if (blocks[j] === B.stone) blocks[j] = ore;
          }
          const d = Math.floor(rnd() * 6);
          if (d === 0) x++; else if (d === 1) x--; else if (d === 2) y++; else if (d === 3) y--; else if (d === 4) z++; else z--;
        }
      }
    }

    // surface plants
    for (let lz = 0; lz < CS; lz++) for (let lx = 0; lx < CS; lx++) {
      const wx = x0 + lx, wz = z0 + lz;
      const col = this.column(wx, wz);
      const h = col.h;
      if (h + 1 >= CH) continue;
      const ground = blocks[idx(lx, h, lz)];
      const above = blocks[idx(lx, h + 1, lz)];
      if (above !== 0) continue;
      const r = hash3(wx, 3, wz, this.seed);
      if (ground === B.grass) {
        const g = col.biome === BIOMES.PLAINS ? 0.18 : col.biome === BIOMES.SWAMP ? 0.12 : 0.08;
        if (r < g) blocks[idx(lx, h + 1, lz)] = B.tall_grass;
        else if (r < g + 0.012) blocks[idx(lx, h + 1, lz)] = [B.poppy, B.dandelion, B.blue_flower][Math.floor(r * 10000) % 3];
        else if (r < g + 0.0135 && col.biome !== BIOMES.SWAMP) blocks[idx(lx, h + 1, lz)] = r * 1e5 % 1 < 0.5 ? B.pumpkin : B.melon;
        else if (r < g + 0.016 && (col.biome === BIOMES.SWAMP || col.biome === BIOMES.FOREST || col.biome === BIOMES.TAIGA)) blocks[idx(lx, h + 1, lz)] = r * 1e5 % 1 < 0.5 ? B.red_mushroom : B.brown_mushroom;
        // sugar cane near water
        if (h === SEA && r > 0.9) {
          const nearWater = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => this.column(wx + dx, wz + dz).h < SEA);
          if (nearWater) { const ch = 1 + Math.floor((r - 0.9) * 30); for (let k = 1; k <= ch && h + k < CH; k++) blocks[idx(lx, h + k, lz)] = B.sugar_cane; }
        }
      } else if (ground === B.sand && col.biome === BIOMES.DESERT) {
        if (r < 0.006) { const ch = 1 + Math.floor(r * 500); for (let k = 1; k <= ch && h + k < CH; k++) blocks[idx(lx, h + k, lz)] = B.cactus; }
        else if (r < 0.012) blocks[idx(lx, h + 1, lz)] = B.dead_bush;
      } else if (ground === B.snowy_grass && r < 0.02) {
        blocks[idx(lx, h + 1, lz)] = B.tall_grass;
      }
      if (h === SEA - 1 && ground === B.sand && r > 0.995) blocks[idx(lx, h, lz)] = B.clay;
    }

    // trees (including from neighbouring columns, so canopies cross chunk borders)
    for (let wz = z0 - 3; wz < z0 + CS + 3; wz++) for (let wx = x0 - 3; wx < x0 + CS + 3; wx++) {
      const col = this.column(wx, wz);
      const t = this.treeAt(wx, wz, col);
      if (!t) continue;
      // check ground exists (not carved): only when inside chunk; outside assume ok
      this.placeTree(chunk, wx - x0, col.h + 1, wz - z0, t.type, t.height, (wx & 0xff) ^ (wz << 3), idx);
    }
  }

  placeTree(chunk, lx, y0, lz, type, height, salt, idx) {
    const blocks = chunk.blocks;
    const inside = (x, y, z) => x >= 0 && x < CS && z >= 0 && z < CS && y > 0 && y < CH;
    if (inside(lx, y0 - 1, lz)) {
      const g = blocks[idx(lx, y0 - 1, lz)];
      if (g !== B.grass && g !== B.dirt && g !== B.snowy_grass) return;
    }
    const log = type === 'birch' ? B.birch_log : type === 'spruce' ? B.spruce_log : B.oak_log;
    const leaf = type === 'birch' ? B.birch_leaves : type === 'spruce' ? B.spruce_leaves : B.oak_leaves;
    const setLeaf = (x, y, z) => {
      if (!inside(x, y, z)) return;
      const j = idx(x, y, z);
      const cur = blocks[j];
      if (cur === 0 || cur === B.tall_grass) blocks[j] = leaf;
    };
    if (type === 'spruce') {
      let r = 0;
      for (let y = y0 + height; y >= y0 + 2; y--) {
        const rr = Math.min(3, r);
        for (let dz = -rr; dz <= rr; dz++) for (let dx = -rr; dx <= rr; dx++) {
          if (Math.abs(dx) + Math.abs(dz) <= rr + (rr > 1 ? 0 : 1) && !(dx === 0 && dz === 0 && y < y0 + height)) setLeaf(lx + dx, y, lz + dz);
        }
        r = (y - y0) % 2 === 0 ? r + 1 : Math.max(0, r - 1) + (r > 2 ? 0 : 1);
      }
      setLeaf(lx, y0 + height + 1, lz);
    } else {
      for (let y = y0 + height - 3; y <= y0 + height + 1; y++) {
        const top = y - (y0 + height);
        const rr = top >= 0 ? 1 : 2;
        for (let dz = -rr; dz <= rr; dz++) for (let dx = -rr; dx <= rr; dx++) {
          if (Math.abs(dx) === rr && Math.abs(dz) === rr && (top >= 0 || hash3(lx + dx, y, lz + dz, salt) < 0.5)) continue;
          setLeaf(lx + dx, y, lz + dz);
        }
      }
    }
    for (let y = y0; y < y0 + height; y++) if (inside(lx, y, lz)) blocks[idx(lx, y, lz)] = log;
  }

  findSpawn() {
    for (let r = 0; r < 400; r += 8) {
      for (let a = 0; a < 8; a++) {
        const x = Math.round(Math.cos(a) * r), z = Math.round(Math.sin(a) * r);
        const c = this.column(x, z);
        if (c.h > SEA && c.biome !== BIOMES.OCEAN) return { x: x + 0.5, y: c.h + 2, z: z + 0.5 };
      }
    }
    return { x: 0.5, y: CH - 20, z: 0.5 };
  }
}
