// Home screen: animated 3D arena backdrop, player bar, battle tab with chests, card collection,
// trophy road and "more" tab. Also handles battle start/end and chest opening.
import { Arena, getPortraits, cardHTML } from './arena.js';
import { CARDS, CARD_KEYS } from './cards.js';
import { sfx } from './audio.js';
import {
  getProfile, saveProfile, ARENAS, CHESTS, FREE_CHEST_SECONDS, currentArena, cardArena, unlockedPool, levelMul,
  upgradeInfo, upgradeCard, rollChest, chestState, startUnlock, takeChest, applyResult, aiLevels, xpForLevel, MAX_LEVEL,
} from './profile.js';

const $ = (id) => document.getElementById(id);
const DIFFS = ['Leicht', 'Normal', 'Schwer'];
const TABS = ['cards', 'battle', 'road', 'more'];

let opts = null;
let preview = null;
let battle = null;
let tab = 1;
let active = false;
let swapKey = null;
let tickTimer = 0;
let difficulty = 1;
try { const d = parseInt(localStorage.getItem('blockwelt_arena_diff'), 10); if (d >= 0 && d <= 2) difficulty = d; } catch (e) { /* ignore */ }

// ---------- pixel-art chest icons ----------
const chestIcons = {};
function chestIcon(type, open = false) {
  const key = type + (open ? '_o' : '');
  if (chestIcons[key]) return chestIcons[key];
  const c = document.createElement('canvas'); c.width = 16; c.height = 16;
  const g = c.getContext('2d');
  const base = CHESTS[type].color;
  const px = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  const shadeC = (hex, f) => { const n = parseInt(hex.slice(1), 16); const r = Math.min(255, ((n >> 16) & 255) * f) | 0, gg = Math.min(255, ((n >> 8) & 255) * f) | 0, b = Math.min(255, (n & 255) * f) | 0; return `rgb(${r},${gg},${b})`; };
  const lidY = open ? 1 : 3;
  px(1, 8, 14, 7, '#1a1208'); px(2, 9, 12, 5, shadeC(base, 0.9)); px(2, 9, 12, 1, shadeC(base, 1.15));
  px(1, lidY, 14, 6, '#1a1208'); px(2, lidY + 1, 12, 4, shadeC(base, 1.05)); px(2, lidY + 1, 12, 1, shadeC(base, 1.3));
  if (open) { px(3, 7, 10, 2, '#fff3a0'); px(5, 6, 6, 1, '#ffe060'); }
  px(1, 8, 14, 1, '#1a1208');
  px(7, lidY + 3, 2, 4, '#3a2a10'); px(7, lidY + 4, 2, 2, '#f8d040');
  px(1, 14, 14, 1, '#0e0a04');
  chestIcons[key] = c.toDataURL();
  return chestIcons[key];
}

const fmtTime = (s) => { s = Math.max(0, Math.ceil(s)); if (s >= 3600) return `${Math.floor(s / 3600)} Std ${Math.floor((s % 3600) / 60)} Min`; if (s >= 60) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; return s + ' s'; };

function toast(msg) {
  const t = $('h-toast'); t.textContent = msg; t.classList.remove('on'); void t.offsetWidth; t.classList.add('on');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), 1800);
}

// animated number
function countTo(el, to) {
  const from = parseInt(el.dataset.v || el.textContent, 10) || 0;
  el.dataset.v = to;
  if (from === to) { el.textContent = to; return; }
  const t0 = performance.now(), dur = 700;
  const step = (now) => { const f = Math.min(1, (now - t0) / dur); el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - f, 3))); if (f < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
  el.parentElement.classList.remove('bump'); void el.offsetWidth; el.parentElement.classList.add('bump');
}

// ---------- top bar ----------
function renderTop() {
  const p = getProfile();
  $('h-lv').textContent = p.level;
  $('h-name').textContent = p.name;
  const need = xpForLevel(p.level);
  $('h-xpfill').style.width = `${Math.min(100, (p.xp / need) * 100)}%`;
  $('h-xptext').textContent = `${p.xp}/${need}`;
  countTo($('h-gold'), p.gold);
  countTo($('h-troph'), p.trophies);
}

