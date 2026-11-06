// Sky dome colors, sun, moon, stars, clouds.
import * as THREE from 'three';
import { mulberry32 } from './noise.js';

function pixelTex(size, paint) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d');
  paint(ctx, size);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Sky {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    const sunTex = pixelTex(16, (c) => {
      c.fillStyle = '#fff6b0'; c.fillRect(2, 2, 12, 12);
      c.fillStyle = '#ffffff'; c.fillRect(4, 4, 8, 8);
      c.fillStyle = 'rgba(255,230,120,0.5)'; c.fillRect(0, 4, 16, 8); c.fillRect(4, 0, 8, 16);
    });
    const moonTex = pixelTex(16, (c) => {
      c.fillStyle = '#e8ecf4'; c.fillRect(3, 3, 10, 10);
      c.fillStyle = '#b8c0d0'; c.fillRect(5, 5, 2, 2); c.fillRect(9, 8, 3, 2); c.fillRect(6, 10, 2, 1);
    });
    const mk = (tex, s) => new THREE.Mesh(new THREE.PlaneGeometry(s, s), new THREE.MeshBasicMaterial({ map: tex, transparent: true, fog: false, depthWrite: false }));
    this.sun = mk(sunTex, 60); this.moon = mk(moonTex, 40);
    this.group.add(this.sun, this.moon);
    // stars
    const rnd = mulberry32(42);
    const pts = [];
    for (let i = 0; i < 700; i++) {
      const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      pts.push(Math.cos(a) * r * 400, u * 400, Math.sin(a) * r * 400);
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, fog: false, depthWrite: false }));
    this.group.add(this.stars);
    // clouds
    const cloudTex = pixelTex(64, (c) => {
      const r = mulberry32(7);
      c.clearRect(0, 0, 64, 64);
      c.fillStyle = 'rgba(255,255,255,0.85)';
      for (let i = 0; i < 26; i++) {
        const x = Math.floor(r() * 64), y = Math.floor(r() * 64), w = 3 + Math.floor(r() * 8), h = 2 + Math.floor(r() * 5);
        c.fillRect(x, y, w, h); c.fillRect((x + 64) % 64 - 64, y, w, h); c.fillRect(x, y - 64 + (y > 58 ? 64 : 0), w, h);
      }
    });
    cloudTex.wrapS = cloudTex.wrapT = THREE.RepeatWrapping;
    cloudTex.repeat.set(4, 4);
    this.cloudTex = cloudTex;
    this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(1536, 1536), new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false, opacity: 0.85 }));
    this.clouds.rotation.x = -Math.PI / 2;
    scene.add(this.clouds);
    this.color = new THREE.Color();
  }

  // time in [0,1): 0 = sunrise, 0.25 noon, 0.5 sunset, 0.75 midnight
  update(camPos, time, dt, settings) {
    const ang = time * Math.PI * 2;
    const sx = Math.cos(ang), sy = Math.sin(ang);
    this.group.position.copy(camPos);
    this.group.updateMatrixWorld();
    this.sun.position.set(sx * 300, sy * 300, 0);
    this.sun.lookAt(camPos);
    this.moon.position.set(-sx * 300, -sy * 300, 0);
    this.moon.lookAt(camPos);
    const day = this.dayFactor(time);
    const dim = this.dim || 'overworld';
    this.sun.visible = this.moon.visible = dim === 'overworld';
    this.stars.material.opacity = dim === 'end' ? 0.9 : dim === 'nether' ? 0 : Math.max(0, 1 - day * 1.6);
    if (dim !== 'overworld') {
      this.clouds.visible = false;
      return this.color.set(dim === 'nether' ? 0x3a0c06 : 0x120a1c);
    }
    this.stars.rotation.z = ang;
    this.clouds.visible = settings.clouds !== false;
    this.clouds.position.set(Math.floor(camPos.x / 384) * 384, 112, Math.floor(camPos.z / 384) * 384);
    this.cloudTex.offset.x += dt * 0.0008;
    const cl = 0.35 + day * 0.65;
    this.clouds.material.color.setRGB(cl, cl, cl);
    // sky colour
    const dayC = new THREE.Color(0x86bdf8), nightC = new THREE.Color(0x070b1c), duskC = new THREE.Color(0xf09a5a);
    this.color.copy(nightC).lerp(dayC, day);
    const dusk = Math.max(0, 1 - Math.abs(sy) * 4) * (Math.abs(sx) > 0.5 ? 1 : 0);
    this.color.lerp(duskC, dusk * 0.45);
    return this.color;
  }

  dayFactor(time) {
    const sy = Math.sin(time * Math.PI * 2);
    return Math.max(0.1, Math.min(1, sy * 2.5 + 0.55));
  }
}
