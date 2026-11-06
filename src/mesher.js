// Builds chunk geometry: smooth lighting + ambient occlusion.
import { CS, CH } from './worldgen.js';
import { BLOCKS, OPAQUE, B } from './blocks.js';
import { tileUV, blockFaceTile } from './textures.js';

const P = CS + 2; // padded size
const pb = new Uint8Array(P * P * CH);
const ps = new Uint8Array(P * P * CH);
const pl = new Uint8Array(P * P * CH);
const pidx = (x, y, z) => (y * P + (z + 1)) * P + (x + 1);

// face: 0 +x, 1 -x, 2 +y, 3 -y, 4 +z, 5 -z
const FACES = [
  { n: [1, 0, 0], c: [[1, 1, 1, 0, 1], [1, 0, 1, 0, 0], [1, 1, 0, 1, 1], [1, 0, 0, 1, 0]], shade: 0.62 },
  { n: [-1, 0, 0], c: [[0, 1, 0, 0, 1], [0, 0, 0, 0, 0], [0, 1, 1, 1, 1], [0, 0, 1, 1, 0]], shade: 0.62 },
  { n: [0, 1, 0], c: [[0, 1, 1, 1, 1], [1, 1, 1, 0, 1], [0, 1, 0, 1, 0], [1, 1, 0, 0, 0]], shade: 1.0 },
  { n: [0, -1, 0], c: [[1, 0, 1, 1, 0], [0, 0, 1, 0, 0], [1, 0, 0, 1, 1], [0, 0, 0, 0, 1]], shade: 0.5 },
  { n: [0, 0, 1], c: [[0, 0, 1, 0, 0], [1, 0, 1, 1, 0], [0, 1, 1, 0, 1], [1, 1, 1, 1, 1]], shade: 0.8 },
  { n: [0, 0, -1], c: [[1, 0, 0, 0, 0], [0, 0, 0, 1, 0], [1, 1, 0, 0, 1], [0, 1, 0, 1, 1]], shade: 0.8 },
];
const FACING_TO_FACE = [4, 0, 5, 1]; // facing index (0:+z,1:+x,2:-z,3:-x) -> face id

class Buf {
  constructor() { this.pos = []; this.uv = []; this.lt = []; this.idx = []; this.n = 0; }
  quad(verts, uvs, lts, flip) {
    const b = this.n;
    for (let i = 0; i < 4; i++) {
      this.pos.push(verts[i][0], verts[i][1], verts[i][2]);
      this.uv.push(uvs[i][0], uvs[i][1]);
      this.lt.push(lts[i][0], lts[i][1], lts[i][2]);
    }
    if (flip) this.idx.push(b + 1, b + 3, b, b, b + 3, b + 2);
    else this.idx.push(b, b + 1, b + 2, b + 2, b + 1, b + 3);
    this.n += 4;
  }
  result() {
    return {
      pos: new Float32Array(this.pos), uv: new Float32Array(this.uv), lt: new Float32Array(this.lt),
      idx: this.n > 16000 ? new Uint32Array(this.idx) : new Uint16Array(this.idx), count: this.idx.length,
    };
  }
}

function fillPadded(world, chunk) {
  const { cx, cz } = chunk;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const c = world.getChunk(cx + dx, cz + dz);
    const xs = dx === -1 ? CS - 1 : 0, xe = dx === 1 ? 1 : CS;
    const zs = dz === -1 ? CS - 1 : 0, ze = dz === 1 ? 1 : CS;
    for (let y = 0; y < CH; y++) for (let z = zs; z < ze; z++) for (let x = xs; x < xe; x++) {
      const px = x + dx * CS, pz = z + dz * CS;
      const j = pidx(px, y, pz);
      if (c) {
        const i = (y * CS + z) * CS + x;
        pb[j] = c.blocks[i]; ps[j] = c.sky[i]; pl[j] = c.blk[i];
      } else { pb[j] = 0; ps[j] = 15; pl[j] = 0; }
    }
  }
}

