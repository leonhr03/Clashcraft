// Entry point: menus, settings, world selection.
import { UI } from './ui.js';
import { Game } from './game.js';
import { listWorlds, saveWorldMeta, loadChunks, deleteWorld, loadSettings, storeSettings } from './save.js';
import { hashString } from './noise.js';
import { initAudio, setVolume, sfx } from './audio.js';
import { Arena, getPortraits, cardHTML } from './arena.js';
import { CARDS, CARD_KEYS, loadDeck, saveDeck, loadTrophies, saveTrophies } from './cards.js';

const $ = (id) => document.getElementById(id);
const DEFAULTS = {
  renderDist: 4, fov: 75, sensitivity: 1, pixelRatio: 1, viewBob: true, autoJump: true, clouds: true,
  volume: 0.6, mobs: true, hostile: true, keepInventory: false, dayLength: 1200, outline: true, showHand: true, shaders: true, postfx: true, compat: false,
};
const settings = Object.assign({}, DEFAULTS, loadSettings());
setVolume(settings.volume);
const ui = new UI(settings);
let game = null;
let settingsReturn = 'mainmenu';

function show(id) {
  for (const m of ['mainmenu', 'worldlist', 'createworld', 'settings', 'arenamenu', 'deckmenu']) $(m).classList.toggle('hidden', m !== id);
}

// Android wrapper: portrait for menus and the arena, landscape for the sandbox world
function setOrientation(mode) { try { if (window.AndroidApp) window.AndroidApp.setOrientation(mode); } catch (e) { /* ignore */ } }

const bind = (id, fn) => $(id).addEventListener('click', (e) => { initAudio(); fn(e); });

bind('mm-play', () => { show('worldlist'); refreshWorlds(); });
bind('mm-arena', () => openArenaMenu());
bind('mm-settings', () => { settingsReturn = 'mainmenu'; openSettings(); });
bind('wl-back', () => show('mainmenu'));
bind('wl-new', () => { show('createworld'); $('cw-name').value = 'Neue Welt'; $('cw-seed').value = ''; });
bind('cw-back', () => { show('worldlist'); refreshWorlds(); });
bind('cw-mode', () => {
  const b = $('cw-mode');
  b.dataset.mode = b.dataset.mode === 'survival' ? 'creative' : 'survival';
  b.textContent = 'Spielmodus: ' + (b.dataset.mode === 'survival' ? 'Überleben' : 'Kreativ');
});
bind('cw-create', async () => {
  const name = $('cw-name').value.trim() || 'Neue Welt';
  const s = $('cw-seed').value.trim();
  const seed = s ? (/^-?\d+$/.test(s) ? (parseInt(s, 10) >>> 0) : hashString(s)) : Math.floor(Math.random() * 2 ** 31);
  const meta = { id: 'w' + Date.now().toString(36), name, seed, mode: $('cw-mode').dataset.mode, created: Date.now(), lastPlayed: Date.now() };
  await saveWorldMeta(meta);
  startWorld(meta);
});
bind('st-back', () => { storeSettings(settings); if (game) game.applySettings(); if (settingsReturn === 'pause') { $('settings').classList.add('hidden'); $('pausemenu').classList.remove('hidden'); } else show(settingsReturn); });

bind('pm-resume', () => ui.resume());
bind('pm-settings', () => { settingsReturn = 'pause'; $('pausemenu').classList.add('hidden'); openSettings(); });
bind('pm-mode', () => {
  if (!game) return;
  game.mode = game.mode === 'creative' ? 'survival' : 'creative';
  if (game.mode === 'survival') game.player.flying = false;
  $('pm-mode').textContent = 'Spielmodus: ' + (game.mode === 'creative' ? 'Kreativ' : 'Überleben');
  ui.dirty = true;
});
bind('pm-quit', () => quitToMenu());
bind('ds-respawn', () => { ui.hideDeath(); game.respawn(); });
bind('ds-quit', () => { ui.hideDeath(); game.respawn(); quitToMenu(); });

async function quitToMenu() {
  if (!game) return;
  $('pausemenu').classList.add('hidden');
  await game.save();
  game.stop();
  game.renderer.domElement.remove();
  game.renderer.dispose();
  game = null;
  ui.detach();
  ui.paused = false;
  setOrientation('portrait');
  show('worldlist');
  refreshWorlds();
}

