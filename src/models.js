// Box-model mobs with hand-painted (procedural) pixel-art skins. All designs original.
import * as THREE from 'three';
import { mulberry32 } from './noise.js';

function hex(h) { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function sh(c, f) { return [Math.min(255, c[0] * f) | 0, Math.min(255, c[1] * f) | 0, Math.min(255, c[2] * f) | 0]; }

const MK = 2; // fine pixels per model pixel (HD skins)
class Face {
  constructor(img, x0, y0, w, h, W, rnd) { this.img = img; this.x0 = x0; this.y0 = y0; this.w = w; this.h = h; this.W = W; this.rnd = rnd; }
  pf(fx, fy, c, a = 255) {
    if (fx < 0 || fy < 0 || fx >= this.w * MK || fy >= this.h * MK) return;
    const i = ((this.y0 * MK + fy) * this.W * MK + this.x0 * MK + fx) * 4;
    this.img[i] = c[0]; this.img[i + 1] = c[1]; this.img[i + 2] = c[2]; this.img[i + 3] = a;
  }
  px(x, y, c, a = 255) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return this;
    for (let b = 0; b < MK; b++) for (let q = 0; q < MK; q++) this.pf(x * MK + q, y * MK + b, a ? sh(c, 1 + (this.rnd() - 0.5) * 0.06) : c, a);
    return this;
  }
  fill(c, v = 0.08) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const base = sh(c, 1 + (this.rnd() * 2 - 1) * v);
      for (let b = 0; b < MK; b++) for (let q = 0; q < MK; q++) this.pf(x * MK + q, y * MK + b, sh(base, 1 + (this.rnd() * 2 - 1) * v * 0.5));
    }
    return this;
  }
  rect(x, y, w, h, c, v = 0) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.px(i, j, v ? sh(c, 1 + (this.rnd() * 2 - 1) * v) : c); return this; }
  spots(c, n, s = 2) { for (let k = 0; k < n; k++) { const x = Math.floor(this.rnd() * this.w), y = Math.floor(this.rnd() * this.h); this.rect(x, y, s + Math.floor(this.rnd() * 2), s, c, 0.05); } return this; }
  dither(c, p) {
    for (let fy = 0; fy < this.h * MK; fy++) for (let fx = 0; fx < this.w * MK; fx++) if (this.rnd() < p * 0.7) this.pf(fx, fy, sh(c, 0.95 + this.rnd() * 0.1));
    return this;
  }
  clear() { for (let fy = 0; fy < this.h * MK; fy++) for (let fx = 0; fx < this.w * MK; fx++) this.pf(fx, fy, [0, 0, 0], 0); return this; }
  // soft shading so boxes read as rounded bodies
  finish(kind) {
    const FW = this.w * MK, FH = this.h * MK;
    for (let fy = 0; fy < FH; fy++) for (let fx = 0; fx < FW; fx++) {
      const i = ((this.y0 * MK + fy) * this.W * MK + this.x0 * MK + fx) * 4;
      if (!this.img[i + 3]) continue;
      let f = 1;
      if (kind === 'top') f = 1.06;
      else if (kind === 'bottom') f = 0.82;
      else f = 1.05 - (fy / FH) * 0.14;
      if (fx === 0 || fy === 0 || fx === FW - 1 || fy === FH - 1) f *= 0.9;
      this.img[i] = Math.min(255, this.img[i] * f); this.img[i + 1] = Math.min(255, this.img[i + 1] * f); this.img[i + 2] = Math.min(255, this.img[i + 2] * f);
    }
  }
}