// ---------- battle tab ----------
function renderBattle() {
  const p = getProfile();
  const a = currentArena();
  $('h-arenanum').textContent = `Arena ${a.id + 1}`;
  $('h-arenaname').textContent = a.name;
  $('h-arenabanner').className = 'h-arena theme-' + a.theme;
  const next = ARENAS[a.id + 1];
  if (next) {
    const f = (p.trophies - a.trophies) / (next.trophies - a.trophies);
    $('h-roadfill').style.width = `${Math.max(3, Math.min(100, f * 100))}%`;
    $('h-next').textContent = `${next.name} ab ${next.trophies} 🏆`;
  } else { $('h-roadfill').style.width = '100%'; $('h-next').textContent = 'Höchste Arena erreicht!'; }
  $('h-diff').textContent = 'Gegner: ' + DIFFS[difficulty];
  renderChests();
}

function renderChests() {
  const p = getProfile(), now = Date.now();
  const wrap = $('h-chests');
  if (wrap.children.length !== 4) {
    wrap.innerHTML = '';
    for (let i = 0; i < 4; i++) {
      const el = document.createElement('div'); el.className = 'h-chest';
      el.addEventListener('click', () => chestTap(i));
      wrap.appendChild(el);
    }
  }
  p.chests.forEach((c, i) => {
    const el = wrap.children[i];
    const st = chestState(c, now);
    const sig = st + (c ? c.type : '');
    if (el.dataset.sig !== sig) {
      el.dataset.sig = sig;
      el.className = 'h-chest ' + st + (c ? ' ' + c.type : '');
      el.innerHTML = c ? `<img src="${chestIcon(c.type)}"><b class="lbl"></b><small></small>` : '<span class="empty">Truhen-<br>platz</span>';
    }
    if (!c) return;
    const lbl = el.querySelector('.lbl'), sm = el.querySelector('small');
    if (st === 'locked') { lbl.textContent = CHESTS[c.type].name.replace('truhe', '').replace('Truhe', '').trim() || 'Truhe'; sm.textContent = fmtTime(CHESTS[c.type].time); }
    else if (st === 'unlocking') { lbl.textContent = fmtTime((c.unlockAt - now) / 1000); sm.textContent = 'wird geöffnet'; }
    else { lbl.textContent = 'ÖFFNEN!'; sm.textContent = CHESTS[c.type].name; }
  });
  // free chest
  const fr = $('h-free'), left = (p.freeChestAt - now) / 1000;
  fr.classList.toggle('ready', left <= 0);
  fr.innerHTML = `<img src="${chestIcon('wood')}"><span>${left <= 0 ? 'Gratis-Truhe!' : 'Gratis in ' + fmtTime(left)}</span>`;
}

function chestTap(i) {
  const p = getProfile(), c = p.chests[i];
  if (!c) { toast('Gewinne Kämpfe, um Truhen zu bekommen!'); return; }
  const st = chestState(c);
  if (st === 'locked') {
    if (startUnlock(i)) { sfx.pop(); toast(`${CHESTS[c.type].name} wird geöffnet …`); renderChests(); }
    else toast('Es wird schon eine Truhe geöffnet.');
  } else if (st === 'unlocking') toast(`Noch ${fmtTime((c.unlockAt - Date.now()) / 1000)}`);
  else { takeChest(i); openChest(c.type); }
}

function freeChest() {
  const p = getProfile();
  if (Date.now() < p.freeChestAt) { toast('Die Gratis-Truhe ist noch nicht bereit.'); return; }
  p.freeChestAt = Date.now() + FREE_CHEST_SECONDS * 1000;
  saveProfile();
  openChest(Math.random() < 0.25 ? 'silver' : 'wood');
}

