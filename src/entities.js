// Mobs, dropped items and arrows.
import * as THREE from 'three';
import { moveEntity, isInLiquid, collides } from './physics.js';
import { createMobModel, animateMob, MOB_DEFS } from './models.js';
import { ITEMS, BLOCKS, B, I, itemByKey, SOLID } from './blocks.js';
import { tileUV, blockFaceTile, itemTileName } from './textures.js';
import { sfx } from './audio.js';
import { CS } from './worldgen.js';

const GRAV = 28;

// ---------- shared item mesh (dropped items, held item) ----------
const itemGeoCache = new Map();
export function itemGeometry(id) {
  if (itemGeoCache.has(id)) return itemGeoCache.get(id);
  const d = ITEMS[id];
  let geo;
  const b = d.isBlock ? BLOCKS[id] : null;
  if (b && b.shape !== 'cross' && b.shape !== 'torch') {
    geo = new THREE.BoxGeometry(1, 1, 1);
    const uv = geo.attributes.uv;
    for (let f = 0; f < 6; f++) {
      let name = blockFaceTile(id, f);
      if (f === 4 && b.tex.front) name = b.tex.front;
      const [u0, v0, u1, v1] = tileUV(name);
      for (let k = 0; k < 4; k++) {
        const i = f * 4 + k;
        uv.setXY(i, uv.getX(i) ? u1 : u0, uv.getY(i) ? v1 : v0);
      }
    }
  } else {
    geo = new THREE.PlaneGeometry(1, 1);
    const [u0, v0, u1, v1] = tileUV(itemTileName(id));
    const uv = geo.attributes.uv;
    for (let i = 0; i < 4; i++) uv.setXY(i, uv.getX(i) ? u1 : u0, uv.getY(i) ? v1 : v0);
  }
  itemGeoCache.set(id, geo);
  return geo;
}

class ItemEntity {
  constructor(game, x, y, z, id, count, dmg = 0) {
    this.game = game; this.kind = 'item';
    this.x = x; this.y = y; this.z = z;
    this.vx = (Math.random() - 0.5) * 3; this.vy = 4; this.vz = (Math.random() - 0.5) * 3;
    this.w = 0.25; this.h = 0.25;
    this.id = id; this.count = count; this.dmg = dmg;
    this.age = 0; this.pickupDelay = 0.6;
    const isBlock = ITEMS[id].isBlock && BLOCKS[id].shape !== 'cross' && BLOCKS[id].shape !== 'torch';
    this.mesh = new THREE.Mesh(itemGeometry(id), game.itemMaterial);
    this.mesh.scale.setScalar(isBlock ? 0.25 : 0.4);
    this.isBlock = isBlock;
    game.scene.add(this.mesh);
  }
  update(dt) {
    this.age += dt; this.pickupDelay -= dt;
    const liq = isInLiquid(this.game.world, this);
    this.vy -= (liq ? 5 : GRAV) * dt;
    if (liq) { this.vy = Math.max(this.vy, -1); if (liq === 'water') this.vy += 8 * dt; }
    this.vx *= this.onGround ? 0.8 : 0.98; this.vz *= this.onGround ? 0.8 : 0.98;
    if (collides(this.game.world, this.x - 0.12, this.y, this.z - 0.12, this.x + 0.12, this.y + 0.25, this.z + 0.12)) this.y += 3 * dt; // pushed out of blocks
    moveEntity(this.game.world, this, dt);
    if (liq === 'lava') this.dead = true;
    this.mesh.position.set(this.x, this.y + 0.15 + Math.sin(this.age * 3) * 0.05, this.z);
    this.mesh.rotation.y = this.age * 1.5;
    const p = this.game.player;
    if (this.pickupDelay <= 0 && !p.dead) {
      const dx = p.x - this.x, dy = (p.y + 0.8) - this.y, dz = p.z - this.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 9 && d2 > 1.5 && p.inv.add !== undefined) {
        // gently attract towards the player
        const l = Math.sqrt(d2);
        this.vx += dx / l * 20 * dt; this.vz += dz / l * 20 * dt; this.vy += dy / l * 10 * dt;
      }
      if (d2 < 2.5) {
        const left = p.inv.add(this.id, this.count, this.dmg);
        if (left < this.count) { sfx.pop(); this.game.ui.dirty = true; }
        this.count = left;
        if (!left) this.dead = true;
      }
    }
    if (this.age > 300) this.dead = true;
  }
  dispose() { this.game.scene.remove(this.mesh); }
}

