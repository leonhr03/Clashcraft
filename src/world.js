// Chunk storage, lighting, block access.
import { CS, CH, WorldGen } from './worldgen.js';
import { OPAQUE, LIGHT_EMIT, LIGHT_FILTER, BLOCKS } from './blocks.js';

export { CS, CH };

export class Chunk {
  constructor(cx, cz) {
    this.cx = cx; this.cz = cz;
    this.blocks = new Uint8Array(CS * CS * CH);
    this.sky = new Uint8Array(CS * CS * CH);
    this.blk = new Uint8Array(CS * CS * CH);
    this.dirty = true;     // needs remesh
    this.lightDirty = true;
    this.modified = false; // differs from generator output (needs saving)
    this.mesh = null;
    this.generated = false;
  }
}

export const idx = (x, y, z) => (y * CS + z) * CS + x;

export class World {
  constructor(seed, savedChunks) {
    this.seed = seed;
    this.gen = new WorldGen(seed);
    this.chunks = new Map();
    this.saved = savedChunks || new Map(); // key -> Uint8Array (modified chunks)
    this.tile = new Map(); // "x,y,z" -> tile entity data (chest, furnace)
    this.onBlockChange = null;
  }

  key(cx, cz) { return cx + ',' + cz; }
  getChunk(cx, cz) { return this.chunks.get(cx + ',' + cz); }

