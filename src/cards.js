// Card definitions for the Arena mode. Every card uses one of Blockwelt's own (original) mobs.
// Distances are in blocks, times in seconds.

export const CARDS = {
  zombie: {
    name: 'Zombie', mob: 'zombie', cost: 3, type: 'unit', count: 1,
    hp: 950, dmg: 115, hitSpeed: 1.2, range: 0.7, speed: 1.0, scale: 0.6, radius: 0.4,
    desc: 'Robuster Nahkämpfer, der alles angreift.',
  },
  skeleton: {
    name: 'Skelett-Schützen', mob: 'skeleton', cost: 3, type: 'unit', count: 2,
    hp: 260, dmg: 85, hitSpeed: 1.1, range: 5, speed: 1.1, scale: 0.6, radius: 0.35, ranged: 'arrow', hitsAir: true,
    desc: 'Zwei Bogenschützen. Treffen auch fliegende Gegner.',
  },
  spider: {
    name: 'Spinne', mob: 'spider', cost: 3, type: 'unit', count: 1,
    hp: 560, dmg: 95, hitSpeed: 0.9, range: 0.8, speed: 1.9, scale: 0.6, radius: 0.5,
    desc: 'Sehr schnell und bissig.',
  },
  ash_zombie: {
    name: 'Aschezombie', mob: 'ash_zombie', cost: 4, type: 'unit', count: 1,
    hp: 1500, dmg: 165, hitSpeed: 1.3, range: 0.7, speed: 0.95, scale: 0.65, radius: 0.45,
    desc: 'Zäher Brocken aus der Unterwelt.',
  },
  fire_skeleton: {
    name: 'Glutskelett', mob: 'fire_skeleton', cost: 5, type: 'unit', count: 1,
    hp: 1250, dmg: 540, hitSpeed: 1.8, range: 0.8, speed: 1.15, scale: 0.65, radius: 0.45,
    desc: 'Langsame, aber vernichtende Klingenhiebe.',
  },
  void_crawler: {
    name: 'Leerenkrabbler', mob: 'void_crawler', cost: 4, type: 'unit', count: 1,
    hp: 1150, dmg: 220, hitSpeed: 1.5, range: 0.8, speed: 2.0, scale: 0.6, radius: 0.5, buildingsOnly: true,
    desc: 'Rennt direkt zu den Türmen und greift nur Gebäude an.',
  },
  cow: {
    name: 'Kuh-Koloss', mob: 'cow', cost: 5, type: 'unit', count: 1,
    hp: 3200, dmg: 170, hitSpeed: 1.5, range: 0.8, speed: 0.75, scale: 0.95, radius: 0.7, buildingsOnly: true,
    desc: 'Riesiger Panzer. Stapft unbeirrt zu den Türmen.',
  },
  pig: {
    name: 'Schweinebande', mob: 'pig', cost: 2, type: 'unit', count: 3,
    hp: 230, dmg: 70, hitSpeed: 1.0, range: 0.6, speed: 1.4, scale: 0.6, radius: 0.35,
    desc: 'Drei Schweine, die gemeinsam drauflos rennen.',
  },
  chicken: {
    name: 'Hühnerschwarm', mob: 'chicken', cost: 2, type: 'unit', count: 4,
    hp: 95, dmg: 45, hitSpeed: 0.9, range: 1.2, speed: 1.7, scale: 0.75, radius: 0.3, air: true, hitsAir: true,
    desc: 'Vier fliegende Hühner – Nahkämpfer erreichen sie nicht!',
  },
  sheep: {
    name: 'Wollschaf', mob: 'sheep', cost: 2, type: 'unit', count: 1,
    hp: 1050, dmg: 45, hitSpeed: 1.2, range: 0.7, speed: 0.9, scale: 0.6, radius: 0.5,
    desc: 'Billiger, flauschiger Schutzschild.',
  },
  villager: {
    name: 'Kürbiswerfer', mob: 'villager', cost: 4, type: 'unit', count: 1,
    hp: 640, dmg: 130, hitSpeed: 1.6, range: 4.5, speed: 0.9, scale: 0.6, radius: 0.4, ranged: 'pumpkin', splash: 1.3, hitsAir: true,
    desc: 'Dorfbewohner, der Kürbisse mit Flächenschaden wirft.',
  },
  powder: {
    name: 'Pulverfass', cost: 4, type: 'spell', radius: 2.4, dmg: 520, towerFactor: 0.35, delay: 0.9,
    desc: 'Explodiert im Zielgebiet und richtet hohen Schaden an.',
  },
  arrows: {
    name: 'Pfeilhagel', cost: 3, type: 'spell', radius: 3.4, dmg: 250, towerFactor: 0.35, delay: 0.6,
    desc: 'Pfeilregen auf ein großes Gebiet – gut gegen Schwärme.',
  },
};

export const CARD_KEYS = Object.keys(CARDS);
export const DEFAULT_DECK = ['zombie', 'skeleton', 'spider', 'pig', 'chicken', 'void_crawler', 'fire_skeleton', 'powder'];

const DECK_KEY = 'blockwelt_arena_deck';
const TROPHY_KEY = 'blockwelt_arena_trophies';

export function loadDeck() {
  try {
    const d = JSON.parse(localStorage.getItem(DECK_KEY));
    if (Array.isArray(d) && d.length === 8 && d.every((k) => CARDS[k]) && new Set(d).size === 8) return d;
  } catch (e) { /* ignore */ }
  return DEFAULT_DECK.slice();
}
export function saveDeck(d) { try { localStorage.setItem(DECK_KEY, JSON.stringify(d)); } catch (e) { /* ignore */ } }
export function loadTrophies() { try { return Math.max(0, parseInt(localStorage.getItem(TROPHY_KEY), 10) || 0); } catch (e) { return 0; } }
export function saveTrophies(t) { try { localStorage.setItem(TROPHY_KEY, String(Math.max(0, t))); } catch (e) { /* ignore */ } }
