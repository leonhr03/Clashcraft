// Entry point: menus, settings, world selection.
import { UI } from './ui.js';
import { Game } from './game.js';
import { listWorlds, saveWorldMeta, loadChunks, deleteWorld, loadSettings, storeSettings } from './save.js';
import { hashString } from './noise.js';
import { initAudio, setVolume } from './audio.js';

const $ = (id) => document.getElementById(id);
const DEFAULTS = {
  renderDist: 4, fov: 75, sensitivity: 1, pixelRatio: 1, viewBob: true, autoJump: true, clouds: true,
  volume: 0.6, mobs: true, hostile: true, keepInventory: false, dayLength: 1200, outline: true, showHand: true, shaders: true,
};
const settings = Object.assign({}, DEFAULTS, loadSettings());
setVolume(settings.volume);
const ui = new UI(settings);
let game = null;
let settingsReturn = 'mainmenu';

function show(id) {
  for (const m of ['mainmenu', 'worldlist', 'createworld', 'settings']) $(m).classList.toggle('hidden', m !== id);
}

const bind = (id, fn) => $(id).addEventListener('click', (e) => { initAudio(); fn(e); });

bind('mm-play', () => { show('worldlist'); refreshWorlds(); });
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

// save when app goes to background
document.addEventListener('visibilitychange', () => { if (document.hidden && game) { game.save(); if (!ui.paused && ui.isTouch) ui.pause(); } });
window.addEventListener('pagehide', () => { if (game) game.save(); });
// Android back button (sent by the wrapper)
window.blockweltBack = () => {
  if (!game) { const cur = ['createworld', 'worldlist', 'settings'].find((m) => !$(m).classList.contains('hidden')); if (cur) { show('mainmenu'); return true; } return false; }
  if (ui.screenOpen) ui.closeScreen(); else if (ui.paused) ui.resume(); else ui.pause();
  return true;
};
show('mainmenu');