// ---------- chest opening ----------
function openChest(type) {
  const res = rollChest(type);
  const ov = $('chestopen'), stage = $('co-stage');
  ov.classList.remove('hidden');
  const items = [{ gold: res.gold }, ...res.cards];
  let idx = -1;
  const portraits = getPortraits();
  stage.innerHTML = `<div class="co-chest shake"><img src="${chestIcon(type)}"></div><div class="co-name">${CHESTS[type].name}</div><div class="co-hint">Tippen zum Öffnen</div>`;
  sfx.click();
  const next = () => {
    idx++;
    if (idx === 0) {
      stage.querySelector('.co-chest').classList.remove('shake');
      stage.querySelector('.co-chest').classList.add('burst');
      stage.querySelector('.co-chest img').src = chestIcon(type, true);
      sfx.boom();
    }
    if (idx >= items.length) {
      // summary
      stage.innerHTML = `<div class="co-name">${CHESTS[type].name}</div><div class="co-sum">` +
        `<div class="co-gold small">🪙 +${res.gold}</div>` +
        res.cards.map((c) => `<div class="co-mini"><div class="ar-card">${cardHTML(c.key, portraits)}</div><b>×${c.count}</b>${c.isNew ? '<i>NEU</i>' : ''}</div>`).join('') +
        `</div><button class="btn h-okbtn" id="co-done">Super!</button>`;
      $('co-done').onclick = (e) => { e.stopPropagation(); ov.classList.add('hidden'); ov.onclick = null; sfx.click(); refresh(); };
      ov.onclick = null;
      return;
    }
    const it = items[idx];
    const left = items.length - idx - 1;
    if (it.gold !== undefined) {
      stage.innerHTML = `<div class="co-chest open"><img src="${chestIcon(type, true)}"></div><div class="co-gold">🪙 +${it.gold}</div><div class="co-left">${left} weitere</div>`;
      sfx.pop();
    } else {
      const p = getProfile(), card = p.cards[it.key], u = upgradeInfo(it.key);
      const prog = u && !u.max ? `<div class="co-prog"><i style="width:${Math.min(100, (card.count / u.need) * 100)}%"></i><span>${card.count}/${u.need}</span></div>` : '';
      stage.innerHTML = `<div class="co-card ${CARDS[it.key].legendary ? 'legend' : ''}"><div class="ar-card">${cardHTML(it.key, portraits)}</div></div>` +
        `<div class="co-count">×${it.count}</div>${it.isNew ? '<div class="co-new">NEUE KARTE!</div>' : ''}<div class="co-cname">${CARDS[it.key].name}</div>${prog}<div class="co-left">${left ? left + ' weitere' : 'Tippen'}</div>`;
      if (CARDS[it.key].legendary) sfx.win(); else sfx.pop();
    }
  };
  ov.onclick = next;
}

// ---------- cards tab ----------
function cardTile(k, extraCls = '') {
  const p = getProfile(), c = p.cards[k], portraits = getPortraits();
  const el = document.createElement('div');
  if (!c) {
    el.className = 'ar-card locked ' + extraCls;
    el.innerHTML = cardHTML(k, portraits) + `<span class="lock">🔒<small>Arena ${cardArena(k).id + 1}</small></span>`;
    return el;
  }
  const u = upgradeInfo(k);
  el.className = 'ar-card ' + extraCls + (u.can ? ' canup' : '');
  const bar = u.max ? '<span class="lvbar max"><i style="width:100%"></i><em>MAX</em></span>'
    : `<span class="lvbar ${u.enoughCards ? 'full' : ''}"><i style="width:${Math.min(100, (c.count / u.need) * 100)}%"></i><em>${c.count}/${u.need}</em></span>`;
  el.innerHTML = cardHTML(k, portraits) + `<span class="lv">Lv ${c.lvl}</span>` + bar + (u.can ? '<span class="uparrow">▲</span>' : '');
  return el;
}

