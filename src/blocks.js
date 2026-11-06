// Block & item registry. Names are German (UI language).

export const B = {};   // block name -> id
export const I = {};   // item name -> id
export const BLOCKS = []; // id -> block def
export const ITEMS = [];  // id -> item def (blocks included, ids < 256)

// shape: 'cube' | 'cross' | 'torch' | 'liquid' | 'flat' (farmland-like) | 'bed' | 'cactus'
function block(id, key, name, opts) {
  const d = Object.assign({
    id, key, name,
    shape: 'cube',
    solid: true,        // collides
    opaque: true,       // hides neighbor faces, blocks light
    transparent: false, // rendered in transparent pass (water)
    cutout: false,      // alpha-tested (leaves, glass)
    hardness: 1,
    tool: null,         // 'pickaxe' | 'axe' | 'shovel' | 'sword' | 'hoe'
    level: 0,           // minimum tool level needed for drops (0 = hand ok)
    drop: null,         // item key or function -> [[key,count]]
    light: 0,           // emitted light
    tex: null,          // tile name or {top,bottom,side,front}
    stack: 64,
    replaceable: false,
    gravity: false,
    flammable: false,
    fuel: 0,
  }, opts);
  if (!d.tex) d.tex = key;
  if (typeof d.tex === 'string') d.tex = { all: d.tex };
  BLOCKS[id] = d;
  ITEMS[id] = { id, key, name, isBlock: true, stack: d.stack, fuel: d.fuel };
  B[key] = id;
  return d;
}

const nonSolidCross = { shape: 'cross', solid: false, opaque: false, cutout: true, hardness: 0, replaceable: false };

