// Player progression: level/XP, gold, trophies, card collection with levels, chests and arenas.
import { CARDS, CARD_KEYS } from './cards.js';

const KEY = 'clashcraft_profile';

export const ARENAS = [
  { id: 0, name: 'Wiesental', trophies: 0, theme: 'meadow', cards: ['zombie', 'skeleton', 'spider', 'pig', 'chicken', 'sheep', 'arrows', 'powder'] },
  { id: 1, name: 'Wüstenschlucht', trophies: 300, theme: 'desert', cards: ['cow', 'villager'] },
  { id: 2, name: 'Glutfestung', trophies: 700, theme: 'nether', cards: ['ash_zombie', 'fire_skeleton'] },
  { id: 3, name: 'Leerenreich', trophies: 1200, theme: 'void', cards: ['void_crawler', 'shadow_lord'] },
];
export const STARTER = ['zombie', 'skeleton', 'spider', 'pig', 'chicken', 'sheep', 'arrows', 'powder'];

export const MAX_LEVEL = 9;
const UP_CARDS = [2, 4, 10, 20, 50, 100, 200, 400];
const UP_GOLD = [5, 20, 50, 150, 400, 1000, 2000, 4000];
const UP_XP = [4, 5, 6, 10, 25, 50, 100, 200];
const LEVEL_XP = [20, 50, 100, 200, 400, 800, 1500, 2500, 4000, 6000, 9000, 13000];

export const CHESTS = {
  wood: { name: 'Holztruhe', time: 15, cards: 4, gold: [15, 30], color: '#a0703a', rare: 0.02 },
  silver: { name: 'Silbertruhe', time: 60, cards: 8, gold: [30, 60], color: '#c8ccd4', rare: 0.05 },
  gold: { name: 'Goldtruhe', time: 180, cards: 18, gold: [80, 160], color: '#f2c62e', rare: 0.12 },
  magic: { name: 'Magische Truhe', time: 480, cards: 35, gold: [200, 350], color: '#b060f0', rare: 0.4 },
};
const CHEST_CYCLE = ['wood', 'wood', 'silver', 'wood', 'silver', 'gold', 'wood', 'silver', 'wood', 'silver', 'magic', 'wood', 'silver', 'gold'];
export const FREE_CHEST_SECONDS = 2 * 60 * 60;

function fresh() {
  const cards = {};
  for (const k of STARTER) cards[k] = { lvl: 1, count: 0 };
  return {
    v: 1, name: 'Spieler', level: 1, xp: 0, gold: 150, trophies: 0, best: 0, wins: 0, losses: 0, battles: 0, threeCrowns: 0,
    cards, deck: STARTER.slice(), chests: ['wood', null, null, null].map((t) => (t ? { type: t, unlockAt: 0 } : null)),
    chestCycle: 0, freeChestAt: 0,
  };
}

let profile = null;
export function getProfile() {
  if (profile) return profile;
  try { profile = JSON.parse(localStorage.getItem(KEY)); } catch (e) { profile = null; }
  if (!profile || profile.v !== 1) {
    profile = fresh();
    // carry over trophies from the first arena version
    try { profile.trophies = profile.best = Math.max(0, parseInt(localStorage.getItem('blockwelt_arena_trophies'), 10) || 0); } catch (e) { /* ignore */ }
    for (const a of ARENAS) if (a.trophies <= profile.trophies) for (const k of a.cards) if (!profile.cards[k]) profile.cards[k] = { lvl: 1, count: 0 };
  }
  // sanity
  profile.deck = (profile.deck || []).filter((k) => CARDS[k] && profile.cards[k]);
  for (const k of STARTER) if (profile.deck.length < 8 && !profile.deck.includes(k)) profile.deck.push(k);
  return profile;
}
export function saveProfile() { try { localStorage.setItem(KEY, JSON.stringify(profile)); } catch (e) { /* ignore */ } }

export function currentArena(t = getProfile().trophies) { let a = ARENAS[0]; for (const x of ARENAS) if (t >= x.trophies) a = x; return a; }
export function bestArena() { return currentArena(getProfile().best); }
export function cardArena(k) { return ARENAS.find((a) => a.cards.includes(k)) || ARENAS[0]; }
export function unlockedPool() { const b = bestArena(); return CARD_KEYS.filter((k) => cardArena(k).id <= b.id); }

export function levelMul(lvl) { return Math.pow(1.1, (lvl || 1) - 1); }
export function towerMul(kingLevel) { return Math.pow(1.07, (kingLevel || 1) - 1); }
export function xpForLevel(l) { return LEVEL_XP[Math.min(LEVEL_XP.length - 1, l - 1)]; }

