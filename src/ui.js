// HUD, inventory screens, menus.
import { ITEMS, BLOCKS, B, I, maxStack } from './blocks.js';
import { getIcon } from './textures.js';
import { Inventory, cloneStack } from './inventory.js';
import { matchRecipe, SMELT } from './recipes.js';
import { Input } from './input.js';
import { sfx } from './audio.js';
import { BIOME_NAMES } from './worldgen.js';

const $ = (id) => document.getElementById(id);

// small pixel icons for hearts / hunger / armor / air
function iconURL(rows, pal) {
  const c = document.createElement('canvas'); c.width = 9; c.height = 9;
  const ctx = c.getContext('2d');
  rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (pal[r[x]]) { ctx.fillStyle = pal[r[x]]; ctx.fillRect(x, y, 1, 1); } });
  return c.toDataURL();
}
const HEART = ['.kk...kk.', 'krrk.krrk', 'krwrrrrrk', 'krrrrrrrk', 'krrrrrrrk', '.krrrrrk.', '..krrrk..', '...krk...', '....k....'];
const HEART_HALF = ['.kk...kk.', 'krrk.keek', 'krwrreeek', 'krrrreeek', 'krrrreeek', '.krrreek.', '..krrek..', '...kek...', '....k....'];
const HEART_E = ['.kk...kk.', 'keek.keek', 'keeeeeeek', 'keeeeeeek', 'keeeeeeek', '.keeeeek.', '..keeek..', '...kek...', '....k....'];
const FOOD = ['......kk.', '.....kwwk', '....kbwk.', '..kkbbk..', '.kbbbbk..', 'kbbbbbk..', 'kbbbbk...', '.kbbk....', '..kk.....'];
const FOOD_E = FOOD.map((r) => r.replace(/[bw]/g, 'e'));
const FOOD_H = FOOD.map((r, y) => r.split('').map((ch, x) => (x < 4 && (ch === 'b' || ch === 'w') ? 'e' : ch)).join(''));
const ARM = ['.kkk.kkk.', 'kaaakaaak', 'kaaaaaaak', 'kawaaaaak', '.kaaaaak.', '.kaaaaak.', '.kaaaaak.', '..kaaak..', '...kkk...'];
const ARM_E = ARM.map((r) => r.replace(/[aw]/g, 'e'));
const BUB = ['.........', '..kkkk...', '.kbbbbk..', 'kbwbbbbk.', 'kbbbbbbk.', 'kbbbbbbk.', '.kbbbbk..', '..kkkk...', '.........'];
const P = { k: '#1a1a1a', r: '#e01e1e', w: '#ffffff', e: '#3a3a3a', b: '#b8703a', a: '#c8c8c8' };
const ICONS = {};

const CREATIVE_TABS = [
  ['Bauen', (d) => d.isBlock && !['cross', 'torch'].includes(BLOCKS[d.id].shape) && d.id !== B.water && d.id !== B.lava && !d.key.startsWith('wheat') && d.id !== B.furnace_lit && d.id !== B.farmland && d.id !== B.air],
  ['Natur', (d) => d.isBlock && (['cross', 'torch'].includes(BLOCKS[d.id].shape) && !d.key.startsWith('wheat_')) && d.id !== B.ladder || d.key === 'ladder'],
  ['Werkzeuge', (d) => !d.isBlock && (d.toolType || d.armorSlot !== undefined || d.bow || d.key === 'arrow' || /bucket/.test(d.key))],
  ['Essen', (d) => !d.isBlock && d.food !== undefined],
  ['Material', (d) => !d.isBlock && !d.toolType && d.armorSlot === undefined && !d.bow && d.food === undefined && d.key !== 'arrow' && !/bucket/.test(d.key)],
];