function renderCards() {
  const p = getProfile();
  const deckEl = $('h-deck');
  deckEl.innerHTML = '';
  deckEl.classList.toggle('swapping', !!swapKey);
  p.deck.forEach((k, i) => {
    const el = cardTile(k, swapKey ? 'wiggle' : '');
    el.addEventListener('click', () => {
      if (swapKey) {
        const j = p.deck.indexOf(swapKey);
        if (j >= 0) [p.deck[i], p.deck[j]] = [swapKey, p.deck[i]]; else p.deck[i] = swapKey;
        swapKey = null; saveProfile(); sfx.pop(); renderCards(); return;
      }
      showDetail(k);
    });
    deckEl.appendChild(el);
  });
  $('h-avg').textContent = (p.deck.reduce((s, k) => s + CARDS[k].cost, 0) / p.deck.length).toFixed(1);
  $('h-swaphint').classList.toggle('hidden', !swapKey);
  const coll = $('h-coll');
  coll.innerHTML = '';
  const keys = CARD_KEYS.filter((k) => !p.deck.includes(k)).sort((a, b) => (!!p.cards[b] - !!p.cards[a]) || (cardArena(a).id - cardArena(b).id) || (CARDS[a].cost - CARDS[b].cost));
  for (const k of keys) {
    const el = cardTile(k);
    el.addEventListener('click', () => { if (p.cards[k]) showDetail(k); else toast(`Wird in Arena ${cardArena(k).id + 1} (${cardArena(k).name}) freigeschaltet.`); });
    coll.appendChild(el);
  }
  $('h-found').textContent = `${Object.keys(p.cards).length}/${CARD_KEYS.length}`;
}

function statRows(k, lvl) {
  const c = CARDS[k], m = levelMul(lvl), m2 = levelMul(lvl + 1);
  const rows = [];
  const add = (label, v, v2) => rows.push(`<tr><td>${label}</td><td><b>${v}</b>${v2 !== undefined && v2 !== v ? ` <span class="nx">+${v2 - v}</span>` : ''}</td></tr>`);
  if (c.type === 'unit') {
    add('❤ Leben', Math.round(c.hp * m), lvl < MAX_LEVEL ? Math.round(c.hp * m2) : undefined);
    add('⚔ Schaden', Math.round(c.dmg * m), lvl < MAX_LEVEL ? Math.round(c.dmg * m2) : undefined);
    add('⏱ Angriffstempo', c.hitSpeed + ' s');
    add('🏃 Tempo', c.speed >= 1.8 ? 'Sehr schnell' : c.speed >= 1.3 ? 'Schnell' : c.speed >= 0.95 ? 'Mittel' : 'Langsam');
    add('🎯 Reichweite', c.range > 2 ? c.range.toFixed(1) : 'Nahkampf');
    add('🎯 Ziele', c.buildingsOnly ? 'Gebäude' : c.hitsAir ? 'Boden & Luft' : 'Boden');
    if (c.count > 1) add('👥 Anzahl', '×' + c.count);
    if (c.air) add('🪽 Typ', 'Fliegend');
    if (c.splash) add('💥 Flächenschaden', 'Ja');
  } else {
    add('💥 Schaden', Math.round(c.dmg * m), lvl < MAX_LEVEL ? Math.round(c.dmg * m2) : undefined);
    add('⭕ Radius', c.radius.toFixed(1));
    add('🏰 Turmschaden', Math.round(c.dmg * m * c.towerFactor));
  }
  return rows.join('');
}

