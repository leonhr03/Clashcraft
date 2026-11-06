// Player state, movement physics and survival stats.
import { moveEntity, isInLiquid, collides } from './physics.js';
import { Inventory } from './inventory.js';
import { ITEMS, BLOCKS, B } from './blocks.js';
import { sfx } from './audio.js';

export class Player {
  constructor(game) {
    this.game = game;
    this.x = 0; this.y = 80; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.w = 0.6; this.h = 1.8; this.eye = 1.62;
    this.yaw = 0; this.pitch = 0;
    this.hp = 20; this.food = 20; this.sat = 5; this.exhaustion = 0; this.air = 10;
    this.inv = new Inventory(36);
    this.armor = new Inventory(4);
    this.sel = 0;
    this.flying = false; this.sneaking = false; this.sprinting = false;
    this.fallStart = null; this.hurtTime = 0; this.regenTimer = 0; this.starveTimer = 0; this.drownTimer = 0;
    this.dead = false; this.spawn = null;
    this.stepDist = 0; this.inWater = false; this.headInWater = false;
    this.bob = 0;
  }
  held() { return this.inv.slots[this.sel]; }
  armorPoints() { return this.armor.slots.reduce((a, s) => a + (s ? ITEMS[s.id].armor || 0 : 0), 0); }

  hurt(dmg, src) {
    const g = this.game;
    if (this.dead || g.mode === 'creative' || this.hurtTime > 0) return;
    if (src && src.kind !== 'fall' && src.kind !== 'starve' && src.kind !== 'drown') {
      const ap = this.armorPoints();
      dmg = dmg * (1 - Math.min(20, ap) / 25);
      // wear armour
      this.armor.slots.forEach((s, i) => { if (s) { s.dmg = (s.dmg || 0) + 1; if (s.dmg >= ITEMS[s.id].durability) this.armor.slots[i] = null; } });
    }
    this.hp -= dmg;
    this.hurtTime = 0.5;
    this.exhaustion += 0.1;
    sfx.hurt();
    g.ui.flashDamage();
    if (src && src.x !== undefined) {
      const dx = this.x - src.x, dz = this.z - src.z, l = Math.hypot(dx, dz) || 1;
      this.vx += dx / l * 6; this.vz += dz / l * 6; this.vy = 5;
    }
    if (this.hp <= 0) { this.hp = 0; g.onDeath(); }
    g.ui.dirty = true;
  }