export class UI {
  constructor(settings) {
    this.settings = settings;
    this.game = null;
    this.dirty = true;
    this.screenOpen = null;
    this.paused = false;
    this.cursor = null;
    this.quick = false; this.single = false;
    this.input = new Input(this);
    this.isTouch = this.input.touch;
    if (!this.isTouch) document.body.classList.add('desktop');
    this.input.bindCanvas($('touchzone'));
    ICONS.heart = iconURL(HEART, P); ICONS.half = iconURL(HEART_HALF, P); ICONS.heartE = iconURL(HEART_E, P);
    ICONS.food = iconURL(FOOD, P); ICONS.foodE = iconURL(FOOD_E, P); ICONS.foodH = iconURL(FOOD_H, P);
    ICONS.arm = iconURL(ARM, P); ICONS.armE = iconURL(ARM_E, P); ICONS.bub = iconURL(BUB, Object.assign({}, P, { b: '#3a7af0' }));
    this.buildHotbar();
    $('screen').addEventListener('pointerdown', (e) => { if (e.target.id === 'screen') this.dropCursor(); });
    this.heldInfo = null;
    this.debugOn = false;
  }

  attach(game) {
    this.game = game;
    this.dirty = true;
    $('hud').classList.remove('hidden');
    this.showLoading();
  }
  detach() { this.game = null; $('hud').classList.add('hidden'); this.closeScreen(); }

  showLoading() { $('loading').classList.remove('hidden'); $('loadbar').style.width = '0%'; }
  hideLoading() { $('loading').classList.add('hidden'); }
  loadingProgress(f) { $('loadbar').style.width = Math.min(100, f * 100).toFixed(0) + '%'; }