function showDetail(k) {
  const p = getProfile(), c = CARDS[k], pc = p.cards[k], u = upgradeInfo(k);
  const md = $('carddetail');
  md.classList.remove('hidden');
  const rar = c.legendary ? 'Legendär' : c.type === 'spell' ? 'Zauber' : c.cost >= 5 ? 'Episch' : c.cost >= 4 ? 'Selten' : 'Gewöhnlich';
  $('cd-body').innerHTML =
    `<div class="cd-head"><div class="ar-card big">${cardHTML(k, getPortraits())}</div><div><h3>${c.name}</h3><div class="cd-rar ${c.legendary ? 'legend' : ''}">${rar} · Level ${pc.lvl}</div><p>${c.desc}</p></div></div>` +
    `<table class="cd-stats">${statRows(k, pc.lvl)}</table>` +
    `<div class="cd-btns">` +
    (u.max ? '<button class="btn" disabled>Maximales Level</button>' : `<button class="btn cd-up ${u.can ? '' : 'off'}" id="cd-up">Aufwerten<br><small>${pc.count}/${u.need} Karten · 🪙 ${u.gold}</small></button>`) +
    (p.deck.includes(k) ? '' : '<button class="btn arena-btn" id="cd-use">Ins Deck</button>') +
    `<button class="btn" id="cd-close">Schließen</button></div>`;
  $('cd-close').onclick = () => { md.classList.add('hidden'); sfx.click(); };
  if ($('cd-use')) $('cd-use').onclick = () => { swapKey = k; md.classList.add('hidden'); renderCards(); toast('Tippe auf die Karte im Deck, die ersetzt werden soll.'); };
  if ($('cd-up')) $('cd-up').onclick = () => {
    if (!u.can) { toast(u.enoughCards ? 'Nicht genug Gold.' : 'Nicht genug Karten – öffne Truhen!'); return; }
    const r = upgradeCard(k);
    sfx.win();
    md.querySelector('.ar-card.big').classList.add('levelup');
    setTimeout(() => { showDetail(k); renderTop(); renderCards(); if (r && r.levelUp) levelUpFx(); }, 650);
  };
}

function levelUpFx() {
  const el = $('h-levelup');
  el.innerHTML = `<b>LEVEL ${getProfile().level}!</b><small>Deine Türme sind stärker geworden</small>`;
  el.classList.remove('hidden'); el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  sfx.win();
  setTimeout(() => el.classList.add('hidden'), 2600);
}

// ---------- trophy road ----------
function renderRoad() {
  const p = getProfile(), portraits = getPortraits();
  const wrap = $('h-roadlist');
  wrap.innerHTML = '';
  for (const a of ARENAS.slice().reverse()) {
    const unlocked = p.best >= a.trophies, cur = currentArena().id === a.id;
    const el = document.createElement('div');
    el.className = `rd-arena theme-${a.theme} ${unlocked ? 'open' : 'locked'} ${cur ? 'cur' : ''}`;
    el.innerHTML = `<div class="rd-head"><span class="rd-num">Arena ${a.id + 1}</span><b>${a.name}</b><span class="rd-t">🏆 ${a.trophies}</span></div>` +
      `<div class="rd-cards">${a.cards.map((k) => `<div class="ar-card ${p.cards[k] ? '' : 'dim'}">${cardHTML(k, portraits)}</div>`).join('')}</div>` +
      (cur ? '<div class="rd-you">▶ Du bist hier</div>' : unlocked ? '' : `<div class="rd-lock">🔒 Noch ${a.trophies - p.trophies} 🏆</div>`);
    wrap.appendChild(el);
  }
  const cur = wrap.querySelector('.cur');
  const page = $('tab-road');
  if (cur) setTimeout(() => page.scrollTo({ top: Math.max(0, cur.offsetTop - page.clientHeight / 2 + cur.offsetHeight / 2), behavior: 'smooth' }), 50);
}

// ---------- more tab ----------
function renderMore() {
  const p = getProfile();
  $('mo-name').value = p.name;
  $('mo-stats').innerHTML = [
    ['Höchste Pokale', p.best], ['Kämpfe', p.battles], ['Siege', p.wins], ['Niederlagen', p.losses], ['3-Kronen-Siege', p.threeCrowns],
    ['Karten gefunden', `${Object.keys(p.cards).length}/${CARD_KEYS.length}`],
  ].map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join('');
}