block(0, 'air', 'Luft', { solid: false, opaque: false, hardness: 0, replaceable: true });
block(1, 'stone', 'Stein', { hardness: 1.5, tool: 'pickaxe', level: 1, drop: 'cobblestone' });
block(2, 'grass', 'Grasblock', { hardness: 0.6, tool: 'shovel', drop: 'dirt', tex: { top: 'grass_top', bottom: 'dirt', side: 'grass_side' } });
block(3, 'dirt', 'Erde', { hardness: 0.5, tool: 'shovel' });
block(4, 'cobblestone', 'Bruchstein', { hardness: 2, tool: 'pickaxe', level: 1 });
block(5, 'oak_planks', 'Eichenbretter', { hardness: 2, tool: 'axe', fuel: 15, flammable: true });
block(6, 'bedrock', 'Grundgestein', { hardness: -1 });
block(7, 'sand', 'Sand', { hardness: 0.5, tool: 'shovel', gravity: true });
block(8, 'gravel', 'Kies', { hardness: 0.6, tool: 'shovel', gravity: true, drop: (r) => (r < 0.12 ? [['flint', 1]] : [['gravel', 1]]) });
block(9, 'oak_log', 'Eichenstamm', { hardness: 2, tool: 'axe', fuel: 15, tex: { top: 'oak_log_top', bottom: 'oak_log_top', side: 'oak_log' } });
block(10, 'oak_leaves', 'Eichenlaub', { hardness: 0.2, tool: 'hoe', opaque: false, cutout: true, drop: (r) => (r < 0.06 ? [['oak_sapling', 1]] : r < 0.08 ? [['apple', 1]] : []) });
block(11, 'glass', 'Glas', { hardness: 0.3, opaque: false, cutout: true, drop: () => [] });
block(12, 'coal_ore', 'Steinkohle', { hardness: 3, tool: 'pickaxe', level: 1, drop: 'coal', xp: 1 });
block(13, 'iron_ore', 'Eisenerz', { hardness: 3, tool: 'pickaxe', level: 2, drop: 'raw_iron' });
block(14, 'gold_ore', 'Golderz', { hardness: 3, tool: 'pickaxe', level: 3, drop: 'raw_gold' });
block(15, 'diamond_ore', 'Diamanterz', { hardness: 3, tool: 'pickaxe', level: 3, drop: 'diamond' });
block(16, 'copper_ore', 'Kupfererz', { hardness: 3, tool: 'pickaxe', level: 2, drop: (r) => [['raw_copper', 2 + Math.floor(r * 3)]] });
block(17, 'lapis_ore', 'Lapislazulierz', { hardness: 3, tool: 'pickaxe', level: 2, drop: (r) => [['lapis', 4 + Math.floor(r * 5)]] });
block(18, 'water', 'Wasser', { shape: 'liquid', solid: false, opaque: false, transparent: true, hardness: -1, replaceable: true, tex: 'water', drop: () => [] });
block(19, 'lava', 'Lava', { shape: 'liquid', solid: false, opaque: false, hardness: -1, replaceable: true, light: 15, tex: 'lava', drop: () => [] });
block(20, 'sandstone', 'Sandstein', { hardness: 0.8, tool: 'pickaxe', level: 1, tex: { top: 'sandstone_top', bottom: 'sandstone_top', side: 'sandstone' } });
block(21, 'birch_log', 'Birkenstamm', { hardness: 2, tool: 'axe', fuel: 15, tex: { top: 'birch_log_top', bottom: 'birch_log_top', side: 'birch_log' } });
block(22, 'birch_leaves', 'Birkenlaub', { hardness: 0.2, tool: 'hoe', opaque: false, cutout: true, drop: (r) => (r < 0.06 ? [['birch_sapling', 1]] : []) });
block(23, 'birch_planks', 'Birkenbretter', { hardness: 2, tool: 'axe', fuel: 15 });
block(24, 'spruce_log', 'Fichtenstamm', { hardness: 2, tool: 'axe', fuel: 15, tex: { top: 'spruce_log_top', bottom: 'spruce_log_top', side: 'spruce_log' } });
block(25, 'spruce_leaves', 'Fichtennadeln', { hardness: 0.2, tool: 'hoe', opaque: false, cutout: true, drop: (r) => (r < 0.06 ? [['spruce_sapling', 1]] : []) });
block(26, 'spruce_planks', 'Fichtenbretter', { hardness: 2, tool: 'axe', fuel: 15 });
block(27, 'snowy_grass', 'Verschneiter Rasen', { hardness: 0.6, tool: 'shovel', drop: 'dirt', tex: { top: 'snow', bottom: 'dirt', side: 'snowy_grass_side' } });
block(28, 'snow_block', 'Schneeblock', { hardness: 0.2, tool: 'shovel', tex: 'snow' });
block(29, 'ice', 'Eis', { hardness: 0.5, tool: 'pickaxe', opaque: false, cutout: true, drop: () => [] });
block(30, 'cactus', 'Kaktus', { shape: 'cactus', hardness: 0.4, opaque: false, cutout: true, tex: { top: 'cactus_top', bottom: 'cactus_top', side: 'cactus_side' } });
block(31, 'crafting_table', 'Werkbank', { hardness: 2.5, tool: 'axe', fuel: 15, tex: { top: 'crafting_top', bottom: 'oak_planks', side: 'crafting_side', front: 'crafting_front' } });
block(32, 'furnace', 'Ofen', { hardness: 3.5, tool: 'pickaxe', level: 1, tex: { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side', front: 'furnace_front' } });
block(33, 'furnace_lit', 'Brennender Ofen', { hardness: 3.5, tool: 'pickaxe', level: 1, light: 13, drop: 'furnace', tex: { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side', front: 'furnace_front_lit' } });
block(34, 'chest', 'Truhe', { hardness: 2.5, tool: 'axe', fuel: 15, tex: { top: 'chest_top', bottom: 'chest_top', side: 'chest_side', front: 'chest_front' } });
block(35, 'torch', 'Fackel', { shape: 'torch', solid: false, opaque: false, cutout: true, hardness: 0, light: 14 });
block(36, 'tall_grass', 'Gras', Object.assign({}, nonSolidCross, { replaceable: true, drop: (r) => (r < 0.15 ? [['wheat_seeds', 1]] : []) }));
block(37, 'poppy', 'Mohnblume', nonSolidCross);
block(38, 'dandelion', 'Löwenzahn', nonSolidCross);
block(39, 'dead_bush', 'Toter Busch', Object.assign({}, nonSolidCross, { replaceable: true, drop: (r) => [['stick', Math.floor(r * 3)]] }));
block(40, 'oak_sapling', 'Eichensetzling', nonSolidCross);
block(41, 'birch_sapling', 'Birkensetzling', nonSolidCross);
block(42, 'spruce_sapling', 'Fichtensetzling', nonSolidCross);
block(43, 'bricks', 'Ziegelsteine', { hardness: 2, tool: 'pickaxe', level: 1 });
block(44, 'stone_bricks', 'Steinziegel', { hardness: 1.5, tool: 'pickaxe', level: 1 });
block(45, 'bookshelf', 'Bücherregal', { hardness: 1.5, tool: 'axe', fuel: 15, drop: (r) => [['book', 3]], tex: { top: 'oak_planks', bottom: 'oak_planks', side: 'bookshelf' } });
const WOOL = [['white', 'Weiße'], ['red', 'Rote'], ['yellow', 'Gelbe'], ['blue', 'Blaue'], ['green', 'Grüne'], ['black', 'Schwarze'], ['orange', 'Orange'], ['purple', 'Violette']];
WOOL.forEach(([c, n], i) => block(46 + i, c + '_wool', n + ' Wolle', { hardness: 0.8, tool: 'shears', fuel: 5 }));
block(54, 'iron_block', 'Eisenblock', { hardness: 5, tool: 'pickaxe', level: 2 });
block(55, 'gold_block', 'Goldblock', { hardness: 3, tool: 'pickaxe', level: 3 });
block(56, 'diamond_block', 'Diamantblock', { hardness: 5, tool: 'pickaxe', level: 3 });
block(57, 'copper_block', 'Kupferblock', { hardness: 3, tool: 'pickaxe', level: 2 });
block(58, 'coal_block', 'Kohleblock', { hardness: 5, tool: 'pickaxe', level: 1, fuel: 800 });
block(59, 'lapis_block', 'Lapislazuliblock', { hardness: 3, tool: 'pickaxe', level: 2 });
block(60, 'farmland', 'Ackerboden', { shape: 'flat', hardness: 0.6, tool: 'shovel', drop: 'dirt', opaque: false, tex: { top: 'farmland', bottom: 'dirt', side: 'dirt' } });
for (let s = 0; s < 4; s++) {
  block(61 + s, 'wheat_' + s, 'Weizen', Object.assign({}, nonSolidCross, {
    tex: 'wheat_' + s,
    drop: s < 3 ? 'wheat_seeds' : (r) => [['wheat', 1], ['wheat_seeds', 1 + Math.floor(r * 3)]],
  }));
}
block(65, 'clay', 'Ton', { hardness: 0.6, tool: 'shovel', drop: (r) => [['clay_ball', 4]] });
block(66, 'terracotta', 'Terrakotta', { hardness: 1.25, tool: 'pickaxe', level: 1 });
block(67, 'obsidian', 'Obsidian', { hardness: 50, tool: 'pickaxe', level: 4 });
block(68, 'bed', 'Bett', { shape: 'bed', hardness: 0.2, opaque: false, tex: { top: 'bed_top', bottom: 'oak_planks', side: 'bed_side' } });
block(69, 'mossy_cobblestone', 'Bemooster Bruchstein', { hardness: 2, tool: 'pickaxe', level: 1 });
block(70, 'granite', 'Granit', { hardness: 1.5, tool: 'pickaxe', level: 1 });
block(71, 'diorite', 'Diorit', { hardness: 1.5, tool: 'pickaxe', level: 1 });
block(72, 'andesite', 'Andesit', { hardness: 1.5, tool: 'pickaxe', level: 1 });
block(73, 'pumpkin', 'Kürbis', { hardness: 1, tool: 'axe', tex: { top: 'pumpkin_top', bottom: 'pumpkin_top', side: 'pumpkin_side' } });
block(74, 'melon', 'Melone', { hardness: 1, tool: 'axe', drop: (r) => [['melon_slice', 3 + Math.floor(r * 5)]], tex: { top: 'melon_top', bottom: 'melon_top', side: 'melon_side' } });
block(75, 'red_mushroom', 'Roter Pilz', nonSolidCross);
block(76, 'brown_mushroom', 'Brauner Pilz', Object.assign({}, nonSolidCross, { light: 1 }));
block(77, 'sugar_cane', 'Zuckerrohr', nonSolidCross);
block(78, 'smooth_stone', 'Glatter Stein', { hardness: 2, tool: 'pickaxe', level: 1 });
block(79, 'hay_block', 'Strohballen', { hardness: 0.5, tool: 'hoe', tex: { top: 'hay_top', bottom: 'hay_top', side: 'hay_side' } });
block(80, 'lantern', 'Laterne', { shape: 'torch', solid: false, opaque: false, cutout: true, hardness: 1, tool: 'pickaxe', light: 15 });
block(81, 'glowing_crystal', 'Leuchtkristall', { hardness: 0.3, light: 15 });
block(82, 'blue_flower', 'Kornblume', nonSolidCross);
block(83, 'fence', 'Holzzaun', { hardness: 2, tool: 'axe', opaque: false, cutout: true, fuel: 15, tex: 'fence' });
block(84, 'ladder', 'Leiter', { solid: false, opaque: false, cutout: true, hardness: 0.4, tool: 'axe', climb: true, fuel: 5 });

// ---- Dschungel, Dörfer, Tempel, Unterwelt, Leere ----
block(85, 'jungle_log', 'Tropenholzstamm', { hardness: 2, tool: 'axe', fuel: 15, tex: { top: 'jungle_log_top', bottom: 'jungle_log_top', side: 'jungle_log' } });
block(86, 'jungle_leaves', 'Tropenlaub', { hardness: 0.2, tool: 'hoe', opaque: false, cutout: true, drop: (r) => (r < 0.04 ? [['jungle_sapling', 1]] : r < 0.06 ? [['apple', 1]] : []) });
block(87, 'jungle_planks', 'Tropenholzbretter', { hardness: 2, tool: 'axe', fuel: 15 });
block(88, 'jungle_sapling', 'Tropensetzling', nonSolidCross);
block(89, 'dirt_path', 'Trampelpfad', { shape: 'flat', hardness: 0.6, tool: 'shovel', drop: 'dirt', opaque: false, tex: { top: 'dirt_path_top', bottom: 'dirt', side: 'dirt_path_side' } });
block(90, 'glutgestein', 'Glutgestein', { hardness: 0.4, tool: 'pickaxe', level: 1 });
block(91, 'aschesand', 'Aschesand', { hardness: 0.5, tool: 'shovel', slow: true });
block(92, 'glutquarz_erz', 'Glutquarzerz', { hardness: 3, tool: 'pickaxe', level: 1, drop: 'quartz' });
block(93, 'glutziegel', 'Glutziegel', { hardness: 2, tool: 'pickaxe', level: 1 });
block(94, 'glutzaun', 'Glutziegelzaun', { hardness: 2, tool: 'pickaxe', level: 1, opaque: false, cutout: true });
block(95, 'leerenstein', 'Leerenstein', { hardness: 3, tool: 'pickaxe', level: 1 });
block(96, 'leerenstein_ziegel', 'Leerensteinziegel', { hardness: 3, tool: 'pickaxe', level: 1 });
block(97, 'sternenziegel', 'Sternenziegel', { hardness: 1.5, tool: 'pickaxe', level: 1 });
block(98, 'sternensaeule', 'Sternensäule', { hardness: 1.5, tool: 'pickaxe', level: 1, tex: { top: 'sternensaeule_top', bottom: 'sternensaeule_top', side: 'sternensaeule' } });
block(99, 'glutportal', 'Glutportal', { solid: false, opaque: false, cutout: true, hardness: 1, light: 11, portal: 'nether' });
block(100, 'leerenportal', 'Leerenportal', { solid: false, opaque: false, cutout: true, hardness: -1, light: 12, portal: 'end' });
block(101, 'leerenrahmen', 'Leerenrahmen', { hardness: -1, light: 3, tex: { top: 'leerenrahmen_top', bottom: 'leerenstein', side: 'leerenrahmen_side' } });
block(102, 'chiseled_sandstone', 'Gemeißelter Sandstein', { hardness: 0.8, tool: 'pickaxe', level: 1, tex: { top: 'sandstone_top', bottom: 'sandstone_top', side: 'chiseled_sandstone' } });
block(103, 'mossy_stone_bricks', 'Bemooste Steinziegel', { hardness: 1.5, tool: 'pickaxe', level: 1 });
block(104, 'cracked_stone_bricks', 'Rissige Steinziegel', { hardness: 1.5, tool: 'pickaxe', level: 1 });
block(105, 'glutpilz', 'Glutpilz', Object.assign({}, nonSolidCross, { light: 6 }));

export const NUM_BLOCKS = 106;

// ---------- Items ----------
let nextItem = 256;
function item(key, name, opts = {}) {
  const id = nextItem++;
  const d = Object.assign({ id, key, name, isBlock: false, stack: 64, tex: key, fuel: 0 }, opts);
  ITEMS[id] = d;
  I[key] = id;
  return d;
}

item('stick', 'Stock', { fuel: 5 });
item('coal', 'Kohle', { fuel: 80 });
item('charcoal', 'Holzkohle', { fuel: 80 });
item('raw_iron', 'Roheisen');
item('raw_gold', 'Rohgold');
item('raw_copper', 'Rohkupfer');
item('iron_ingot', 'Eisenbarren');
item('gold_ingot', 'Goldbarren');
item('copper_ingot', 'Kupferbarren');
item('diamond', 'Diamant');
item('lapis', 'Lapislazuli');
item('flint', 'Feuerstein');
item('wheat_seeds', 'Weizenkörner', { places: 'wheat_0' });
item('wheat', 'Weizen');
item('bread', 'Brot', { food: 5, sat: 6 });
item('apple', 'Apfel', { food: 4, sat: 2.4 });
item('golden_apple', 'Goldener Apfel', { food: 4, sat: 9.6, heal: 8 });
item('porkchop', 'Rohes Schweinefleisch', { food: 3, sat: 1.8 });
item('cooked_porkchop', 'Gebratenes Schweinefleisch', { food: 8, sat: 12.8 });
item('beef', 'Rohes Rindfleisch', { food: 3, sat: 1.8 });
item('steak', 'Steak', { food: 8, sat: 12.8 });
item('mutton', 'Rohes Hammelfleisch', { food: 2, sat: 1.2 });
item('cooked_mutton', 'Gebratenes Hammelfleisch', { food: 6, sat: 9.6 });
item('chicken', 'Rohes Hühnchen', { food: 2, sat: 1.2 });
item('cooked_chicken', 'Gebratenes Hühnchen', { food: 6, sat: 7.2 });
item('rotten_flesh', 'Verrottetes Fleisch', { food: 4, sat: 0.8, poison: true });
item('melon_slice', 'Melonenscheibe', { food: 2, sat: 1.2 });
item('pumpkin_pie', 'Kürbiskuchen', { food: 8, sat: 4.8 });
item('bone', 'Knochen');
item('bone_meal', 'Knochenmehl', { fertilizer: true });
item('string', 'Faden');
item('feather', 'Feder');
item('leather', 'Leder');
item('arrow', 'Pfeil');
item('bow', 'Bogen', { stack: 1, durability: 384, bow: true });
item('paper', 'Papier');
item('book', 'Buch');
item('sugar', 'Zucker');
item('clay_ball', 'Tonklumpen');
item('brick', 'Ziegel');
item('bucket', 'Eimer', { stack: 16 });
item('water_bucket', 'Wassereimer', { stack: 1, places: 'water', leaves: 'bucket' });
item('lava_bucket', 'Lavaeimer', { stack: 1, places: 'lava', leaves: 'bucket', fuel: 1000 });
item('shears', 'Schere', { stack: 1, durability: 238, toolType: 'shears', toolLevel: 1, toolSpeed: 5 });
item('egg', 'Ei', { stack: 16 });
item('red_dye', 'Roter Farbstoff');
item('yellow_dye', 'Gelber Farbstoff');
item('green_dye', 'Grüner Farbstoff');
item('black_dye', 'Schwarzer Farbstoff');
item('orange_dye', 'Oranger Farbstoff');
item('purple_dye', 'Violetter Farbstoff');
item('blue_dye', 'Blauer Farbstoff');
item('quartz', 'Glutquarz');
item('explorer_compass', 'Entdeckerkompass', { stack: 1, compass: true });

export const TIERS = [
  { key: 'wooden', name: 'Holz', level: 1, speed: 2, dur: 59, dmg: 0, color: 'wood' },
  { key: 'stone', name: 'Stein', level: 2, speed: 4, dur: 131, dmg: 1, color: 'stone' },
  { key: 'iron', name: 'Eisen', level: 3, speed: 6, dur: 250, dmg: 2, color: 'iron' },
  { key: 'golden', name: 'Gold', level: 1, speed: 12, dur: 32, dmg: 0, color: 'gold' },
  { key: 'diamond', name: 'Diamant', level: 4, speed: 8, dur: 1561, dmg: 3, color: 'diamond' },
];
export const TOOL_TYPES = [
  { key: 'pickaxe', name: 'spitzhacke', baseDmg: 2 },
  { key: 'axe', name: 'axt', baseDmg: 7 },
  { key: 'shovel', name: 'schaufel', baseDmg: 2.5 },
  { key: 'sword', name: 'schwert', baseDmg: 4 },
  { key: 'hoe', name: 'hacke', baseDmg: 1 },
];
const TIER_ADJ = { wooden: 'Holz', stone: 'Stein', iron: 'Eisen', golden: 'Gold', diamond: 'Diamant' };
const TOOL_NOUN = { pickaxe: 'spitzhacke', axe: 'axt', shovel: 'schaufel', sword: 'schwert', hoe: 'hacke' };
for (const t of TIERS) {
  for (const tt of TOOL_TYPES) {
    item(t.key + '_' + tt.key, TIER_ADJ[t.key] + TOOL_NOUN[tt.key], {
      stack: 1, durability: t.dur, toolType: tt.key, toolLevel: t.level, toolSpeed: t.speed,
      damage: tt.baseDmg + t.dmg + (tt.key === 'sword' ? 1 : 0), tier: t.key,
    });
  }
}

export const ARMOR_TIERS = [
  { key: 'leather', name: 'Leder', pts: [1, 3, 2, 1], dur: 80 },
  { key: 'iron', name: 'Eisen', pts: [2, 6, 5, 2], dur: 240 },
  { key: 'golden', name: 'Gold', pts: [2, 5, 3, 1], dur: 112 },
  { key: 'diamond', name: 'Diamant', pts: [3, 8, 6, 3], dur: 528 },
];
export const ARMOR_SLOTS = [
  { key: 'helmet', name: 'helm' },
  { key: 'chestplate', name: 'harnisch' },
  { key: 'leggings', name: 'beinschutz' },
  { key: 'boots', name: 'stiefel' },
];
for (const t of ARMOR_TIERS) {
  ARMOR_SLOTS.forEach((s, i) => {
    const nm = t.name + s.name;
    item(t.key + '_' + s.key, nm, { stack: 1, durability: t.dur, armorSlot: i, armor: t.pts[i], tier: t.key });
  });
}

export function itemByKey(k) {
  if (B[k] !== undefined) return B[k];
  if (I[k] !== undefined) return I[k];
  throw new Error('unknown item ' + k);
}

export function maxStack(id) {
  const d = ITEMS[id];
  return d ? d.stack : 64;
}

export function isOpaque(id) { return BLOCKS[id] ? BLOCKS[id].opaque : false; }

// Lookup arrays for fast access in hot loops
export const OPAQUE = new Uint8Array(256);
export const SOLID = new Uint8Array(256);
export const LIGHT_EMIT = new Uint8Array(256);
export const LIGHT_FILTER = new Uint8Array(256); // extra attenuation
for (let i = 0; i < 256; i++) {
  const b = BLOCKS[i];
  if (!b) continue;
  OPAQUE[i] = b.opaque ? 1 : 0;
  SOLID[i] = b.solid ? 1 : 0;
  LIGHT_EMIT[i] = b.light;
  LIGHT_FILTER[i] = b.opaque ? 15 : (b.key.endsWith('leaves') ? 1 : (b.key === 'water' || b.key === 'ice') ? 2 : 0);
}