class Arrow {
  constructor(game, x, y, z, vx, vy, vz, owner, dmg) {
    this.game = game; this.kind = 'arrow';
    this.x = x; this.y = y; this.z = z; this.vx = vx; this.vy = vy; this.vz = vz;
    this.owner = owner; this.dmg = dmg; this.age = 0; this.stuck = false;
    const g = new THREE.BoxGeometry(0.05, 0.05, 0.6);
    this.mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0x8a6a3a }));
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.1), new THREE.MeshLambertMaterial({ color: 0x9a9a9a }));
    tip.position.z = 0.3; this.mesh.add(tip);
    game.scene.add(this.mesh);
  }
  update(dt) {
    this.age += dt;
    if (this.age > 30) this.dead = true;
    if (this.stuck) {
      if (this.owner === 'player' && this.age > 0.5) {
        const p = this.game.player;
        if (Math.hypot(p.x - this.x, p.y + 0.8 - this.y, p.z - this.z) < 1.5 && !p.inv.add(I.arrow, 1)) { this.dead = true; sfx.pop(); }
      }
      return;
    }
    this.vy -= 18 * dt;
    const steps = 4;
    for (let s = 0; s < steps && !this.stuck && !this.dead; s++) {
      const nx = this.x + this.vx * dt / steps, ny = this.y + this.vy * dt / steps, nz = this.z + this.vz * dt / steps;
      const b = this.game.world.getBlock(Math.floor(nx), Math.floor(ny), Math.floor(nz));
      if (SOLID[b]) { this.stuck = true; break; }
      this.x = nx; this.y = ny; this.z = nz;
      // hit entities
      const targets = this.owner === 'player' ? this.game.ents.mobs : [this.game.player];
      for (const t of targets) {
        if (t.dead) continue;
        const hw = t.w / 2 + 0.1;
        if (this.x > t.x - hw && this.x < t.x + hw && this.z > t.z - hw && this.z < t.z + hw && this.y > t.y && this.y < t.y + t.h) {
          t.hurt(this.dmg, { x: this.x - this.vx * 0.1, z: this.z - this.vz * 0.1, kind: this.owner === 'player' ? 'player' : 'mob' });
          this.dead = true; break;
        }
      }
    }
    this.mesh.position.set(this.x, this.y, this.z);
    const sp = Math.hypot(this.vx, this.vz);
    this.mesh.rotation.set(0, 0, 0);
    this.mesh.rotation.y = Math.atan2(this.vx, this.vz);
    this.mesh.rotateX(-Math.atan2(this.vy, sp));
  }
  dispose() { this.game.scene.remove(this.mesh); }
}

