// Main game: rendering, chunk streaming, interaction, simulation.
import * as THREE from 'three';
import { World, CS, CH } from './world.js';
import { buildChunkMesh } from './mesher.js';
import { buildAtlas, tileUV } from './textures.js';
import { BLOCKS, ITEMS, B, I, SOLID, itemByKey } from './blocks.js';
import { Player } from './player.js';
import { EntityManager, itemGeometry } from './entities.js';
import { raycast, rayBox, collides } from './physics.js';
import { Sky } from './sky.js';
import { SMELT } from './recipes.js';
import { sfx, initAudio } from './audio.js';
import { saveWorldMeta, saveChunks } from './save.js';
import { SEA } from './worldgen.js';

const VERT = `
attribute vec3 lt;
varying vec2 vUv;
varying vec3 vLt;
varying float vDist;
void main(){
  vUv = uv; vLt = lt;
  vec4 mv = modelViewMatrix * vec4(position,1.0);
  vDist = length(mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
uniform sampler2D map;
uniform float uDay;
uniform vec3 uFog;
uniform float uFogNear, uFogFar, uAlpha, uAlphaTest;
varying vec2 vUv;
varying vec3 vLt;
varying float vDist;
void main(){
  vec4 c = texture2D(map, vUv);
  if (c.a < uAlphaTest) discard;
  float sky = vLt.x * uDay;
  float bl = vLt.y;
  float ls = pow(0.82, 15.0*(1.0-sky));
  float lb = pow(0.82, 15.0*(1.0-bl));
  vec3 light = max(vec3(ls), vec3(lb)*vec3(1.0,0.9,0.75));
  light = max(light, vec3(0.03));
  vec3 col = c.rgb * light * vLt.z;
  float f = clamp((vDist - uFogNear)/(uFogFar-uFogNear), 0.0, 1.0);
  gl_FragColor = vec4(mix(col, uFog, f), c.a * uAlpha);
  #include <colorspace_fragment>
}`;