async function refreshWorlds() {
  const list = $('worlds');
  list.innerHTML = '';
  const worlds = await listWorlds();
  if (!worlds.length) { list.innerHTML = '<div class="empty-list">Noch keine Welten. Erstelle eine neue!</div>'; return; }
  for (const w of worlds) {
    const el = document.createElement('div'); el.className = 'world';
    const d = new Date(w.lastPlayed || w.created);
    el.innerHTML = `<div class="info"><b></b><span>${w.mode === 'creative' ? 'Kreativ' : 'Überleben'} · Seed ${w.seed} · ${d.toLocaleDateString('de-DE')} ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</span></div>`;
    el.querySelector('b').textContent = w.name;
    const play = document.createElement('button'); play.className = 'btn'; play.textContent = 'Spielen';
    play.addEventListener('click', () => startWorld(w));
    const del = document.createElement('button'); del.className = 'btn danger'; del.textContent = 'Löschen';
    del.addEventListener('click', async () => {
      if (del.dataset.confirm) { await deleteWorld(w.id); refreshWorlds(); }
      else { del.dataset.confirm = '1'; del.textContent = 'Sicher?'; setTimeout(() => { del.dataset.confirm = ''; del.textContent = 'Löschen'; }, 3000); }
    });
    el.append(play, del);
    list.appendChild(el);
  }
}

async function startWorld(meta) {
  setOrientation('landscape');
  show(null);
  $('loading').classList.remove('hidden');
  let chunks = new Map();
  const store = meta.dim && meta.dim !== 'overworld' ? meta.id + '~' + meta.dim : meta.id;
  try { chunks = await loadChunks(store); } catch (e) { console.warn(e); }
  if (!game) game = new Game($('game'), ui, settings);
  window.__game = game;
  game.start(meta, chunks);
}

const SETTING_DEFS = [
  ['renderDist', 'Sichtweite (Chunks)', 2, 10, 1],
  ['fov', 'Sichtfeld (FOV)', 50, 110, 1],
  ['sensitivity', 'Empfindlichkeit', 0.2, 3, 0.1],
  ['pixelRatio', 'Grafikauflösung', 0.5, 2, 0.25],
  ['volume', 'Lautstärke', 0, 1, 0.05],
  ['dayLength', 'Tageslänge (Sek.)', 300, 2400, 60],
  ['shaders', 'Shader (Schatten, Wasser, Wind)'],
  ['postfx', 'Shader-Effekte (Leuchten, Lichtstrahlen, Filmlook)'],
  ['compat', 'Kompatibler Grafikmodus (bei Grafikfehlern)'],
  ['autoJump', 'Automatisch springen'],
  ['viewBob', 'Kamerawackeln'],
  ['clouds', 'Wolken'],
  ['outline', 'Blockumrandung'],
  ['mobs', 'Tiere & Monster'],
  ['hostile', 'Monster (Überleben)'],
  ['keepInventory', 'Inventar behalten beim Tod'],
  ['showHand', 'Hand anzeigen'],
];
function openSettings() {
  show('settings');
  $('settings').classList.remove('hidden');
  const grid = $('settingsgrid');
  grid.innerHTML = '';
  for (const [key, label, min, max, step] of SETTING_DEFS) {
    const el = document.createElement('div'); el.className = 'setting';
    if (min !== undefined) {
      el.innerHTML = `<span></span><span class="val"></span><input type="range" min="${min}" max="${max}" step="${step}">`;
      el.children[0].textContent = label;
      const inp = el.querySelector('input'), val = el.querySelector('.val');
      inp.value = settings[key];
      const upd = () => { settings[key] = parseFloat(inp.value); val.textContent = key === 'volume' ? Math.round(settings[key] * 100) + '%' : settings[key]; if (key === 'volume') setVolume(settings[key]); };
      inp.addEventListener('input', upd); upd();
    } else {
      const b = document.createElement('button'); b.className = 'btn';
      const upd = () => { b.textContent = label + ': ' + (settings[key] ? 'AN' : 'AUS'); };
      b.addEventListener('click', () => { settings[key] = !settings[key]; upd(); });
      upd(); el.style.padding = '0'; el.style.border = 'none'; el.appendChild(b);
    }
    grid.appendChild(el);
  }
}

// ---------------- Block-Arena ----------------
let arena = null;
let deck = loadDeck();
const DIFFS = ['Leicht', 'Normal', 'Schwer'];
let difficulty = 1;
try { difficulty = Math.min(2, Math.max(0, parseInt(localStorage.getItem('blockwelt_arena_diff'), 10))); if (isNaN(difficulty)) difficulty = 1; } catch (e) { difficulty = 1; }

function openArenaMenu() {
  show('arenamenu');
  $('am-troph').textContent = loadTrophies();
  $('am-diff').textContent = 'Gegner: ' + DIFFS[difficulty];
  const p = getPortraits();
  $('am-deckprev').innerHTML = deck.map((k) => `<div class="ar-card">${cardHTML(k, p)}</div>`).join('');
}
bind('am-back', () => show('mainmenu'));
bind('am-diff', () => {
  difficulty = (difficulty + 1) % 3;
  try { localStorage.setItem('blockwelt_arena_diff', String(difficulty)); } catch (e) { /* ignore */ }
  $('am-diff').textContent = 'Gegner: ' + DIFFS[difficulty];
});
bind('am-deck', () => openDeck());
bind('am-fight', () => startArena());

