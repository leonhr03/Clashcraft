// Block-Arena: a 3D real-time card battle (two lanes, towers, energy) using Blockwelt's own mobs and block textures.
import * as THREE from 'three';
import { buildAtlas, tileUV } from './textures.js';
import { createMobModel, animateMob, MOB_DEFS } from './models.js';
import { CARDS, CARD_KEYS } from './cards.js';
import { sfx } from './audio.js';
import { PostFX } from './postfx.js';
import { levelMul, towerMul } from './profile.js';

const SUN_DIR = new THREE.Vector3(-0.6, 0.72, 0.38).normalize();

const SKY_VERT = `
varying vec3 vDir;
void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`;
const SKY_FRAG = `
uniform vec3 uSun, uHorizon, uZenith;
uniform float uStars;
varying vec3 vDir;
float h21(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
void main(){
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  vec3 col = mix(uHorizon, uZenith, pow(h, 0.45));
  if (uStars > 0.0) { vec3 q = floor(d * 160.0); float st = step(0.9965, h21(q)); col += vec3(1.6, 1.4, 2.0) * st * uStars * smoothstep(0.0, 0.3, h); }
  float s = max(dot(d, uSun), 0.0);
  col += vec3(1.0, 0.75, 0.45) * pow(s, 10.0) * 0.7;
  col += vec3(5.0, 4.2, 3.0) * smoothstep(0.9975, 0.9985, s);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;
const WATER_VERT = `
uniform float uTime;
varying vec3 vW;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  w.y += sin(w.x * 1.3 + uTime * 1.7) * 0.035 + cos(w.z * 2.1 + uTime * 1.3) * 0.025;
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const WATER_FRAG = `
uniform float uTime, uLava;
uniform vec3 uSun, uCam, uDeep, uShallow;
varying vec3 vW;
void main(){
  if (uLava > 0.5) {
    float f = sin(vW.x * 1.7 + uTime * 0.8) * sin(vW.z * 2.3 - uTime * 0.6) + sin(vW.x * 4.1 - uTime * 1.3 + vW.z * 1.5) * 0.5;
    vec3 lc = mix(vec3(1.6, 0.35, 0.05), vec3(3.2, 1.6, 0.3), smoothstep(-0.6, 1.2, f));
    lc = mix(lc, vec3(0.35, 0.08, 0.03), smoothstep(0.75, 1.0, abs(vW.z)) * 0.6);
    gl_FragColor = vec4(lc, 1.0);
    #include <colorspace_fragment>
    return;
  }
  vec3 n = normalize(vec3(
    sin(vW.x * 2.0 + uTime * 1.5) * 0.12 + sin(vW.x * 5.3 - uTime * 2.1 + vW.z * 3.0) * 0.06,
    1.0,
    cos(vW.z * 3.0 + uTime * 1.2) * 0.12 + cos(vW.x * 4.1 + uTime) * 0.05));
  vec3 v = normalize(uCam - vW);
  float fr = pow(1.0 - max(dot(n, v), 0.0), 3.0) * 0.75 + 0.15;
  vec3 col = mix(uDeep, uShallow, fr);
  vec3 hv = normalize(uSun + v);
  col += vec3(1.0, 0.85, 0.6) * pow(max(dot(n, hv), 0.0), 90.0) * 2.5;
  float edge = smoothstep(0.7, 1.0, abs(vW.z));
  col = mix(col, vec3(0.92, 0.96, 1.0), edge * 0.45 * (0.6 + 0.4 * sin(vW.x * 6.0 + uTime * 2.0)));
  gl_FragColor = vec4(col, 0.85);
  #include <colorspace_fragment>
}`;

// ---------- layout (1 unit = 1 block) ----------
const HALF_W = 9, HALF_L = 16;
const RIVER = 1;                 // river covers |z| < 1
const LANES = [-5.5, 5.5];       // bridges are 3 blocks wide around these x
const BRIDGE_HW = 1.5;
const MATCH_TIME = 180, OVERTIME = 60, DOUBLE_AT = 60;
const MAX_ENERGY = 10, ENERGY_RATE = 1 / 2.8;
const SPEED_MUL = 1.3;
const SIGHT = 5.5;
const TEAM_COL = [0x3d7bff, 0xff3d3d];
const MODEL_SCALE = 1.7; // mobs are drawn a bit larger than life so they read well from above

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const $ = (id) => document.getElementById(id);

// ---------- textured block geometry from the shared atlas ----------
class BlockBuilder {
  constructor() { this.pos = []; this.uv = []; this.col = []; this.idx = []; }
  face(o, a, b, tile, shade) {
    const [u0, v0, u1, v1] = tileUV(tile);
    const n = this.pos.length / 3;
    const p = [o, [o[0] + a[0], o[1] + a[1], o[2] + a[2]], [o[0] + a[0] + b[0], o[1] + a[1] + b[1], o[2] + a[2] + b[2]], [o[0] + b[0], o[1] + b[1], o[2] + b[2]]];
    for (const q of p) this.pos.push(q[0], q[1], q[2]);
    this.uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    for (let i = 0; i < 4; i++) this.col.push(shade, shade, shade);
    this.idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
  }
  // axis aligned box; t = {top, side, bottom, front} tile names; skip = set of faces to omit
  box(x0, y0, z0, x1, y1, z1, t, skip = '') {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const side = t.side || t.all, top = t.top || t.all || side, bottom = t.bottom || t.all || side;
    if (!skip.includes('t')) this.face([x0, y1, z1], [dx, 0, 0], [0, 0, -dz], top, 1);
    if (!skip.includes('b')) this.face([x0, y0, z0], [dx, 0, 0], [0, 0, dz], bottom, 0.5);
    if (!skip.includes('e')) this.face([x1, y0, z1], [0, 0, -dz], [0, dy, 0], side, 0.78);
    if (!skip.includes('w')) this.face([x0, y0, z0], [0, 0, dz], [0, dy, 0], side, 0.78);
    if (!skip.includes('s')) this.face([x0, y0, z1], [dx, 0, 0], [0, dy, 0], t.front || side, 0.9);
    if (!skip.includes('n')) this.face([x1, y0, z0], [-dx, 0, 0], [0, dy, 0], side, 0.62);
  }
  block(x, y, z, t, skip) { this.box(x, y, z, x + 1, y + 1, z + 1, t, skip); }
  mesh(mat) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals(); // faces don't share vertices, so these are flat face normals
    return new THREE.Mesh(g, mat);
  }
}

const THEMES = {
  meadow: {
    ground: { top: 'grass_top', side: 'grass_side', bottom: 'dirt' }, path: { top: 'dirt_path_top', side: 'dirt_path_side', bottom: 'dirt' },
    wall: [{ all: 'stone_bricks' }, { all: 'mossy_stone_bricks' }], bank: 'dirt', bed: { all: 'sand' }, bridge: { all: 'oak_planks' }, rail: { top: 'oak_log_top', side: 'oak_log' },
    decor: 'trees', liquid: 0, deep: [0.03, 0.2, 0.38], shallow: [0.62, 0.8, 1.0], horizon: [1.0, 0.78, 0.55], zenith: [0.28, 0.5, 0.92], stars: 0,
    fog: 0xf0c898, hemi: [0xbcd8ff, 0x6a7a3a, 0.95], sun: [0xffdcae, 2.1], motes: [2.2, 1.9, 0.9], clear: 0x86bdf8,
  },
  desert: {
    ground: { top: 'sand', side: 'sandstone', bottom: 'sandstone' }, path: { top: 'sandstone_top', side: 'sandstone', bottom: 'sandstone' },
    wall: [{ top: 'sandstone_top', side: 'sandstone' }, { top: 'sandstone_top', side: 'chiseled_sandstone' }], bank: 'sandstone', bed: { all: 'sand' }, bridge: { all: 'birch_planks' }, rail: { top: 'birch_log_top', side: 'birch_log' },
    decor: 'cactus', liquid: 0, deep: [0.02, 0.28, 0.4], shallow: [0.5, 0.88, 0.95], horizon: [1.0, 0.82, 0.55], zenith: [0.35, 0.6, 0.95], stars: 0,
    fog: 0xf6d8a4, hemi: [0xd8e6ff, 0xc8a860, 1.0], sun: [0xfff0c8, 2.3], motes: [2.4, 2.0, 1.2], clear: 0xa8d0f8,
  },
  nether: {
    ground: { all: 'glutgestein' }, path: { all: 'aschesand' }, wall: [{ all: 'glutziegel' }, { all: 'glutziegel' }], bank: 'glutgestein', bed: { all: 'glutgestein' },
    bridge: { all: 'glutziegel' }, rail: { all: 'glutzaun' },
    decor: 'nether', liquid: 1, deep: [0, 0, 0], shallow: [0, 0, 0], horizon: [0.75, 0.22, 0.1], zenith: [0.22, 0.04, 0.03], stars: 0,
    fog: 0x5a1a10, hemi: [0xff9a70, 0x401010, 0.9], sun: [0xffb080, 1.4], motes: [3.0, 1.2, 0.3], clear: 0x3a0c06,
  },
  void: {
    ground: { all: 'leerenstein' }, path: { all: 'leerenstein_ziegel' }, wall: [{ all: 'sternenziegel' }, { top: 'sternensaeule_top', side: 'sternensaeule' }], bank: 'leerenstein', bed: { all: 'obsidian' },
    bridge: { all: 'sternenziegel' }, rail: { all: 'obsidian' },
    decor: 'void', liquid: 0, deep: [0.04, 0.0, 0.1], shallow: [0.45, 0.2, 0.75], horizon: [0.25, 0.12, 0.38], zenith: [0.03, 0.01, 0.08], stars: 1,
    fog: 0x1a1030, hemi: [0xc8b0ff, 0x302040, 0.85], sun: [0xe8d8ff, 1.5], motes: [1.6, 0.8, 3.0], clear: 0x120a1c,
  },
};