export function buildChunkMesh(world, chunk) {
  fillPadded(world, chunk);
  const solid = new Buf(), water = new Buf();
  const ox = chunk.cx * CS, oz = chunk.cz * CS;
  const tileCache = {};
  const uvOf = (name) => tileCache[name] || (tileCache[name] = tileUV(name));

  const vertLight = (x, y, z, f, c) => {
    // returns [sky, blk, ao]
    const n = FACES[f].n;
    const bx = x + n[0], by = y + n[1], bz = z + n[2];
    // tangent offsets
    let s1, s2;
    if (n[0] !== 0) { s1 = [0, c[1] ? 1 : -1, 0]; s2 = [0, 0, c[2] ? 1 : -1]; }
    else if (n[1] !== 0) { s1 = [c[0] ? 1 : -1, 0, 0]; s2 = [0, 0, c[2] ? 1 : -1]; }
    else { s1 = [c[0] ? 1 : -1, 0, 0]; s2 = [0, c[1] ? 1 : -1, 0]; }
    const yb = Math.min(CH - 1, Math.max(0, by));
    const i0 = pidx(bx, yb, bz);
    const y1 = Math.min(CH - 1, Math.max(0, by + s1[1])), y2 = Math.min(CH - 1, Math.max(0, by + s2[1])), y3 = Math.min(CH - 1, Math.max(0, by + s1[1] + s2[1]));
    const i1 = pidx(bx + s1[0], y1, bz + s1[2]);
    const i2 = pidx(bx + s2[0], y2, bz + s2[2]);
    const i3 = pidx(bx + s1[0] + s2[0], y3, bz + s1[2] + s2[2]);
    const o1 = OPAQUE[pb[i1]], o2 = OPAQUE[pb[i2]], o3 = OPAQUE[pb[i3]];
    const ao = o1 && o2 ? 0 : 3 - (o1 + o2 + o3);
    let sky = by >= CH ? 15 : ps[i0], bl = by >= CH ? 0 : pl[i0], cnt = 1;
    if (!o1) { sky += ps[i1]; bl += pl[i1]; cnt++; }
    if (!o2) { sky += ps[i2]; bl += pl[i2]; cnt++; }
    if (!o3 && !(o1 && o2)) { sky += ps[i3]; bl += pl[i3]; cnt++; }
    return [sky / cnt / 15, bl / cnt / 15, ao];
  };
  const AO_CURVE = [0.45, 0.62, 0.8, 1.0];

  for (let y = 0; y < CH; y++) for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
    const id = pb[pidx(x, y, z)];
    if (id === 0) continue;
    const def = BLOCKS[id];
    if (!def) continue;
    const wx = ox + x, wz = oz + z;
    const shape = def.shape;

    if (shape === 'cross') {
      const i = pidx(x, y, z);
      const L = [ps[i] / 15, pl[i] / 15, 0.95];
      const [u0, v0, u1, v1] = uvOf(blockFaceTile(id, 0));
      const uvs = [[u0, v0], [u1, v0], [u0, v1], [u1, v1]];
      const sway = def.key !== 'ladder' && !def.key.endsWith('mushroom') && def.key !== 'glutpilz';
      const LT = sway ? [L[0], L[1], L[2] + 10] : L;
      const lts = [L, L, LT, LT];
      let ex = 0, ez = 0;
      if (id === B.tall_grass || def.key.startsWith('wheat')) { ex = ((wx * 31 + wz * 17) % 7) / 40 - 0.075; ez = ((wx * 13 + wz * 29) % 7) / 40 - 0.075; }
      const a = 0.15, bb = 0.85;
      const q1 = [[wx + a + ex, y, wz + a + ez], [wx + bb + ex, y, wz + bb + ez], [wx + a + ex, y + 1, wz + a + ez], [wx + bb + ex, y + 1, wz + bb + ez]];
      const q2 = [[wx + a + ex, y, wz + bb + ez], [wx + bb + ex, y, wz + a + ez], [wx + a + ex, y + 1, wz + bb + ez], [wx + bb + ex, y + 1, wz + a + ez]];
      if (def.key === 'ladder') { /* handled as cube */ }
      solid.quad(q1, uvs, lts, false); solid.quad([q1[1], q1[0], q1[3], q1[2]], uvs, lts, false);
      solid.quad(q2, uvs, lts, false); solid.quad([q2[1], q2[0], q2[3], q2[2]], uvs, lts, false);
      continue;
    }
    if (shape === 'torch') {
      const i = pidx(x, y, z);
      const L = [ps[i] / 15, Math.max(pl[i], def.light) / 15, 1];
      const lantern = def.key === 'lantern';
      const w = lantern ? 8 / 16 : 2 / 16, h = lantern ? 13 / 16 : 10 / 16;
      const [u0, v0, u1, v1] = uvOf(blockFaceTile(id, 0));
      const du = (u1 - u0), dv = (v1 - v0);
      const cu0 = u0 + du * (0.5 - w / 2), cu1 = u0 + du * (0.5 + w / 2);
      const cv1 = v0 + dv * h;
      const x0 = wx + 0.5 - w / 2, x1 = wx + 0.5 + w / 2, z0 = wz + 0.5 - w / 2, z1 = wz + 0.5 + w / 2, y1 = y + h;
      const lts = [L, L, L, L];
      const uvs = [[cu0, v0], [cu1, v0], [cu0, cv1], [cu1, cv1]];
      solid.quad([[x0, y, z1], [x1, y, z1], [x0, y1, z1], [x1, y1, z1]], uvs, lts);
      solid.quad([[x1, y, z0], [x0, y, z0], [x1, y1, z0], [x0, y1, z0]], uvs, lts);
      solid.quad([[x1, y, z1], [x1, y, z0], [x1, y1, z1], [x1, y1, z0]], uvs, lts);
      solid.quad([[x0, y, z0], [x0, y, z1], [x0, y1, z0], [x0, y1, z1]], uvs, lts);
      const tv0 = v0 + dv * (h - w), tv1 = cv1;
      solid.quad([[x0, y1, z1], [x1, y1, z1], [x0, y1, z0], [x1, y1, z0]], [[cu0, tv0], [cu1, tv0], [cu0, tv1], [cu1, tv1]], lts);
      continue;
    }

    const isLiquid = shape === 'liquid';
    const waveAdd = def.key.endsWith('leaves') ? 10 : 0;
    const buf = id === B.water ? water : solid;
    let top = 1, inset = 0, bottom = 0;
    if (isLiquid && pb[pidx(x, y + 1, z)] !== id) top = 0.875;
    if (shape === 'flat') top = 15 / 16;
    if (shape === 'bed') top = 9 / 16;
    if (shape === 'cactus') inset = 1 / 16;
    let frontFace = -1;
    if (def.tex.front) {
      const t = world.tile.get(wx + ',' + y + ',' + wz);
      frontFace = FACING_TO_FACE[t && t.facing !== undefined ? t.facing : 0];
    }

    for (let f = 0; f < 6; f++) {
      const F = FACES[f];
      const nx = x + F.n[0], ny = y + F.n[1], nz = z + F.n[2];
      let nid = ny < 0 || ny >= CH ? 0 : pb[pidx(nx, ny, nz)];
      if (ny < 0) nid = 1;
      if (OPAQUE[nid] && !(f === 2 && top < 1) && !(inset && f !== 2 && f !== 3)) continue;
      if (nid === id && (def.cutout || isLiquid || !def.opaque) && shape !== 'bed') continue;
      if (isLiquid && f !== 2 && nid !== 0 && BLOCKS[nid].solid) continue;
      if (id === B.water && nid === B.ice) continue;

      let tileName = blockFaceTile(id, f);
      if (f === frontFace) tileName = def.tex.front;
      const [u0, v0, u1, v1] = uvOf(tileName);
      const verts = [], uvs = [], lts = [];
      let aoSum = [0, 0, 0, 0];
      for (let k = 0; k < 4; k++) {
        const c = F.c[k];
        let vx = c[0], vy = c[1], vz = c[2];
        if (vy === 1) vy = top;
        if (vy === 0) vy = bottom;
        if (inset) {
          if (f === 0) vx = 1 - inset; else if (f === 1) vx = inset;
          else if (f === 4) vz = 1 - inset; else if (f === 5) vz = inset;
        }
        verts.push([wx + vx, y + vy, wz + vz]);
        // side faces of short blocks: crop texture
        let vv = c[4];
        if (f !== 2 && f !== 3 && top < 1 && c[1] === 1) vv = top;
        uvs.push([c[3] ? u1 : u0, v0 + (v1 - v0) * vv]);
        const vl = vertLight(x, y, z, f, c);
        const ao = isLiquid ? 1 : AO_CURVE[vl[2]];
        aoSum[k] = vl[2];
        lts.push([vl[0], vl[1], ao * F.shade + waveAdd]);
      }
      const flip = aoSum[0] + aoSum[3] < aoSum[1] + aoSum[2];
      buf.quad(verts, uvs, lts, flip);
      // water seen from below/inside: add back face
      if (id === B.water && f === 2 && top < 1) buf.quad([verts[1], verts[0], verts[3], verts[2]], [uvs[1], uvs[0], uvs[3], uvs[2]], lts, false);
    }
  }
  return { solid: solid.result(), water: water.result() };
}