// faces: {all, front, back, left, right, top, bottom} painter fns (face) => void
// returns THREE.Mesh with box centered at origin (pixel units / 16)
const matCache = new Map();
function makeBox(id, w, h, d, paint, opts = {}) {
  let mat = matCache.get(id);
  const fw = { right: [d, h], left: [d, h], top: [w, d], bottom: [w, d], front: [w, h], back: [w, h] };
  const order = ['right', 'left', 'top', 'bottom', 'front', 'back']; // BoxGeometry face order: +x -x +y -y +z -z
  const W = 2 * d + 2 * w + 2 * w + 6, H = Math.max(h, d) + 1;
  const offs = {};
  let x = 0;
  for (const k of order) { offs[k] = x; x += fw[k][0] + 1; }
  if (!mat) {
    const img = new Uint8ClampedArray(W * H * 4 * MK * MK);
    const rnd = mulberry32(id.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0);
    for (const k of order) {
      const f = new Face(img, offs[k], 0, fw[k][0], fw[k][1], W, rnd);
      if (paint.all) paint.all(f, k);
      if (paint[k]) paint[k](f);
      f.finish(k);
    }
    const canvas = document.createElement('canvas');
    canvas.width = W * MK; canvas.height = H * MK;
    canvas.getContext('2d').putImageData(new ImageData(img, W * MK, H * MK), 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace;
    mat = new THREE.MeshLambertMaterial({ map: tex, transparent: !!opts.transparent, alphaTest: opts.transparent ? 0 : 0.5, opacity: opts.opacity || 1, depthWrite: !opts.transparent });
    matCache.set(id, mat);
  }
  const geo = new THREE.BoxGeometry(w / 16, h / 16, d / 16);
  const uv = geo.attributes.uv;
  order.forEach((k, fi) => {
    const [fwid, fhei] = fw[k];
    for (let v = 0; v < 4; v++) {
      const i = fi * 4 + v;
      const u0 = uv.getX(i), v0 = uv.getY(i);
      uv.setXY(i, (offs[k] + u0 * fwid) / W, 1 - ((1 - v0) * fhei) / H);
    }
  });
  const mesh = new THREE.Mesh(geo, mat);
  return mesh;
}

// part helper: pivot group at (px,py,pz) in pixels; box offset relative to pivot
function part(parent, id, size, pivot, offset, paint, opts) {
  const g = new THREE.Group();
  g.position.set(pivot[0] / 16, pivot[1] / 16, pivot[2] / 16);
  const m = makeBox(id, size[0], size[1], size[2], paint, opts);
  m.position.set(offset[0] / 16, offset[1] / 16, offset[2] / 16);
  g.add(m);
  parent.add(g);
  return g;
}

// ---------------- skins ----------------
const PIG = hex('#eda3a8'), PIGD = hex('#d27f8a');
const COW = hex('#5a3d2a'), COWW = hex('#ece6dc');
const WOOL = hex('#ecebe6'), SHEEPSKIN = hex('#d9c3a8');
const CHICK = hex('#f4f2ee');
const ZSKIN = hex('#6f8f5a'), ZCLOTH = hex('#6b4a32'), ZPANTS = hex('#3a3f55');
const BONE = hex('#d8d6cc'), BONED = hex('#a8a59a');
const SPIDER = hex('#2e2620'), SPIDERD = hex('#1d1814');

const eye = (f, x, y, white = [250, 250, 250], pupil = [20, 20, 20]) => { f.px(x, y, white); f.px(x + 1, y, pupil); };

export const MOB_DEFS = {};

MOB_DEFS.pig = {
  name: 'Schwein', w: 0.9, h: 0.9, hp: 10, speed: 1.1, passive: true,
  drops: [['porkchop', 1, 3]],
  build(root) {
    const skin = { all: (f) => { f.fill(PIG, 0.05); f.dither(PIGD, 0.06); } };
    const body = part(root, 'pig_body', [10, 8, 16], [0, 10, 0], [0, 0, 0], skin);
    const head = part(root, 'pig_head', [8, 8, 8], [0, 12, 8], [0, 0, 4], Object.assign({}, skin, {
      front: (f) => { eye(f, 1, 3, [255, 255, 255], [30, 20, 20]); f.px(5, 3, [30, 20, 20]); f.px(6, 3, [255, 255, 255]); f.rect(0, 2, 8, 1, PIGD); },
    }));
    part(head, 'pig_snout', [4, 3, 1], [0, -1, 8.5], [0, 0, 0], { all: (f) => f.fill(hex('#f2b5b8'), 0.03), front: (f) => { f.fill(hex('#f7c2c4'), 0.03); f.px(0, 1, hex('#a65a64')); f.px(3, 1, hex('#a65a64')); } });
    const legSkin = { all: (f) => { f.fill(PIG, 0.05); f.rect(0, f.h - 1, f.w, 1, hex('#8a5a5a')); } };
    const legs = [[-3, 5], [3, 5], [-3, -5], [3, -5]].map(([x, z], i) => part(root, 'pig_leg', [4, 6, 4], [x, 6, z], [0, -3, 0], legSkin));
    return { head, legs, body };
  },
};

MOB_DEFS.cow = {
  name: 'Kuh', w: 0.9, h: 1.4, hp: 10, speed: 1.0, passive: true,
  drops: [['beef', 1, 3], ['leather', 0, 2]],
  build(root) {
    const skin = { all: (f) => { f.fill(COW, 0.06); f.spots(COWW, 3, 3); } };
    const body = part(root, 'cow_body', [12, 10, 18], [0, 17, 0], [0, 0, 0], Object.assign({}, skin, {
      bottom: (f) => { f.fill(COW, 0.05); f.rect(4, 2, 4, 5, hex('#e8a8b0')); },
    }));
    const head = part(root, 'cow_head', [8, 8, 6], [0, 20, 9], [0, 0, 3], {
      all: (f) => f.fill(COW, 0.05),
      front: (f) => { f.fill(COW, 0.04); f.rect(2, 0, 4, 4, COWW, 0.03); eye(f, 0, 3, [240, 240, 240], [10, 10, 10]); f.px(6, 3, [10, 10, 10]); f.px(7, 3, [240, 240, 240]); f.rect(2, 5, 4, 3, hex('#d8c4b0'), 0.03); f.px(2, 6, [60, 40, 30]); f.px(5, 6, [60, 40, 30]); },
    });
    part(head, 'cow_horn', [1, 3, 1], [-4.5, 4, 3], [0, 1.5, 0], { all: (f) => { f.fill(hex('#e8e0c8'), 0.02); f.px(0, 0, hex('#9a9078')); } });
    part(head, 'cow_horn', [1, 3, 1], [4.5, 4, 3], [0, 1.5, 0], { all: (f) => { f.fill(hex('#e8e0c8'), 0.02); f.px(0, 0, hex('#9a9078')); } });
    const legSkin = { all: (f) => { f.fill(COW, 0.05); f.rect(0, 6, f.w, 3, COWW, 0.03); f.rect(0, f.h - 2, f.w, 2, hex('#2a2018')); } };
    const legs = [[-4, 7], [4, 7], [-4, -7], [4, -7]].map(([x, z]) => part(root, 'cow_leg', [4, 12, 4], [x, 12, z], [0, -6, 0], legSkin));
    return { head, legs, body };
  },
};

MOB_DEFS.sheep = {
  name: 'Schaf', w: 0.9, h: 1.3, hp: 8, speed: 1.0, passive: true,
  drops: [['mutton', 1, 2], ['white_wool', 1, 1]],
  build(root) {
    const wool = { all: (f) => { f.fill(WOOL, 0.04); f.dither(hex('#d8d6d0'), 0.25); } };
    const body = part(root, 'sheep_body', [10, 10, 15], [0, 17, 0], [0, 0, 0], wool);
    const head = part(root, 'sheep_head', [6, 7, 7], [0, 19, 8], [0, 0, 3], {
      all: (f) => f.fill(SHEEPSKIN, 0.04),
      top: (f) => f.fill(WOOL, 0.05),
      front: (f) => { f.fill(SHEEPSKIN, 0.03); f.rect(0, 0, 6, 2, WOOL, 0.04); f.px(0, 3, [250, 250, 250]); f.px(1, 3, [30, 30, 30]); f.px(4, 3, [30, 30, 30]); f.px(5, 3, [250, 250, 250]); f.rect(2, 5, 2, 1, hex('#b8907a')); },
    });
    part(head, 'sheep_ear', [2, 1, 2], [-4, 2, 2], [0, 0, 0], { all: (f) => f.fill(SHEEPSKIN, 0.04) });
    part(head, 'sheep_ear', [2, 1, 2], [4, 2, 2], [0, 0, 0], { all: (f) => f.fill(SHEEPSKIN, 0.04) });
    const legSkin = { all: (f) => { f.fill(SHEEPSKIN, 0.04); f.rect(0, 0, f.w, 5, WOOL, 0.04); f.rect(0, f.h - 1, f.w, 1, hex('#5a4a3a')); } };
    const legs = [[-3, 5], [3, 5], [-3, -5], [3, -5]].map(([x, z]) => part(root, 'sheep_leg', [3, 12, 3], [x, 12, z], [0, -6, 0], legSkin));
    return { head, legs, body };
  },
};

MOB_DEFS.chicken = {
  name: 'Huhn', w: 0.5, h: 0.75, hp: 4, speed: 1.0, passive: true,
  drops: [['chicken', 1, 1], ['feather', 0, 2]],
  build(root) {
    const feath = { all: (f) => { f.fill(CHICK, 0.03); f.dither(hex('#e2ddd4'), 0.2); } };
    const body = part(root, 'chicken_body', [6, 6, 8], [0, 7, 0], [0, 0, 0], feath);
    const head = part(root, 'chicken_head', [4, 6, 3], [0, 10, 4], [0, 2, 1], Object.assign({}, feath, {
      front: (f) => { f.fill(CHICK, 0.03); f.px(0, 1, [20, 20, 20]); f.px(3, 1, [20, 20, 20]); },
    }));
    part(head, 'chicken_beak', [4, 2, 2], [0, 2.5, 3.5], [0, 0, 0], { all: (f) => f.fill(hex('#f2b02a'), 0.04) });
    part(head, 'chicken_wattle', [2, 2, 1], [0, 0.5, 3], [0, 0, 0], { all: (f) => f.fill(hex('#d8281e'), 0.04) });
    part(head, 'chicken_comb', [1, 2, 3], [0, 6, 1.5], [0, 0, 0], { all: (f) => f.fill(hex('#d8281e'), 0.04) });
    const wings = [-3.5, 3.5].map((x) => part(root, 'chicken_wing', [1, 4, 6], [x, 9, 0], [0, -2, 0], { all: (f) => { f.fill(hex('#e6e2da'), 0.04); f.rect(0, f.h - 1, f.w, 1, hex('#c8c2b6')); } }));
    const legSkin = { all: (f) => f.fill(hex('#e8a020'), 0.05) };
    const legs = [[-1.5, 0], [1.5, 0]].map(([x, z]) => part(root, 'chicken_leg', [1, 4, 1], [x, 4, z], [0, -2, 0], legSkin));
    part(legs[0], 'chicken_foot', [3, 1, 3], [0, -3.5, 0.5], [0, 0, 0], legSkin);
    part(legs[1], 'chicken_foot', [3, 1, 3], [0, -3.5, 0.5], [0, 0, 0], legSkin);
    return { head, legs, body, wings };
  },
};

function humanoid(root, prefix, limbW, skinFns) {
  const head = part(root, prefix + '_head', [8, 8, 8], [0, 24, 0], [0, 4, 0], skinFns.head);
  const body = part(root, prefix + '_body', [8, 12, 4], [0, 18, 0], [0, 0, 0], skinFns.body);
  const arms = [-1, 1].map((s) => part(root, prefix + '_arm', [limbW, 12, limbW], [s * (4 + limbW / 2), 22, 0], [0, -4, 0], skinFns.arm));
  const legs = [-1, 1].map((s) => part(root, prefix + '_leg', [limbW, 12, limbW], [s * 2, 12, 0], [0, -6, 0], skinFns.leg));
  return { head, body, arms, legs };
}

function zombieBuild(prefix, P) {
  return (root) => {
    const m = humanoid(root, prefix, 4, {
      head: {
        all: (f) => { f.fill(P.skin, 0.08); f.dither(P.skin2, 0.15); },
        top: (f) => { f.fill(P.hair, 0.1); f.dither(P.skin, 0.2); },
        front: (f) => {
          f.fill(P.skin, 0.07); f.dither(P.skin2, 0.15);
          f.rect(0, 0, 8, 2, P.hair, 0.1); f.px(2, 0, P.skin); f.px(6, 1, P.skin);
          f.rect(1, 3, 2, 2, P.socket); f.rect(5, 3, 2, 2, P.socket); f.px(2, 3, P.eye); f.px(5, 3, P.eye);
          f.rect(3, 5, 2, 1, P.skin2); f.rect(2, 6, 4, 1, hex('#2a1e18')); f.px(3, 6, hex('#d8d0b0'));
        },
      },
      body: {
        all: (f) => { f.fill(P.cloth, 0.08); f.spots(P.cloth2, 3, 1); f.rect(0, f.h - 2, f.w, 2, P.belt); },
        front: (f) => { f.fill(P.cloth, 0.08); f.rect(3, 0, 2, 3, P.skin, 0.05); f.rect(0, 10, 8, 2, P.belt); f.px(2, 6, P.skin); f.px(5, 8, P.skin); f.px(6, 4, P.cloth2); },
      },
      arm: { all: (f) => { f.fill(P.skin, 0.07); f.rect(0, 0, f.w, 4, P.cloth, 0.08); f.px(1, 7, P.skin2); } },
      leg: { all: (f) => { f.fill(P.pants, 0.08); f.rect(0, f.h - 2, f.w, 2, hex('#2a2420')); } },
    });
    m.arms.forEach((a) => (a.rotation.x = -Math.PI / 2.2));
    m.armsForward = true;
    return m;
  };
}

function skeletonBuild(prefix, BN, BD, EYE, weapon) {
  return (root) => {
    const ribs = (f) => { f.clear(); for (let y = 0; y < f.h; y += 2) f.rect(0, y, f.w, 1, BN, 0.05); f.rect(Math.floor(f.w / 2) - 1, 0, 2, f.h, BD, 0.05); };
    const m = humanoid(root, prefix, 2, {
      head: {
        all: (f) => { f.fill(BN, 0.05); f.dither(BD, 0.1); },
        front: (f) => {
          f.fill(BN, 0.05);
          f.rect(1, 3, 2, 2, EYE); f.rect(5, 3, 2, 2, EYE);
          f.px(3, 5, hex('#3a3a3a')); f.px(4, 5, hex('#3a3a3a'));
          f.rect(1, 6, 6, 1, hex('#3a3a3a')); for (let x = 1; x < 7; x += 2) f.px(x, 6, BN);
        },
      },
      body: { all: ribs },
      arm: { all: (f) => { f.fill(BN, 0.05); f.rect(0, 5, f.w, 1, BD); } },
      leg: { all: (f) => { f.fill(BN, 0.05); f.rect(0, 6, f.w, 1, BD); } },
    });
    if (weapon === 'bow') part(m.arms[1], prefix + '_bow', [1, 10, 2], [0, -9, 1.5], [0, 0, 0], { all: (f) => { f.fill(hex('#7a5530'), 0.05); f.rect(0, 0, f.w, 1, hex('#e0e0e0')); } });
    else part(m.arms[1], prefix + '_blade', [1, 2, 10], [0, -10, 4], [0, 0, 0], { all: (f) => { f.fill(hex('#3a3a3e'), 0.06); f.rect(0, 0, f.w, 1, hex('#6a6a70')); } });
    m.arms.forEach((a) => (a.rotation.x = -Math.PI / 2.4));
    m.armsForward = true;
    return m;
  };
}

function spiderBuild(prefix, BODY, BODYD, MARK, EYE, EYE2) {
  return (root) => {
    const fur = { all: (f) => { f.fill(BODY, 0.12); f.dither(BODYD, 0.15); } };
    const body = part(root, prefix + '_body', [12, 9, 12], [0, 8, -6], [0, 0, 0], Object.assign({}, fur, {
      top: (f) => { f.fill(BODY, 0.12); f.dither(BODYD, 0.2); f.rect(5, 2, 2, 7, MARK); f.rect(3, 4, 6, 1, MARK); },
    }));
    part(root, prefix + '_thorax', [6, 6, 6], [0, 7, 1], [0, 0, 0], fur);
    const head = part(root, prefix + '_head', [8, 8, 8], [0, 7, 4], [0, 0, 4], Object.assign({}, fur, {
      front: (f) => {
        f.fill(BODYD, 0.1);
        f.rect(1, 2, 2, 2, EYE); f.rect(5, 2, 2, 2, EYE);
        f.px(3, 1, EYE2); f.px(4, 1, EYE2); f.px(0, 4, EYE); f.px(7, 4, EYE);
        f.px(1, 2, hex('#ffffff')); f.px(5, 2, hex('#ffffff'));
        f.rect(3, 6, 1, 2, hex('#8a7a6a')); f.rect(4, 6, 1, 2, hex('#8a7a6a'));
      },
    }));
    const legSkin = { all: (f) => { f.fill(BODYD, 0.12); f.px(Math.floor(f.w / 2), 0, BODY); } };
    const legs = [];
    for (let i = 0; i < 8; i++) {
      const side = i < 4 ? -1 : 1, k = i % 4;
      const g = part(root, prefix + '_leg', [14, 2, 2], [side * 3, 8, 3 - k * 2], [side * 7, 0, 0], legSkin);
      g.userData.baseY = side * (0.6 - k * 0.4);
      g.rotation.y = g.userData.baseY;
      g.rotation.z = -side * 0.42;
      legs.push(g);
    }
    return { head, legs, body, spider: true };
  };
}

MOB_DEFS.zombie = {
  name: 'Zombie', w: 0.6, h: 1.9, hp: 20, speed: 1.15, hostile: true, damage: 3, burns: true,
  drops: [['rotten_flesh', 0, 2]], rare: [['iron_ingot', 0.025], ['raw_iron', 0.03]],
  build: zombieBuild('zombie', { skin: ZSKIN, skin2: hex('#5a7a48'), hair: hex('#3a2e22'), socket: hex('#14200f'), eye: hex('#c8d84a'), cloth: ZCLOTH, cloth2: hex('#5a3c26'), belt: hex('#3a2a1a'), pants: ZPANTS }),
};
MOB_DEFS.ash_zombie = {
  name: 'Aschezombie', w: 0.6, h: 1.9, hp: 22, speed: 1.2, hostile: true, damage: 4,
  drops: [['rotten_flesh', 0, 2], ['coal', 0, 1]], rare: [['gold_ingot', 0.05]],
  build: zombieBuild('ashzombie', { skin: hex('#5a4a44'), skin2: hex('#3e322e'), hair: hex('#1e1614'), socket: hex('#1a0806'), eye: hex('#ff7a1e'), cloth: hex('#4a2420'), cloth2: hex('#2e1614'), belt: hex('#c06018'), pants: hex('#2a2224') }),
};
MOB_DEFS.skeleton = {
  name: 'Skelett', w: 0.6, h: 1.9, hp: 20, speed: 1.1, hostile: true, ranged: true, burns: true,
  drops: [['bone', 0, 2], ['arrow', 0, 2]], rare: [['bow', 0.04]],
  build: skeletonBuild('skel', BONE, BONED, hex('#141414'), 'bow'),
};
MOB_DEFS.fire_skeleton = {
  name: 'Glutskelett', w: 0.7, h: 2.2, hp: 24, speed: 1.2, hostile: true, damage: 5,
  drops: [['bone', 0, 2], ['coal', 0, 2]], rare: [['diamond', 0.02], ['gold_ingot', 0.05]],
  build: skeletonBuild('fireskel', hex('#3a3434'), hex('#1e1a1a'), hex('#ff6a1a'), 'blade'),
};
MOB_DEFS.spider = {
  name: 'Spinne', w: 1.3, h: 0.9, hp: 16, speed: 1.4, hostile: true, damage: 2, neutralDay: true, spider: true,
  drops: [['string', 0, 2]],
  build: spiderBuild('spider', SPIDER, hex('#4a3a2e'), hex('#6a2a1e'), hex('#e0281e'), hex('#ff5040')),
};
MOB_DEFS.void_crawler = {
  name: 'Leerenkrabbler', w: 1.3, h: 0.9, hp: 20, speed: 1.5, hostile: true, damage: 3, spider: true,
  drops: [['string', 0, 2]], rare: [['diamond', 0.03]],
  build: spiderBuild('voidcrawler', hex('#2a1e3a'), hex('#4a3a6a'), hex('#7ae0d0'), hex('#c070ff'), hex('#7ae0d0')),
};

MOB_DEFS.villager = {
  name: 'Dorfbewohner', w: 0.6, h: 1.95, hp: 20, speed: 0.8, passive: true, villager: true,
  drops: [],
  build(root) {
    const SK = hex('#c89670'), ROBE = hex('#5a7a3a'), ROBE2 = hex('#4a6630'), STRAW = hex('#d8b860');
    const m = humanoid(root, 'villager', 4, {
      head: {
        all: (f) => { f.fill(SK, 0.04); f.rect(0, 0, f.w, 3, hex('#5a3a22'), 0.08); },
        top: (f) => f.fill(hex('#5a3a22'), 0.08),
        front: (f) => {
          f.fill(SK, 0.04); f.rect(0, 0, 8, 2, hex('#5a3a22'), 0.08);
          f.px(1, 3, [250, 250, 250]); f.px(2, 3, hex('#2a6a3a')); f.px(5, 3, hex('#2a6a3a')); f.px(6, 3, [250, 250, 250]);
          f.rect(1, 2, 2, 1, hex('#4a2e1a')); f.rect(5, 2, 2, 1, hex('#4a2e1a'));
          f.px(3, 4, hex('#b07a58')); f.px(4, 4, hex('#b07a58'));
          f.rect(2, 6, 4, 1, hex('#8a4a3a'));
          f.rect(1, 5, 1, 2, hex('#6a4a32')); f.rect(6, 5, 1, 2, hex('#6a4a32'));
        },
      },
      body: {
        all: (f) => { f.fill(ROBE, 0.07); f.rect(0, 7, f.w, 1, hex('#7a5a30')); },
        front: (f) => { f.fill(ROBE, 0.07); f.rect(3, 0, 2, 2, SK); f.rect(0, 7, f.w, 1, hex('#7a5a30')); f.px(4, 7, hex('#d8c040')); f.rect(3, 2, 1, 4, ROBE2); },
      },
      arm: { all: (f) => { f.fill(ROBE, 0.07); f.rect(0, f.h - 3, f.w, 3, SK, 0.04); } },
      leg: { all: (f) => { f.fill(ROBE2, 0.07); f.rect(0, f.h - 2, f.w, 2, hex('#4a3020')); } },
    });
    // straw hat
    part(m.head, 'villager_hat', [12, 1, 12], [0, 8, 0], [0, 0, 0], { all: (f) => { f.fill(STRAW, 0.08); f.dither(hex('#b89a48'), 0.2); } });
    part(m.head, 'villager_hattop', [8, 2, 8], [0, 9.5, 0], [0, 0, 0], { all: (f) => { f.fill(STRAW, 0.08); f.rect(0, f.h - 1, f.w, 1, hex('#a0302a')); }, top: (f) => f.fill(STRAW, 0.08) });
    return m;
  },
};

export function createMobModel(type) {
  const root = new THREE.Group();
  const inner = new THREE.Group();
  root.add(inner);
  const parts = MOB_DEFS[type].build(inner);
  // per-instance materials so we can tint (damage flash, light)
  const mats = [];
  inner.traverse((o) => {
    if (o.isMesh) { o.material = o.material.clone(); mats.push(o.material); }
  });
  return { root, inner, parts, mats };
}

export function animateMob(model, t, walkAmt, headYaw, headPitch) {
  const p = model.parts;
  const swing = Math.sin(t * 8) * 0.7 * walkAmt;
  if (p.spider) {
    p.legs.forEach((l, i) => { l.rotation.y = l.userData.baseY + Math.sin(t * 12 + i * 1.3) * 0.3 * walkAmt; });
  } else if (p.legs) {
    p.legs.forEach((l, i) => { l.rotation.x = (i % 2 === (i < 2 ? 0 : 1) ? swing : -swing); });
    if (p.legs.length === 2) { p.legs[0].rotation.x = swing; p.legs[1].rotation.x = -swing; }
  }
  if (p.arms) {
    const base = p.armsForward ? -Math.PI / 2.3 : 0;
    p.arms[0].rotation.x = base + (p.armsForward ? Math.sin(t * 2) * 0.05 : -swing);
    p.arms[1].rotation.x = base + (p.armsForward ? Math.sin(t * 2 + 1) * 0.05 : swing);
  }
  if (p.wings) { const f = walkAmt > 0.1 ? Math.sin(t * 25) * 0.5 : 0; p.wings[0].rotation.z = -f; p.wings[1].rotation.z = f; }
  if (p.head) { p.head.rotation.y = headYaw || 0; p.head.rotation.x = headPitch || 0; }
}