const TILES = {
  grass: { top: 'grass_top', side: 'grass_side', bottom: 'dirt' },
  path: { top: 'dirt_path_top', side: 'dirt_path_side', bottom: 'dirt' },
  dirt: { all: 'dirt' }, sand: { all: 'sand' }, stone: { all: 'stone' },
  bricks: { all: 'stone_bricks' }, mossy: { all: 'mossy_stone_bricks' }, cracked: { all: 'cracked_stone_bricks' },
  cobble: { all: 'cobblestone' }, planks: { all: 'oak_planks' }, spruce: { all: 'spruce_planks' },
  oak: { top: 'oak_log_top', side: 'oak_log' }, birch: { top: 'birch_log_top', side: 'birch_log' },
  oakLeaves: { all: 'oak_leaves' }, birchLeaves: { all: 'birch_leaves' },
  gold: { all: 'gold_block' }, smooth: { all: 'smooth_stone' }, water: { all: 'water' },
  pumpkin: { top: 'pumpkin_top', side: 'pumpkin_side' }, hay: { top: 'hay_top', side: 'hay_side' },
  wool: [{ all: 'blue_wool' }, { all: 'red_wool' }],
};

// ---------- painted textures for the powder keg ----------
function kegCanvas() {
  const c = document.createElement('canvas'); c.width = 32; c.height = 32;
  const g = c.getContext('2d');
  for (let x = 0; x < 32; x += 4) { g.fillStyle = x % 8 ? '#6b4423' : '#5a381c'; g.fillRect(x, 0, 4, 32); g.fillStyle = '#3e2512'; g.fillRect(x, 0, 1, 32); }
  for (const y of [4, 25]) { g.fillStyle = '#5c5c62'; g.fillRect(0, y, 32, 3); g.fillStyle = '#8a8a92'; g.fillRect(0, y, 32, 1); }
  g.fillStyle = '#c0281e'; g.fillRect(9, 10, 14, 12); g.fillStyle = '#f0e0c0'; g.fillRect(15, 12, 2, 5); g.fillRect(15, 18, 2, 2);
  return c;
}

// ---------- card portraits (rendered once from the 3D models) ----------
let portraits = null;
export function getPortraits() {
  if (portraits) return portraits;
  portraits = {};
  buildAtlas();
  let r = null;
  try { r = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true }); } catch (e) { r = null; }
  if (r) {
    r.setSize(150, 180, false);
    r.setPixelRatio(1);
    r.setClearColor(0x000000, 0);
    r.outputColorSpace = THREE.SRGBColorSpace;
    for (const k of CARD_KEYS) {
      const def = CARDS[k];
      if (!def.mob) continue;
      const scene = new THREE.Scene();
      scene.add(new THREE.AmbientLight(0xffffff, 0.85));
      const dl = new THREE.DirectionalLight(0xffffff, 0.9); dl.position.set(1, 2, 2); scene.add(dl);
      const m = createMobModel(def.mob);
      m.root.rotation.y = 0.55;
      animateMob(m, 0.3, 0, 0, 0);
      scene.add(m.root);
      const box = new THREE.Box3().setFromObject(m.root);
      const ctr = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
      const cam = new THREE.PerspectiveCamera(28, 150 / 180, 0.01, 100);
      const dist = Math.max(size.y * 1.15, size.x * 1.25, size.z) / (2 * Math.tan((28 * Math.PI) / 360)) + size.z * 0.5;
      cam.position.set(ctr.x, ctr.y + size.y * 0.18, ctr.z + dist);
      cam.lookAt(ctr);
      r.render(scene, cam);
      portraits[k] = r.domElement.toDataURL();
    }
    r.dispose(); try { r.forceContextLoss(); } catch (e) { /* ignore */ }
  }
  // spells: 2D pixel art
  const atlas = buildAtlas();
  const draw = (fn) => { const c = document.createElement('canvas'); c.width = 150; c.height = 180; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; fn(g); return c.toDataURL(); };
  portraits.powder = draw((g) => { g.drawImage(kegCanvas(), 0, 0, 32, 32, 30, 40, 90, 100); g.fillStyle = '#222'; g.fillRect(72, 22, 6, 20); g.fillStyle = '#ffb030'; g.fillRect(70, 14, 10, 10); g.fillStyle = '#fff3a0'; g.fillRect(73, 17, 4, 4); });
  portraits.arrows = draw((g) => {
    const uv = tileUV('item_arrow');
    const sx = uv[0] * atlas.width, sy = (1 - uv[3]) * atlas.height, sw = (uv[2] - uv[0]) * atlas.width, sh = (uv[3] - uv[1]) * atlas.height;
    for (const [x, y] of [[10, 20], [60, 10], [35, 70], [85, 60], [20, 115], [70, 110]]) {
      g.save(); g.translate(x + 30, y + 30); g.rotate(Math.PI / 2); g.drawImage(atlas, sx, sy, sw, sh, -30, -30, 60, 60); g.restore();
    }
  });
  for (const k of CARD_KEYS) if (!portraits[k]) portraits[k] = draw((g) => { g.fillStyle = '#666'; g.fillRect(40, 50, 70, 80); });
  return portraits;
}

