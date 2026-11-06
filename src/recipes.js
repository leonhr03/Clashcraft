// Crafting and smelting recipes.
import { itemByKey } from './blocks.js';

const TAGS = {
  '#planks': ['oak_planks', 'birch_planks', 'spruce_planks', 'jungle_planks'],
  '#logs': ['oak_log', 'birch_log', 'spruce_log', 'jungle_log'],
  '#wool': ['white_wool', 'red_wool', 'yellow_wool', 'blue_wool', 'green_wool', 'black_wool', 'orange_wool', 'purple_wool'],
  '#coal': ['coal', 'charcoal'],
};

function matcher(key) {
  if (TAGS[key]) { const ids = TAGS[key].map(itemByKey); return (id) => ids.includes(id); }
  const id = itemByKey(key);
  return (x) => x === id;
}

export const RECIPES = [];
function shaped(pattern, keys, out, count = 1) {
  const k = {};
  for (const [ch, v] of Object.entries(keys)) k[ch] = matcher(v);
  RECIPES.push({ type: 'shaped', w: Math.max(...pattern.map((r) => r.length)), h: pattern.length, pattern: pattern.map((r) => r.padEnd(Math.max(...pattern.map((q) => q.length)), ' ')), k, out: itemByKey(out), count });
}
function shapeless(ings, out, count = 1) {
  RECIPES.push({ type: 'shapeless', ings: ings.map(matcher), out: itemByKey(out), count });
}

// wood
shapeless(['oak_log'], 'oak_planks', 4);
shapeless(['birch_log'], 'birch_planks', 4);
shapeless(['spruce_log'], 'spruce_planks', 4);
shapeless(['jungle_log'], 'jungle_planks', 4);
shaped(['P', 'P'], { P: '#planks' }, 'stick', 4);
shaped(['PP', 'PP'], { P: '#planks' }, 'crafting_table');
shaped(['PPP', 'P P', 'PPP'], { P: '#planks' }, 'chest');
shaped(['CCC', 'C C', 'CCC'], { C: 'cobblestone' }, 'furnace');
shaped(['C', 'S'], { C: '#coal', S: 'stick' }, 'torch', 4);
shaped(['PSP', 'PSP'], { P: '#planks', S: 'stick' }, 'fence', 3);
shaped(['S S', 'SSS', 'S S'], { S: 'stick' }, 'ladder', 3);
shaped(['WWW', 'PPP'], { W: '#wool', P: '#planks' }, 'bed');
shaped(['PPP', 'BBB', 'PPP'], { P: '#planks', B: 'book' }, 'bookshelf');

// tools
const MATS = { wooden: '#planks', stone: 'cobblestone', iron: 'iron_ingot', golden: 'gold_ingot', diamond: 'diamond' };
for (const [t, m] of Object.entries(MATS)) {
  const k = { M: m, S: 'stick' };
  shaped(['MMM', ' S ', ' S '], k, t + '_pickaxe');
  shaped(['MM', 'MS', ' S'], k, t + '_axe');
  shaped(['M', 'S', 'S'], k, t + '_shovel');
  shaped(['M', 'M', 'S'], k, t + '_sword');
  shaped(['MM', ' S', ' S'], k, t + '_hoe');
}
const AMATS = { leather: 'leather', iron: 'iron_ingot', golden: 'gold_ingot', diamond: 'diamond' };
for (const [t, m] of Object.entries(AMATS)) {
  const k = { M: m };
  shaped(['MMM', 'M M'], k, t + '_helmet');
  shaped(['M M', 'MMM', 'MMM'], k, t + '_chestplate');
  shaped(['MMM', 'M M', 'M M'], k, t + '_leggings');
  shaped(['M M', 'M M'], k, t + '_boots');
}
shaped([' TS', 'T S', ' TS'], { T: 'stick', S: 'string' }, 'bow');
shaped(['F', 'S', 'E'], { F: 'flint', S: 'stick', E: 'feather' }, 'arrow', 4);
shaped(['I I', ' I '], { I: 'iron_ingot' }, 'bucket');
shaped([' I', 'I '], { I: 'iron_ingot' }, 'shears');

// storage blocks
for (const [ing, blk] of [['iron_ingot', 'iron_block'], ['gold_ingot', 'gold_block'], ['diamond', 'diamond_block'], ['copper_ingot', 'copper_block'], ['coal', 'coal_block'], ['lapis', 'lapis_block'], ['wheat', 'hay_block']]) {
  shaped(['XXX', 'XXX', 'XXX'], { X: ing }, blk);
  shapeless([blk], ing, 9);
}

// building
shaped(['BB', 'BB'], { B: 'brick' }, 'bricks');
shaped(['SS', 'SS'], { S: 'stone' }, 'stone_bricks', 4);
shaped(['SS', 'SS'], { S: 'sand' }, 'sandstone');
shaped(['SS', 'SS'], { S: 'string' }, 'white_wool');
shaped(['SS', 'SS'], { S: 'snow_block' }, 'snow_block');
shapeless(['cobblestone', 'tall_grass'], 'mossy_cobblestone');
shaped([' I ', 'ITI', ' I '], { I: 'iron_ingot', T: 'torch' }, 'lantern');
shaped([' T ', 'TGT', ' T '], { T: 'torch', G: 'glass' }, 'glowing_crystal');