export class Mob {
  constructor(game, type, x, y, z) {
    this.game = game; this.type = type; this.kind = 'mob';
    this.def = MOB_DEFS[type];
    this.x = x; this.y = y; this.z = z; this.vx = 0; this.vy = 0; this.vz = 0;
    this.w = this.def.w; this.h = this.def.h;
    this.hp = this.def.hp; this.yaw = Math.random() * Math.PI * 2; this.bodyYaw = this.yaw;
    this.model = createMobModel(type);
    game.scene.add(this.model.root);
    this.t = Math.random() * 10; this.walk = 0;
    this.target = null; this.wanderTimer = 0; this.panic = 0; this.attackCd = 0; this.hurtTime = 0;
    this.soundTimer = 5 + Math.random() * 10;
    this.fireTimer = 0; this.aggro = false; this.age = 0;
  }
  hurt(dmg, src) {
    if (this.dead || this.hurtTime > 0.3) return;
    this.hp -= dmg; this.hurtTime = 0.5;
    sfx.hit();
    if (src && src.x !== undefined) {
      const dx = this.x - src.x, dz = this.z - src.z, l = Math.hypot(dx, dz) || 1;
      this.vx = dx / l * 7; this.vz = dz / l * 7; this.vy = 6;
    }
    if (this.def.passive) this.panic = 4;
    else this.aggro = true;
    if (this.hp <= 0) this.die(src && src.kind === 'player');
  }
  die(byPlayer) {
    this.dead = true;
    const g = this.game;
    for (const [k, mn, mx] of this.def.drops) {
      const n = mn + Math.floor(Math.random() * (mx - mn + 1));
      if (n > 0) {
        let key = k;
        if (this.burning && SMELT_DROP[k]) key = SMELT_DROP[k];
        g.ents.drop(this.x, this.y + 0.5, this.z, itemByKey(key), n);
      }
    }
    if (byPlayer && this.def.rare) for (const [k, p] of this.def.rare) if (Math.random() < p) g.ents.drop(this.x, this.y + 0.5, this.z, itemByKey(k), 1);
    if (this.woolColor && this.type === 'sheep') {/* wool drop handled in drops */}
    g.ents.poof(this.x, this.y + this.h / 2, this.z);
  }
  update(dt) {
    const g = this.game, w = g.world, p = g.player, def = this.def;
    this.age += dt; this.t += dt;
    this.hurtTime -= dt; this.attackCd -= dt; this.panic -= dt;
    const liq = isInLiquid(w, this);
    const dxp = p.x - this.x, dzp = p.z - this.z, dyp = p.y - this.y;
    const distP = Math.hypot(dxp, dzp, dyp);
    let mx = 0, mz = 0, speed = def.speed * 2.2;
    const night = g.dayFactor() < 0.35;
    const hostileActive = def.hostile && !p.dead && g.mode === 'survival' && (!def.neutralDay || night || this.aggro);
    // sunlight burning
    if (def.burns && g.dayFactor() > 0.6 && !liq) {
      const [sky] = w.getLight(Math.floor(this.x), Math.floor(this.y + 1.5), Math.floor(this.z));
      if (sky >= 14) { this.fireTimer += dt; this.burning = true; if (this.fireTimer > 1) { this.fireTimer = 0; this.hurt(1, null); this.hurtTime = 0; } }
    }
    if (hostileActive && distP < 18) {
      const l = Math.hypot(dxp, dzp) || 1;
      if (def.ranged) {
        if (distP > 8) { mx = dxp / l; mz = dzp / l; }
        else if (distP < 5) { mx = -dxp / l; mz = -dzp / l; }
        if (this.attackCd <= 0 && distP < 16 && this.canSee(p)) {
          this.attackCd = 2 + Math.random();
          const sy = this.y + 1.5, ty = p.y + 1.2;
          const dh = Math.hypot(dxp, dzp) || 1;
          const flight = dh / 20;
          const inacc = 0.6;
          g.ents.arrow(this.x + dxp / l * 0.6, sy, this.z + dzp / l * 0.6,
            (dxp + (Math.random() - 0.5) * inacc * 2) / flight, (ty - sy) / flight + 9 * flight, (dzp + (Math.random() - 0.5) * inacc * 2) / flight, 'mob', 3);
          sfx.bow();
        }
      } else {
        mx = dxp / l; mz = dzp / l;
        speed *= 1.1;
        if (distP < 1.4 + this.w / 2 && this.attackCd <= 0 && Math.abs(dyp) < 1.8) {
          this.attackCd = 1;
          p.hurt(def.damage, { x: this.x, z: this.z, kind: 'mob' });
        }
        if (def.type === 'spider' || this.type === 'spider') { if (this.onGround && distP < 4 && distP > 2 && Math.random() < 0.03) { this.vy = 7; this.vx = mx * 7; this.vz = mz * 7; } }
      }
      this.yaw = Math.atan2(dxp, dzp);
    } else if (this.panic > 0) {
      if (this.wanderTimer <= 0 || !this.target) { this.wanderTimer = 1; const a = Math.random() * Math.PI * 2; this.target = [this.x + Math.cos(a) * 8, this.z + Math.sin(a) * 8]; }
      speed *= 1.8;
    } else {
      // follow player holding wheat
      const held = p.held();
      if (def.passive && held && (held.id === I.wheat || held.id === I.wheat_seeds) && distP < 8 && distP > 2) {
        this.target = [p.x, p.z];
      } else if (this.wanderTimer <= 0) {
        this.wanderTimer = 3 + Math.random() * 6;
        if (Math.random() < 0.5) { const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 6; this.target = [this.x + Math.cos(a) * r, this.z + Math.sin(a) * r]; }
        else this.target = null;
      }
    }
    this.wanderTimer -= dt;
    if (mx === 0 && mz === 0 && this.target) {
      const tx = this.target[0] - this.x, tz = this.target[1] - this.z, l = Math.hypot(tx, tz);
      if (l < 0.5) this.target = null;
      else { mx = tx / l; mz = tz / l; this.yaw = Math.atan2(tx, tz); speed *= 0.5; }
    }
    // physics
    const ctrl = this.onGround ? 1 : 0.3;
    const tvx = mx * speed, tvz = mz * speed;
    this.vx += (tvx - this.vx) * Math.min(1, dt * 10 * ctrl);
    this.vz += (tvz - this.vz) * Math.min(1, dt * 10 * ctrl);
    if (liq) { this.vy += (liq === 'water' ? 30 : 10) * dt; this.vy = Math.min(this.vy, 3); this.vx *= 0.9; this.vz *= 0.9; if (liq === 'lava') { this.hurt(2, null); this.hurtTime = 0.3; } }
    this.vy -= GRAV * dt;
    if (liq) this.vy = Math.max(this.vy, -3);
    const preVy = this.vy;
    moveEntity(w, this, dt);
    if (this.onGround && preVy < -15) this.hurt(Math.floor((-preVy - 13) / 3), null);
    if (this.hitWall && this.onGround && (mx || mz)) {
      if (this.type === 'spider') this.vy = 5; else this.vy = 8.5;
    }
    if (this.type === 'spider' && this.hitWall && (mx || mz)) this.vy = Math.max(this.vy, 3);
    // visuals
    const sp = Math.hypot(this.vx, this.vz);
    this.walk += (Math.min(1, sp / 2) - this.walk) * Math.min(1, dt * 8);
    let dy = this.yaw - this.bodyYaw;
    while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
    this.bodyYaw += dy * Math.min(1, dt * 6);
    const m = this.model;
    m.root.position.set(this.x, this.y, this.z);
    m.root.rotation.y = this.bodyYaw;
    let headYaw = 0, headPitch = 0;
    if (distP < 8) {
      let hy = Math.atan2(dxp, dzp) - this.bodyYaw;
      while (hy > Math.PI) hy -= Math.PI * 2; while (hy < -Math.PI) hy += Math.PI * 2;
      if (Math.abs(hy) < 1.2) { headYaw = hy; headPitch = -Math.atan2(dyp + 1.6 - this.h, Math.hypot(dxp, dzp)) * 0.6; }
    }
    animateMob(m, this.t, this.walk, headYaw, headPitch);
    // lighting tint
    const [sky, bl] = w.getLight(Math.floor(this.x), Math.floor(this.y + 0.5), Math.floor(this.z));
    const lv = Math.max(sky / 15 * g.dayFactor(), bl / 15);
    const br = Math.pow(0.82, 15 * (1 - lv)) * 1.1 + 0.05;
    for (const mat of m.mats) {
      if (this.hurtTime > 0.2) mat.color.setRGB(1.0, 0.35, 0.35);
      else mat.color.setRGB(br, br, br);
    }
    this.soundTimer -= dt;
    if (this.soundTimer <= 0) { this.soundTimer = 8 + Math.random() * 12; if (distP < 16) sfx.mob(this.type); }
    if (this.y < -20) this.dead = true;
  }
  canSee(p) {
    const ex = this.x, ey = this.y + this.h * 0.85, ez = this.z;
    const tx = p.x - ex, ty = p.y + 1.5 - ey, tz = p.z - ez;
    const l = Math.hypot(tx, ty, tz);
    for (let s = 0.5; s < l; s += 0.5) {
      if (SOLID[this.game.world.getBlock(Math.floor(ex + tx / l * s), Math.floor(ey + ty / l * s), Math.floor(ez + tz / l * s))]) return false;
    }
    return true;
  }
  dispose() { this.game.scene.remove(this.model.root); }
}
const SMELT_DROP = { porkchop: 'cooked_porkchop', beef: 'steak', mutton: 'cooked_mutton', chicken: 'cooked_chicken' };