// ---------- the match ----------
export class Arena {
  constructor(container, opts) {
    this.container = container;
    this.deck = opts.deck;
    this.difficulty = opts.difficulty || 1;
    this.onEnd = opts.onEnd;
    this.preview = !!opts.preview;
    this.theme = THEMES[opts.theme] || THEMES.meadow;
    // card / king tower levels per team: [{cards:{key:lvl}, king}, {card:lvl, king}]
    this.levels = opts.levels || [{ cards: {}, king: 1 }, { card: 1, king: 1 }];
    this.aiDeck = opts.aiDeck || null;
    this.portraits = getPortraits();
    const st = opts.settings || {};
    this.fx = st.shaders !== false && !st.compat;          // shadows, sky, water shader
    this.wantPost = this.fx && st.postfx !== false;         // bloom, sun rays, filmic look

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    if (this.fx) { this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap; }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(this.theme.clear);
    container.appendChild(this.renderer.domElement);
    this.canvas = this.renderer.domElement;

    this.scene = new THREE.Scene();
    const TH = this.theme;
    this.scene.fog = new THREE.Fog(this.fx ? TH.fog : TH.clear, 60, 120);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 300);
    if (this.fx) {
      this.scene.add(new THREE.HemisphereLight(TH.hemi[0], TH.hemi[1], TH.hemi[2]));
      const sun = new THREE.DirectionalLight(TH.sun[0], TH.sun[1]);
      sun.position.copy(SUN_DIR).multiplyScalar(60);
      sun.castShadow = true;
      const sc = sun.shadow.camera;
      sc.left = -28; sc.right = 28; sc.top = 32; sc.bottom = -32; sc.near = 1; sc.far = 140;
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
      this.scene.add(sun); this.scene.add(sun.target);
      // gradient sky dome with sun
      this.sky = new THREE.Mesh(new THREE.SphereGeometry(200, 24, 12), new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: { uSun: { value: SUN_DIR }, uHorizon: { value: new THREE.Vector3(...TH.horizon) }, uZenith: { value: new THREE.Vector3(...TH.zenith) }, uStars: { value: TH.stars } }, side: THREE.BackSide, depthWrite: false, fog: false }));
      this.sky.frustumCulled = false; this.sky.renderOrder = -1;
      this.scene.add(this.sky);
    } else {
      this.scene.add(new THREE.AmbientLight(0xffffff, 0.8));
      const dl = new THREE.DirectionalLight(0xffffff, 0.75); dl.position.set(0.5, 1, 0.7); this.scene.add(dl);
    }
    this.post = null;
    if (this.wantPost) { try { this.post = new PostFX(this.renderer); } catch (e) { this.post = null; } }

    const atlas = buildAtlas();
    this.atlasTex = new THREE.CanvasTexture(atlas);
    this.atlasTex.magFilter = THREE.NearestFilter;
    this.atlasTex.minFilter = THREE.NearestMipmapLinearFilter;
    this.atlasTex.colorSpace = THREE.SRGBColorSpace;
    this.blockMat = this.fx ? new THREE.MeshLambertMaterial({ map: this.atlasTex, vertexColors: true, alphaTest: 0.5 }) : new THREE.MeshBasicMaterial({ map: this.atlasTex, vertexColors: true, alphaTest: 0.5 });
    this.waterMat = this.fx
      ? new THREE.ShaderMaterial({ vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, uniforms: { uTime: { value: 0 }, uSun: { value: SUN_DIR }, uCam: { value: new THREE.Vector3() }, uLava: { value: TH.liquid }, uDeep: { value: new THREE.Vector3(...TH.deep) }, uShallow: { value: new THREE.Vector3(...TH.shallow) } }, transparent: !TH.liquid, depthWrite: !!TH.liquid })
      : new THREE.MeshBasicMaterial({ map: this.atlasTex, vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false });
    this.glowMats = new Map();
    this.particleGeo = new THREE.BoxGeometry(1, 1, 1);
    this.particleMats = new Map();

    this.buildWorld();

    this.ents = [];
    this.bars = this.preview ? document.createElement('div') : $('ar-bars');
    if (!this.preview) this.bars.innerHTML = '';
    this.projectiles = [];
    this.particles = [];
    this.effects = [];
    this.time = MATCH_TIME;
    this.overtime = false;
    this.over = false;
    this.clock = 0;
    this.shake = 0;
    this.crowns = [0, 0];
    this.energy = [5, 5];
    this.doubleAnnounced = false;

    // towers
    for (const team of [0, 1]) {
      const s = team === 0 ? 1 : -1;
      this.addTower(team, false, LANES[0], s * 10.5);
      this.addTower(team, false, LANES[1], s * 10.5);
      this.addTower(team, true, 0, s * 14);
    }

    if (this.preview) { this.startPreview(); return; }

    // hands
    const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const aiDeck = this.aiDeck || this.makeAiDeck(shuffle);
    this.hands = [this.makeHand(shuffle(this.deck)), this.makeHand(shuffle(aiDeck))];
    this.ai = { think: 1.5 };

    this.sel = -1; this.drag = null; this.pointer = null;
    this.ghost = null; this.ghostKey = null;
    this.ray = new THREE.Raycaster();
    this.rect = { x: 0, y: 0, w: 1, h: 1 };

    this.setupUI();
    this.resize();
    this._resize = () => this.resize();
    window.addEventListener('resize', this._resize);
    this.last = performance.now();
    this.running = true;
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
    this.countdown = 3.6;
    this.showCount('3');
  }

  showCount(t) {
    const el = $('ar-count');
    if (!el) return;
    el.textContent = t;
    el.classList.remove('hidden', 'go');
    if (t === 'LOS!') el.classList.add('go');
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    if (!t) el.classList.add('hidden');
  }

  // ---------- home-screen preview: slow camera orbit with wandering mobs ----------
  startPreview() {
    this.hands = null;
    this.over = true;
    const keys = ['zombie', 'skeleton', 'spider', 'pig', 'chicken', 'sheep', 'cow', 'villager', 'ash_zombie', 'shadow_lord'];
    for (let i = 0; i < 9; i++) {
      const team = i % 2, k = keys[Math.floor(Math.random() * keys.length)];
      const u = this.spawnUnit(team, k, (Math.random() * 2 - 1) * 7, (team ? -1 : 1) * (3 + Math.random() * 9));
      u.deploy = 0; u.y = u.air ? (u.card.airHeight || 1.4) : 0; u.wait = Math.random() * 2;
    }
    this.rect = { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
    this._resize = () => this.resize();
    window.addEventListener('resize', this._resize);
    this.resize();
    this.last = performance.now();
    this.running = true;
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  updatePreview(dt) {
    for (const u of this.ents) {
      if (u.kind === 'tower') { animateMob(u.guard, this.clock, 0, Math.sin(this.clock * 0.7 + u.x) * 0.5, 0); continue; }
      u.t += dt; u.walk = 0;
      if (u.wait > 0) { u.wait -= dt; continue; }
      if (!u.goal || Math.hypot(u.goal[0] - u.x, u.goal[1] - u.z) < 0.3) {
        const s = u.team ? -1 : 1;
        u.goal = [(Math.random() * 2 - 1) * 7.5, s * (2.5 + Math.random() * 11)];
        u.wait = 0.5 + Math.random() * 2.5;
        continue;
      }
      const sp = u.card.speed;
      const saved = u.card.speed; u.card.speed = sp * 0.6;
      this.moveToward(u, u.goal[0], u.goal[1], dt);
      u.card.speed = saved;
      if (u.air) u.y = (u.card.airHeight || 1.4) + Math.sin(u.t * 3) * 0.12;
    }
    this.separate();
  }

  makeAiDeck(shuffle) {
    for (let tries = 0; tries < 50; tries++) {
      const d = shuffle(CARD_KEYS).slice(0, 8);
      const spells = d.filter((k) => CARDS[k].type === 'spell').length;
      const anti = d.some((k) => CARDS[k].hitsAir && CARDS[k].type === 'unit');
      const win = d.some((k) => CARDS[k].buildingsOnly);
      if (spells >= 1 && spells <= 2 && anti && win) return d;
    }
    return ['zombie', 'skeleton', 'spider', 'pig', 'cow', 'villager', 'ash_zombie', 'arrows'];
  }
  makeHand(cards) { return { hand: cards.slice(0, 4), rest: cards.slice(4) }; }
  cycle(team, i) {
    const h = this.hands[team];
    const c = h.hand[i];
    h.hand[i] = h.rest.shift();
    h.rest.push(c);
  }

  // ---------- world building ----------
  buildWorld() {
    const TH = this.theme;
    const b = new BlockBuilder();
    const water = new BlockBuilder();
    const rnd = (() => { let s = 1234567; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
    const onBridge = (x) => LANES.some((l) => x + 0.5 > l - BRIDGE_HW && x + 0.5 < l + BRIDGE_HW);
    const onPath = (x, z) => LANES.some((l) => Math.abs(x + 0.5 - l) < 1.2) && Math.abs(z + 0.5) < 10 || (Math.abs(x + 0.5) < 1 && Math.abs(z + 0.5) > 11.5);
    // outer meadow + arena floor
    for (let x = -22; x < 22; x++) for (let z = -28; z < 28; z++) {
      const inArena = x >= -HALF_W && x < HALF_W && z >= -HALF_L && z < HALF_L;
      const river = z >= -RIVER && z < RIVER && x >= -HALF_W - 13 && x < HALF_W + 13;
      if (river && !(inArena && onBridge(x))) {
        b.box(x, -3, z, x + 1, -2, z + 1, TH.bed, 'bnsew');
        water.face([x, -0.3, z + 1], [1, 0, 0], [0, 0, -1], TH.liquid ? 'lava' : 'water', 1);
        continue;
      }
      if (river) {
        // bridge: planks deck with log rails
        b.block(x, -1, z, TH.bridge);
        continue;
      }
      const t = inArena && onPath(x, z) ? TH.path : TH.ground;
      b.block(x, -1, z, t, 'bnsew');
    }
    // river bank walls (the sides of the channel)
    for (let x = -22; x < 22; x++) {
      const inArena = x >= -HALF_W && x < HALF_W;
      if (inArena && onBridge(x)) continue;
      b.face([x, -2, -RIVER], [1, 0, 0], [0, 2, 0], TH.bank, 0.62);
      b.face([x + 1, -2, RIVER], [-1, 0, 0], [0, 2, 0], TH.bank, 0.75);
    }
    // bridge rails
    for (const l of LANES) for (let z = -RIVER - 1; z <= RIVER; z++) {
      for (const x of [l - BRIDGE_HW - 0.25, l + BRIDGE_HW]) b.box(x, 0, z, x + 0.25, 0.5, z + 1, TH.rail);
    }
    // arena wall
    for (let x = -HALF_W - 1; x <= HALF_W; x++) for (const z of [-HALF_L - 1, HALF_L]) b.block(x, 0, z, TH.wall[rnd() < 0.25 ? 1 : 0]);
    for (let z = -HALF_L; z < HALF_L; z++) for (const x of [-HALF_W - 1, HALF_W]) {
      if (z >= -RIVER && z < RIVER) continue;
      b.block(x, 0, z, TH.wall[rnd() < 0.25 ? 1 : 0]);
    }
    // trees, pumpkins and hay outside the arena
    const tree = (x, z, kind) => {
      const log = kind ? TILES.birch : TILES.oak, leaf = kind ? TILES.birchLeaves : TILES.oakLeaves;
      const h = 3 + Math.floor(rnd() * 2);
      for (let y = 0; y < h; y++) b.block(x, y, z, log);
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = h - 1; dy <= h + 1; dy++) {
        const r = Math.abs(dx) + Math.abs(dz) + (dy === h + 1 ? 2 : 0);
        if (r > 3 || (dx === 0 && dz === 0 && dy < h)) continue;
        if (r === 3 && rnd() < 0.5) continue;
        b.block(x + dx, dy, z + dz, leaf);
      }
    };
    const spots = [];
    for (let i = 0; i < 70; i++) {
      const x = Math.floor((rnd() * 2 - 1) * 21), z = Math.floor((rnd() * 2 - 1) * 27);
      if (x > -HALF_W - 4 && x < HALF_W + 3 && z > -HALF_L - 4 && z < HALF_L + 3) continue;
      if (z > -RIVER - 3 && z < RIVER + 2) continue;
      if (spots.some(([a, c]) => Math.abs(a - x) < 4 && Math.abs(c - z) < 4)) continue;
      spots.push([x, z]);
      const r = rnd();
      if (TH.decor === 'trees') {
        if (r < 0.75) tree(x, z, rnd() < 0.35 ? 1 : 0);
        else b.block(x, 0, z, r < 0.88 ? TILES.pumpkin : TILES.hay);
      } else if (TH.decor === 'cactus') {
        if (r < 0.6) { const h = 2 + Math.floor(rnd() * 2); for (let y = 0; y < h; y++) b.box(x + 0.06, y, z + 0.06, x + 0.94, y + 1, z + 0.94, { top: 'cactus_top', side: 'cactus_side', bottom: 'cactus_top' }); }
        else if (r < 0.85) { b.block(x, 0, z, { top: 'sandstone_top', side: 'sandstone' }); if (rnd() < 0.6) b.block(x + 1, 0, z, { top: 'sandstone_top', side: 'sandstone' }); if (rnd() < 0.5) b.block(x, 1, z, { top: 'sandstone_top', side: 'chiseled_sandstone' }); }
        else b.block(x, 0, z, TILES.hay);
      } else if (TH.decor === 'nether') {
        const h = 2 + Math.floor(rnd() * 4);
        for (let y = 0; y < h; y++) b.block(x, y, z, rnd() < 0.2 ? { all: 'glutquarz_erz' } : { all: 'glutgestein' });
        if (rnd() < 0.7) this.glowCube(x + 0.5, h + 0.4, z + 0.5, [3.2, 1.6, 0.5], 0.7);
        if (r < 0.4) b.block(x + 1, 0, z, { all: 'glutgestein' });
      } else if (TH.decor === 'void') {
        const h = 3 + Math.floor(rnd() * 5);
        for (let y = 0; y < h; y++) b.block(x, y, z, { all: 'obsidian' });
        b.block(x, h, z, { top: 'sternensaeule_top', side: 'sternensaeule' });
        this.glowCube(x + 0.5, h + 1.6, z + 0.5, [1.6, 0.9, 3.4], 0.6);
      }
    }
    const world = b.mesh(this.blockMat);
    world.castShadow = world.receiveShadow = true;
    this.scene.add(world);
    let wm;
    if (this.fx) {
      const g = new THREE.PlaneGeometry(44, 2, 88, 4); g.rotateX(-Math.PI / 2);
      wm = new THREE.Mesh(g, this.waterMat); wm.position.set(0, -0.3, 0);
    } else wm = water.mesh(this.waterMat);
    wm.renderOrder = 2;
    this.scene.add(wm);
    this.waterMesh = wm;
    // drifting light motes (they glow with the bloom effect)
    if (this.fx) {
      const n = 70, pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() * 2 - 1) * 14; pos[i * 3 + 1] = 0.5 + Math.random() * 4; pos[i * 3 + 2] = (Math.random() * 2 - 1) * 20; }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.motes = new THREE.Points(g, new THREE.PointsMaterial({ color: new THREE.Color(...TH.motes), size: 0.13, transparent: true, opacity: 0.85, depthWrite: false }));
      this.scene.add(this.motes);
    }

    // deploy-zone overlays (red = forbidden)
    const mk = () => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.22, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.y = 0.03; m.visible = false; m.renderOrder = 3;
      this.scene.add(m); return m;
    };
    this.zoneL = mk(); this.zoneR = mk();
    // target ring
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
    this.ring.rotation.x = -Math.PI / 2; this.ring.position.y = 0.05; this.ring.visible = false; this.ring.renderOrder = 4;
    this.scene.add(this.ring);
  }

  glowCube(x, y, z, rgb, size) {
    if (!this.floaters) this.floaters = [];
    const m = new THREE.Mesh(this.particleGeo, this.glowMat(rgb));
    m.scale.setScalar(size); m.position.set(x, y, z); m.rotation.set(0.6, 0.3, 0.5);
    m.userData.baseY = y;
    this.scene.add(m); this.floaters.push(m);
  }

  addTower(team, king, x, z) {
    const b = new BlockBuilder();
    const hw = king ? 2 : 1.5, h = king ? 5 : 4;
    const rnd = Math.random;
    for (let y = 0; y < h; y++) for (let i = 0; i < hw * 2; i++) for (let j = 0; j < hw * 2; j++) {
      const r = rnd();
      const t = king && (y === 0 || y === h - 1) ? (r < 0.5 ? TILES.smooth : TILES.bricks) : r < 0.18 ? TILES.mossy : r < 0.28 ? TILES.cracked : TILES.bricks;
      b.block(-hw + i, y, -hw + j, t);
    }
    // battlements
    for (let i = 0; i < hw * 2; i++) for (let j = 0; j < hw * 2; j++) {
      const edge = i === 0 || j === 0 || i === hw * 2 - 1 || j === hw * 2 - 1;
      if (edge && (i + j) % 2 === 0) b.block(-hw + i, h, -hw + j, king ? TILES.gold : TILES.cobble);
    }
    // team banners
    const front = team === 0 ? -1 : 1;
    for (let i = 0; i < hw * 2; i++) if (i !== 0 && i !== hw * 2 - 1) {
      const zz = front < 0 ? -hw - 0.1 : hw;
      b.box(-hw + i + 0.15, h - 2.5, zz, -hw + i + 0.85, h - 0.3, zz + 0.1, TILES.wool[team]);
    }
    const g = new THREE.Group();
    const tm = b.mesh(this.blockMat); tm.castShadow = tm.receiveShadow = true;
    g.add(tm);
    // lanterns on the corners
    const lanterns = [];
    for (const [lx, lz] of [[-hw + 0.5, -hw + 0.5], [hw - 0.5, -hw + 0.5], [-hw + 0.5, hw - 0.5], [hw - 0.5, hw - 0.5]]) {
      if (!king && (lx + lz) % 2 !== 0 && (lx > 0) === (lz > 0)) continue;
      const core = new THREE.Mesh(this.particleGeo, this.glowMat(team === 0 ? [1.4, 1.9, 3.2] : [3.2, 1.5, 0.8]));
      core.scale.set(0.28, 0.36, 0.28); core.position.set(lx, h + 1.25, lz);
      const cage = new THREE.Mesh(this.particleGeo, this.colMat(0x2a2a30)); cage.scale.set(0.38, 0.08, 0.38); cage.position.set(lx, h + 1.48, lz);
      g.add(core, cage); lanterns.push(core);
    }
    g.position.set(x, 0, z);
    this.scene.add(g);
    // guard on top
    const guard = createMobModel(king ? 'villager' : 'skeleton');
    guard.root.scale.setScalar(king ? 0.95 : 0.85);
    guard.root.position.set(0, h, 0);
    guard.root.rotation.y = team === 0 ? Math.PI : 0;
    if (king) {
      const cb = new BlockBuilder();
      for (const [dx, dz] of [[-0.3, -0.3], [0.1, -0.3], [-0.3, 0.1], [0.1, 0.1]]) cb.box(dx, 0, dz, dx + 0.2, 0.25, dz + 0.2, TILES.gold);
      cb.box(-0.3, -0.05, -0.3, 0.3, 0.05, 0.3, TILES.gold);
      const crown = cb.mesh(this.blockMat);
      crown.position.set(0, 0.68, 0);
      guard.parts.head.add(crown);
    }
    g.add(guard.root);
    guard.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    const tmul = towerMul(this.levels[team].king);
    const thp = Math.round((king ? 2600 : 1500) * tmul);
    const ent = {
      kind: 'tower', king, team, x, z, hw, h, radius: hw, hp: thp, maxHp: thp,
      dmg: Math.round((king ? 70 : 55) * tmul), hitSpeed: king ? 1.0 : 0.8, range: king ? 8 : 7.5, atkCd: 0, active: !king, alive: true,
      group: g, guard, target: null, flash: 0, lanterns,
    };
    this.ents.push(ent);
    this.makeBar(ent);
    return ent;
  }

  // ---------- UI ----------
  setupUI() {
    this.hud = $('arenahud');
    this.hud.classList.remove('hidden');
    this.cardEls = [...document.querySelectorAll('#ar-hand .ar-card')];
    this.nextEl = $('ar-next');
    this.cardEls.forEach((el, i) => {
      el.onpointerdown = (e) => {
        e.preventDefault();
        if (this.over) return;
        const wasSel = this.sel === i;
        this.select(i);
        this.drag = { id: e.pointerId, i, wasSel, moved: false };
      };
    });
    this._pm = (e) => this.onPointerMove(e);
    this._pu = (e) => this.onPointerUp(e);
    this._pd = (e) => { if (e.target === this.canvas) this.onPointerMove(e); };
    window.addEventListener('pointermove', this._pm);
    window.addEventListener('pointerup', this._pu);
    window.addEventListener('pointerdown', this._pd);
    this.renderHand();
    $('ar-end').classList.add('hidden');
  }

  renderHand() {
    const h = this.hands[0];
    this.cardEls.forEach((el, i) => {
      const k = h.hand[i];
      if (el.dataset.key !== k) {
        el.dataset.key = k;
        el.innerHTML = cardHTML(k, this.portraits);
        el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
      }
      el.classList.toggle('sel', this.sel === i);
    });
    const n = h.rest[0];
    if (this.nextEl.dataset.key !== n) { this.nextEl.dataset.key = n; this.nextEl.innerHTML = `<img src="${this.portraits[n]}"><span class="cost">${CARDS[n].cost}</span>`; }
  }

  updateHandAfford() {
    const e = this.energy[0];
    this.cardEls.forEach((el, i) => {
      const c = CARDS[this.hands[0].hand[i]];
      el.classList.toggle('poor', c.cost > e);
      const need = el.querySelector('.need');
      if (need) need.style.height = c.cost > e ? `${(1 - e / c.cost) * 100}%` : '0%';
    });
    $('ar-efill').style.width = `${(e / MAX_ENERGY) * 100}%`;
    $('ar-enum').textContent = Math.floor(e);
  }

  select(i) {
    this.sel = i;
    this.renderHand();
    const key = i >= 0 ? this.hands[0].hand[i] : null;
    this.setGhost(key);
  }

  setGhost(key) {
    if (this.ghost) { this.scene.remove(this.ghost.root); this.ghost = null; }
    this.ghostKey = key;
    this.ring.visible = false;
    this.zoneL.visible = this.zoneR.visible = false;
    if (!key) return;
    const c = CARDS[key];
    if (c.type === 'unit') {
      const m = createMobModel(c.mob);
      m.root.scale.setScalar(c.scale * MODEL_SCALE);
      m.root.rotation.y = Math.PI;
      for (const mat of m.mats) { mat.transparent = true; mat.opacity = 0.55; mat.depthWrite = false; }
      m.root.traverse((o) => { if (o.userData.glow) o.visible = false; });
      m.root.visible = false;
      this.scene.add(m.root);
      this.ghost = m;
      // forbidden zones
      for (const [zone, side] of [[this.zoneL, 0], [this.zoneR, 1]]) {
        const lim = this.deployLimit(0, side);
        const z0 = -HALF_L, z1 = lim;
        zone.scale.set(HALF_W, z1 - z0, 1);
        zone.position.set(side ? HALF_W / 2 : -HALF_W / 2, 0.03, (z0 + z1) / 2);
        zone.visible = true;
      }
    }
  }

  // smallest z the player (team 0) may deploy at for the given x-half; mirrored for team 1
  deployLimit(team, side) {
    const enemy = 1 - team;
    const pt = this.ents.find((e) => e.kind === 'tower' && !e.king && e.team === enemy && (e.x > 0) === (side === 1));
    const pocket = !pt || !pt.alive;
    return pocket ? -5 : RIVER + 0.2; // for team 0
  }

  canDeploy(team, key, x, z) {
    const c = CARDS[key];
    if (Math.abs(x) > HALF_W - 0.3 || Math.abs(z) > HALF_L - 0.3) return false;
    if (c.type === 'spell') return true;
    const s = team === 0 ? 1 : -1;
    const lim = this.deployLimit(team, x > 0 ? 1 : 0);
    if (z * s < lim) return false;
    if (Math.abs(z) < RIVER + 0.2) return false;
    for (const e of this.ents) if (e.kind === 'tower' && e.alive && Math.abs(x - e.x) < e.hw + 0.3 && Math.abs(z - e.z) < e.hw + 0.3) return false;
    return true;
  }

  groundPoint(cx, cy) {
    const r = this.rect;
    if (cx < r.x || cx > r.x + r.w || cy < r.y || cy > r.y + r.h) return null;
    const ndc = new THREE.Vector2(((cx - r.x) / r.w) * 2 - 1, -((cy - r.y) / r.h) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const p = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p)) return null;
    return p;
  }

  overPanel(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    return !!(el && el.closest && el.closest('#ar-panel, #ar-top'));
  }

  onPointerMove(e) {
    if (this.drag && this.drag.id === e.pointerId) this.drag.moved = true;
    if (this.sel < 0 || this.over) return;
    const p = this.overPanel(e) ? null : this.groundPoint(e.clientX, e.clientY);
    this.pointer = p;
    this.updateGhost();
  }

  updateGhost() {
    const p = this.pointer, key = this.ghostKey;
    if (!key) return;
    if (!p) { if (this.ghost) this.ghost.root.visible = false; this.ring.visible = false; return; }
    const c = CARDS[key];
    const ok = this.canDeploy(0, key, p.x, p.z);
    this.ring.visible = true;
    this.ring.position.set(p.x, 0.05, p.z);
    const rr = c.type === 'spell' ? c.radius : 0.8;
    this.ring.scale.set(rr, rr, 1);
    this.ring.material.color.set(ok ? (c.type === 'spell' ? 0xffe060 : 0xffffff) : 0xff3030);
    if (this.ghost) {
      this.ghost.root.visible = true;
      this.ghost.root.position.set(p.x, c.air ? (c.airHeight || 1.4) : 0, p.z);
    }
  }

  onPointerUp(e) {
    const d = this.drag;
    this.drag = null;
    if (this.over || this.sel < 0) return;
    const onPanel = this.overPanel(e);
    if (onPanel) {
      // tapping the selected card again deselects it
      if (d && d.wasSel && !d.moved) this.select(-1);
      return;
    }
    const p = this.groundPoint(e.clientX, e.clientY);
    if (!p) return;
    if (this.countdown > 0) { this.toast('Gleich geht es los …', 0.8); return; }
    const key = this.hands[0].hand[this.sel];
    const c = CARDS[key];
    if (!this.canDeploy(0, key, p.x, p.z)) { this.toast('Hier kannst du nichts ausspielen', 1.2); return; }
    if (this.energy[0] < c.cost) { this.toast('Nicht genug Energie', 1); return; }
    this.play(0, this.sel, p.x, p.z);
    this.pointer = null;
    this.select(-1);
  }

  toast(msg, dur = 1.6) {
    const t = $('ar-toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.remove('on'), dur * 1000);
  }

  makeBar(ent) {
    const el = document.createElement('div');
    el.className = 'ar-hp ' + (ent.team === 0 ? 'blue' : 'red') + (ent.kind === 'tower' ? ' tower' : '');
    el.innerHTML = ent.kind === 'tower' ? `<i></i><b></b>` : '<i></i>';
    this.bars.appendChild(el);
    ent.bar = el;
    ent.barFill = el.firstChild;
    ent.barNum = el.querySelector('b');
  }

  // ---------- gameplay ----------
  play(team, i, x, z) {
    const key = this.hands[team].hand[i];
    const c = CARDS[key];
    this.energy[team] -= c.cost;
    if (team === 0) this.flyCard(i, key, x, z); else this.enemyCardPop(key, x, z);
    this.cycle(team, i);
    if (team === 0) this.renderHand();
    if (c.type === 'spell') this.castSpell(team, key, x, z);
    else {
      const n = c.count;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + 0.4, r = n > 1 ? 0.55 + n * 0.08 : 0;
        this.spawnUnit(team, key, clamp(x + Math.cos(a) * r, -HALF_W + 0.5, HALF_W - 0.5), z + Math.sin(a) * r * 0.8);
      }
      sfx.mob(c.mob === 'ash_zombie' ? 'zombie' : c.mob === 'fire_skeleton' ? 'skeleton' : c.mob === 'void_crawler' ? 'spider' : c.mob);
    }
  }

  lvlOf(team, key) { const L = this.levels[team]; return (L.cards && L.cards[key]) || L.card || 1; }

  spawnUnit(team, key, x, z) {
    const base = CARDS[key], mul = levelMul(this.lvlOf(team, key));
    const c = Object.assign({}, base, { hp: Math.round(base.hp * mul), dmg: Math.round(base.dmg * mul) });
    const m = createMobModel(c.mob);
    m.root.scale.setScalar(c.scale * MODEL_SCALE);
    m.root.rotation.y = team === 0 ? Math.PI : 0;
    m.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.scene.add(m.root);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(c.radius * 1.1, 20), new THREE.MeshBasicMaterial({ color: TEAM_COL[team], transparent: true, opacity: 0.5, depthWrite: false }));
    disc.rotation.x = -Math.PI / 2; disc.renderOrder = 3;
    this.scene.add(disc);
    const u = {
      kind: 'unit', key, card: c, team, x, z, y: 0, hp: c.hp, maxHp: c.hp, radius: c.radius, air: !!c.air,
      model: m, disc, deploy: 1, atkCd: 0.4, target: null, retarget: 0, swing: 0, walk: 0, t: Math.random() * 10, alive: true, flash: 0,
      height: MOB_DEFS[c.mob].h * c.scale * MODEL_SCALE,
    };
    this.ents.push(u);
    this.makeBar(u);
    return u;
  }

  castSpell(team, key, x, z) {
    const base = CARDS[key];
    const c = Object.assign({}, base, { dmg: Math.round(base.dmg * levelMul(this.lvlOf(team, key))) });
    if (key === 'powder') {
      const tex = new THREE.CanvasTexture(kegCanvas()); tex.magFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace;
      const keg = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.9), new THREE.MeshLambertMaterial({ map: tex }));
      keg.position.set(x, 12, z);
      this.scene.add(keg);
      this.effects.push({ t: 0, dur: c.delay, update: (f, dt) => { keg.position.y = 12 * (1 - f * f) + 0.55; keg.rotation.y += dt * 6; },
        end: () => { this.scene.remove(keg); this.explode(team, c, x, z); } });
    } else {
      const arrows = [];
      for (let i = 0; i < 26; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * c.radius;
        const m = this.arrowMesh();
        m.position.set(x + Math.cos(a) * r - 3, 10 + Math.random() * 4, z + Math.sin(a) * r);
        m.userData.v = new THREE.Vector3(3, -10 - Math.random() * 4, 0).multiplyScalar(1 / c.delay * 0.55);
        m.lookAt(m.position.clone().add(m.userData.v));
        this.scene.add(m); arrows.push(m);
      }
      sfx.bow();
      let wave = 0;
      this.effects.push({ t: 0, dur: c.delay + 0.6, update: (f, dt, t) => {
        for (const m of arrows) { if (m.position.y > 0.1) m.position.addScaledVector(m.userData.v, dt); }
        while (wave < 3 && t >= c.delay + wave * 0.25) { wave++; this.areaDamage(team, x, z, c.radius, c.dmg / 3, c.towerFactor); sfx.hit(); }
      }, end: () => arrows.forEach((m) => this.scene.remove(m)) });
    }
  }

  explode(team, c, x, z) {
    this.areaDamage(team, x, z, c.radius, c.dmg, c.towerFactor);
    this.burst(x, 0.6, z, [0xff9a2a, 0xffd040, 0x555555, 0x333333, 0xff5020], 40, 6);
    this.shake = 0.45;
    sfx.boom();
    // scorch mark
    const s = new THREE.Mesh(new THREE.CircleGeometry(c.radius * 0.8, 24), new THREE.MeshBasicMaterial({ color: 0x1a1410, transparent: true, opacity: 0.45, depthWrite: false }));
    s.rotation.x = -Math.PI / 2; s.position.set(x, 0.02, z); s.renderOrder = 2; this.scene.add(s);
    this.effects.push({ t: 0, dur: 4, update: (f) => { s.material.opacity = 0.45 * (1 - f); }, end: () => this.scene.remove(s) });
  }

  areaDamage(team, x, z, r, dmg, towerFactor = 1) {
    for (const e of this.ents) {
      if (!e.alive || e.team === team) continue;
      const d = e.kind === 'tower' ? Math.hypot(Math.max(0, Math.abs(x - e.x) - e.hw), Math.max(0, Math.abs(z - e.z) - e.hw)) : Math.hypot(x - e.x, z - e.z) - e.radius;
      if (d <= r) this.damage(e, e.kind === 'tower' ? dmg * towerFactor : dmg);
    }
  }

  arrowMesh() {
    const g = new THREE.Group();
    const shaft = new THREE.Mesh(this.particleGeo, this.colMat(0x7a5530)); shaft.scale.set(0.05, 0.05, 0.6); g.add(shaft);
    const tip = new THREE.Mesh(this.particleGeo, this.colMat(0xb0b0b8)); tip.scale.set(0.09, 0.09, 0.12); tip.position.z = 0.32; g.add(tip);
    const fl = new THREE.Mesh(this.particleGeo, this.colMat(0xf0f0f0)); fl.scale.set(0.12, 0.02, 0.14); fl.position.z = -0.26; g.add(fl);
    return g;
  }

  glowMat(rgb) {
    const k = rgb.join(',');
    let m = this.glowMats.get(k);
    if (!m) { m = new THREE.MeshBasicMaterial({ color: new THREE.Color(rgb[0], rgb[1], rgb[2]) }); this.glowMats.set(k, m); }
    return m;
  }

  colMat(c) {
    let m = this.particleMats.get(c);
    if (!m) { m = new THREE.MeshLambertMaterial({ color: c }); this.particleMats.set(c, m); }
    return m;
  }

  burst(x, y, z, colors, n, power = 3, size = 0.16) {
    for (let i = 0; i < n; i++) {
      if (this.particles.length > 400) break;
      const m = new THREE.Mesh(this.particleGeo, this.colMat(colors[i % colors.length]));
      const s = size * (0.6 + Math.random() * 0.8);
      m.scale.setScalar(s);
      m.position.set(x + (Math.random() - 0.5) * 0.4, y + Math.random() * 0.4, z + (Math.random() - 0.5) * 0.4);
      const a = Math.random() * Math.PI * 2, sp = power * (0.3 + Math.random() * 0.7);
      this.scene.add(m);
      this.particles.push({ m, vx: Math.cos(a) * sp, vy: power * (0.5 + Math.random()), vz: Math.sin(a) * sp, life: 0.6 + Math.random() * 0.6 });
    }
  }

  damage(e, amt) {
    if (!e.alive || this.over) return;
    e.hp -= amt;
    e.flash = 0.12;
    if (e.kind === 'tower' && e.king && !e.active) e.active = true;
    if (e.hp <= 0) this.kill(e);
  }

  kill(e) {
    e.alive = false;
    e.hp = 0;
    if (e.bar) { e.bar.remove(); e.bar = null; }
    if (e.kind === 'unit') {
      this.scene.remove(e.disc);
      const root = e.model.root, side = Math.random() < 0.5 ? 1 : -1, y0 = root.position.y, sc = root.scale.x;
      for (const mat of e.model.mats) { mat.transparent = true; if (mat.emissive) mat.emissive.setRGB(0.5, 0.5, 0.5); }
      this.effects.push({ t: 0, dur: 0.55, update: (f) => {
        root.rotation.z = side * Math.min(1, f * 2.2) * Math.PI / 2;
        root.position.y = Math.max(0, y0 * (1 - f * 2)) - Math.max(0, f - 0.5) * 0.6;
        for (const mat of e.model.mats) mat.opacity = 1 - Math.max(0, f - 0.4) / 0.6;
        root.scale.setScalar(sc * (1 - Math.max(0, f - 0.6) * 0.8));
      }, end: () => { this.scene.remove(root); this.burst(e.x, 0.3, e.z, [0xdddddd, 0xbbbbbb, 0xffffff], 12, 1.6, 0.16); } });
      return;
    }
    // tower destroyed
    const other = 1 - e.team;
    this.scene.remove(e.group);
    const rb = new BlockBuilder();
    for (let i = 0; i < e.hw * 2; i++) for (let j = 0; j < e.hw * 2; j++) if (Math.random() < 0.7) rb.block(-e.hw + i, 0, -e.hw + j, Math.random() < 0.5 ? TILES.cobble : TILES.cracked, '');
    const rubble = rb.mesh(this.blockMat); rubble.position.set(e.x, -0.5, e.z); this.scene.add(rubble);
    this.burst(e.x, 2, e.z, [0x8a8a8a, 0x6a6a6a, 0xb0b0b0, 0x4a4a4a], 60, 5, 0.3);
    this.shake = 0.6;
    sfx.boom();
    if (e.king) {
      this.crowns[other] = 3;
      for (const t of this.ents) if (t.kind === 'tower' && t.team === e.team && t.alive) { t.alive = false; if (t.bar) { t.bar.remove(); t.bar = null; } }
    } else {
      this.crowns[other] = Math.min(3, this.crowns[other] + 1);
      const k = this.ents.find((t) => t.kind === 'tower' && t.king && t.team === e.team);
      if (k) k.active = true;
      this.toast(other === 0 ? 'Turm zerstört! 👑' : 'Du hast einen Turm verloren!', 1.6);
      if (this.sel >= 0) this.setGhost(this.ghostKey);
    }
    this.updateCrowns();
    if (e.king || (this.overtime && this.crowns[0] !== this.crowns[1])) this.finish();
  }

  screenOf(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return [((v.x + 1) / 2) * this.rect.w, ((1 - v.y) / 2) * this.rect.h];
  }

  flyCard(i, key, x, z) {
    const src = this.cardEls[i];
    if (!src) return;
    const r = src.getBoundingClientRect();
    const [tx, ty] = this.screenOf(x, 0.5, z);
    const el = document.createElement('div');
    el.className = 'ar-card ar-fly';
    el.innerHTML = cardHTML(key, this.portraits);
    el.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;`;
    document.body.appendChild(el);
    requestAnimationFrame(() => {
      el.style.transform = `translate(${tx - r.left - r.width / 2}px, ${ty - r.top - r.height / 2}px) scale(0.25) rotate(-12deg)`;
      el.style.opacity = '0';
    });
    setTimeout(() => el.remove(), 450);
    // shockwave ring where the card lands
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.8, 32), new THREE.MeshBasicMaterial({ color: 0x9ac0ff, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.06, z); ring.renderOrder = 4; this.scene.add(ring);
    this.effects.push({ t: 0, dur: 0.6, update: (f) => { ring.scale.setScalar(1 + f * 2.2); ring.material.opacity = 0.8 * (1 - f); }, end: () => { this.scene.remove(ring); ring.geometry.dispose(); } });
  }

  enemyCardPop(key, x, z) {
    const el = document.createElement('div');
    el.className = 'ar-enemycard';
    el.innerHTML = `<img src="${this.portraits[key]}"><span>${CARDS[key].cost}</span>`;
    this.bars.appendChild(el);
    const ent = { pop: el, x, z, t: 0 };
    this.effects.push({ t: 0, dur: 1.6, update: (f) => {
      const [sx, sy] = this.screenOf(ent.x, 2.2, ent.z);
      el.style.transform = `translate(${sx | 0}px, ${(sy - f * 18) | 0}px)`;
      el.style.opacity = f < 0.75 ? 1 : 1 - (f - 0.75) / 0.25;
    }, end: () => el.remove() });
  }

  updateCrowns() {
    const prev = this._prevCrowns || [0, 0];
    const draw = (el, n, cls, before) => { el.innerHTML = [0, 1, 2].map((i) => `<span class="crown ${i < n ? 'on ' + cls : ''} ${i < n && i >= before ? 'pop' : ''}">♛</span>`).join(''); };
    draw($('ar-crowns-me'), this.crowns[0], 'blue', prev[0]);
    draw($('ar-crowns-ai'), this.crowns[1], 'red', prev[1]);
    this._prevCrowns = this.crowns.slice();
  }

  gap(a, b) {
    if (b.kind === 'tower') return Math.hypot(Math.max(0, Math.abs(a.x - b.x) - b.hw), Math.max(0, Math.abs(a.z - b.z) - b.hw)) - a.radius;
    return Math.hypot(a.x - b.x, a.z - b.z) - a.radius - b.radius;
  }

  findTarget(u) {
    let best = null, bd = Infinity;
    const c = u.card;
    if (!c.buildingsOnly) {
      for (const e of this.ents) {
        if (!e.alive || e.team === u.team || e.kind !== 'unit' || e.deploy > 0.5) continue;
        if (e.air && !c.hitsAir) continue;
        const d = this.gap(u, e);
        if (d < SIGHT + (c.range > 2 ? c.range - 2 : 0) && d < bd) { bd = d; best = e; }
      }
      if (best) return best;
    }
    for (const e of this.ents) {
      if (!e.alive || e.team === u.team || e.kind !== 'tower') continue;
      // prefer staying in the current lane: bias towards towers on the same x side
      const d = this.gap(u, e) + (e.king ? 3 : 0);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  moveToward(u, tx, tz, dt) {
    let gx = tx, gz = tz;
    if (!u.air) {
      const band = RIVER + 0.7;
      const sU = Math.sign(u.z) || 1, sT = Math.sign(tz) || 1;
      if (Math.abs(tz) > band || Math.abs(u.z) > band) {
        const bx = LANES.reduce((a, l) => (Math.abs(l - u.x) < Math.abs(a - u.x) ? l : a), LANES[0]);
        if (Math.abs(u.z) < band) { gx = clamp(u.x, bx - 0.6, bx + 0.6); gz = sT * (band + 0.6); }
        else if (sU !== sT) { gx = bx; gz = sU * (band - 0.2); }
      }
    }
    const dx = gx - u.x, dz = gz - u.z, d = Math.hypot(dx, dz);
    if (d < 0.01) return;
    const sp = Math.min(d, u.card.speed * SPEED_MUL * dt);
    u.x += (dx / d) * sp; u.z += (dz / d) * sp;
    u.face = Math.atan2(dx, dz);
    u.walk = 1;
  }

  updateUnit(u, dt) {
    u.t += dt;
    if (u.deploy > 0) {
      u.deploy -= dt;
      const f = 1 - Math.max(0, u.deploy);
      const ah = u.card.airHeight || 1.4;
      u.y = (u.air ? ah : 0) + Math.max(0, (1 - f * 2.2)) * 3;
      if (u.deploy <= 0) { u.y = u.air ? ah : 0; this.burst(u.x, 0.1, u.z, [0xdddddd, 0xffffff], 6, 1.2, 0.12); }
      return;
    }
    u.walk = 0;
    if (u.target && !u.target.alive) u.target = null;
    u.retarget -= dt;
    const locked = u.target && this.gap(u, u.target) <= u.card.range;
    if (!locked && (u.retarget <= 0 || !u.target)) { u.target = this.findTarget(u); u.retarget = 0.4; }
    u.atkCd -= dt;
    const t = u.target;
    if (t) {
      const g = this.gap(u, t);
      if (g <= u.card.range) {
        u.face = Math.atan2(t.x - u.x, t.z - u.z);
        if (u.atkCd <= 0) {
          u.atkCd = u.card.hitSpeed;
          u.swing = 0.35;
          if (u.card.ranged) this.shoot(u, t);
          else { this.damage(t, u.card.dmg); this.hitSound(); }
        }
      } else this.moveToward(u, t.x, t.z, dt);
    }
    if (u.air) u.y = (u.card.airHeight || 1.4) + Math.sin(u.t * 3) * 0.12;
  }

  hitSound() { const n = performance.now(); if (n - (this._hs || 0) > 90) { this._hs = n; sfx.hit(); } }

  shoot(src, t) {
    const kind = src.card ? src.card.ranged : 'arrow';
    const pumpkin = kind === 'pumpkin' || kind === 'orb';
    let m;
    if (kind === 'orb') {
      m = new THREE.Group();
      const core = new THREE.Mesh(this.particleGeo, this.glowMat([2.6, 0.9, 3.8])); core.scale.setScalar(0.32); m.add(core);
      const shell = new THREE.Mesh(this.particleGeo, this.glowMat([0.5, 0.15, 0.8])); shell.scale.setScalar(0.46); shell.rotation.set(0.7, 0.7, 0); m.add(shell);
    } else if (pumpkin) {
      const b = new BlockBuilder(); b.box(-0.2, -0.2, -0.2, 0.2, 0.2, 0.2, TILES.pumpkin); m = b.mesh(this.blockMat);
    } else m = this.arrowMesh();
    const y0 = src.kind === 'tower' ? src.h + 0.9 : src.y + (src.height || 1) * 0.7;
    m.position.set(src.x, y0, src.z);
    this.scene.add(m);
    const dmg = src.kind === 'tower' ? src.dmg : src.card.dmg;
    this.projectiles.push({ m, team: src.team, target: t, dmg, speed: kind === 'orb' ? 7 : pumpkin ? 9 : 16, orb: kind === 'orb', splash: src.card ? src.card.splash : 0, arc: pumpkin, y0, sx: src.x, sz: src.z, p: 0 });
    const n = performance.now(); if (n - (this._bs || 0) > 120) { this._bs = n; sfx.bow(); }
  }

  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      const t = p.target;
      const tx = t.x, tz = t.z, ty = t.kind === 'tower' ? t.h * 0.6 : t.y + (t.height || 1) * 0.5;
      const dist = Math.hypot(tx - p.sx, tz - p.sz) + 0.01;
      p.p += (p.speed * dt) / dist;
      const f = Math.min(1, p.p);
      const prev = p.m.position.clone();
      const arc = p.arc ? Math.sin(f * Math.PI) * dist * 0.35 : Math.sin(f * Math.PI) * dist * 0.06;
      p.m.position.set(p.sx + (tx - p.sx) * f, p.y0 + (ty - p.y0) * f + arc, p.sz + (tz - p.sz) * f);
      if (p.arc) p.m.rotation.x += dt * 8; else p.m.lookAt(p.m.position.clone().multiplyScalar(2).sub(prev));
      if (f >= 1) {
        this.scene.remove(p.m);
        this.projectiles.splice(i, 1);
        if (p.splash) {
          this.areaDamage(p.team, tx, tz, p.splash, p.dmg, 1);
          if (p.orb) { this.burst(tx, ty, tz, [0x9a3ae0, 0xd080ff, 0x2a1040], 18, 3, 0.16); this.shake = Math.max(this.shake, 0.15); sfx.boom(); }
          else this.burst(tx, ty, tz, [0xe08a20, 0xf0b040, 0x5a8a2a], 10, 2, 0.14);
        } else if (t.alive) this.damage(t, p.dmg);
      }
    }
  }

  updateTower(e, dt) {
    if (!e.alive) return;
    e.atkCd -= dt;
    if (e.flash > 0) e.flash -= dt;
    const gm = e.guard;
    animateMob(gm, this.clock, 0, 0, 0);
    if (!e.active) { gm.root.rotation.z = Math.sin(this.clock * 1.5) * 0.05; return; }
    if (e.target && (!e.target.alive || Math.hypot(e.target.x - e.x, e.target.z - e.z) - e.target.radius > e.range)) e.target = null;
    if (!e.target) {
      let bd = Infinity;
      for (const u of this.ents) {
        if (u.kind !== 'unit' || !u.alive || u.team === e.team || u.deploy > 0) continue;
        const d = Math.hypot(u.x - e.x, u.z - e.z) - u.radius;
        if (d <= e.range && d < bd) { bd = d; e.target = u; }
      }
    }
    if (e.target) {
      gm.root.rotation.y = Math.atan2(e.target.x - e.x, e.target.z - e.z);
      if (e.atkCd <= 0) { e.atkCd = e.hitSpeed; this.shoot(e, e.target); }
    }
  }

  separate() {
    const us = this.ents.filter((e) => e.kind === 'unit' && e.alive && e.deploy <= 0);
    for (let i = 0; i < us.length; i++) for (let j = i + 1; j < us.length; j++) {
      const a = us[i], b = us[j];
      if (a.air !== b.air) continue;
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz) || 0.001, min = a.radius + b.radius;
      if (d < min) {
        const ma = a.radius * a.radius, mb = b.radius * b.radius, push = (min - d) * 0.5;
        const nx = dx / d, nz = dz / d;
        a.x -= nx * push * (mb / (ma + mb)) * 2; a.z -= nz * push * (mb / (ma + mb)) * 2;
        b.x += nx * push * (ma / (ma + mb)) * 2; b.z += nz * push * (ma / (ma + mb)) * 2;
      }
    }
    for (const u of us) {
      u.x = clamp(u.x, -HALF_W + u.radius, HALF_W - u.radius);
      u.z = clamp(u.z, -HALF_L + u.radius, HALF_L - u.radius);
      if (u.air) continue;
      // keep out of the water unless on a bridge
      if (Math.abs(u.z) < RIVER + u.radius * 0.5) {
        const bx = LANES.find((l) => Math.abs(u.x - l) < BRIDGE_HW);
        if (bx === undefined) u.z = (Math.sign(u.z) || 1) * (RIVER + u.radius * 0.5);
        else u.x = clamp(u.x, bx - BRIDGE_HW + u.radius * 0.6, bx + BRIDGE_HW - u.radius * 0.6);
      }
      // keep out of towers
      for (const t of this.ents) {
        if (t.kind !== 'tower' || !t.alive) continue;
        const ex = t.hw + u.radius, px = ex - Math.abs(u.x - t.x), pz = ex - Math.abs(u.z - t.z);
        if (px > 0 && pz > 0) {
          if (px < pz) u.x += Math.sign(u.x - t.x || 1) * px; else u.z += Math.sign(u.z - t.z || 1) * pz;
        }
      }
    }
  }

  // ---------- opponent ----------
  updateAI(dt) {
    const ai = this.ai;
    ai.think -= dt;
    if (ai.think > 0) return;
    ai.think = [1.2, 0.8, 0.5][this.difficulty] + Math.random() * 0.6;
    const team = 1, en = this.energy[1], h = this.hands[1];
    const options = h.hand.map((k, i) => ({ k, i, c: CARDS[k] })).filter((o) => o.c.cost <= en);
    const threats = this.ents.filter((e) => e.kind === 'unit' && e.alive && e.team === 0 && e.z < 3);
    if (threats.length) {
      // spell on a cluster
      for (const o of options) {
        if (o.c.type !== 'spell') continue;
        for (const t of threats) {
          const near = threats.filter((q) => Math.hypot(q.x - t.x, q.z - t.z) < o.c.radius * 0.8);
          const value = near.reduce((s, q) => s + Math.min(q.hp, o.c.dmg), 0);
          if (near.length >= 3 || value > 650) { this.play(team, o.i, t.x, t.z); return; }
        }
      }
      const main = threats.reduce((a, b) => (b.hp > a.hp ? b : a));
      const air = threats.some((t) => t.air);
      let pick = options.filter((o) => o.c.type === 'unit' && !o.c.buildingsOnly && (!air || o.c.hitsAir));
      if (!pick.length) pick = options.filter((o) => o.c.type === 'unit' && !o.c.buildingsOnly);
      if (pick.length && (main.z < -3 || en >= 6)) {
        pick.sort((a, b) => (main.hp > 900 ? b.c.dmg / b.c.hitSpeed - a.c.dmg / a.c.hitSpeed : a.c.cost - b.c.cost));
        const o = pick[0];
        const z = clamp(main.z - (o.c.ranged ? 4 : 2), -HALF_L + 2, -RIVER - 1);
        const x = clamp(main.x + (Math.random() - 0.5), -HALF_W + 1, HALF_W - 1);
        if (this.canDeploy(team, o.k, x, z)) { this.play(team, o.i, x, z); return; }
      }
      if (en < 9) return;
    }
    // attack
    const want = en >= 9.5 || (en >= 7 && Math.random() < 0.35);
    if (!want) return;
    const units = options.filter((o) => o.c.type === 'unit');
    if (!units.length) return;
    // pick lane: weaker enemy tower
    const pts = this.ents.filter((e) => e.kind === 'tower' && !e.king && e.team === 0);
    let lane = Math.random() < 0.5 ? 0 : 1;
    const l0 = pts.find((p) => p.x < 0), l1 = pts.find((p) => p.x > 0);
    if (l0 && l1) { const a = l0.alive ? l0.hp : 9999, b = l1.alive ? l1.hp : 9999; if (Math.abs(a - b) > 200) lane = a < b ? 0 : 1; }
    const lx = LANES[lane];
    const support = this.ents.find((e) => e.kind === 'unit' && e.alive && e.team === 1 && e.card.buildingsOnly && e.z < -2);
    const o = support ? (units.find((u) => !u.c.buildingsOnly) || units[0]) : units.sort((a, b) => b.c.cost - a.c.cost)[0];
    const pocket = this.deployLimit(1, lane) < 0;
    let x = lx + (Math.random() - 0.5), z = o.c.buildingsOnly || o.c.hp > 1400 ? -13 : -2.5;
    if (support) { x = support.x; z = Math.min(-2.2, support.z - 1.5); }
    if (pocket && Math.random() < 0.5 && o.c.cost <= 4) z = 4;
    if (this.canDeploy(team, o.k, x, z)) this.play(team, o.i, x, z);
  }

  // ---------- loop ----------
  loop(now) {
    if (!this.running) return;
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (!this.paused) this.update(dt);
    this.render(dt);
  }

  update(dt) {
    this.clock += dt;
    if (this.preview) { this.updatePreview(dt); this.updateParticles(dt); return; }
    if (this.countdown > 0) {
      const before = Math.ceil(this.countdown - 0.6);
      this.countdown -= dt;
      const now = Math.ceil(this.countdown - 0.6);
      if (now !== before) { this.showCount(now > 0 ? String(now) : 'LOS!'); sfx.click(); if (now <= 0) sfx.pop(); }
      if (this.countdown <= 0) this.showCount('');
      for (const e of this.ents) if (e.kind === 'tower') animateMob(e.guard, this.clock, 0, 0, 0);
      return;
    }
    if (!this.over) {
      this.time -= dt;
      const dbl = this.overtime || this.time <= DOUBLE_AT;
      if (dbl && !this.doubleAnnounced) { this.doubleAnnounced = true; this.toast('2× Energie!', 2); sfx.pop(); }
      const rate = ENERGY_RATE * (dbl ? 2 : 1);
      const aiMul = [0.75, 1, 1.25][this.difficulty];
      this.energy[0] = Math.min(MAX_ENERGY, this.energy[0] + rate * dt);
      this.energy[1] = Math.min(MAX_ENERGY, this.energy[1] + rate * aiMul * dt);
      this.updateAI(dt);
      if (this.time <= 0) {
        if (!this.overtime && this.crowns[0] === this.crowns[1]) { this.overtime = true; this.time = OVERTIME; this.toast('Verlängerung! Der nächste Turm entscheidet.', 2.5); }
        else this.finish();
      }
    }
    for (const e of this.ents) {
      if (!e.alive) continue;
      if (e.kind === 'unit') this.updateUnit(e, dt); else this.updateTower(e, dt);
    }
    this.separate();
    this.updateProjectiles(dt);
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const f = this.effects[i];
      f.t += dt;
      f.update(Math.min(1, f.t / f.dur), dt, f.t);
      if (f.t >= f.dur) { this.effects.splice(i, 1); f.end && f.end(); }
    }
    this.updateParticles(dt);
    if (this.ents.length > 80) this.ents = this.ents.filter((e) => e.alive || e.kind === 'tower');
  }

  updateParticles(dt) {
    for (let i = this.effects.length - 1; i >= 0 && this.preview; i--) {
      const f = this.effects[i];
      f.t += dt; f.update(Math.min(1, f.t / f.dur), dt, f.t);
      if (f.t >= f.dur) { this.effects.splice(i, 1); f.end && f.end(); }
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt; p.vy -= 14 * dt;
      p.m.position.x += p.vx * dt; p.m.position.y += p.vy * dt; p.m.position.z += p.vz * dt;
      if (p.m.position.y < 0.05) { p.m.position.y = 0.05; p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; }
      p.m.scale.multiplyScalar(1 - dt * 0.8);
      if (p.life <= 0) { this.scene.remove(p.m); this.particles.splice(i, 1); }
    }
  }

  render(dt) {
    // models
    for (const e of this.ents) {
      if (e.kind !== 'unit' || !e.alive) continue;
      const m = e.model;
      m.root.position.set(e.x, e.y, e.z);
      if (e.face !== undefined) {
        let d = e.face - m.root.rotation.y;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        m.root.rotation.y += d * Math.min(1, dt * 10);
      }
      animateMob(m, e.t, e.air ? 1 : e.walk, 0, 0);
      if (e.swing > 0) {
        e.swing -= dt;
        const s = Math.sin((e.swing / 0.35) * Math.PI);
        m.inner.position.z = s * 0.25;
        if (m.parts.arms) { m.parts.arms[0].rotation.x -= s * 0.9; m.parts.arms[1].rotation.x -= s * 0.9; }
        if (m.parts.head && !m.parts.arms) m.parts.head.rotation.x = s * 0.4;
      } else m.inner.position.z = 0;
      if (e.flash > 0) e.flash -= dt;
      const fl = e.flash > 0;
      for (const mat of m.mats) if (mat.emissive) mat.emissive.setRGB(fl ? 0.7 : 0, 0, 0);
      e.disc.position.set(e.x, 0.04, e.z);
      e.disc.visible = e.deploy <= 0;
      m.root.scale.setScalar(e.card.scale * MODEL_SCALE * (e.deploy > 0 ? 0.6 + 0.4 * (1 - e.deploy) : 1));
    }
    for (const e of this.ents) if (e.kind === 'tower' && e.alive) {
      for (const mat of e.guard.mats) if (mat.emissive) mat.emissive.setRGB(e.flash > 0 ? 0.6 : 0, 0, 0);
      for (const l of e.lanterns) l.scale.y = 0.36 * (0.92 + Math.sin(this.clock * 7 + l.position.x * 3) * 0.08);
    }
    if (this.fx) {
      this.waterMat.uniforms.uTime.value = this.clock;
      this.waterMat.uniforms.uCam.value.copy(this.camera.position);
    } else if (this.waterMesh) this.waterMesh.position.y = Math.sin(this.clock * 1.6) * 0.04;
    if (this.floaters) for (const f of this.floaters) { f.rotation.y += dt * 0.8; f.position.y = f.userData.baseY + Math.sin(this.clock * 1.4 + f.position.x) * 0.15; }
    if (this.motes) {
      const a = this.motes.geometry.attributes.position;
      for (let i = 0; i < a.count; i++) {
        a.setY(i, a.getY(i) + Math.sin(this.clock * 0.9 + i) * dt * 0.25);
        a.setX(i, a.getX(i) + Math.cos(this.clock * 0.5 + i * 1.7) * dt * 0.3);
      }
      a.needsUpdate = true;
      this.motes.material.opacity = 0.6 + Math.sin(this.clock * 2) * 0.25;
    }
    // camera shake / preview orbit
    if (this.preview) {
      const a = this.clock * 0.06 + 0.6, R = this.rect.w > this.rect.h ? 30 : 36;
      this.camBase.set(Math.sin(a) * R, 17 + Math.sin(this.clock * 0.13) * 2, Math.cos(a) * R);
      this.camera.position.copy(this.camBase);
      this.camera.lookAt(0, 0, 0);
    }
    this.camera.position.copy(this.camBase);
    if (this.shake > 0) {
      this.shake -= dt;
      const s = this.shake * 0.5;
      this.camera.position.x += (Math.random() - 0.5) * s; this.camera.position.y += (Math.random() - 0.5) * s;
    }
    if (this.sky) this.sky.position.copy(this.camera.position);
    if (this.post && this.post.ok) {
      this.post.begin();
      this.renderer.render(this.scene, this.camera);
      const sp = this.camera.position.clone().addScaledVector(SUN_DIR, 150).project(this.camera);
      const on = Math.abs(sp.x) < 1.3 && Math.abs(sp.y) < 1.3 && sp.z < 1;
      this.post.end({ sun: new THREE.Vector2((sp.x + 1) / 2, (sp.y + 1) / 2), sunVis: on ? 0.8 : 0, bloom: 0.55, rays: 0.55, exposure: 0.95, sat: 1.15, tint: new THREE.Color(1, 0.85, 0.62) });
    } else {
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.scene, this.camera);
    }
    if (this.preview) return;
    this.updateBars();
    this.updateHUD();
  }

  updateBars() {
    const v = new THREE.Vector3(), r = this.rect;
    for (const e of this.ents) {
      if (!e.alive || !e.bar) continue;
      const tower = e.kind === 'tower';
      const show = tower || (e.hp < e.maxHp && e.deploy <= 0);
      if (!show) { e.bar.style.display = 'none'; continue; }
      e.bar.style.display = '';
      v.set(e.x, tower ? e.h + (e.king ? 2.4 : 2) : e.y + e.height + 0.35, e.z).project(this.camera);
      const sx = r.x + ((v.x + 1) / 2) * r.w, sy = r.y + ((1 - v.y) / 2) * r.h;
      e.bar.style.transform = `translate(${sx | 0}px, ${sy | 0}px)`;
      e.barFill.style.width = `${Math.max(0, (e.hp / e.maxHp) * 100)}%`;
      if (e.barNum) e.barNum.textContent = Math.ceil(e.hp);
      if (tower) e.bar.classList.toggle('sleep', !e.active);
    }
  }

  updateHUD() {
    const t = Math.max(0, Math.ceil(this.time));
    const s = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    if (s !== this._lastT) { this._lastT = s; $('ar-time').textContent = s; $('ar-timelabel').textContent = this.overtime ? 'Verlängerung' : 'Restzeit'; }
    $('ar-top').classList.toggle('double', this.overtime || this.time <= DOUBLE_AT);
    if (!this._crownsInit) { this._crownsInit = true; this.updateCrowns(); }
    this.updateHandAfford();
  }

  resize() {
    const W = window.innerWidth, H = window.innerHeight;
    this.renderer.setSize(W, H);
    if (this.post) this.post.setSize(W, H);
    this.camera.clearViewOffset();
    if (this.preview) {
      this.camera.aspect = W / H; this.camera.fov = W > H ? 40 : 55; this.camera.updateProjectionMatrix();
      this.rect = { x: 0, y: 0, w: W, h: H }; this.camBase = this.camera.position.clone();
      return;
    }
    const pr = $('ar-panel').getBoundingClientRect();
    const landscape = W > H;
    const r = landscape ? { x: 0, y: 0, w: Math.max(100, W - pr.width), h: H } : { x: 0, y: 0, w: W, h: Math.max(100, H - pr.height) };
    this.camera.aspect = r.w / r.h;
    // fit the whole arena (including towers) into the view
    const pitch = landscape ? 0.85 : 0.85;
    const dir = new THREE.Vector3(0, Math.sin(pitch), Math.cos(pitch));
    const pts = [];
    for (const x of [-HALF_W - 1, HALF_W + 1]) for (const z of [-HALF_L - 1, HALF_L + 1]) for (const y of [0, z < 0 ? 6 : 0]) pts.push(new THREE.Vector3(x, y, z));
    const tmp = new THREE.Vector3();
    const fits = (D, tc) => {
      this.camera.position.set(0, 0, tc).addScaledVector(dir, D);
      this.camera.lookAt(0, 0, tc);
      this.camera.updateMatrixWorld();
      this.camera.updateProjectionMatrix();
      for (const p of pts) { tmp.copy(p).project(this.camera); if (Math.abs(tmp.x) > 0.98 || Math.abs(tmp.y) > 0.86 || tmp.z > 1) return false; }
      return true;
    };
    let best = null;
    for (let tc = -3; tc <= 3; tc += 0.25) {
      let lo = 5, hi = 120;
      if (!fits(hi, tc)) continue;
      for (let k = 0; k < 24; k++) { const mid = (lo + hi) / 2; if (fits(mid, tc)) hi = mid; else lo = mid; }
      if (!best || hi < best.D) best = { D: hi, tc };
    }
    if (!best) best = { D: 40, tc: 0 };
    this.camera.position.set(0, 0, best.tc).addScaledVector(dir, best.D * 1.01);
    this.camera.lookAt(0, 0, best.tc);
    // render the full screen, but keep the fitted arena centred in the free area above/left of the card panel
    this.camera.setViewOffset(r.w, r.h, -r.x, -r.y, W, H);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.rect = { x: 0, y: 0, w: W, h: H };
    this.camBase = this.camera.position.clone();
  }

  finish() {
    if (this.over) return;
    this.over = true;
    this.select(-1);
    let res = this.crowns[0] > this.crowns[1] ? 'win' : this.crowns[0] < this.crowns[1] ? 'lose' : 'draw';
    if (res === 'draw') {
      // tie-break: the side whose weakest tower has less health loses
      const low = (team) => Math.min(...this.ents.filter((e) => e.kind === 'tower' && e.team === team).map((e) => e.hp / e.maxHp));
      const a = low(0), b = low(1);
      if (Math.abs(a - b) > 0.001) res = a > b ? 'win' : 'lose';
    }
    setTimeout(() => {
      if (res === 'win') sfx.win(); else if (res === 'lose') sfx.lose();
      this.onEnd && this.onEnd(res, this.crowns.slice());
    }, 1200);
  }

  setPaused(p) { this.paused = p; if (!p) this.last = performance.now(); }

  dispose() {
    this.running = false;
    window.removeEventListener('resize', this._resize);
    window.removeEventListener('pointermove', this._pm);
    window.removeEventListener('pointerup', this._pu);
    window.removeEventListener('pointerdown', this._pd);
    if (!this.preview) {
      this.cardEls.forEach((el) => { el.onpointerdown = null; el.dataset.key = ''; el.innerHTML = ''; });
      this.nextEl.dataset.key = ''; this.nextEl.innerHTML = '';
      this.bars.innerHTML = '';
      this.hud.classList.add('hidden');
      this.showCount('');
    }
    this.scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.atlasTex.dispose();
    if (this.post) { for (const t of [this.post.main, this.post.bloomA, this.post.bloomB, this.post.rayA, this.post.rayB]) t.dispose(); }
    this.renderer.dispose();
    try { this.renderer.forceContextLoss(); } catch (e) { /* ignore */ }
    this.canvas.remove();
  }
}

export function cardHTML(k, portraits, extra = '') {
  const c = CARDS[k];
  return `<div class="ar-cbg ${c.legendary ? 'legend' : c.type === 'spell' ? 'spell' : c.cost >= 5 ? 'epic' : c.cost >= 4 ? 'rare' : ''}"></div><img src="${portraits[k]}" draggable="false"><div class="need"></div><span class="cost">${c.cost}</span><span class="nm">${c.name}</span>${extra}`;
}