export class Game {
  constructor(container, ui, settings) {
    this.ui = ui; this.settings = settings;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, settings.pixelRatio || 1));
    this.renderer.autoClear = false;
    container.appendChild(this.renderer.domElement);
    this.canvas = this.renderer.domElement;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(settings.fov || 75, 1, 0.05, 1000);
    this.camera.rotation.order = 'YXZ';
    this.handScene = new THREE.Scene();
    this.handCam = new THREE.PerspectiveCamera(70, 1, 0.01, 10);
    this.handLight = new THREE.AmbientLight(0xffffff, 1);
    this.handScene.add(this.handLight);
    const hd = new THREE.DirectionalLight(0xffffff, 0.6); hd.position.set(1, 2, 1); this.handScene.add(hd);

    // lights for mobs / items (lambert)
    this.amb = new THREE.AmbientLight(0xffffff, 0.75); this.scene.add(this.amb);
    this.dir = new THREE.DirectionalLight(0xffffff, 0.5); this.dir.position.set(0.4, 1, 0.3); this.scene.add(this.dir);

    const atlas = buildAtlas();
    this.atlasTex = new THREE.CanvasTexture(atlas);
    this.atlasTex.magFilter = THREE.NearestFilter; this.atlasTex.minFilter = THREE.NearestFilter;
    this.atlasTex.generateMipmaps = false; this.atlasTex.colorSpace = THREE.SRGBColorSpace;
    const uniforms = () => ({
      map: { value: this.atlasTex }, uDay: { value: 1 }, uFog: { value: new THREE.Color() },
      uFogNear: { value: 40 }, uFogFar: { value: 60 }, uAlpha: { value: 1 }, uAlphaTest: { value: 0.5 },
    });
    this.solidMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: uniforms() });
    this.waterMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: uniforms(), transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.waterMat.uniforms.uAlpha.value = 0.85; this.waterMat.uniforms.uAlphaTest.value = 0.01;
    this.itemMaterial = new THREE.MeshLambertMaterial({ map: this.atlasTex, alphaTest: 0.5, side: THREE.DoubleSide });

    this.sky = new Sky(this.scene);

    // selection box + crack overlay
    const eg = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002));
    this.selBox = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6 }));
    this.selBox.visible = false; this.scene.add(this.selBox);
    this.crackGeo = new THREE.BoxGeometry(1.004, 1.004, 1.004);
    this.crack = new THREE.Mesh(this.crackGeo, new THREE.MeshBasicMaterial({ map: this.atlasTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
    this.crack.visible = false; this.scene.add(this.crack);
    this.crackStage = -1;

    this.hand = new THREE.Group(); this.handScene.add(this.hand);
    this.handItem = null; this.handHeldId = -1;
    this.swing = 0;

    this.time = 0.05; this.running = false; this.paused = false;
    this.mining = null; this.useCooldown = 0; this.attackCd = 0; this.eating = 0;
    this.fluidQueue = []; this.fluidTimer = 0; this.flow = new Map();
    this.tickTimer = 0; this.saveTimer = 0;
    this.lastFrame = performance.now();
    this.fpsAcc = 0; this.fpsN = 0; this.fps = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.handCam.aspect = w / h; this.handCam.updateProjectionMatrix();
  }

  applySettings() {
    const s = this.settings;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, s.pixelRatio || 1));
    this.camera.fov = s.fov || 75; this.camera.updateProjectionMatrix();
    this.resize();
  }

  dayFactor() { return this.sky.dayFactor(this.time); }

  // ------------- world lifecycle -------------
  start(meta, savedChunks) {
    this.meta = meta;
    this.mode = meta.mode;
    this.world = new World(meta.seed, savedChunks);
    this.world.onBlockChange = (x, y, z, old, id) => this.onBlockChange(x, y, z, old, id);
    for (const [k, v] of Object.entries(meta.tiles || {})) this.world.tile.set(k, v);
    this.time = meta.time ?? 0.05;
    this.player = new Player(this);
    this.ents = new EntityManager(this);
    this.dirtySave = new Set();
    if (meta.player) this.player.load(meta.player);
    else {
      const sp = this.world.gen.findSpawn();
      this.player.x = sp.x; this.player.y = sp.y; this.player.z = sp.z;
      this.player.spawn = [sp.x, sp.y, sp.z];
      if (this.mode === 'survival' && meta.starterKit) {
        // nothing: survival starts empty like a real adventure
      }
    }
    this.pendingMobs = meta.mobs || null;
    this.ready = false;
    this.running = true;
    this.lastFrame = performance.now();
    this.ui.attach(this);
    requestAnimationFrame((t) => this.frame(t));
  }

  stop() {
    this.running = false;
    for (const c of this.world.chunks.values()) this.disposeChunkMesh(c);
    this.ents.clear();
  }

  async save() {
    if (!this.world) return;
    const entries = [];
    for (const c of this.world.chunks.values()) if (c.modified && c.unsaved !== false) { entries.push([c.cx + ',' + c.cz, c.blocks.slice()]); c.unsaved = false; }
    for (const k of this.dirtySave) { const d = this.world.saved.get(k); if (d && !this.world.chunks.has(k)) entries.push([k, d]); }
    this.dirtySave.clear();
    const tiles = {};
    for (const [k, v] of this.world.tile) tiles[k] = v;
    Object.assign(this.meta, {
      time: this.time, mode: this.mode, lastPlayed: Date.now(), player: this.player.serialize(), tiles, mobs: this.ents.serialize(),
    });
    try {
      await saveChunks(this.meta.id, entries);
      await saveWorldMeta(this.meta);
    } catch (e) { console.warn('save failed', e); }
  }

  // ------------- chunks -------------
  disposeChunkMesh(c) {
    if (c.mesh) {
      for (const m of c.mesh) { this.scene.remove(m); m.geometry.dispose(); }
      c.mesh = null;
    }
  }

  buildMesh(c) {
    if (c.lightDirty) this.world.computeLight(c);
    const r = buildChunkMesh(this.world, c);
    this.disposeChunkMesh(c);
    const meshes = [];
    for (const [data, mat] of [[r.solid, this.solidMat], [r.water, this.waterMat]]) {
      if (!data.count) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(data.pos, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(data.uv, 2));
      g.setAttribute('lt', new THREE.BufferAttribute(data.lt, 3));
      g.setIndex(new THREE.BufferAttribute(data.idx, 1));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      m.matrixAutoUpdate = false;
      if (mat === this.waterMat) m.renderOrder = 1;
      this.scene.add(m); meshes.push(m);
    }
    c.mesh = meshes;
    c.dirty = false;
  }

  updateChunks(budgetMs) {
    const w = this.world, p = this.player;
    const pcx = Math.floor(p.x / CS), pcz = Math.floor(p.z / CS);
    const R = this.settings.renderDist || 4;
    const t0 = performance.now();
    // unload far chunks
    for (const c of [...w.chunks.values()]) {
      if (Math.abs(c.cx - pcx) > R + 3 || Math.abs(c.cz - pcz) > R + 3) {
        if (c.modified) this.dirtySave.add(c.cx + ',' + c.cz);
        if (c.modified && c.unsaved !== false) c.unsaved = true;
        this.disposeChunkMesh(c); w.unloadChunk(c);
      }
    }
    // generate (spiral order)
    if (!this._order || this._orderR !== R) {
      this._orderR = R; this._order = [];
      for (let dz = -R - 1; dz <= R + 1; dz++) for (let dx = -R - 1; dx <= R + 1; dx++) this._order.push([dx, dz, dx * dx + dz * dz]);
      this._order.sort((a, b) => a[2] - b[2]);
    }
    let generated = 0;
    for (const [dx, dz] of this._order) {
      if (performance.now() - t0 > budgetMs && generated) break;
      const cx = pcx + dx, cz = pcz + dz;
      if (!w.getChunk(cx, cz)) { w.ensureChunk(cx, cz); generated++; }
    }
    // mesh
    let meshed = 0;
    for (const [dx, dz] of this._order) {
      if (Math.abs(dx) > R || Math.abs(dz) > R) continue;
      if (performance.now() - t0 > budgetMs && meshed) break;
      const c = w.getChunk(pcx + dx, pcz + dz);
      if (!c || !c.dirty) continue;
      if (!w.getChunk(c.cx + 1, c.cz) || !w.getChunk(c.cx - 1, c.cz) || !w.getChunk(c.cx, c.cz + 1) || !w.getChunk(c.cx, c.cz - 1)) continue;
      this.buildMesh(c); meshed++;
    }
    // visibility (distance cull)
    for (const c of w.chunks.values()) {
      if (!c.mesh) continue;
      const vis = Math.abs(c.cx - pcx) <= R && Math.abs(c.cz - pcz) <= R;
      for (const m of c.mesh) m.visible = vis;
    }
    if (!this.ready) {
      const c = w.getChunk(pcx, pcz);
      let ok = c && c.mesh;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = w.getChunk(pcx + dx, pcz + dz); ok = ok && n && n.mesh; }
      if (ok) {
        this.ready = true;
        // make sure player is not stuck inside terrain
        const pl = this.player;
        if (!this.meta.player) { pl.y = w.surfaceY(Math.floor(pl.x), Math.floor(pl.z)) + 1.01; }
        while (collides(w, pl.x - 0.3, pl.y, pl.z - 0.3, pl.x + 0.3, pl.y + 1.8, pl.z + 0.3) && pl.y < CH) pl.y += 1;
        if (this.pendingMobs) { this.ents.load(this.pendingMobs); this.pendingMobs = null; }
        this.ui.hideLoading();
      } else this.ui.loadingProgress(w.chunks.size / ((2 * R + 3) ** 2));
    }
  }

  // immediate remesh of chunks affected by an edit
  flushEdits() {
    for (const c of this.world.chunks.values()) if (c.lightDirty && c.mesh) this.world.computeLight(c);
    for (const c of this.world.chunks.values()) if (c.dirty && c.mesh) this.buildMesh(c);
  }

  onBlockChange(x, y, z, old, id) {
    const k = Math.floor(x / CS) + ',' + Math.floor(z / CS);
    const c = this.world.chunks.get(k);
    if (c) c.unsaved = true;
    this._edited = true;
    // fluids react to neighbour changes
    for (const [dx, dy, dz] of [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const b = this.world.getBlock(x + dx, y + dy, z + dz);
      if (b === B.water || b === B.lava) this.fluidQueue.push([x + dx, y + dy, z + dz]);
    }
    // gravity blocks
    const above = this.world.getBlock(x, y + 1, z);
    if (BLOCKS[above] && BLOCKS[above].gravity && !SOLID[id]) this._gravity = [x, y + 1, z];
    if (BLOCKS[id] && BLOCKS[id].gravity && !SOLID[this.world.getBlock(x, y - 1, z)]) this._gravity = [x, y, z];
    // plants lose support
    const up = this.world.getBlock(x, y + 1, z);
    if (!SOLID[id] && BLOCKS[up] && (BLOCKS[up].shape === 'cross' || BLOCKS[up].shape === 'torch' || up === B.cactus) && up !== B.ladder) {
      this._support = this._support || []; this._support.push([x, y + 1, z]);
    }
  }

  processGravityAndSupport() {
    let guard = 0;
    while (this._gravity && guard++ < 64) {
      const [x, y, z] = this._gravity; this._gravity = null;
      const id = this.world.getBlock(x, y, z);
      if (!BLOCKS[id].gravity) continue;
      let ty = y;
      while (ty > 0 && !SOLID[this.world.getBlock(x, ty - 1, z)] && this.world.getBlock(x, ty - 1, z) !== B.lava) ty--;
      if (ty !== y) {
        this.world.setBlock(x, y, z, 0);
        const below = this.world.getBlock(x, ty, z);
        if (below && BLOCKS[below].shape === 'cross') this.breakDrops(x, ty, z, below, null);
        this.world.setBlock(x, ty, z, id);
      }
    }
    if (this._support) {
      const list = this._support; this._support = null;
      for (const [x, y, z] of list) {
        const id = this.world.getBlock(x, y, z);
        if (id && (BLOCKS[id].shape === 'cross' || BLOCKS[id].shape === 'torch' || id === B.cactus)) {
          this.breakDrops(x, y, z, id, null);
          this.world.setBlock(x, y, z, 0);
        }
      }
    }
  }

  // ------------- fluids -------------
  updateFluids(dt) {
    this.fluidTimer += dt;
    if (this.fluidTimer < 0.25) return;
    this.fluidTimer = 0;
    const w = this.world;
    const q = this.fluidQueue; this.fluidQueue = [];
    const seen = new Set();
    let n = 0;
    for (const [x, y, z] of q) {
      const key = x + ',' + y + ',' + z;
      if (seen.has(key) || n++ > 300) { if (n > 300) this.fluidQueue.push([x, y, z]); continue; }
      seen.add(key);
      const id = w.getBlock(x, y, z);
      if (id !== B.water && id !== B.lava) continue;
      const isLava = id === B.lava;
      const maxSpread = isLava ? 3 : 7;
      const level = this.flow.get(key) || 0;
      // interaction lava/water
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]]) {
        const nb = w.getBlock(x + dx, y + dy, z + dz);
        if (!isLava && nb === B.lava) {
          const nk = (x + dx) + ',' + (y + dy) + ',' + (z + dz);
          w.setBlock(x + dx, y + dy, z + dz, this.flow.has(nk) ? B.cobblestone : B.obsidian);
          this.flow.delete(nk); sfx.splash();
        }
      }
      const below = w.getBlock(x, y - 1, z);
      if (y > 0 && (below === 0 || (BLOCKS[below].replaceable && below !== id && below !== B.water && below !== B.lava) || BLOCKS[below].shape === 'cross' && below !== B.ladder)) {
        if (below && below !== 0) this.breakDrops(x, y - 1, z, below, null);
        w.setBlock(x, y - 1, z, id);
        this.flow.set(x + ',' + (y - 1) + ',' + z, 1);
        this.fluidQueue.push([x, y - 1, z]);
        continue;
      }
      if (below === id) continue;
      if (level >= maxSpread) continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nb = w.getBlock(x + dx, y, z + dz);
        if (nb === 0 || (BLOCKS[nb].shape === 'cross' && nb !== B.ladder)) {
          if (nb) this.breakDrops(x + dx, y, z + dz, nb, null);
          w.setBlock(x + dx, y, z + dz, id);
          this.flow.set((x + dx) + ',' + y + ',' + (z + dz), level + 1);
          this.fluidQueue.push([x + dx, y, z + dz]);
        }
      }
    }
  }

  // ------------- random ticks (growth) -------------
  randomTicks() {
    const w = this.world, p = this.player;
    const pcx = Math.floor(p.x / CS), pcz = Math.floor(p.z / CS);
    for (let i = 0; i < 40; i++) {
      const cx = pcx + Math.floor(Math.random() * 7) - 3, cz = pcz + Math.floor(Math.random() * 7) - 3;
      const c = w.getChunk(cx, cz);
      if (!c || !c.mesh) continue;
      const x = cx * CS + Math.floor(Math.random() * CS), z = cz * CS + Math.floor(Math.random() * CS);
      const y = Math.floor(Math.random() * CH);
      const id = w.getBlock(x, y, z);
      if (!id) continue;
      const above = w.getBlock(x, y + 1, z);
      if (id === B.grass) {
        if (SOLID[above] && BLOCKS[above].opaque) w.setBlock(x, y, z, B.dirt);
        else {
          const tx = x + Math.floor(Math.random() * 3) - 1, ty = y + Math.floor(Math.random() * 3) - 1, tz = z + Math.floor(Math.random() * 3) - 1;
          if (w.getBlock(tx, ty, tz) === B.dirt && !BLOCKS[w.getBlock(tx, ty + 1, tz)].opaque && w.getLight(tx, ty + 1, tz)[0] > 8) w.setBlock(tx, ty, tz, B.grass);
        }
      } else if (id >= B.wheat_0 && id < B.wheat_3) {
        if (w.getBlock(x, y - 1, z) === B.farmland && Math.random() < 0.35) w.setBlock(x, y, z, id + 1);
      } else if (id === B.oak_sapling || id === B.birch_sapling || id === B.spruce_sapling) {
        if (Math.random() < 0.15) this.growTree(x, y, z, id);
      } else if ((id === B.sugar_cane || id === B.cactus) && above === 0) {
        let h = 1; while (w.getBlock(x, y - h, z) === id) h++;
        if (h < 3 && Math.random() < 0.3) w.setBlock(x, y + 1, z, id);
      }
    }
  }

  growTree(x, y, z, sap) {
    const w = this.world;
    const type = sap === B.birch_sapling ? 'birch' : sap === B.spruce_sapling ? 'spruce' : 'oak';
    const height = type === 'spruce' ? 6 + Math.floor(Math.random() * 3) : 4 + Math.floor(Math.random() * 3);
    for (let k = 1; k <= height; k++) if (SOLID[w.getBlock(x, y + k, z)]) return false;
    w.setBlock(x, y, z, 0);
    // reuse generator by writing into a temporary proxy
    const gen = w.gen;
    const fake = { blocks: { set: null } };
    const writes = [];
    const proxy = new Proxy({}, { set: (o, i, v) => { writes.push([+i, v]); return true; }, get: (o, i) => { const n = +i; const lx = n % CS, lz = Math.floor(n / CS) % CS, ly = Math.floor(n / (CS * CS)); return w.getBlock(x - 8 + lx, ly, z - 8 + lz); } });
    fake.blocks = proxy;
    gen.placeTree(fake, 8, y, 8, type, height, x ^ z, (a, b, c) => (b * CS + c) * CS + a);
    for (const [i, v] of writes) {
      const lx = i % CS, lz = Math.floor(i / CS) % CS, ly = Math.floor(i / (CS * CS));
      w.setBlock(x - 8 + lx, ly, z - 8 + lz, v);
    }
    return true;
  }

  // ------------- furnaces -------------
  updateFurnaces(dt) {
    for (const [k, t] of this.world.tile) {
      if (t.type !== 'furnace') continue;
      const [x, y, z] = k.split(',').map(Number);
      if (!this.world.isLoaded(x, z)) continue;
      const [inp, fuel, out] = t.slots;
      const result = inp ? SMELT.get(inp.id) : null;
      const canOut = result && (!out || (out.id === result && out.count < 64));
      if (t.burn > 0) t.burn -= dt;
      if (t.burn <= 0 && canOut && fuel && ITEMS[fuel.id].fuel) {
        t.burnMax = t.burn = ITEMS[fuel.id].fuel; // seconds
        if (fuel.id === I.lava_bucket) t.slots[1] = { id: I.bucket, count: 1, dmg: 0 };
        else { fuel.count--; if (!fuel.count) t.slots[1] = null; }
      }
      if (t.burn > 0 && canOut) {
        t.cook = (t.cook || 0) + dt;
        if (t.cook >= 10 / 1.0) {
          t.cook = 0;
          inp.count--; if (!inp.count) t.slots[0] = null;
          if (t.slots[2]) t.slots[2].count++; else t.slots[2] = { id: result, count: 1, dmg: 0 };
        }
      } else t.cook = Math.max(0, (t.cook || 0) - dt * 2);
      const lit = t.burn > 0;
      const cur = this.world.getBlock(x, y, z);
      if (lit && cur === B.furnace) this.world.setBlock(x, y, z, B.furnace_lit);
      else if (!lit && cur === B.furnace_lit) this.world.setBlock(x, y, z, B.furnace);
    }
  }

  // ------------- interaction -------------
  lookDir() {
    const p = this.player;
    const cp = Math.cos(p.pitch);
    return [-Math.sin(p.yaw) * cp, Math.sin(p.pitch), -Math.cos(p.yaw) * cp];
  }
  eyePos() { const p = this.player; return [p.x, p.y + (p.sneaking ? p.eye - 0.15 : p.eye), p.z]; }

  target(liquids = false) {
    const [ox, oy, oz] = this.eyePos(), [dx, dy, dz] = this.lookDir();
    const reach = this.mode === 'creative' ? 6 : 5;
    const hit = raycast(this.world, ox, oy, oz, dx, dy, dz, reach, (id) => liquids ? true : (id !== B.water && id !== B.lava));
    const mob = this.ents.pickMob(ox, oy, oz, dx, dy, dz, Math.min(reach - 1.5, hit ? hit.dist : 99), rayBox);
    return { hit, mob };
  }

  canHarvest(id, held) {
    const b = BLOCKS[id];
    if (b.level <= 0) return true;
    const d = held ? ITEMS[held.id] : null;
    return d && d.toolType === b.tool && d.toolLevel >= b.level;
  }

  breakTime(id, held) {
    const b = BLOCKS[id];
    if (b.hardness < 0) return Infinity;
    if (b.hardness === 0) return 0.05;
    const d = held ? ITEMS[held.id] : null;
    let speed = 1;
    if (d && d.toolType && (d.toolType === b.tool || (d.toolType === 'sword' && /leaves|cobweb/.test(b.key)) || (d.toolType === 'shears' && /leaves|wool/.test(b.key)))) speed = d.toolSpeed;
    let t = b.hardness * (this.canHarvest(id, held) ? 1.5 : 5) / speed;
    if (this.player.inWater && this.player.headInWater) t *= 5;
    if (!this.player.onGround && !this.player.flying) t *= 5;
    return t;
  }

  breakDrops(x, y, z, id, held) {
    const b = BLOCKS[id];
    if (this.mode === 'creative') return;
    if (!this.canHarvest(id, held)) return;
    let drops;
    if (held && ITEMS[held.id].toolType === 'shears' && /leaves/.test(b.key)) drops = [[b.key, 1]];
    else if (typeof b.drop === 'function') drops = b.drop(Math.random());
    else if (typeof b.drop === 'string') drops = [[b.drop, 1]];
    else drops = [[b.key, 1]];
    for (const [k, n] of drops) if (n > 0) this.ents.drop(x + 0.5, y + 0.3, z + 0.5, itemByKey(k), n);
    // container contents
    const t = this.world.tile.get(x + ',' + y + ',' + z);
    if (t && t.slots) for (const s of t.slots) if (s) this.ents.drop(x + 0.5, y + 0.5, z + 0.5, s.id, s.count, s.dmg);
  }

  damageHeld(n = 1) {
    if (this.mode === 'creative') return;
    const p = this.player, s = p.held();
    if (!s || !ITEMS[s.id].durability) return;
    s.dmg = (s.dmg || 0) + n;
    if (s.dmg >= ITEMS[s.id].durability) { p.inv.slots[p.sel] = null; sfx.break('stone'); }
    this.ui.dirty = true;
  }

  breakBlock(x, y, z) {
    const id = this.world.getBlock(x, y, z);
    if (!id) return;
    const held = this.player.held();
    sfx.break(BLOCKS[id].key);
    this.ents.blockParticles(x, y, z, id);
    this.breakDrops(x, y, z, id, held);
    let newId = 0;
    // ice turns to water
    if (id === B.ice && this.mode === 'survival') newId = B.water;
    this.world.setBlock(x, y, z, newId);
    this.world.tile.delete(x + ',' + y + ',' + z);
    if (this.mode === 'survival') { this.damageHeld(1); this.player.exhaustion += 0.005; }
    this.processGravityAndSupport();
    this.flushEdits();
  }

  attack(mob) {
    if (this.attackCd > 0) return;
    const held = this.player.held();
    const d = held ? ITEMS[held.id] : null;
    let dmg = d && d.damage ? d.damage : 1;
    if (!this.player.onGround && this.player.vy < 0) dmg *= 1.5; // critical
    mob.hurt(dmg, { x: this.player.x, z: this.player.z, kind: 'player' });
    this.attackCd = 0.45;
    this.swing = 1;
    if (d && d.toolType) this.damageHeld(d.toolType === 'sword' ? 1 : 2);
    this.player.exhaustion += 0.1;
  }

  // primary action held (mine / attack)
  updateMining(dt, active) {
    const { hit, mob } = this.target();
    if (!active) { this.mining = null; this.crack.visible = false; return; }
    this.swing = Math.max(this.swing, 0.6);
    if (mob) { this.attack(mob); this.mining = null; this.crack.visible = false; return; }
    if (!hit) { this.mining = null; this.crack.visible = false; return; }
    const { x, y, z, id } = hit;
    if (this.mode === 'creative') {
      if (this.useCooldown <= 0) { this.breakBlock(x, y, z); this.useCooldown = 0.25; }
      return;
    }
    if (!this.mining || this.mining.x !== x || this.mining.y !== y || this.mining.z !== z || this.mining.id !== id) {
      this.mining = { x, y, z, id, progress: 0, total: this.breakTime(id, this.player.held()), sound: 0 };
    }
    const m = this.mining;
    if (this.useCooldown > 0) return;
    m.progress += dt;
    m.sound -= dt;
    if (m.sound <= 0) { m.sound = 0.25; sfx.dig(BLOCKS[id].key); }
    if (m.progress >= m.total) {
      this.breakBlock(x, y, z);
      this.mining = null; this.crack.visible = false;
      this.useCooldown = 0.15;
    } else if (isFinite(m.total)) {
      const stage = Math.min(9, Math.floor(m.progress / m.total * 10));
      if (stage !== this.crackStage) {
        this.crackStage = stage;
        const [u0, v0, u1, v1] = tileUV('crack_' + stage);
        const uv = this.crackGeo.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, i % 2 === 0 ? u0 : u1, (i % 4) < 2 ? v1 : v0);
        uv.needsUpdate = true;
      }
      this.crack.position.set(x + 0.5, y + 0.5, z + 0.5);
      this.crack.visible = true;
    }
  }

  // secondary action (place / use / eat)
  use() {
    if (this.useCooldown > 0) return;
    const p = this.player, w = this.world;
    const held = p.held();
    const hd = held ? ITEMS[held.id] : null;
    const { hit, mob } = this.target(hd && (hd.key === 'bucket'));
    this.useCooldown = 0.22;
    // interact with mobs
    if (mob && held) {
      if (hd.key === 'shears' && mob.type === 'sheep' && !mob.sheared) {
        mob.sheared = true; this.ents.drop(mob.x, mob.y + 1, mob.z, B.white_wool, 1 + Math.floor(Math.random() * 3)); this.damageHeld(1); this.swing = 1; return;
      }
      if (hd.key === 'bucket' && mob.type === 'cow') { /* milk not implemented */ }
    }
    // interact with blocks
    if (hit && !p.sneaking) {
      const id = hit.id, k = hit.x + ',' + hit.y + ',' + hit.z;
      if (id === B.crafting_table) { this.ui.openCrafting(); return; }
      if (id === B.furnace || id === B.furnace_lit) {
        if (!w.tile.has(k)) w.tile.set(k, { type: 'furnace', facing: 0, slots: [null, null, null], burn: 0, cook: 0 });
        this.ui.openFurnace(w.tile.get(k)); return;
      }
      if (id === B.chest) {
        if (!w.tile.has(k)) w.tile.set(k, { type: 'chest', facing: 0, slots: new Array(27).fill(null) });
        this.ui.openChest(w.tile.get(k)); return;
      }
      if (id === B.bed) {
        p.spawn = [hit.x + 0.5, hit.y + 1, hit.z + 0.5];
        const df = this.dayFactor();
        if (df < 0.4) { this.time = 0.0; this.ui.toast('Du hast geschlafen. Guten Morgen!'); }
        else this.ui.toast('Einstiegspunkt gesetzt. Schlafen geht nur nachts.');
        return;
      }
    }
    if (!held) return;
    // food
    if (hd.food !== undefined) {
      if (p.food < 20 || hd.heal || this.mode === 'creative') {
        if (this.eating <= 0) { this.eating = 1.2; this.eatingId = held.id; }
      }
      return;
    }
    if (hd.bow) {
      const hasArrow = this.mode === 'creative' || p.inv.count(I.arrow) > 0;
      if (!hasArrow) return;
      if (this.mode === 'survival') p.inv.remove(I.arrow, 1);
      const [ox, oy, oz] = this.eyePos(), [dx, dy, dz] = this.lookDir();
      this.ents.arrow(ox + dx * 0.5, oy + dy * 0.5, oz + dz * 0.5, dx * 30, dy * 30, dz * 30, 'player', 6);
      sfx.bow(); this.damageHeld(1); this.useCooldown = 0.6; this.ui.dirty = true; this.swing = 1;
      return;
    }
    if (!hit) return;
    const { x, y, z, face, id } = hit;
    // tools used on blocks
    if (hd.toolType === 'hoe' && (id === B.grass || id === B.dirt) && !w.getBlock(x, y + 1, z)) {
      w.setBlock(x, y, z, B.farmland); sfx.step('dirt'); this.damageHeld(1); this.swing = 1; this.flushEdits(); return;
    }
    if (hd.toolType === 'shovel' && id === B.grass && !w.getBlock(x, y + 1, z)) { /* path not implemented */ }
    if (hd.fertilizer) {
      let used = false;
      if (id >= B.wheat_0 && id < B.wheat_3) { w.setBlock(x, y, z, Math.min(B.wheat_3, id + 1 + Math.floor(Math.random() * 2))); used = true; }
      else if (id === B.oak_sapling || id === B.birch_sapling || id === B.spruce_sapling) { if (Math.random() < 0.45) this.growTree(x, y, z, id); used = true; }
      else if (id === B.grass) {
        for (let i = 0; i < 12; i++) {
          const tx = x + Math.floor(Math.random() * 7) - 3, tz = z + Math.floor(Math.random() * 7) - 3;
          if (w.getBlock(tx, y, tz) === B.grass && !w.getBlock(tx, y + 1, tz)) w.setBlock(tx, y + 1, tz, Math.random() < 0.8 ? B.tall_grass : [B.poppy, B.dandelion, B.blue_flower][Math.floor(Math.random() * 3)]);
        }
        used = true;
      }
      if (used) { this.consumeHeld(); this.ents.poof(x + 0.5, y + 1, z + 0.5); this.flushEdits(); }
      return;
    }
    if (hd.key === 'bucket') {
      if ((id === B.water || id === B.lava) && !this.flow.has(x + ',' + y + ',' + z)) {
        w.setBlock(x, y, z, 0);
        this.replaceHeld(id === B.water ? I.water_bucket : I.lava_bucket);
        sfx.splash(); this.flushEdits();
      }
      return;
    }
    // placement
    let placeId = null;
    if (hd.isBlock) placeId = held.id;
    else if (hd.places) placeId = itemByKey(hd.places);
    if (placeId === null) return;
    let px = x, py = y, pz = z;
    if (!BLOCKS[id].replaceable || id === B.water || id === B.lava) { px += face[0]; py += face[1]; pz += face[2]; }
    if (py < 0 || py >= CH) return;
    const cur = w.getBlock(px, py, pz);
    if (cur && !BLOCKS[cur].replaceable) return;
    const pb = BLOCKS[placeId];
    const below = w.getBlock(px, py - 1, pz);
    // placement rules
    if (pb.shape === 'cross' && placeId !== B.ladder) {
      if (placeId >= B.wheat_0 && placeId <= B.wheat_3) { if (below !== B.farmland) return; }
      else if (placeId === B.sugar_cane) { if (![B.grass, B.dirt, B.sand, B.sugar_cane].includes(below)) return; }
      else if (placeId === B.dead_bush) { if (![B.sand, B.dirt, B.grass].includes(below)) return; }
      else if (placeId === B.red_mushroom || placeId === B.brown_mushroom) { if (!SOLID[below]) return; }
      else if (![B.grass, B.dirt, B.farmland, B.snowy_grass].includes(below)) return;
    }
    if (placeId === B.cactus && below !== B.sand && below !== B.cactus) return;
    if (pb.shape === 'torch' && !SOLID[below] && !hd.places) {
      // need any solid neighbour
      if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => SOLID[w.getBlock(px + dx, py, pz + dz)])) return;
    }
    if (pb.solid) {
      const pl = this.player;
      if (px + 1 > pl.x - 0.3 && px < pl.x + 0.3 && pz + 1 > pl.z - 0.3 && pz < pl.z + 0.3 && py + 1 > pl.y && py < pl.y + 1.8) return;
      for (const m of this.ents.mobs) { const hw = m.w / 2; if (px + 1 > m.x - hw && px < m.x + hw && pz + 1 > m.z - hw && pz < m.z + hw && py + 1 > m.y && py < m.y + m.h) return; }
    }
    if (cur && cur !== B.water && cur !== B.lava) this.breakDrops(px, py, pz, cur, null);
    w.setBlock(px, py, pz, placeId);
    if (pb.tex.front) {
      // face towards player
      const a = Math.atan2(this.player.x - (px + 0.5), this.player.z - (pz + 0.5));
      const facing = ((Math.round(a / (Math.PI / 2)) % 4) + 4) % 4; // 0:+z,1:+x,2:-z,3:-x
      const kk = px + ',' + py + ',' + pz;
      const t = w.tile.get(kk) || (placeId === B.chest ? { type: 'chest', slots: new Array(27).fill(null) } : placeId === B.furnace ? { type: 'furnace', slots: [null, null, null], burn: 0, cook: 0 } : { type: 'deco' });
      t.facing = facing; w.tile.set(kk, t);
      const c = w.getChunk(Math.floor(px / CS), Math.floor(pz / CS)); if (c) c.dirty = true;
    }
    if (placeId === B.water || placeId === B.lava) { this.fluidQueue.push([px, py, pz]); this.flow.delete(px + ',' + py + ',' + pz); }
    sfx.place(pb.key);
    this.swing = 1;
    if (this.mode === 'survival') {
      if (hd.leaves) this.replaceHeld(itemByKey(hd.leaves));
      else this.consumeHeld();
    }
    this.processGravityAndSupport();
    this.flushEdits();
  }

  consumeHeld() {
    if (this.mode === 'creative') return;
    const p = this.player, s = p.held();
    if (!s) return;
    s.count--; if (s.count <= 0) p.inv.slots[p.sel] = null;
    this.ui.dirty = true;
  }
  replaceHeld(id) {
    if (this.mode === 'creative') return;
    const p = this.player, s = p.held();
    if (s && s.count > 1) { s.count--; if (p.inv.add(id, 1)) this.ents.drop(p.x, p.y + 1, p.z, id, 1); }
    else p.inv.slots[p.sel] = { id, count: 1, dmg: 0 };
    this.ui.dirty = true;
  }

  dropHeld(all = false) {
    const p = this.player, s = p.held();
    if (!s) return;
    const n = all ? s.count : 1;
    const [dx, , dz] = this.lookDir();
    const e = { x: p.x + dx * 0.6, y: p.y + 1.3, z: p.z + dz * 0.6 };
    this.ents.drop(e.x, e.y, e.z, s.id, n, s.dmg);
    const it = this.ents.items[this.ents.items.length - 1];
    it.vx = dx * 5; it.vz = dz * 5; it.vy = 3; it.pickupDelay = 1.5;
    s.count -= n; if (s.count <= 0) p.inv.slots[p.sel] = null;
    this.ui.dirty = true;
  }

  onDeath() {
    const p = this.player;
    p.dead = true;
    // drop everything
    if (!this.settings.keepInventory) {
      for (const inv of [p.inv, p.armor]) inv.slots.forEach((s, i) => { if (s) { this.ents.drop(p.x, p.y + 1, p.z, s.id, s.count, s.dmg); inv.slots[i] = null; } });
    }
    this.ui.showDeath();
  }

  respawn() {
    const p = this.player;
    const sp = p.spawn || [0.5, 80, 0.5];
    p.x = sp[0]; p.y = sp[1]; p.z = sp[2];
    p.vx = p.vy = p.vz = 0; p.hp = 20; p.food = 20; p.sat = 5; p.air = 10; p.dead = false; p.fallStart = null;
    this.ready = false;
    this.meta.player = null; // trigger spawn surface search
    this.ui.showLoading();
    this.ui.dirty = true;
  }

  // ------------- hand -------------
  updateHand(dt) {
    const p = this.player;
    const held = p.held();
    const id = held ? held.id : 0;
    if (id !== this.handHeldId) {
      this.handHeldId = id;
      if (this.handItem) this.hand.remove(this.handItem);
      if (id) {
        this.handItem = new THREE.Mesh(itemGeometry(id), this.itemMaterial);
        const d = ITEMS[id];
        const isCube = d.isBlock && BLOCKS[id].shape !== 'cross' && BLOCKS[id].shape !== 'torch';
        if (isCube) { this.handItem.scale.setScalar(0.4); this.handItem.rotation.set(0, Math.PI / 4, 0); this.handItem.position.set(0, 0, 0); }
        else { this.handItem.scale.setScalar(0.6); this.handItem.rotation.set(0, -Math.PI / 2.3, Math.PI / 8); this.handItem.position.set(0, 0.1, 0); }
      } else {
        this.handItem = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.75), new THREE.MeshLambertMaterial({ color: 0xc8956b }));
        this.handItem.position.set(0.05, -0.05, 0.1); this.handItem.rotation.set(0.2, 0.1, 0);
      }
      this.hand.add(this.handItem);
    }
    this.swing = Math.max(0, this.swing - dt * 3.5);
    const s = Math.sin((1 - this.swing) * Math.PI) * (this.swing > 0 ? 1 : 0);
    const bob = this.settings.viewBob !== false ? p.bob : 0;
    const eatShake = this.eating > 0 ? Math.sin(performance.now() / 50) * 0.03 : 0;
    this.hand.position.set(0.55 - s * 0.25 + Math.sin(bob) * 0.02, -0.5 + s * 0.15 + Math.abs(Math.cos(bob)) * 0.02 + eatShake + (this.eating > 0 ? 0.15 : 0), -0.85 - s * 0.2);
    this.hand.rotation.set(-s * 0.9, s * 0.5 + (this.eating > 0 ? 0.6 : 0), 0);
    const [sky, bl] = this.world.getLight(Math.floor(p.x), Math.floor(p.y + 1.5), Math.floor(p.z));
    const lv = Math.max(sky / 15 * this.dayFactor(), bl / 15);
    this.handLight.intensity = Math.pow(0.82, 15 * (1 - lv)) * 1.0 + 0.1;
  }

  // ------------- main loop -------------
  frame(now) {
    if (!this.running) return;
    requestAnimationFrame((t) => this.frame(t));
    let dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc > 1) { this.fps = Math.round(this.fpsN / this.fpsAcc); this.fpsAcc = 0; this.fpsN = 0; }
    const input = this.ui.input;
    input.poll();
    this.updateChunks(this.ready ? 6 : 30);
    const active = this.ready && !this.paused;
    const p = this.player;
    if (active) {
      // look
      p.yaw -= input.lookDX; p.pitch -= input.lookDY;
      p.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, p.pitch));
      input.lookDX = input.lookDY = 0;
      if (input.consumeFlyToggle() && this.mode === 'creative') { p.flying = !p.flying; p.vy = 0; }
      if (!p.dead && !this.ui.screenOpen) p.update(dt, input);
      this.useCooldown -= dt; this.attackCd -= dt;
      if (!p.dead && !this.ui.screenOpen) {
        this.updateMining(dt, input.primary);
        if (input.consumeUse() || (input.secondary && this.useCooldown <= 0 && this.mode === 'creative')) this.use();
        if (input.consumeTap()) { const { mob } = this.target(); if (mob) this.attack(mob); else { this.useCooldown = 0; this.use(); } this.swing = Math.max(this.swing, 0.5); }
      } else { this.mining = null; this.crack.visible = false; }
      // eating
      if (this.eating > 0) {
        this.eating -= dt;
        const s = p.held();
        if (!s || s.id !== this.eatingId) this.eating = 0;
        else if (this.eating <= 0) { const d = ITEMS[s.id]; p.eat(d); if (d.poison && Math.random() < 0.8) p.exhaustion += 10; this.consumeHeld(); }
      }
      this.time = (this.time + dt / (this.settings.dayLength || 1200)) % 1;
      this.ents.update(dt);
      this.updateFluids(dt);
      this.tickTimer += dt;
      if (this.tickTimer > 0.1) { this.tickTimer = 0; this.randomTicks(); this.updateFurnaces(0.1); this.ui.tickContainers(); }
      if (this._edited) { this._edited = false; this.processGravityAndSupport(); this.flushEdits(); }
      this.saveTimer += dt;
      if (this.saveTimer > 30) { this.saveTimer = 0; this.save(); }
    }
    // camera
    const eye = this.eyePos();
    let bobY = 0, bobX = 0;
    if (this.settings.viewBob !== false && p.onGround) { bobY = Math.abs(Math.cos(p.bob)) * 0.06; bobX = Math.sin(p.bob) * 0.03; }
    this.camera.position.set(eye[0] + Math.cos(p.yaw) * bobX, eye[1] + bobY, eye[2] - Math.sin(p.yaw) * bobX);
    this.camera.rotation.set(p.pitch, p.yaw, p.hurtTime > 0 ? Math.sin(p.hurtTime * 20) * 0.04 : 0);
    const fovT = (this.settings.fov || 75) + (p.sprinting ? 8 : 0);
    if (Math.abs(this.camera.fov - fovT) > 0.1) { this.camera.fov += (fovT - this.camera.fov) * Math.min(1, dt * 8); this.camera.updateProjectionMatrix(); }
    // sky & fog
    const skyCol = this.sky.update(this.camera.position, this.time, dt, this.settings);
    const day = this.dayFactor();
    let fogCol = skyCol.clone(), near = (this.settings.renderDist || 4) * CS * 0.6, far = (this.settings.renderDist || 4) * CS * 0.95;
    if (p.headInWater) { fogCol = new THREE.Color(0x1a3a8a).multiplyScalar(0.3 + day * 0.7); near = 1; far = 18; }
    if (p.headInLava) { fogCol = new THREE.Color(0xd04010); near = 0; far = 2; }
    // darker fog underground
    if (p.y < SEA - 10) { const [sky] = this.world.getLight(Math.floor(p.x), Math.floor(p.y + 1.6), Math.floor(p.z)); if (sky < 4) fogCol.multiplyScalar(0.25); }
    this.renderer.setClearColor(fogCol);
    for (const m of [this.solidMat, this.waterMat]) {
      m.uniforms.uDay.value = day; m.uniforms.uFog.value.copy(fogCol); m.uniforms.uFogNear.value = near; m.uniforms.uFogFar.value = far;
    }
    this.scene.fog = null;
    this.amb.intensity = 0.3 + day * 0.5; this.dir.intensity = 0.2 + day * 0.4;
    // selection
    if (this.ready && !p.dead) {
      const { hit } = this.target();
      if (hit && this.settings.outline !== false) {
        this.selBox.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5); this.selBox.visible = true;
      } else this.selBox.visible = false;
    }
    this.updateHand(dt);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    if (this.settings.showHand !== false && !p.dead) {
      this.renderer.clearDepth();
      this.renderer.render(this.handScene, this.handCam);
    }
    this.ui.frame(dt);
  }
}