// structures & dimensions
shaped(['OOO', 'OGO', 'OOO'], { O: 'obsidian', G: 'glowing_crystal' }, 'glutportal', 2);
shaped([' I ', 'ILI', ' I '], { I: 'iron_ingot', L: 'lapis' }, 'explorer_compass');
shaped(['GG', 'GG'], { G: 'glutgestein' }, 'glutziegel', 4);
shaped(['GBG', 'GBG'], { G: 'glutziegel', B: 'glutgestein' }, 'glutzaun', 6);
shaped(['LL', 'LL'], { L: 'leerenstein' }, 'leerenstein_ziegel', 4);
shaped(['QQ', 'QQ'], { Q: 'quartz' }, 'sternenziegel', 4);
shaped(['S', 'S'], { S: 'sternenziegel' }, 'sternensaeule', 2);
shaped(['S', 'S'], { S: 'sandstone' }, 'chiseled_sandstone');
shapeless(['stone_bricks', 'tall_grass'], 'mossy_stone_bricks');

// food & misc
shaped(['WWW'], { W: 'wheat' }, 'bread');
shaped(['GGG', 'GAG', 'GGG'], { G: 'gold_ingot', A: 'apple' }, 'golden_apple');
shapeless(['pumpkin', 'sugar', 'egg'], 'pumpkin_pie');
shaped(['SSS'], { S: 'sugar_cane' }, 'paper', 3);
shapeless(['sugar_cane'], 'sugar');
shapeless(['paper', 'paper', 'paper', 'leather'], 'book');
shapeless(['bone'], 'bone_meal', 3);
shapeless(['pumpkin'], 'wheat_seeds', 4);

// dyes
shapeless(['poppy'], 'red_dye', 2);
shapeless(['dandelion'], 'yellow_dye', 2);
shapeless(['blue_flower'], 'blue_dye', 2);
shapeless(['lapis'], 'blue_dye');
shapeless(['coal'], 'black_dye');
shapeless(['red_dye', 'yellow_dye'], 'orange_dye', 2);
shapeless(['red_dye', 'blue_dye'], 'purple_dye', 2);
for (const c of ['red', 'yellow', 'blue', 'green', 'black', 'orange', 'purple']) shapeless([c + '_dye', 'white_wool'], c + '_wool');

// find a recipe for a grid (array of ids or 0, size n x n)
export function matchRecipe(grid, n) {
  // bounding box
  let minX = n, minY = n, maxX = -1, maxY = -1;
  const items = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const id = grid[y * n + x];
    if (id) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); items.push(id); }
  }
  if (!items.length) return null;
  const w = maxX - minX + 1, h = maxY - minY + 1;
  for (const r of RECIPES) {
    if (r.type === 'shapeless') {
      if (r.ings.length !== items.length) continue;
      const used = new Array(items.length).fill(false);
      let ok = true;
      for (const m of r.ings) {
        let found = false;
        for (let i = 0; i < items.length; i++) if (!used[i] && m(items[i])) { used[i] = true; found = true; break; }
        if (!found) { ok = false; break; }
      }
      if (ok) return r;
      continue;
    }
    if (r.w !== w || r.h !== h) continue;
    for (const mirror of [false, true]) {
      let ok = true;
      for (let y = 0; y < h && ok; y++) for (let x = 0; x < w && ok; x++) {
        const ch = r.pattern[y][mirror ? w - 1 - x : x];
        const id = grid[(y + minY) * n + (x + minX)];
        if (ch === ' ') { if (id) ok = false; }
        else if (!id || !r.k[ch](id)) ok = false;
      }
      if (ok) return r;
    }
  }
  return null;
}

export const SMELT = new Map();
function smelt(a, b) { SMELT.set(itemByKey(a), itemByKey(b)); }
smelt('raw_iron', 'iron_ingot'); smelt('raw_gold', 'gold_ingot'); smelt('raw_copper', 'copper_ingot');
smelt('iron_ore', 'iron_ingot'); smelt('gold_ore', 'gold_ingot'); smelt('copper_ore', 'copper_ingot');
smelt('sand', 'glass'); smelt('cobblestone', 'stone'); smelt('stone', 'smooth_stone');
smelt('clay_ball', 'brick'); smelt('clay', 'terracotta');
smelt('oak_log', 'charcoal'); smelt('birch_log', 'charcoal'); smelt('spruce_log', 'charcoal');
smelt('porkchop', 'cooked_porkchop'); smelt('beef', 'steak'); smelt('mutton', 'cooked_mutton'); smelt('chicken', 'cooked_chicken');
smelt('cactus', 'green_dye'); smelt('stone_bricks', 'cracked_stone_bricks'); smelt('glutquarz_erz', 'quartz'); smelt('jungle_log', 'charcoal'); smelt('diamond_ore', 'diamond'); smelt('coal_ore', 'coal'); smelt('lapis_ore', 'lapis');