  ensureChunk(cx, cz) {
    const k = cx + ',' + cz;
    let c = this.chunks.get(k);
    if (c) return c;
    c = new Chunk(cx, cz);
    const saved = this.saved.get(k);
    if (saved) { c.blocks.set(saved); c.modified = true; }
    else this.gen.generate(c);
    c.generated = true;
    this.chunks.set(k, c);
    // neighbours need relight/remesh at borders
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = this.chunks.get((cx + dx) + ',' + (cz + dz));
      if (n) { n.dirty = true; n.lightDirty = true; }
    }
    return c;
  }

  unloadChunk(c) {
    if (c.modified) this.saved.set(this.key(c.cx, c.cz), c.blocks.slice());
    this.chunks.delete(this.key(c.cx, c.cz));
  }

  getBlock(x, y, z) {
    if (y < 0 || y >= CH) return 0;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    const c = this.chunks.get(cx + ',' + cz);
    if (!c) return 0;
    return c.blocks[idx(x - cx * CS, y, z - cz * CS)];
  }

  isLoaded(x, z) { return this.chunks.has(Math.floor(x / CS) + ',' + Math.floor(z / CS)); }

  setBlock(x, y, z, id) {
    if (y < 0 || y >= CH) return false;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    const c = this.chunks.get(cx + ',' + cz);
    if (!c) return false;
    const lx = x - cx * CS, lz = z - cz * CS;
    const i = idx(lx, y, lz);
    const old = c.blocks[i];
    if (old === id) return false;
    c.blocks[i] = id;
    c.modified = true;
    c.dirty = true; c.lightDirty = true;
    const k = x + ',' + y + ',' + z;
    if (this.tile.has(k) && !BLOCKS[id].tex.front) this.tile.delete(k);
    // neighbours: border blocks affect neighbour meshes; light emitters affect neighbour light
    const emitter = LIGHT_EMIT[id] || LIGHT_EMIT[old];
    const near = emitter ? 14 : 2;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      if (!dx && !dz) continue;
      if (dx === -1 && lx >= near) continue;
      if (dx === 1 && lx < CS - near) continue;
      if (dz === -1 && lz >= near) continue;
      if (dz === 1 && lz < CS - near) continue;
      const n = this.chunks.get((cx + dx) + ',' + (cz + dz));
      if (n) { n.lightDirty = true; n.dirty = true; }
    }
    if (this.onBlockChange) this.onBlockChange(x, y, z, old, id);
    return true;
  }

  // light value 0..15 at world pos (max of sky*dayFactor handled in shader)
  getLight(x, y, z) {
    if (y >= CH) return [15, 0];
    if (y < 0) return [0, 0];
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    const c = this.chunks.get(cx + ',' + cz);
    if (!c) return [15, 0];
    const i = idx(x - cx * CS, y, z - cz * CS);
    return [c.sky[i], c.blk[i]];
  }

  surfaceY(x, z) {
    for (let y = CH - 1; y > 0; y--) { const b = this.getBlock(x, y, z); if (b && BLOCKS[b].solid) return y; }
    return 0;
  }

  // Compute sky + block light for a chunk, seeding from neighbour borders.
  computeLight(c) {
    const sky = c.sky, blk = c.blk, blocks = c.blocks;
    sky.fill(0); blk.fill(0);
    const queueS = [], queueB = [];
    // sky: straight down
    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      let l = 15;
      for (let y = CH - 1; y >= 0; y--) {
        const i = idx(x, y, z);
        const b = blocks[i];
        const f = LIGHT_FILTER[b];
        if (f >= 15) { l = 0; break; }
        l = Math.max(0, l - f);
        sky[i] = l;
        if (l === 0) break;
      }
    }
    // seed queue with lit cells adjacent to darker ones (only those that can spread)
    for (let y = 0; y < CH; y++) for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const i = idx(x, y, z);
      const b = blocks[i];
      const e = LIGHT_EMIT[b];
      if (e) { blk[i] = e; queueB.push(i); }
      if (sky[i] > 1) {
        // only push if some horizontal neighbour is darker
        if ((x > 0 && sky[i - 1] < sky[i] - 1) || (x < CS - 1 && sky[i + 1] < sky[i] - 1) ||
          (z > 0 && sky[i - CS] < sky[i] - 1) || (z < CS - 1 && sky[i + CS] < sky[i] - 1) ||
          (y > 0 && sky[i - CS * CS] < sky[i] - 1) || x === 0 || z === 0 || x === CS - 1 || z === CS - 1) queueS.push(i);
      }
    }
    // seed from neighbour chunk borders
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dz] of nb) {
      const n = this.chunks.get((c.cx + dx) + ',' + (c.cz + dz));
      if (!n || n.lightDirty) continue;
      for (let y = 0; y < CH; y++) for (let k = 0; k < CS; k++) {
        let lx, lz, nx, nz;
        if (dx === 1) { lx = CS - 1; nx = 0; lz = nz = k; }
        else if (dx === -1) { lx = 0; nx = CS - 1; lz = nz = k; }
        else if (dz === 1) { lz = CS - 1; nz = 0; lx = nx = k; }
        else { lz = 0; nz = CS - 1; lx = nx = k; }
        const i = idx(lx, y, lz), j = idx(nx, y, nz);
        if (OPAQUE[blocks[i]]) continue;
        const s = n.sky[j] - 1, bl = n.blk[j] - 1;
        if (s > sky[i]) { sky[i] = s; queueS.push(i); }
        if (bl > blk[i]) { blk[i] = bl; queueB.push(i); }
      }
    }
    this._bfs(sky, blocks, queueS);
    this._bfs(blk, blocks, queueB);
    c.lightDirty = false;
  }

  _bfs(light, blocks, q) {
    let head = 0;
    const L = CS * CS;
    while (head < q.length) {
      const i = q[head++];
      const l = light[i];
      if (l <= 1) continue;
      const x = i % CS, z = Math.floor(i / CS) % CS, y = Math.floor(i / L);
      const tryN = (j) => {
        const b = blocks[j];
        if (OPAQUE[b]) return;
        const nl = l - 1 - LIGHT_FILTER[b];
        if (nl > light[j]) { light[j] = nl; q.push(j); }
      };
      if (x > 0) tryN(i - 1);
      if (x < CS - 1) tryN(i + 1);
      if (z > 0) tryN(i - CS);
      if (z < CS - 1) tryN(i + CS);
      if (y > 0) tryN(i - L);
      if (y < CH - 1) tryN(i + L);
    }
  }
}