// ---------- tabs ----------
function setTab(i, silent) {
  tab = i;
  $('h-pages').style.transform = `translateX(${-i * 25}%)`;
  document.querySelectorAll('#h-nav button').forEach((b, j) => b.classList.toggle('on', j === i));
  if (!silent) sfx.click();
  if (TABS[i] === 'cards') renderCards();
  if (TABS[i] === 'road') renderRoad();
  if (TABS[i] === 'more') renderMore();
  if (TABS[i] === 'battle') renderBattle();
}

function refresh() { renderTop(); renderBattle(); if (TABS[tab] === 'cards') renderCards(); }

// ---------- battle ----------
function makeAiDeck() {
  const a = currentArena();
  const pool = CARD_KEYS.filter((k) => cardArena(k).id <= a.id);
  const shuffle = (x) => x.slice().sort(() => Math.random() - 0.5);
  for (let t = 0; t < 60; t++) {
    const d = shuffle(pool).slice(0, 8);
    const spells = d.filter((k) => CARDS[k].type === 'spell').length;
    if (spells >= 1 && spells <= 2 && d.some((k) => CARDS[k].hitsAir && CARDS[k].type === 'unit')) return d;
  }
  return shuffle(pool).slice(0, 8);
}

function startBattle() {
  const p = getProfile();
  stopPreview();
  active = false;
  $('home').classList.add('hidden');
  $('ar-end').classList.add('hidden');
  $('ar-quit').classList.remove('confirm'); $('ar-quit').textContent = '✕';
  const ai = aiLevels(difficulty);
  const lv = {}; for (const k of p.deck) lv[k] = p.cards[k].lvl;
  try {
    battle = new Arena($('arena'), {
      deck: p.deck.slice(), difficulty, settings: opts.settings, theme: currentArena().theme, aiDeck: makeAiDeck(),
      levels: [{ cards: lv, king: p.level }, { card: ai.card, king: ai.king }], onEnd: battleEnded,
    });
    window.__arena = battle;
    $('ar-arenaname').textContent = `${currentArena().name} · Gegner Lv ${ai.card}`;
  } catch (e) {
    console.error(e);
    battle = null;
    enter();
  }
}

function battleEnded(res, crowns) {
  const r = applyResult(res, crowns);
  const p = getProfile();
  const title = $('ar-endtitle');
  title.className = res;
  title.textContent = res === 'win' ? 'SIEG!' : res === 'lose' ? 'Niederlage' : 'Unentschieden';
  $('ar-endcrowns').innerHTML = [0, 1, 2].map((i) => `<span class="crown ${i < crowns[0] ? 'on blue' : ''}" style="animation-delay:${0.3 + i * 0.25}s">♛</span>`).join('') +
    '<span class="vs">:</span>' + [0, 1, 2].map((i) => `<span class="crown ${i < crowns[1] ? 'on red' : ''}" style="animation-delay:${0.3 + i * 0.25}s">♛</span>`).join('');
  const rows = [];
  rows.push(`<div class="rw"><span>🏆 Pokale</span><b class="${r.dT >= 0 ? 'plus' : 'minus'}">${r.dT >= 0 ? '+' : ''}${r.dT}</b><small>${p.trophies}</small></div>`);
  if (r.gold) rows.push(`<div class="rw"><span>🪙 Gold</span><b class="plus">+${r.gold}</b><small>${p.gold}</small></div>`);
  rows.push(`<div class="rw"><span>⭐ Erfahrung</span><b class="plus">+${r.xp}</b><small>Lv ${p.level}</small></div>`);
  if (r.chest) rows.push(`<div class="rw chest"><img src="${chestIcon(r.chest)}"><span>${CHESTS[r.chest].name} erhalten!</span></div>`);
  else if (res === 'win') rows.push('<div class="rw"><span>Alle Truhenplätze sind voll!</span></div>');
  if (r.levelUp) rows.push(`<div class="rw big">🎉 Level ${p.level} erreicht!</div>`);
  if (r.newArena) rows.push(`<div class="rw big">🏟️ Neue Arena: ${r.newArena.name}!</div>`);
  if (r.newCards.length) rows.push(`<div class="rw">Neue Karten: ${r.newCards.map((k) => CARDS[k].name).join(', ')}</div>`);
  $('ar-endtroph').innerHTML = rows.join('');
  $('ar-end').classList.remove('hidden');
}