  update(dt, input) {
    const g = this.game, w = g.world;
    this.hurtTime -= dt;
    const creative = g.mode === 'creative';
    if (!creative) this.flying = false;
    // input movement in local space
    let fwd = input.forward, str = input.strafe;
    const len = Math.hypot(fwd, str);
    if (len > 1) { fwd /= len; str /= len; }
    this.sneaking = input.sneak && !this.flying;
    this.sprinting = (input.sprint || len > 0.95 && input.autoSprint) && fwd > 0.5 && !this.sneaking && (this.food > 6 || creative);
    const liq = isInLiquid(w, this);
    this.inWater = liq === 'water';
    const headBlock = w.getBlock(Math.floor(this.x), Math.floor(this.y + this.eye), Math.floor(this.z));
    this.headInWater = headBlock === B.water;
    this.headInLava = headBlock === B.lava;
    let speed = this.flying ? (this.sprinting ? 21 : 11) : this.sprinting ? 5.6 : this.sneaking ? 1.3 : 4.3;
    if (liq) speed *= 0.5;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // forward is -z in camera space; yaw rotates around Y
    const mx = (-sin * fwd + cos * str) * speed;
    const mz = (-cos * fwd - sin * str) * speed;
    const accel = this.flying ? 10 : this.onGround ? 14 : liq ? 6 : 3;
    this.vx += (mx - this.vx) * Math.min(1, accel * dt);
    this.vz += (mz - this.vz) * Math.min(1, accel * dt);

    const onLadder = BLOCKS[w.getBlock(Math.floor(this.x), Math.floor(this.y + 0.2), Math.floor(this.z))].climb;
    if (this.flying) {
      let vyT = 0;
      if (input.jump) vyT = 9; if (input.sneak) vyT = -9;
      this.vy += (vyT - this.vy) * Math.min(1, 10 * dt);
    } else if (liq) {
      this.vy -= 10 * dt;
      if (input.jump) this.vy += 22 * dt;
      this.vy = Math.max(-3, Math.min(this.vy, 3.5));
      this.vx *= 1 - dt * 2; this.vz *= 1 - dt * 2;
    } else if (onLadder) {
      this.vy = input.jump || (fwd > 0.3 && this.hitWall) ? 3 : this.sneaking ? 0 : Math.max(this.vy - 28 * dt, -2.5);
    } else {
      this.vy -= 28 * dt;
      this.vy = Math.max(this.vy, -60);
      if (input.jump && this.onGround) { this.vy = 8.6; this.exhaustion += this.sprinting ? 0.2 : 0.05; if (this.sprinting) { this.vx *= 1.25; this.vz *= 1.25; } }
    }
    const ox = this.x, oz = this.z;
    // sneaking: don't fall off edges
    const preVy = this.vy;
    const wasGround = this.onGround;
    moveEntity(w, this, dt);
    if (this.sneaking && wasGround && !this.flying) {
      if (!collides(w, this.x - 0.3, this.y - 0.6, this.z - 0.3, this.x + 0.3, this.y - 0.01, this.z + 0.3)) {
        // revert horizontal movement that would leave the edge
        const tx = this.x, tz = this.z;
        this.x = ox; this.z = oz;
        if (collides(w, tx - 0.3, this.y - 0.6, this.z - 0.3, tx + 0.3, this.y - 0.01, this.z + 0.3)) this.x = tx;
        if (collides(w, this.x - 0.3, this.y - 0.6, tz - 0.3, this.x + 0.3, this.y - 0.01, tz + 0.3)) this.z = tz;
        this.onGround = true; this.vy = 0;
      }
    }
    // auto jump (mobile friendly)
    if (g.settings.autoJump && this.hitWall && this.onGround && (fwd || str) && !this.flying && !liq) {
      const ax = this.x + (mx / speed) * 0.5, az = this.z + (mz / speed) * 0.5;
      const fb = w.getBlock(Math.floor(ax), Math.floor(this.y + 0.1), Math.floor(az));
      if (BLOCKS[fb].solid && !collides(w, this.x - 0.3, this.y + 1.05, this.z - 0.3, this.x + 0.3, this.y + 2.85, this.z + 0.3)) this.vy = 8.6;
    }
    if (this.flying && this.onGround && !input.jump) this.flying = false;
    // fall damage
    if (!this.onGround && !liq && !this.flying && !onLadder) {
      if (this.fallStart === null || this.y > this.fallStart) this.fallStart = this.y;
    } else {
      if (this.fallStart !== null && this.onGround && !creative) {
        const dist = this.fallStart - this.y;
        if (dist > 3.5) this.hurt(Math.floor(dist - 3), { kind: 'fall' });
      }
      this.fallStart = liq || onLadder || this.flying ? null : (this.onGround ? null : this.fallStart);
    }
    void preVy;
    // steps
    const moved = Math.hypot(this.x - ox, this.z - oz);
    if (this.onGround) {
      this.stepDist += moved; this.bob += moved * 2.2;
      if (this.stepDist > 1.8) {
        this.stepDist = 0;
        const gb = w.getBlock(Math.floor(this.x), Math.floor(this.y - 0.2), Math.floor(this.z));
        if (gb) sfx.step(BLOCKS[gb].key);
      }
      this.exhaustion += moved * (this.sprinting ? 0.1 : 0.01);
    }
    if (liq === 'lava') this.hurt(4, { kind: 'lava' });
    // cactus damage
    for (const [dx, dz] of [[0.35, 0], [-0.35, 0], [0, 0.35], [0, -0.35]]) {
      if (w.getBlock(Math.floor(this.x + dx), Math.floor(this.y + 0.5), Math.floor(this.z + dz)) === B.cactus) { this.hurt(1, { kind: 'cactus' }); break; }
    }
    if (!creative) this.survival(dt);
    if (this.y < -30) this.hurt(4, { kind: 'void' });
  }

  survival(dt) {
    // air
    if (this.headInWater) {
      this.drownTimer += dt;
      if (this.drownTimer > 1.5) { this.drownTimer = 0; if (this.air > 0) this.air--; else this.hurt(2, { kind: 'drown' }); this.game.ui.dirty = true; }
    } else if (this.air < 10) { this.drownTimer += dt; if (this.drownTimer > 0.3) { this.drownTimer = 0; this.air++; this.game.ui.dirty = true; } }
    // hunger
    if (this.exhaustion >= 4) {
      this.exhaustion -= 4;
      if (this.sat > 0) this.sat = Math.max(0, this.sat - 1); else this.food = Math.max(0, this.food - 1);
      this.game.ui.dirty = true;
    }
    this.regenTimer += dt;
    if (this.food >= 18 && this.hp < 20 && this.regenTimer > 4) {
      this.regenTimer = 0; this.hp = Math.min(20, this.hp + 1); this.exhaustion += 3; this.game.ui.dirty = true;
    }
    if (this.food <= 0) {
      this.starveTimer += dt;
      if (this.starveTimer > 4) { this.starveTimer = 0; if (this.hp > 1 || this.game.settings.hardcoreStarve) this.hurt(1, { kind: 'starve' }); }
    }
  }

  eat(def) {
    this.food = Math.min(20, this.food + def.food);
    this.sat = Math.min(this.food, this.sat + def.sat);
    if (def.heal) this.hp = Math.min(20, this.hp + def.heal);
    sfx.eat();
    this.game.ui.dirty = true;
  }

  serialize() {
    return {
      x: this.x, y: this.y, z: this.z, yaw: this.yaw, pitch: this.pitch, hp: this.hp, food: this.food, sat: this.sat,
      inv: this.inv.toJSON(), armor: this.armor.toJSON(), sel: this.sel, spawn: this.spawn, flying: this.flying,
    };
  }
  load(d) {
    if (!d) return;
    Object.assign(this, { x: d.x, y: d.y, z: d.z, yaw: d.yaw || 0, pitch: d.pitch || 0, hp: d.hp ?? 20, food: d.food ?? 20, sat: d.sat ?? 5, sel: d.sel || 0, spawn: d.spawn || null, flying: !!d.flying });
    this.inv.load(d.inv); this.armor.load(d.armor);
  }
}