export function upgradeInfo(k) {
  const c = getProfile().cards[k];
  if (!c) return null;
  if (c.lvl >= MAX_LEVEL) return { max: true, need: 0, gold: 0, can: false };
  const need = UP_CARDS[c.lvl - 1], gold = UP_GOLD[c.lvl - 1];
  return { max: false, need, gold, xp: UP_XP[c.lvl - 1], can: c.count >= need && getProfile().gold >= gold, enoughCards: c.count >= need };
}
// returns {levelUp:boolean}
export function upgradeCard(k) {
  const p = getProfile(), u = upgradeInfo(k);
  if (!u || !u.can) return null;
  const c = p.cards[k];
  c.count -= u.need; c.lvl++; p.gold -= u.gold;
  const lu = addXp(u.xp);
  saveProfile();
  return { levelUp: lu };
}
export function addXp(n) {
  const p = getProfile();
  p.xp += n;
  let up = false;
  while (p.xp >= xpForLevel(p.level)) { p.xp -= xpForLevel(p.level); p.level++; up = true; }
  return up;
}

const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
// opens a chest: returns {gold, cards:[{key,count,isNew}]}
export function rollChest(type) {
  const p = getProfile(), def = CHESTS[type];
  const arenaBonus = 1 + bestArena().id * 0.35;
  const gold = Math.round(rnd(def.gold[0], def.gold[1]) * arenaBonus);
  const pool = unlockedPool();
  const commons = pool.filter((k) => CARDS[k].cost < 5 && !CARDS[k].legendary);
  const rares = pool.filter((k) => CARDS[k].cost >= 5 || CARDS[k].legendary);
  let total = Math.round(def.cards * arenaBonus);
  const out = new Map();
  const add = (k, n) => out.set(k, (out.get(k) || 0) + n);
  if (rares.length && Math.random() < def.rare) { const k = rares[Math.floor(Math.random() * rares.length)]; add(k, CARDS[k].legendary ? 1 : rnd(1, 3)); total -= 2; }
  const kinds = Math.min(commons.length, type === 'wood' ? 2 : type === 'silver' ? 3 : 4);
  const picks = commons.slice().sort(() => Math.random() - 0.5).slice(0, kinds);
  for (let i = 0; i < picks.length; i++) {
    const n = i === picks.length - 1 ? Math.max(1, total) : Math.max(1, Math.round(total * (0.3 + Math.random() * 0.3)));
    add(picks[i], n); total -= n;
  }
  const cards = [];
  for (const [k, n] of out) {
    const isNew = !p.cards[k];
    if (isNew) p.cards[k] = { lvl: 1, count: n - 1 }; else p.cards[k].count += n;
    cards.push({ key: k, count: n, isNew });
  }
  p.gold += gold;
  saveProfile();
  return { gold, cards };
}

export function nextChestType() {
  const p = getProfile();
  const t = CHEST_CYCLE[p.chestCycle % CHEST_CYCLE.length];
  p.chestCycle++;
  return t;
}

// battle result -> rewards
export function applyResult(res, crowns, now = Date.now()) {
  const p = getProfile();
  const before = { trophies: p.trophies, arena: currentArena().id, level: p.level };
  let dT = 0, gold = 0, chest = null, xp = 0;
  p.battles++;
  if (res === 'win') {
    dT = 26 + Math.floor(Math.random() * 8);
    gold = 15 + currentArena().id * 8 + crowns[0] * 3;
    xp = 10 + crowns[0] * 2;
    p.wins++;
    if (crowns[0] === 3) p.threeCrowns++;
    const slot = p.chests.findIndex((c) => !c);
    if (slot >= 0) { chest = nextChestType(); p.chests[slot] = { type: chest, unlockAt: 0 }; }
  } else if (res === 'lose') {
    dT = -Math.min(p.trophies, 18 + Math.floor(Math.random() * 6));
    xp = 3; p.losses++;
  } else xp = 5;
  p.trophies += dT; p.best = Math.max(p.best, p.trophies); p.gold += gold;
  const lu = addXp(xp);
  // newly reached arenas unlock their cards
  const newCards = [];
  for (const a of ARENAS) if (a.trophies <= p.best) for (const k of a.cards) if (!p.cards[k]) { p.cards[k] = { lvl: 1, count: 0 }; newCards.push(k); }
  saveProfile();
  return { dT, gold, chest, xp, levelUp: lu, newArena: currentArena().id > before.arena ? currentArena() : null, newCards };
}

// chest slots
export function chestState(c, now = Date.now()) {
  if (!c) return 'empty';
  if (!c.unlockAt) return 'locked';
  return now >= c.unlockAt ? 'ready' : 'unlocking';
}
export function startUnlock(i, now = Date.now()) {
  const p = getProfile();
  if (p.chests.some((c) => chestState(c, now) === 'unlocking')) return false;
  const c = p.chests[i];
  if (!c || c.unlockAt) return false;
  c.unlockAt = now + CHESTS[c.type].time * 1000;
  saveProfile();
  return true;
}
export function takeChest(i) { const p = getProfile(); const c = p.chests[i]; p.chests[i] = null; saveProfile(); return c; }

// AI strength scales with trophies
export function aiLevels(difficulty) {
  const p = getProfile();
  const base = 1 + Math.floor(p.trophies / 220) + (difficulty - 1);
  return { card: Math.max(1, Math.min(MAX_LEVEL, base)), king: Math.max(1, Math.min(13, base + Math.floor(p.level / 3))) };
}