function leaveBattle() {
  if (battle) { battle.dispose(); battle = null; window.__arena = null; }
  $('ar-end').classList.add('hidden');
  enter();
}

// ---------- preview backdrop ----------
function startPreview() {
  if (preview) return;
  try { preview = new Arena($('arena'), { preview: true, settings: opts.settings, theme: currentArena().theme }); } catch (e) { preview = null; }
}
function stopPreview() { if (preview) { preview.dispose(); preview = null; } }

// ---------- public ----------
export function initHome(o) {
  opts = o;
  const bindc = (id, fn) => $(id).addEventListener('click', (e) => { o.initAudio && o.initAudio(); fn(e); });
  document.querySelectorAll('#h-nav button').forEach((b, i) => b.addEventListener('click', () => { o.initAudio && o.initAudio(); setTab(i); }));
  bindc('h-fight', () => { sfx.pop(); $('h-fight').classList.add('press'); setTimeout(() => { $('h-fight').classList.remove('press'); startBattle(); }, 180); });
  bindc('h-diff', () => { difficulty = (difficulty + 1) % 3; try { localStorage.setItem('blockwelt_arena_diff', String(difficulty)); } catch (e) { /* ignore */ } renderBattle(); sfx.click(); });
  bindc('h-free', () => freeChest());
  bindc('mo-sandbox', () => { leave(); o.onSandbox(); });
  bindc('mo-settings', () => { leave(); o.onSettings(); });
  $('mo-name').addEventListener('change', () => { const p = getProfile(); p.name = $('mo-name').value.trim().slice(0, 16) || 'Spieler'; saveProfile(); renderTop(); });
  bindc('ar-again', () => { leaveBattle(); startBattle(); });
  bindc('ar-menu', () => leaveBattle());
  let quitTimer = 0;
  bindc('ar-quit', () => {
    const b = $('ar-quit');
    if (b.classList.contains('confirm')) { clearTimeout(quitTimer); leaveBattle(); return; }
    b.classList.add('confirm'); b.textContent = 'Aufgeben?';
    quitTimer = setTimeout(() => { b.classList.remove('confirm'); b.textContent = '✕'; }, 3000);
  });
  $('carddetail').addEventListener('click', (e) => { if (e.target.id === 'carddetail') $('carddetail').classList.add('hidden'); });
  // logo letters for the bounce-in animation
  const logo = $('h-logo');
  logo.innerHTML = [...'CLASHCRAFT'].map((ch, i) => `<span style="animation-delay:${i * 0.06}s">${ch}</span>`).join('');
  document.addEventListener('visibilitychange', () => { if (battle) battle.setPaused(document.hidden); if (preview) preview.setPaused(document.hidden); });
}

export function enter() {
  active = true;
  $('home').classList.remove('hidden');
  renderTop();
  setTab(tab, true);
  startPreview();
  clearInterval(tickTimer);
  tickTimer = setInterval(() => { if (active && TABS[tab] === 'battle') renderChests(); }, 1000);
}
export function leave() {
  active = false;
  clearInterval(tickTimer);
  $('home').classList.add('hidden');
  stopPreview();
}
export function inBattle() { return !!battle; }
export function back() {
  if (battle) { $('ar-end').classList.contains('hidden') ? $('ar-quit').click() : leaveBattle(); return true; }
  if (!$('chestopen').classList.contains('hidden')) return true;
  if (!$('carddetail').classList.contains('hidden')) { $('carddetail').classList.add('hidden'); return true; }
  if (swapKey) { swapKey = null; renderCards(); return true; }
  if (active && tab !== 1) { setTab(1); return true; }
  return false;
}
export function settingsChanged() { if (active) { stopPreview(); startPreview(); } }