let deckDraft = [];
function openDeck() {
  show('deckmenu');
  deckDraft = deck.slice();
  renderDeck();
}
function renderDeck(focus) {
  const p = getPortraits();
  const grid = $('dk-grid');
  grid.innerHTML = '';
  const sorted = CARD_KEYS.slice().sort((a, b) => CARDS[a].cost - CARDS[b].cost);
  for (const k of sorted) {
    const el = document.createElement('div');
    const inDeck = deckDraft.includes(k);
    el.className = 'ar-card ' + (inDeck ? 'in' : 'out');
    el.innerHTML = cardHTML(k, p);
    el.addEventListener('click', () => {
      sfx.click();
      if (deckDraft.includes(k)) deckDraft = deckDraft.filter((q) => q !== k);
      else if (deckDraft.length < 8) deckDraft.push(k);
      else { $('dk-info').textContent = 'Dein Deck ist voll (8 Karten). Nimm zuerst eine Karte heraus.'; return; }
      renderDeck(k);
    });
    grid.appendChild(el);
  }
  $('dk-count').textContent = deckDraft.length + '/8';
  $('dk-avg').textContent = deckDraft.length ? (deckDraft.reduce((s, k) => s + CARDS[k].cost, 0) / deckDraft.length).toFixed(1) : '0';
  const c = focus && CARDS[focus];
  $('dk-info').textContent = c ? `${c.name} (${c.cost} Energie): ${c.desc}` : 'Tippe Karten an, um sie ins Deck zu legen oder herauszunehmen (genau 8).';
}
bind('dk-done', () => {
  if (deckDraft.length !== 8) { $('dk-info').textContent = `Ein Deck braucht genau 8 Karten (aktuell ${deckDraft.length}).`; return; }
  deck = deckDraft.slice();
  saveDeck(deck);
  openArenaMenu();
});

function startArena() {
  show(null);
  if (arena) { arena.dispose(); arena = null; }
  $('ar-quit').classList.remove('confirm'); $('ar-quit').textContent = '✕';
  try {
    arena = new Arena($('arena'), { deck, difficulty, settings, onEnd: arenaEnded });
    window.__arena = arena;
  } catch (e) {
    console.error(e);
    arena = null;
    openArenaMenu();
  }
}
function arenaEnded(res, crowns) {
  let t = loadTrophies();
  const delta = res === 'win' ? 30 : res === 'lose' ? -Math.min(20, t) : 0;
  t += delta; saveTrophies(t);
  const title = $('ar-endtitle');
  title.className = res;
  title.textContent = res === 'win' ? 'Sieg!' : res === 'lose' ? 'Niederlage' : 'Unentschieden';
  $('ar-endcrowns').innerHTML = [0, 1, 2].map((i) => `<span class="crown ${i < crowns[0] ? 'on blue' : ''}">♛</span>`).join('') + '<span style="width:24px"></span>' + [0, 1, 2].map((i) => `<span class="crown ${i < crowns[1] ? 'on red' : ''}">♛</span>`).join('');
  $('ar-endtroph').textContent = `🏆 ${delta >= 0 ? '+' : ''}${delta} → ${t} Pokale`;
  $('ar-end').classList.remove('hidden');
}
function quitArena() {
  if (arena) { arena.dispose(); arena = null; }
  $('ar-end').classList.add('hidden');
  openArenaMenu();
}
bind('ar-again', () => { $('ar-end').classList.add('hidden'); startArena(); });
bind('ar-menu', () => quitArena());
let quitTimer = 0;
bind('ar-quit', () => {
  const b = $('ar-quit');
  if (b.classList.contains('confirm')) { clearTimeout(quitTimer); quitArena(); return; }
  b.classList.add('confirm'); b.textContent = 'Aufgeben?';
  quitTimer = setTimeout(() => { b.classList.remove('confirm'); b.textContent = '✕'; }, 3000);
});

// save when app goes to background
document.addEventListener('visibilitychange', () => { if (arena) arena.setPaused(document.hidden); });
document.addEventListener('visibilitychange', () => { if (document.hidden && game) { game.save(); if (!ui.paused && ui.isTouch) ui.pause(); } });
window.addEventListener('pagehide', () => { if (game) game.save(); });
// Android back button (sent by the wrapper)
window.blockweltBack = () => {
  if (arena) { $('ar-quit').click(); return true; }
  if (!$('deckmenu').classList.contains('hidden')) { openArenaMenu(); return true; }
  if (!$('arenamenu').classList.contains('hidden')) { show('mainmenu'); return true; }
  if (!game) { const cur = ['createworld', 'worldlist', 'settings'].find((m) => !$(m).classList.contains('hidden')); if (cur) { show('mainmenu'); return true; } return false; }
  if (ui.screenOpen) ui.closeScreen(); else if (ui.paused) ui.resume(); else ui.pause();
  return true;
};
show('mainmenu');
