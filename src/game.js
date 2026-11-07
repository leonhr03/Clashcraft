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
import { PostFX } from './postfx.js';
import { SMELT } from './recipes.js';
import { sfx, initAudio } from './audio.js';
import { saveWorldMeta, saveChunks, loadChunks } from './save.js';
import { SEA } from './worldgen.js';

export const DIMS = {
  overworld: { name: 'Oberwelt', fixedDay: null, amb: 0.03, ambCol: [1, 1, 1] },
  nether: { name: 'Unterwelt', fixedDay: 0, amb: 0.3, ambCol: [1, 0.72, 0.6], fog: 0x3a0c06 },
  end: { name: 'Leere', fixedDay: 0.55, amb: 0.12, ambCol: [0.85, 0.8, 1], fog: 0x120a1c },
};

const VERT = `
attribute vec3 lt;
uniform float uTime, uWave;
varying vec2 vUv;
varying vec3 vLt;
varying float vDist;
varying vec3 vWorld;
varying float vWav;
void main(){
  vUv = uv;
  vec3 l = lt;
  vec3 p = position;
  float wav = 0.0;
  if (l.z > 5.0) { l.z -= 10.0; wav = 1.0; }
  if (wav > 0.5 && uWave > 0.5) {
    p.x += sin(uTime * 1.7 + p.z * 0.9 + p.y * 0.5) * 0.05;
    p.z += cos(uTime * 1.3 + p.x * 0.8 + p.y * 0.4) * 0.05;
  }
  #ifdef WATER
  if (uWave > 0.5) {
    float top = step(0.5, fract(p.y + 0.001));
    p.y += top * (sin(uTime * 1.6 + p.x * 0.7 + p.z * 0.5) * 0.03 + sin(uTime * 2.3 - p.x * 0.4 + p.z * 0.9) * 0.02 - 0.03);
  }
  #endif
  vLt = l; vWav = wav; vWorld = p;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vDist = length(mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
// simple fallback shaders (work on every device)
const SIMPLE_VERT = `
attribute vec3 lt;
varying vec2 vUv;
varying vec3 vLt;
varying float vDist;
void main(){
  vUv = uv; vLt = lt;
  if (vLt.z > 5.0) vLt.z -= 10.0;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDist = length(mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const SIMPLE_FRAG = `
uniform sampler2D map;
uniform float uDay, uFogNear, uFogFar, uAlpha, uAlphaTest, uAmb;
uniform vec3 uFog, uAmbCol;
varying vec2 vUv;
varying vec3 vLt;
varying float vDist;
void main(){
  vec4 c = texture2D(map, vUv);
  if (c.a < uAlphaTest) discard;
  float sky = vLt.x * uDay;
  float ls = pow(0.82, 15.0 * (1.0 - sky));
  float lb = pow(0.82, 15.0 * (1.0 - vLt.y));
  vec3 light = max(vec3(ls), vec3(lb) * vec3(1.0, 0.9, 0.75));
  light = max(light, uAmbCol * uAmb);
  vec3 col = c.rgb * light * vLt.z;
  float f = clamp((vDist - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  gl_FragColor = vec4(mix(col, uFog, f), c.a * uAlpha);
  #include <colorspace_fragment>
}`;

const FRAG = `
uniform sampler2D map;
uniform sampler2D uShadowMap;
uniform mat4 uShadowMat;
uniform float uDay, uFogNear, uFogFar, uAlpha, uAlphaTest, uAmb, uShadowOn, uTime, uTexel, uHDR;
uniform vec3 uFog, uAmbCol, uSunDir, uSunCol, uSkyCol;
varying vec2 vUv;
varying vec3 vLt;
varying float vDist;
varying vec3 vWorld;
varying float vWav;
float shadowAt(vec3 wp) {
  vec4 s = uShadowMat * vec4(wp, 1.0);
  vec3 sc = s.xyz / s.w * 0.5 + 0.5;
  if (sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0) return 1.0;
  float sum = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 o = vec2(float(i - (i / 2) * 2) - 0.5, float(i / 2) - 0.5) * uTexel;
    sum += (sc.z - 0.0008 > texture2D(uShadowMap, sc.xy + o).r) ? 0.0 : 1.0;
  }
  return sum * 0.25;
}
void main(){
  vec4 c = texture2D(map, vUv);
  if (c.a < uAlphaTest) discard;
  vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  float sky = vLt.x * uDay;
  float bl = vLt.y;
  vec3 skyL = vec3(pow(0.82, 15.0 * (1.0 - sky)));
  float lb = pow(0.82, 15.0 * (1.0 - bl));
  float sunStrength = 0.0, sun = 0.0;
  if (uShadowOn > 0.5) {
    float ndl = vWav > 0.5 ? 0.8 : dot(N, uSunDir);
    float outdoor = smoothstep(0.55, 0.95, vLt.x);
    sunStrength = clamp(uDay * 1.5 - 0.35, 0.0, 1.0) * outdoor;
    if (sunStrength > 0.0 && ndl > 0.0) sun = clamp(ndl * 1.4, 0.0, 1.0) * shadowAt(vWorld + N * 0.08);
    skyL *= mix(1.0, 0.5 + (0.6 + uHDR * 0.22) * sun, sunStrength);
    skyL *= mix(vec3(1.0), uSunCol, sunStrength * sun * 0.4);
    skyL = mix(skyL, skyL * vec3(0.78, 0.86, 1.1), sunStrength * (1.0 - sun) * 0.8);
  }
  vec3 light = max(skyL, vec3(lb) * vec3(1.0, 0.86, 0.68));
  light = max(light, uAmbCol * uAmb);
  vec3 col = c.rgb * light * vLt.z;
  float alpha = c.a * uAlpha;
  vec3 V = normalize(cameraPosition - vWorld);
  #ifdef WATER
  if (N.y > 0.5 || N.y < -0.5) {
    vec3 nW = normalize(vec3(sin(uTime * 1.3 + vWorld.x * 1.1 + vWorld.z * 0.6) * 0.07 + sin(uTime * 2.1 - vWorld.z * 1.7) * 0.04,
                             1.0,
                             cos(uTime * 1.1 + vWorld.z * 1.2 - vWorld.x * 0.5) * 0.07 + cos(uTime * 1.9 + vWorld.x * 1.5) * 0.04));
    if (N.y < 0.0) nW.y = -nW.y;
    float fres = 0.08 + 0.85 * pow(1.0 - max(dot(V, nW), 0.0), 4.0);
    vec3 refl = uSkyCol * (0.35 + 0.65 * max(uDay, 0.1)) * max(vLt.x, 0.15);
    col = mix(col, refl, fres * (uShadowOn > 0.5 ? 0.85 : 0.4));
    float spec = pow(max(dot(reflect(-uSunDir, nW), V), 0.0), 90.0) * sunStrength;
    col += uSunCol * spec * 2.2;
    alpha = mix(alpha, 0.97, fres * 0.6);
  }
  #endif
  vec3 fogC = uFog;
  if (uShadowOn > 0.5) {
    float sa = pow(max(dot(-V, uSunDir), 0.0), 6.0) * clamp(uDay * 1.4 - 0.2, 0.0, 1.0);
    fogC = mix(uFog, uSunCol, sa * 0.55);
  }
  float f = clamp((vDist - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  gl_FragColor = vec4(mix(col, fogC, f), alpha);
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
    this.atlasTex.magFilter = THREE.NearestFilter;
    this.atlasTex.colorSpace = THREE.SRGBColorSpace;
    this.setTextureFiltering(!settings.compat);
    // shadow map (sun) used by the shader mode
    const SR = settings.shadowRes || 1024;
    this.shadowRT = new THREE.WebGLRenderTarget(SR, SR, { depthTexture: new THREE.DepthTexture(SR, SR), depthBuffer: true });
    this.shadowRT.depthTexture.minFilter = THREE.NearestFilter; this.shadowRT.depthTexture.magFilter = THREE.NearestFilter;
    this.shadowCam = new THREE.OrthographicCamera(-48, 48, 48, -48, 1, 400);
    this.shadowDepthMat = new THREE.MeshBasicMaterial({ colorWrite: false });
    this.sunDir = new THREE.Vector3(0.3, 1, 0.2).normalize();
    this.shadowMat = new THREE.Matrix4();
    this.frameNo = 0;
    const uniforms = () => ({
      map: { value: this.atlasTex }, uDay: { value: 1 }, uFog: { value: new THREE.Color() },
      uFogNear: { value: 40 }, uFogFar: { value: 60 }, uAlpha: { value: 1 }, uAlphaTest: { value: 0.5 },
      uAmb: { value: 0.03 }, uAmbCol: { value: new THREE.Color(1, 1, 1) },
      uShadowMap: { value: this.shadowRT.depthTexture }, uShadowMat: { value: this.shadowMat }, uShadowOn: { value: 0 },
      uTexel: { value: 1 / SR }, uTime: { value: 0 }, uWave: { value: 1 }, uHDR: { value: 0 },
      uSunDir: { value: this.sunDir }, uSunCol: { value: new THREE.Color(1, 0.92, 0.75) }, uSkyCol: { value: new THREE.Color(0x86bdf8) },
    });
    this.solidMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: uniforms() });
    this.waterMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: uniforms(), transparent: true, depthWrite: false, side: THREE.DoubleSide, defines: { WATER: 1 } });
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
    this.post = new PostFX(this.renderer);
    this.shadowsOk = true;
    this.fancy = true;
    if (settings.compat) this.useSimpleShaders();
    this.sunScreen = new THREE.Vector2();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.handCam.aspect = w / h; this.handCam.updateProjectionMatrix();
    if (this.post) this.post.setSize(w, h);
  }

  setTextureFiltering(mips) {
    const t = this.atlasTex;
    t.mipmaps = [];
    t.generateMipmaps = !!mips;
    t.minFilter = mips ? THREE.NearestMipmapLinearFilter : THREE.NearestFilter;
    t.magFilter = THREE.NearestFilter;
    t.needsUpdate = true;
  }

  useSimpleShaders() {
    this.fancy = false;
    for (const m of [this.solidMat, this.waterMat]) {
      m.vertexShader = SIMPLE_VERT; m.fragmentShader = SIMPLE_FRAG; m.needsUpdate = true;
    }
  }

  // run once after the first rendered frame: fall back if the device cannot run the effects
  verifyGraphics() {
    if (this._verified) return;
    this._verified = true;
    const r = this.renderer, gl = r.getContext();
    const notes = [];
    if (this.fancy) {
      for (const m of [this.solidMat, this.waterMat]) {
        const prog = r.properties.get(m).currentProgram;
        if (prog && prog.diagnostics && prog.diagnostics.runnable === false) {
          console.warn('chunk shader failed', prog.diagnostics);
          this.useSimpleShaders(); notes.push('Shader'); break;
        }
      }
    }
    const fboOk = (rt) => {
      try {
        r.setRenderTarget(rt);
        const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
        r.setRenderTarget(null);
        return ok;
      } catch (e) { r.setRenderTarget(null); return false; }
    };
    if (!fboOk(this.shadowRT)) { this.shadowsOk = false; notes.push('Schatten'); }
    if (!fboOk(this.post.main)) {
      this.post.useLowPrecision();
      if (!fboOk(this.post.main)) { this.post.ok = false; notes.push('Effekte'); }
    }
    if (gl.getError() === gl.OUT_OF_MEMORY) { this.post.ok = false; notes.push('Speicher'); }
    if (!this.textureSelfTest()) {
      this.setTextureFiltering(false);
      if (!this.textureSelfTest()) { this.useSimpleShaders(); this.post.ok = false; }
      notes.push('Mipmaps');
    }
    if (notes.length) this.ui.toast('Grafik angepasst – auf diesem Gerät nicht verfügbar: ' + notes.join(', '), 5000);
  }

  // render a minified stone tile with the atlas and read it back; false if the texture samples as empty
  textureSelfTest() {
    const r = this.renderer;
    try {
      const rt = new THREE.WebGLRenderTarget(4, 4);
      const geo = new THREE.PlaneGeometry(2, 2);
      const [u0, v0, u1, v1] = tileUV('stone');
      const uv = geo.attributes.uv;
      for (let i = 0; i < 4; i++) uv.setXY(i, uv.getX(i) ? u1 : u0, uv.getY(i) ? v1 : v0);
      const mat = new THREE.MeshBasicMaterial({ map: this.atlasTex, alphaTest: 0.5 });
      const sc = new THREE.Scene(); sc.add(new THREE.Mesh(geo, mat));
      const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
      r.setRenderTarget(rt); r.setClearColor(0x000000, 0); r.clear(); r.render(sc, cam);
      const buf = new Uint8Array(4 * 4 * 4);
      r.readRenderTargetPixels(rt, 0, 0, 4, 4, buf);
      r.setRenderTarget(null); r.setClearColor(0x000000, 1);
      rt.dispose(); geo.dispose(); mat.dispose();
      let sum = 0, alpha = 0;
      for (let i = 0; i < 16; i++) { sum += buf[i * 4] + buf[i * 4 + 1] + buf[i * 4 + 2]; alpha += buf[i * 4 + 3]; }
      return alpha / 16 > 128 && sum / 16 > 60;
    } catch (e) { r.setRenderTarget(null); return true; }
  }

  applySettings() {
    this.setTextureFiltering(!this.settings.compat);
    if (this.settings.compat && this.fancy) this.useSimpleShaders();
    const s = this.settings;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, s.pixelRatio || 1));
    this.camera.fov = s.fov || 75; this.camera.updateProjectionMatrix();
    this.resize();
  }

  dayFactor() { const d = DIMS[this.dim || 'overworld']; return d.fixedDay !== null ? d.fixedDay : this.sky.dayFactor(this.time); }
  ambient() { return DIMS[this.dim || 'overworld'].amb; }
  chunkStore(dim = this.dim) { return dim === 'overworld' ? this.meta.id : this.meta.id + '~' + dim; }

  // ------------- world lifecycle -------------
  start(meta, savedChunks) {
    this.meta = meta;
    this.mode = meta.mode;
    this.dim = meta.dim || 'overworld';
    if (!meta.tilesByDim) meta.tilesByDim = { overworld: meta.tiles || {} };
    if (!meta.mobsByDim) meta.mobsByDim = { overworld: meta.mobs || [] };
    if (!meta.spawnedByDim) meta.spawnedByDim = {};
    this.createWorld(savedChunks);
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
    this.ents.load(meta.mobsByDim[this.dim]);
    this.ready = false;
    this.running = true;
    this.lastFrame = performance.now();
    this.ui.attach(this);
    requestAnimationFrame((t) => this.frame(t));
  }

  createWorld(savedChunks) {
    const meta = this.meta;
    this.world = new World(meta.seed, savedChunks, this.dim);
    this.world.onBlockChange = (x, y, z, old, id) => this.onBlockChange(x, y, z, old, id);
    for (const [k, v] of Object.entries(meta.tilesByDim[this.dim] || {})) this.world.tile.set(k, v);
    for (const k of meta.spawnedByDim[this.dim] || []) this.world.spawnedKeys.add(k);
    this.flow = new Map(); this.fluidQueue = [];
    this._order = null;
  }

  // ------------- dimensions -------------
  usePortal(id) {
    if (this.switching) return;
    const p = this.player;
    if (id === B.glutportal) {
      if (this.dim === 'overworld') this.changeDimension('nether', Math.floor(p.x / 8) + 0.5, Math.floor(p.z / 8) + 0.5, 'portal');
      else if (this.dim === 'nether') this.changeDimension('overworld', Math.floor(p.x * 8) + 0.5, Math.floor(p.z * 8) + 0.5, 'portal');
    } else if (id === B.leerenportal) {
      if (this.dim === 'end') { const sp = p.spawn || [0.5, 80, 0.5]; this.changeDimension('overworld', sp[0], sp[2], 'spawn'); }
      else this.changeDimension('end', 0.5, 6.5, 'end');
    }
  }

  async changeDimension(dim, x, z, arrival) {
    if (this.switching) return;
    this.switching = true;
    this.ready = false;
    this.ui.showLoading();
    this.ui.closeScreen();
    await this.save();
    for (const c of this.world.chunks.values()) this.disposeChunkMesh(c);
    this.ents.clear();
    let saved = new Map();
    try { saved = await loadChunks(this.chunkStore(dim)); } catch (e) { console.warn(e); }
    this.dim = dim;
    this.meta.dim = dim;
    this.createWorld(saved);
    this.ents.load(this.meta.mobsByDim[dim]);
    const p = this.player;
    p.x = x; p.z = z; p.y = 100; p.vx = p.vy = p.vz = 0; p.fallStart = null; p.flying = this.mode === 'creative' && p.flying;
    p.portalCooldown = true;
    this.arrival = arrival;
    this.mining = null; this.crack.visible = false;
    this.switching = false;
    this.ui.toast(DIMS[dim].name);
  }

  // place player safely after a dimension change (chunks around are loaded)
  handleArrival() {
    const w = this.world, p = this.player;
    const kind = this.arrival; this.arrival = null;
    const free = (x, y, z) => !SOLID[w.getBlock(x, y, z)] && !SOLID[w.getBlock(x, y + 1, z)] && w.getBlock(x, y, z) !== B.lava && w.getBlock(x, y + 1, z) !== B.lava;
    const ground = (x, y, z) => SOLID[w.getBlock(x, y - 1, z)];
    let spot = null;
    const bx = Math.floor(p.x), bz = Math.floor(p.z);
    if (kind === 'end') {
      const e = w.gen.endColumn(0, 6);
      spot = [0, (e ? e.top : 58) + 1, 6];
    } else if (this.dim === 'nether') {
      // existing portal nearby?
      search: for (let r = 0; r < 10; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        for (let y = 33; y < 110; y++) if (free(bx + dx, y, bz + dz) && ground(bx + dx, y, bz + dz)) { spot = [bx + dx, y, bz + dz]; break search; }
      }
      if (!spot) {
        spot = [bx, 64, bz];
        for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) { w.setBlock(bx + dx, 63, bz + dz, B.obsidian); for (let y = 64; y < 67; y++) w.setBlock(bx + dx, y, bz + dz, 0); }
      }
    } else {
      const y = w.surfaceY(bx, bz) + 1;
      spot = [bx, y, bz];
      if (!free(bx, y, bz)) { w.setBlock(bx, y, bz, 0); w.setBlock(bx, y + 1, bz, 0); }
    }
    p.x = spot[0] + 0.5; p.y = spot[1]; p.z = spot[2] + 0.5;
    if (kind === 'portal') {
      // build a return portal next to the player (unless one exists close by)
      let has = false;
      for (let dx = -4; dx <= 4 && !has; dx++) for (let dz = -4; dz <= 4 && !has; dz++) for (let dy = -3; dy <= 3; dy++) if (w.getBlock(spot[0] + dx, spot[1] + dy, spot[2] + dz) === B.glutportal) { has = true; break; }
      if (!has) {
        const px = spot[0] + 2, pz = spot[2];
        w.setBlock(px, spot[1] - 1, pz, B.obsidian);
        w.setBlock(px, spot[1], pz, B.glutportal); w.setBlock(px, spot[1] + 1, pz, B.glutportal);
        w.setBlock(px, spot[1] + 2, pz, B.obsidian);
        for (const dz of [-1, 1]) for (let dy = -1; dy <= 2; dy++) w.setBlock(px, spot[1] + dy, pz + dz, B.obsidian);
      }
    }
    this.flushEdits();
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
    this.meta.tilesByDim[this.dim] = tiles;
    this.meta.mobsByDim[this.dim] = this.ents.serialize();
    this.meta.spawnedByDim[this.dim] = [...this.world.spawnedKeys];
    delete this.meta.tiles; delete this.meta.mobs;
    Object.assign(this.meta, {
      time: this.time, mode: this.mode, lastPlayed: Date.now(), player: this.player.serialize(), dim: this.dim,
    });
    try {
      await saveChunks(this.chunkStore(), entries);
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
      // light the 3x3 neighbourhood first so borders get correct light (no dark seams)
      for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) { const n = w.getChunk(c.cx + ox, c.cz + oz); if (n && n.lightDirty && n !== c) w.computeLight(n); }
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
        if (this.arrival) this.handleArrival();
        else if (!this.meta.player) { pl.y = w.surfaceY(Math.floor(pl.x), Math.floor(pl.z)) + 1.01; }
        while (collides(w, pl.x - 0.3, pl.y, pl.z - 0.3, pl.x + 0.3, pl.y + 1.8, pl.z + 0.3) && pl.y < CH) pl.y += 1;
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
      } else if (id === B.oak_sapling || id === B.birch_sapling || id === B.spruce_sapling || id === B.jungle_sapling) {
        if (Math.random() < 0.15) this.growTree(x, y, z, id);
      } else if ((id === B.sugar_cane || id === B.cactus) && above === 0) {
        let h = 1; while (w.getBlock(x, y - h, z) === id) h++;
        if (h < 3 && Math.random() < 0.3) w.setBlock(x, y + 1, z, id);
      }
    }
  }

  growTree(x, y, z, sap) {
    const w = this.world;
    const type = sap === B.birch_sapling ? 'birch' : sap === B.spruce_sapling ? 'spruce' : sap === B.jungle_sapling ? 'jungle' : 'oak';
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
    if (hd.compass) {
      const list = this.world.gen.structures.nearest(p.x, p.z);
      if (!list.length) { this.ui.toast('Keine Bauwerke in dieser Dimension bekannt.'); return; }
      const DIR = ['Norden', 'Nordosten', 'Osten', 'Südosten', 'Süden', 'Südwesten', 'Westen', 'Nordwesten'];
      const lines = list.slice(0, 5).map((st) => {
        const a = Math.atan2(st.x - p.x, -(st.z - p.z));
        const d = DIR[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
        return `${st.name}: ${Math.round(st.dist)} Blöcke Richtung ${d} (X ${st.x}, Z ${st.z})`;
      });
      this.ui.toast(lines.join('\n'), 7000);
      this.swing = 1;
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
    if (hd.toolType === 'shovel' && (id === B.grass || id === B.dirt) && !SOLID[w.getBlock(x, y + 1, z)]) {
      w.setBlock(x, y, z, B.dirt_path); sfx.step('dirt'); this.damageHeld(1); this.swing = 1; this.flushEdits(); return;
    }
    if (hd.fertilizer) {
      let used = false;
      if (id >= B.wheat_0 && id < B.wheat_3) { w.setBlock(x, y, z, Math.min(B.wheat_3, id + 1 + Math.floor(Math.random() * 2))); used = true; }
      else if (id === B.oak_sapling || id === B.birch_sapling || id === B.spruce_sapling || id === B.jungle_sapling) { if (Math.random() < 0.45) this.growTree(x, y, z, id); used = true; }
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
    if (this.dim !== 'overworld') { this.changeDimension('overworld', sp[0], sp[2], 'spawn'); this.ui.dirty = true; return; }
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
    this.handLight.intensity = Math.max(Math.pow(0.82, 15 * (1 - lv)) * 1.0 + 0.1, this.ambient() * 1.8);
  }

  // ------------- sun shadows (shader mode) -------------
  renderShadows() {
    const on = this.settings.shaders !== false && !this.settings.compat && this.fancy && this.shadowsOk && this.dim === 'overworld' && this.ready;
    const day = this.dayFactor();
    const active = on && day > 0.3;
    for (const m of [this.solidMat, this.waterMat]) m.uniforms.uShadowOn.value = on ? 1 : 0;
    if (!active) { if (on) this.renderer.setRenderTarget(null); this.sunDir.set(0, -1, 0); return; }
    this.frameNo++;
    // sun direction (tilted a bit so shadows are never perfectly axis aligned)
    const ang = this.time * Math.PI * 2;
    this.sunDir.set(Math.cos(ang), Math.max(0.15, Math.sin(ang) * 0.8), 0.4).normalize();
    this.dir.position.copy(this.sunDir);
    if (this.frameNo % (this.settings.shadowEvery || 2) !== 0 && this._shadowValid) return;
    const p = this.player, cam = this.shadowCam;
    const snap = 2;
    const cx = Math.round(p.x / snap) * snap, cy = Math.round(p.y / snap) * snap, cz = Math.round(p.z / snap) * snap;
    cam.position.set(cx + this.sunDir.x * 150, cy + this.sunDir.y * 150, cz + this.sunDir.z * 150);
    cam.up.set(0, 0, 1);
    cam.lookAt(cx, cy, cz);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    this.shadowMat.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    // hide things that should not cast shadows
    const hidden = [this.sky.group, this.sky.clouds, this.selBox, this.crack];
    const prevVis = hidden.map((o) => o.visible);
    hidden.forEach((o) => (o.visible = false));
    const waterMeshes = [];
    for (const c of this.world.chunks.values()) if (c.mesh) for (const m of c.mesh) if (m.material === this.waterMat && m.visible) { m.visible = false; waterMeshes.push(m); }
    this.scene.overrideMaterial = this.shadowDepthMat;
    this.renderer.setRenderTarget(this.shadowRT);
    this.renderer.clear();
    this.renderer.render(this.scene, cam);
    this.renderer.setRenderTarget(null);
    this.scene.overrideMaterial = null;
    hidden.forEach((o, i) => (o.visible = prevVis[i]));
    for (const m of waterMeshes) m.visible = true;
    this._shadowValid = true;
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
    if (!this.switching) this.updateChunks(this.ready ? 6 : 30);
    const active = this.ready && !this.paused && !this.switching;
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
    this.sky.dim = this.dim;
    const skyCol = this.sky.update(this.camera.position, this.time, dt, this.settings);
    const day = this.dayFactor();
    const D = DIMS[this.dim];
    let fogCol = skyCol.clone(), near = (this.settings.renderDist || 4) * CS * 0.6, far = (this.settings.renderDist || 4) * CS * 0.95;
    if (D.fog !== undefined) { fogCol = new THREE.Color(D.fog); if (this.dim === 'nether') { near = 8; far = Math.min(far, 64); } }
    if (p.headInWater) { fogCol = new THREE.Color(0x1a3a8a).multiplyScalar(0.3 + day * 0.7); near = 1; far = 18; }
    if (p.headInLava) { fogCol = new THREE.Color(0xd04010); near = 0; far = 2; }
    // darker fog underground
    if (this.dim === 'overworld' && p.y < SEA - 10) { const [sky] = this.world.getLight(Math.floor(p.x), Math.floor(p.y + 1.6), Math.floor(p.z)); if (sky < 4) fogCol.multiplyScalar(0.25); }
    this.renderer.setClearColor(fogCol);
    for (const m of [this.solidMat, this.waterMat]) {
      m.uniforms.uDay.value = day; m.uniforms.uFog.value.copy(fogCol); m.uniforms.uFogNear.value = near; m.uniforms.uFogFar.value = far;
      m.uniforms.uAmb.value = D.amb; m.uniforms.uAmbCol.value.setRGB(D.ambCol[0], D.ambCol[1], D.ambCol[2]);
      m.uniforms.uTime.value = now / 1000; m.uniforms.uWave.value = this.settings.shaders !== false ? 1 : 0;
      m.uniforms.uSkyCol.value.copy(skyCol);
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
    this.renderShadows();
    const usePost = this.settings.shaders !== false && this.settings.postfx !== false && !this.settings.compat && this.fancy && this.post.ok;
    for (const m of [this.solidMat, this.waterMat]) m.uniforms.uHDR.value = usePost && this.post.hdr ? 1 : 0;
    if (usePost) this.post.begin(); else this.renderer.setRenderTarget(null);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    if (this.settings.showHand !== false && !p.dead) {
      this.renderer.clearDepth();
      this.renderer.render(this.handScene, this.handCam);
    }
    if (usePost) {
      // sun position on screen for light shafts
      const sd = this.sky.sunDir;
      const v = new THREE.Vector3().copy(this.camera.position).addScaledVector(sd, 300).project(this.camera);
      const fwd = new THREE.Vector3(); this.camera.getWorldDirection(fwd);
      const facing = fwd.dot(sd);
      let vis = this.dim === 'overworld' ? Math.max(0, Math.min(1, sd.y * 5)) * Math.max(0, Math.min(1, facing * 2)) : 0;
      if (p.headInWater) vis = 0;
      this.sunScreen.set(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5);
      const dayk = this.dim === 'overworld' ? day : 0.3;
      this.post.end({
        sun: this.sunScreen, sunVis: vis, rays: 0.9, bloom: this.dim === 'overworld' ? 0.32 + (1 - dayk) * 0.25 : 0.5,
        exposure: this.dim === "overworld" ? 0.98 + (1 - dayk) * 0.55 : 1.3, sat: 1.08, tint: this.sky.dome.material.uniforms.uSunCol.value,
      });
    }
    if (this.ready && !this._verified) this.verifyGraphics();
    this.ui.frame(dt);
  }
}