  toast(msg, ms = 2500) {
    const t = $('toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(this._tt); this._tt = setTimeout(() => t.classList.remove('on'), ms);
  }
  flashDamage() { const d = $('dmgflash'); d.classList.add('on'); setTimeout(() => d.classList.remove('on'), 80); }
  toggleDebug() { this.debugOn = !this.debugOn; $('debug').classList.toggle('hidden', !this.debugOn); }

  // ---------- HUD ----------
  buildHotbar() {
    const hb = $('hotbar'); hb.innerHTML = '';
    this.hotSlots = [];
    for (let i = 0; i < 9; i++) {
      const s = document.createElement('div'); s.className = 'slot';
      s.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.selectSlot(i); });
      hb.appendChild(s); this.hotSlots.push(s);
    }
  }
  selectSlot(i) {
    if (!this.game) return;
    this.game.player.sel = i; this.dirty = true;
    const s = this.game.player.held();
    const n = $('itemname');
    if (s) { n.textContent = ITEMS[s.id].name; n.classList.add('on'); clearTimeout(this._nt); this._nt = setTimeout(() => n.classList.remove('on'), 1500); }
    else n.classList.remove('on');
    if (this.game.eating > 0) this.game.eating = 0;
  }
  renderSlot(el, s) {
    let html = '';
    if (s) {
      html += `<div class="ic" style="background-image:url(${getIcon(s.id)})"></div>`;
      if (s.count > 1) html += `<div class="cnt">${s.count}</div>`;
      const d = ITEMS[s.id];
      if (d.durability && s.dmg > 0) {
        const f = 1 - s.dmg / d.durability;
        html += `<div class="dur"><i style="width:${(f * 100).toFixed(0)}%;background:hsl(${(f * 120).toFixed(0)},90%,45%)"></i></div>`;
      }
    }
    if (el._html !== html) { el.innerHTML = html; el._html = html; }
  }
  renderHUD() {
    const g = this.game, p = g.player;
    this.hotSlots.forEach((el, i) => { this.renderSlot(el, p.inv.slots[i]); el.classList.toggle('sel', i === p.sel); });
    const surv = g.mode === 'survival';
    $('stats').style.visibility = surv ? 'visible' : 'hidden';
    if (!surv) return;
    const icons = (full, half, empty, val, n = 10) => {
      let h = '';
      for (let i = 0; i < n; i++) { const v = val - i * 2; h += `<img src="${v >= 2 ? full : v === 1 ? half : empty}">`; }
      return h;
    };
    const hp = Math.ceil(p.hp);
    const set = (id, html) => { const el = $(id); if (el._h !== html) { el.innerHTML = html; el._h = html; } };
    set('hearts', icons(ICONS.heart, ICONS.half, ICONS.heartE, hp));
    set('hunger', icons(ICONS.food, ICONS.foodH, ICONS.foodE, p.food));
    const ap = p.armorPoints();
    set('armorbar', ap > 0 ? icons(ICONS.arm, ICONS.arm, ICONS.armE, ap) : '');
    set('airbar', p.headInWater || p.air < 10 ? `${'<img src="' + ICONS.bub + '">'}`.repeat(Math.max(0, p.air)) : '');
  }

  frame(dt) {
    const g = this.game;
    if (!g) return;
    if (this.dirty) { this.dirty = false; this.renderHUD(); if (this.screenOpen) this.renderScreen(); }
    if (this.debugOn) {
      const p = g.player;
      const col = g.world.gen.column(Math.floor(p.x), Math.floor(p.z));
      const [sky, bl] = g.world.getLight(Math.floor(p.x), Math.floor(p.y + 0.5), Math.floor(p.z));
      $('debug').textContent = `Blockwelt  ${g.fps} FPS\nXYZ: ${p.x.toFixed(1)} / ${p.y.toFixed(1)} / ${p.z.toFixed(1)}\nBiom: ${BIOME_NAMES[col.biome]}\nLicht: Himmel ${sky} Block ${bl}\nChunks: ${g.world.chunks.size}  Mobs: ${g.ents.mobs.length}\nZeit: ${(g.time * 24 + 6).toFixed(1) % 24}h`;
    }
  }

  // ---------- menus ----------
  pause() {
    if (!this.game || this.paused) return;
    this.closeScreen();
    this.paused = true; this.game.paused = true;
    $('pausemenu').classList.remove('hidden');
    $('pm-mode').textContent = 'Spielmodus: ' + (this.game.mode === 'creative' ? 'Kreativ' : 'Überleben');
    if (document.pointerLockElement) document.exitPointerLock();
    this.game.save();
  }
  resume() {
    this.paused = false; if (this.game) this.game.paused = false;
    $('pausemenu').classList.add('hidden');
    if (!this.isTouch) $('touchzone').requestPointerLock && $('touchzone').requestPointerLock();
  }
  showDeath() { $('deathscreen').classList.remove('hidden'); if (document.pointerLockElement) document.exitPointerLock(); this.closeScreen(); }
  hideDeath() { $('deathscreen').classList.add('hidden'); }

  // ---------- container screens ----------
  openScreen(kind, data) {
    if (!this.game || this.game.player.dead) return;
    this.screenOpen = kind; this.screenData = data || {};
    this.selName = '';
    $('screen').classList.remove('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
    this.renderScreen();
  }
  openInventory() {
    if (!this.game) return;
    if (this.game.mode === 'creative') this.openScreen('creative', { tab: this._ctab || 0, craft: new Inventory(4) });
    else this.openScreen('inventory', { craft: new Inventory(4) });
  }
  openCrafting() { this.openScreen('crafting', { craft: new Inventory(9) }); }
  openFurnace(tile) { this.openScreen('furnace', { tile }); }
  openChest(tile) { this.openScreen('chest', { tile }); sfx.place('oak_planks'); }

  closeScreen() {
    if (!this.screenOpen) return;
    const p = this.game && this.game.player;
    if (p) {
      const craft = this.screenData.craft;
      if (craft) for (const s of craft.slots) if (s) this.giveOrDrop(s);
      if (this.cursor) { this.giveOrDrop(this.cursor); this.cursor = null; }
    }
    this.screenOpen = null; this.screenData = null;
    $('screen').classList.add('hidden');
    this.removeHeldInfo();
    this.dirty = true;
    if (!this.isTouch && this.game && !this.paused) $('touchzone').requestPointerLock && $('touchzone').requestPointerLock();
  }
  giveOrDrop(s) {
    const p = this.game.player;
    const left = p.inv.add(s.id, s.count, s.dmg);
    if (left) this.game.ents.drop(p.x, p.y + 1.2, p.z, s.id, left, s.dmg);
  }
  dropCursor() {
    if (!this.cursor || !this.game) return;
    const g = this.game, p = g.player;
    const [dx, , dz] = g.lookDir();
    g.ents.drop(p.x + dx, p.y + 1.3, p.z + dz, this.cursor.id, this.cursor.count, this.cursor.dmg);
    const it = g.ents.items[g.ents.items.length - 1]; it.pickupDelay = 1.5; it.vx = dx * 4; it.vz = dz * 4;
    this.cursor = null; this.renderScreen();
  }

  tickContainers() {
    if (this.screenOpen === 'furnace' || this.screenOpen === 'chest') this.renderScreen(true);
  }

  // slot reference: {get(), set(s), kind, accept(id)}
  slotRef(inv, i, kind = 'normal', accept) {
    return { get: () => inv.slots[i], set: (s) => { inv.slots[i] = s; }, kind, accept, inv, i };
  }

  makeSlot(ref, extraClass) {
    const el = document.createElement('div');
    el.className = 'slot' + (extraClass ? ' ' + extraClass : '');
    this.renderSlot(el, ref.get());
    let pressTimer = null, longFired = false;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      longFired = false;
      pressTimer = setTimeout(() => { longFired = true; this.slotAction(ref, true); }, 420);
    });
    const up = (e) => {
      e.preventDefault(); e.stopPropagation();
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; if (!longFired) this.slotAction(ref, false); }
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointerleave', () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } });
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); });
    return el;
  }

  slotAction(ref, alt) {
    const g = this.game, p = g.player;
    let s = ref.get();
    sfx.click();
    if (s) this.selName = ITEMS[s.id].name;
    if (ref.kind === 'catalog') {
      const id = ref.catalogId;
      this.selName = ITEMS[id].name;
      if (this.quick) { p.inv.add(id, maxStack(id)); }
      else if (this.cursor && this.cursor.id === id) this.cursor.count = Math.min(maxStack(id), this.cursor.count + (alt ? 1 : maxStack(id)));
      else this.cursor = { id, count: alt ? 1 : maxStack(id), dmg: 0 };
      this.renderScreen(); return;
    }
    if (ref.kind === 'trash') { this.cursor = null; this.renderScreen(); return; }
    if (ref.kind === 'output') { this.takeOutput(ref, this.quick || alt); this.renderScreen(); return; }
    if (this.quick && s && !this.cursor) { this.quickMove(ref); this.afterChange(); return; }
    const single = this.single || alt;
    if (!this.cursor) {
      if (!s) return;
      if (alt) { const h = Math.ceil(s.count / 2); this.cursor = { id: s.id, count: h, dmg: s.dmg }; s.count -= h; if (!s.count) ref.set(null); }
      else { this.cursor = s; ref.set(null); }
    } else {
      const c = this.cursor;
      if (ref.accept && !ref.accept(c.id)) return;
      if (!s) {
        if (single) { ref.set({ id: c.id, count: 1, dmg: c.dmg }); c.count--; if (!c.count) this.cursor = null; }
        else { ref.set(c); this.cursor = null; }
      } else if (s.id === c.id && !ITEMS[c.id].durability) {
        const room = maxStack(c.id) - s.count;
        const n = Math.min(room, single ? 1 : c.count);
        s.count += n; c.count -= n; if (!c.count) this.cursor = null;
      } else {
        ref.set(c); this.cursor = s;
      }
    }
    this.afterChange();
  }

  afterChange() {
    const d = this.screenData;
    if (d && d.craft) this.updateCraftResult();
    this.dirty = true;
    this.renderScreen();
  }

  updateCraftResult() {
    const d = this.screenData;
    const n = d.craft.slots.length === 9 ? 3 : 2;
    const r = matchRecipe(d.craft.slots.map((s) => (s ? s.id : 0)), n);
    d.result = r ? { id: r.out, count: r.count, dmg: 0 } : null;
  }

  takeOutput(ref, all) {
    const d = this.screenData, p = this.game.player;
    if (d.craft) {
      let crafted = 0;
      do {
        this.updateCraftResult();
        const r = d.result;
        if (!r) break;
        if (all) { if (p.inv.add(r.id, r.count)) break; }
        else {
          if (this.cursor && (this.cursor.id !== r.id || this.cursor.count + r.count > maxStack(r.id) || ITEMS[r.id].durability)) break;
          if (this.cursor) this.cursor.count += r.count; else this.cursor = { id: r.id, count: r.count, dmg: 0 };
        }
        for (let i = 0; i < d.craft.slots.length; i++) {
          const s = d.craft.slots[i];
          if (s) {
            if (s.id === I.water_bucket || s.id === I.lava_bucket) d.craft.slots[i] = { id: I.bucket, count: 1, dmg: 0 };
            else { s.count--; if (!s.count) d.craft.slots[i] = null; }
          }
        }
        crafted++;
        sfx.click();
      } while (all && crafted < 64);
      this.updateCraftResult();
      this.dirty = true;
    } else {
      // furnace output
      const s = ref.get();
      if (!s) return;
      if (all) { const left = p.inv.add(s.id, s.count); if (left) s.count = left; else ref.set(null); }
      else if (!this.cursor) { this.cursor = s; ref.set(null); }
      else if (this.cursor.id === s.id) { const n = Math.min(s.count, maxStack(s.id) - this.cursor.count); this.cursor.count += n; s.count -= n; if (!s.count) ref.set(null); }
      this.dirty = true;
    }
  }

  quickMove(ref) {
    const p = this.game.player, s = ref.get();
    const d = this.screenData;
    let target = null, order = null;
    if (ref.inv === p.inv) {
      if (this.screenOpen === 'chest') target = d.tile.slotsInv;
      else if (this.screenOpen === 'furnace') {
        const t = d.tile;
        if (SMELT.has(s.id) && (!t.slots[0] || t.slots[0].id === s.id)) { this.mergeInto(t.slots, 0, ref); return; }
        if (ITEMS[s.id].fuel && (!t.slots[1] || t.slots[1].id === s.id)) { this.mergeInto(t.slots, 1, ref); return; }
      }
      if (ITEMS[s.id].armorSlot !== undefined && !p.armor.slots[ITEMS[s.id].armorSlot] && this.screenOpen === 'inventory') {
        p.armor.slots[ITEMS[s.id].armorSlot] = s; ref.set(null); return;
      }
      if (!target) { target = p.inv; order = ref.i < 9 ? [...Array(27).keys()].map((k) => k + 9) : [...Array(9).keys()]; }
    } else target = p.inv;
    if (target === p.inv && !order) order = [...Array(9).keys(), ...[...Array(27).keys()].map((k) => k + 9)];
    const inv = target.slots ? target : { slots: target };
    const tmp = Object.assign(Object.create(Inventory.prototype), { slots: inv.slots });
    const left = tmp.add(s.id, s.count, s.dmg, order);
    if (left) s.count = left; else ref.set(null);
  }
  mergeInto(slots, i, ref) {
    const s = ref.get();
    if (!slots[i]) { slots[i] = s; ref.set(null); return; }
    const n = Math.min(s.count, maxStack(s.id) - slots[i].count);
    slots[i].count += n; s.count -= n; if (!s.count) ref.set(null);
  }

  renderHeldInfo() {
    if (!this.cursor && !this.selName) { this.removeHeldInfo(); return; }
    if (!this.heldInfo) { this.heldInfo = document.createElement('div'); this.heldInfo.id = 'heldinfo'; document.body.appendChild(this.heldInfo); }
    const c = this.cursor;
    this.heldInfo.innerHTML = c ? `<img src="${getIcon(c.id)}"> In der Hand: ${ITEMS[c.id].name} ×${c.count}` : this.selName;
  }
  removeHeldInfo() { if (this.heldInfo) { this.heldInfo.remove(); this.heldInfo = null; } }

  invGrid(inv, from, to, cols, kind, accept) {
    const g = document.createElement('div');
    g.className = 'grid'; g.style.gridTemplateColumns = `repeat(${cols}, var(--slot))`;
    for (let i = from; i < to; i++) g.appendChild(this.makeSlot(this.slotRef(inv, i, kind, accept)));
    return g;
  }

  playerInvSection(panel) {
    const p = this.game.player;
    const h = document.createElement('h3'); h.textContent = 'Inventar'; panel.appendChild(h);
    panel.appendChild(this.invGrid(p.inv, 9, 36, 9));
    const sp = document.createElement('div'); sp.style.height = '6px'; panel.appendChild(sp);
    panel.appendChild(this.invGrid(p.inv, 0, 9, 9));
  }

  craftSection(container, n) {
    const d = this.screenData;
    const row = document.createElement('div'); row.className = 'prow';
    row.appendChild(this.invGrid(d.craft, 0, n * n, n));
    const ar = document.createElement('div'); ar.className = 'arrow'; ar.textContent = '➜'; row.appendChild(ar);
    this.updateCraftResult();
    const outRef = { get: () => d.result, set: () => {}, kind: 'output' };
    row.appendChild(this.makeSlot(outRef));
    container.appendChild(row);
  }

  panelButtons(panel) {
    const b = document.createElement('div'); b.className = 'panelbtns';
    const mk = (label, on, fn) => { const x = document.createElement('button'); x.className = 'pbtn' + (on ? ' on' : ''); x.textContent = label; x.addEventListener('pointerdown', (e) => { e.stopPropagation(); fn(); this.renderScreen(); }); b.appendChild(x); };
    mk('⇄ Schnell', this.quick, () => { this.quick = !this.quick; });
    mk('1×', this.single, () => { this.single = !this.single; });
    mk('✕', false, () => this.closeScreen());
    panel.appendChild(b);
  }

  renderScreen(soft) {
    if (!this.screenOpen) return;
    const panel = $('panel');
    if (soft) { if (this._soft) this._soft(); return; }
    this._soft = null;
    const scroll = panel.querySelector('.catalog');
    const st = scroll ? scroll.scrollTop : 0;
    panel.innerHTML = '';
    this.panelButtons(panel);
    const p = this.game.player, d = this.screenData;
    const title = document.createElement('h3');
    panel.appendChild(title);
    if (this.screenOpen === 'inventory') {
      title.textContent = 'Inventar';
      const row = document.createElement('div'); row.className = 'prow';
      const armor = document.createElement('div'); armor.className = 'grid'; armor.style.gridTemplateColumns = 'var(--slot)';
      for (let i = 0; i < 4; i++) armor.appendChild(this.makeSlot(this.slotRef(p.armor, i, 'armor', (id) => ITEMS[id].armorSlot === i)));
      row.appendChild(armor);
      const cwrap = document.createElement('div');
      const ct = document.createElement('h3'); ct.textContent = 'Handwerk'; cwrap.appendChild(ct);
      this.craftSection(cwrap, 2);
      row.appendChild(cwrap);
      panel.appendChild(row);
      this.playerInvSection(panel);
    } else if (this.screenOpen === 'crafting') {
      title.textContent = 'Werkbank';
      this.craftSection(panel, 3);
      this.playerInvSection(panel);
    } else if (this.screenOpen === 'furnace') {
      title.textContent = 'Ofen';
      const t = d.tile;
      const row = document.createElement('div'); row.className = 'prow';
      const col = document.createElement('div'); col.style.display = 'flex'; col.style.flexDirection = 'column'; col.style.alignItems = 'center'; col.style.gap = '4px';
      const s0 = this.makeSlot(this.slotRef(t, 0));
      col.appendChild(s0);
      const fl = document.createElement('div'); fl.className = 'flame'; fl.innerHTML = '<i></i>';
      col.appendChild(fl);
      const s1 = this.makeSlot(this.slotRef(t, 1, 'normal', (id) => ITEMS[id].fuel > 0));
      col.appendChild(s1);
      row.appendChild(col);
      const pb = document.createElement('div'); pb.className = 'progressbar'; pb.innerHTML = '<i></i>';
      row.appendChild(pb);
      const s2 = this.makeSlot({ get: () => t.slots[2], set: (s) => { t.slots[2] = s; }, kind: 'output' });
      row.appendChild(s2);
      panel.appendChild(row);
      this._soft = () => {
        fl.firstChild.style.height = (t.burn > 0 ? Math.min(100, t.burn / (t.burnMax || 1) * 100) : 0) + '%';
        pb.firstChild.style.width = Math.min(100, (t.cook || 0) / 10 * 100) + '%';
        this.renderSlot(s0, t.slots[0]); this.renderSlot(s1, t.slots[1]); this.renderSlot(s2, t.slots[2]);
      };
      this._soft();
      this.playerInvSection(panel);
    } else if (this.screenOpen === 'chest') {
      title.textContent = 'Truhe';
      const t = d.tile;
      t.slotsInv = t.slotsInv || Object.assign(Object.create(Inventory.prototype), { slots: t.slots });
      t.slotsInv.slots = t.slots;
      panel.appendChild(this.invGrid(t.slotsInv, 0, 27, 9));
      this.playerInvSection(panel);
    } else if (this.screenOpen === 'creative') {
      title.textContent = 'Kreativ-Inventar';
      const tabs = document.createElement('div'); tabs.className = 'tabs';
      [...CREATIVE_TABS.map((t) => t[0]), 'Inventar'].forEach((name, i) => {
        const tb = document.createElement('div'); tb.className = 'tab' + (d.tab === i ? ' on' : ''); tb.textContent = name;
        tb.addEventListener('pointerdown', (e) => { e.stopPropagation(); d.tab = i; this._ctab = i; this.renderScreen(); });
        tabs.appendChild(tb);
      });
      panel.appendChild(tabs);
      if (d.tab < CREATIVE_TABS.length) {
        const cat = document.createElement('div'); cat.className = 'catalog';
        const cols = Math.max(9, Math.min(12, Math.floor((window.innerWidth * 0.9) / 46)));
        cat.style.gridTemplateColumns = `repeat(${cols}, var(--slot))`;
        for (const def of ITEMS) {
          if (!def || def.id === 0 || !CREATIVE_TABS[d.tab][1](def)) continue;
          const ref = { get: () => ({ id: def.id, count: 1 }), set: () => {}, kind: 'catalog', catalogId: def.id };
          cat.appendChild(this.makeSlot(ref));
        }
        panel.appendChild(cat);
        requestAnimationFrame(() => { cat.scrollTop = st; });
        const row = document.createElement('div'); row.className = 'prow'; row.style.marginTop = '6px';
        row.appendChild(this.invGrid(p.inv, 0, 9, 9));
        const trash = this.makeSlot({ get: () => null, set: () => {}, kind: 'trash' });
        trash.style.background = '#a55'; trash.title = 'Löschen';
        trash.innerHTML = '<div class="cnt" style="left:0;right:0;text-align:center;top:20%;font-size:20px">🗑</div>';
        row.appendChild(trash);
        panel.appendChild(row);
      } else {
        const row = document.createElement('div'); row.className = 'prow';
        const armor = document.createElement('div'); armor.className = 'grid'; armor.style.gridTemplateColumns = 'repeat(4, var(--slot))';
        for (let i = 0; i < 4; i++) armor.appendChild(this.makeSlot(this.slotRef(p.armor, i, 'armor', (id) => ITEMS[id].armorSlot === i)));
        row.appendChild(armor);
        panel.appendChild(row);
        this.playerInvSection(panel);
      }
    }
    this.renderHeldInfo();
  }
}