class Particle {
  constructor(game, x, y, z, color) {
    this.x = x; this.y = y; this.z = z;
    this.vx = (Math.random() - 0.5) * 3; this.vy = Math.random() * 3 + 1; this.vz = (Math.random() - 0.5) * 3;
    this.life = 0.6 + Math.random() * 0.4; this.game = game; this.kind = 'particle';
    this.mesh = new THREE.Mesh(game.particleGeo, new THREE.MeshBasicMaterial({ color }));
    game.scene.add(this.mesh);
  }
  update(dt) {
    this.life -= dt; if (this.life <= 0) this.dead = true;
    this.vy -= 10 * dt;
    this.x += this.vx * dt; this.y += this.vy * dt; this.z += this.vz * dt;
    if (SOLID[this.game.world.getBlock(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z))]) { this.vy = 0; this.vx *= 0.5; this.vz *= 0.5; this.y = Math.floor(this.y) + 1.01; }
    this.mesh.position.set(this.x, this.y, this.z);
  }
  dispose() { this.game.scene.remove(this.mesh); this.mesh.material.dispose(); }
}

export class EntityManager {
  constructor(game) {
    this.game = game;
    this.mobs = []; this.items = []; this.others = [];
    this.spawnTimer = 0;
    game.particleGeo = new THREE.BoxGeometry(0.08, 0.08, 0.08);
  }
  drop(x, y, z, id, count, dmg = 0) { if (count > 0 && id) this.items.push(new ItemEntity(this.game, x, y, z, id, count, dmg)); }
  arrow(x, y, z, vx, vy, vz, owner, dmg) { this.others.push(new Arrow(this.game, x, y, z, vx, vy, vz, owner, dmg)); }
  spawnMob(type, x, y, z) { const m = new Mob(this.game, type, x, y, z); this.mobs.push(m); return m; }
  poof(x, y, z) { for (let i = 0; i < 10; i++) this.others.push(new Particle(this.game, x, y, z, 0xdddddd)); }
  blockParticles(x, y, z, id) {
    const col = PARTICLE_COL(id);
    for (let i = 0; i < 8; i++) this.others.push(new Particle(this.game, x + Math.random(), y + Math.random(), z + Math.random(), col));
  }
  update(dt) {
    const g = this.game, p = g.player;
    for (const list of [this.mobs, this.items, this.others]) {
      for (let i = list.length - 1; i >= 0; i--) {
        const e = list[i];
        // freeze entities in unloaded chunks
        if (e.kind !== 'particle' && !g.world.isLoaded(Math.floor(e.x), Math.floor(e.z))) {
          if (e.kind === 'mob') { e.dead = true; }
          else continue;
        }
        e.update(dt);
        if (e.kind === 'mob' && !e.dead) {
          const d = Math.hypot(e.x - p.x, e.z - p.z);
          if (e.def.hostile && (d > 64 || (d > 32 && Math.random() < dt / 30))) e.dead = true;
        }
        if (e.dead) { e.dispose(); list.splice(i, 1); }
      }
    }
    // merge nearby items occasionally
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) { this.spawnTimer = 1; this.trySpawn(); }
  }
  trySpawn() {
    const g = this.game, w = g.world, p = g.player;
    if (!g.settings.mobs) return;
    const passive = this.mobs.filter((m) => m.def.passive).length;
    const hostile = this.mobs.length - passive;
    const day = g.dayFactor();
    for (let attempt = 0; attempt < 3; attempt++) {
      const a = Math.random() * Math.PI * 2, r = 20 + Math.random() * 28;
      const x = Math.floor(p.x + Math.cos(a) * r), z = Math.floor(p.z + Math.sin(a) * r);
      if (!w.isLoaded(x, z)) continue;
      const cave = Math.random() < 0.5;
      let y;
      if (cave) {
        y = 5 + Math.floor(Math.random() * Math.max(1, w.surfaceY(x, z) - 8));
        if (SOLID[w.getBlock(x, y, z)] || SOLID[w.getBlock(x, y + 1, z)] || !SOLID[w.getBlock(x, y - 1, z)]) continue;
      } else {
        y = w.surfaceY(x, z) + 1;
        if (SOLID[w.getBlock(x, y, z)] || SOLID[w.getBlock(x, y + 1, z)]) continue;
      }
      const ground = w.getBlock(x, y - 1, z);
      if (ground === B.water || ground === B.lava || ground === B.oak_leaves || ground === B.birch_leaves || ground === B.spruce_leaves) continue;
      if (w.getBlock(x, y, z) === B.water) continue;
      const [sky, bl] = w.getLight(x, y, z);
      const light = Math.max(sky * day, bl);
      if (!cave && passive < 12 && (ground === B.grass || ground === B.snowy_grass) && sky > 12 && Math.random() < 0.3) {
        const types = ['pig', 'cow', 'sheep', 'chicken'];
        const t = types[Math.floor(Math.random() * types.length)];
        const n = 1 + Math.floor(Math.random() * 3);
        for (let k = 0; k < n; k++) this.spawnMob(t, x + 0.5 + k * 0.6, y, z + 0.5);
        return;
      }
      if (g.mode === 'survival' && hostile < 14 && light < 7 && g.settings.hostile) {
        const types = ['zombie', 'zombie', 'skeleton', 'spider'];
        this.spawnMob(types[Math.floor(Math.random() * types.length)], x + 0.5, y, z + 0.5);
        return;
      }
    }
  }
  clear() {
    for (const list of [this.mobs, this.items, this.others]) { for (const e of list) e.dispose(); list.length = 0; }
  }
  // raycast mobs, returns {mob, dist}
  pickMob(ox, oy, oz, dx, dy, dz, maxD, rayBox) {
    let best = null, bd = maxD;
    for (const m of this.mobs) {
      const hw = m.w / 2;
      const t = rayBox(ox, oy, oz, dx, dy, dz, m.x - hw, m.y, m.z - hw, m.x + hw, m.y + m.h, m.z + hw);
      if (t >= 0 && t < bd) { bd = t; best = m; }
    }
    return best ? { mob: best, dist: bd } : null;
  }
  serialize() {
    return this.mobs.filter((m) => m.def.passive).map((m) => [m.type, +m.x.toFixed(2), +m.y.toFixed(2), +m.z.toFixed(2), m.hp]);
  }
  load(arr) {
    if (!arr) return;
    for (const [t, x, y, z, hp] of arr) if (MOB_DEFS[t]) { const m = this.spawnMob(t, x, y, z); m.hp = hp; }
  }
}

function PARTICLE_COL(id) {
  const k = BLOCKS[id] ? BLOCKS[id].key : '';
  if (/grass|leaves|cactus|sapling|melon/.test(k)) return 0x4f8a2a;
  if (/dirt|farmland/.test(k)) return 0x7a5638;
  if (/sand/.test(k)) return 0xddd09a;
  if (/log|plank|table|chest|bookshelf|fence|ladder/.test(k)) return 0x9a7a4a;
  if (/snow|wool|white/.test(k)) return 0xf0f0f0;
  if (/glass|ice/.test(k)) return 0xcfe8ff;
  return 0x808080;
}
