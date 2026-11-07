// Post processing: HDR render target, bloom, sun rays (god rays), filmic tone mapping, colour grading.
import * as THREE from 'three';

const FS_VERT = `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const BRIGHT_FRAG = `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uSun;
uniform float uAspect, uSunVis, uThreshold;
varying vec2 vUv;
void main(){
  vec3 c = texture2D(tColor, vUv).rgb;
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec3 bloom = c * smoothstep(uThreshold, uThreshold + 0.6, lum);
  // sky pixels close to the sun feed the light shafts
  float depth = texture2D(tDepth, vUv).r;
  vec2 d = (vUv - uSun) * vec2(uAspect, 1.0);
  float glow = exp(-dot(d, d) * 9.0) * uSunVis;
  vec3 rays = depth > 0.99995 ? c * glow : vec3(0.0);
  gl_FragColor = vec4(bloom, 1.0);
  gl_FragColor.rgb += 0.0 * rays;
  gl_FragColor.a = 1.0;
}`;

const RAYMASK_FRAG = `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uSun;
uniform float uAspect, uSunVis;
varying vec2 vUv;
void main(){
  vec3 c = texture2D(tColor, vUv).rgb;
  float depth = texture2D(tDepth, vUv).r;
  vec2 d = (vUv - uSun) * vec2(uAspect, 1.0);
  float glow = exp(-dot(d, d) * 7.0) * uSunVis;
  gl_FragColor = vec4(depth > 0.99995 ? min(c, vec3(4.0)) * glow : vec3(0.0), 1.0);
}`;

const BLUR_FRAG = `
uniform sampler2D tInput;
uniform vec2 uDir;
varying vec2 vUv;
void main(){
  vec3 s = texture2D(tInput, vUv).rgb * 0.227;
  s += texture2D(tInput, vUv + uDir * 1.385).rgb * 0.316;
  s += texture2D(tInput, vUv - uDir * 1.385).rgb * 0.316;
  s += texture2D(tInput, vUv + uDir * 3.231).rgb * 0.070;
  s += texture2D(tInput, vUv - uDir * 3.231).rgb * 0.070;
  gl_FragColor = vec4(s, 1.0);
}`;

const RADIAL_FRAG = `
uniform sampler2D tInput;
uniform vec2 uSun;
varying vec2 vUv;
void main(){
  vec2 delta = (vUv - uSun) * (0.95 / 40.0);
  vec2 uv = vUv;
  vec3 sum = vec3(0.0);
  float w = 1.0;
  for (int i = 0; i < 40; i++) {
    uv -= delta;
    sum += texture2D(tInput, uv).rgb * w;
    w *= 0.965;
  }
  gl_FragColor = vec4(sum / 22.0, 1.0);
}`;

const COMPOSITE_FRAG = `
uniform sampler2D tColor;
uniform sampler2D tBloom;
uniform sampler2D tRays;
uniform float uBloom, uRays, uExposure, uSat, uVignette;
uniform vec3 uTint;
varying vec2 vUv;
vec3 aces(vec3 x){
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
void main(){
  vec3 col = texture2D(tColor, vUv).rgb;
  col += texture2D(tBloom, vUv).rgb * uBloom;
  col += texture2D(tRays, vUv).rgb * uRays * uTint;
  col *= uExposure;
  col = aces(col);
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, uSat);
  // gentle warm/cool split toning
  col = mix(col, col * vec3(1.04, 1.0, 0.95), smoothstep(0.4, 1.0, l));
  col = mix(col, col * vec3(0.95, 0.99, 1.06), 1.0 - smoothstep(0.0, 0.35, l));
  vec2 v = vUv - 0.5;
  col *= 1.0 - dot(v, v) * uVignette;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

export class PostFX {
  constructor(renderer) {
    this.r = renderer;
    const ext = renderer.extensions;
    this.hdr = !!(ext.has('EXT_color_buffer_half_float') || ext.has('EXT_color_buffer_float'));
    this.ok = true;
    const type = this.hdr ? THREE.HalfFloatType : THREE.UnsignedByteType;
    const opts = { type, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.main = new THREE.WebGLRenderTarget(4, 4, { type, depthBuffer: true, depthTexture: new THREE.DepthTexture(4, 4) });
    this.bloomA = new THREE.WebGLRenderTarget(4, 4, opts);
    this.bloomB = new THREE.WebGLRenderTarget(4, 4, opts);
    this.rayA = new THREE.WebGLRenderTarget(4, 4, opts);
    this.rayB = new THREE.WebGLRenderTarget(4, 4, opts);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene = new THREE.Scene();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    const mk = (frag, uniforms) => new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
    this.bright = mk(BRIGHT_FRAG, { tColor: { value: null }, tDepth: { value: null }, uSun: { value: new THREE.Vector2() }, uAspect: { value: 1 }, uSunVis: { value: 0 }, uThreshold: { value: 0.9 } });
    this.rayMask = mk(RAYMASK_FRAG, { tColor: { value: null }, tDepth: { value: null }, uSun: { value: new THREE.Vector2() }, uAspect: { value: 1 }, uSunVis: { value: 0 } });
    this.blur = mk(BLUR_FRAG, { tInput: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.radial = mk(RADIAL_FRAG, { tInput: { value: null }, uSun: { value: new THREE.Vector2() } });
    this.comp = mk(COMPOSITE_FRAG, {
      tColor: { value: null }, tBloom: { value: null }, tRays: { value: null }, uBloom: { value: 0.35 }, uRays: { value: 0.6 },
      uExposure: { value: 1.15 }, uSat: { value: 1.18 }, uVignette: { value: 0.55 }, uTint: { value: new THREE.Color(1, 0.85, 0.6) },
    });
  }

  setSize(w, h) {
    const pr = this.r.getPixelRatio();
    const W = Math.max(4, Math.floor(w * pr)), H = Math.max(4, Math.floor(h * pr));
    this.main.setSize(W, H);
    this.bloomA.setSize(W >> 2, H >> 2); this.bloomB.setSize(W >> 2, H >> 2);
    this.rayA.setSize(W >> 2, H >> 2); this.rayB.setSize(W >> 2, H >> 2);
    this.w = W; this.h = H;
  }

  begin() { this.r.setRenderTarget(this.main); }

  pass(mat, target) {
    this.quad.material = mat;
    this.r.setRenderTarget(target);
    this.r.render(this.scene, this.cam);
  }

  // p: {sun:Vector2 (uv), sunVis, bloom, rays, exposure, tint:Color, sat}
  end(p) {
    const aspect = this.w / this.h;
    const qw = this.bloomA.width, qh = this.bloomA.height;
    // bloom
    this.bright.uniforms.tColor.value = this.main.texture;
    this.bright.uniforms.tDepth.value = this.main.depthTexture;
    this.bright.uniforms.uThreshold.value = this.hdr ? 0.95 : 0.72;
    this.pass(this.bright, this.bloomA);
    for (let i = 0; i < 2; i++) {
      this.blur.uniforms.tInput.value = this.bloomA.texture; this.blur.uniforms.uDir.value.set((1 + i) / qw, 0);
      this.pass(this.blur, this.bloomB);
      this.blur.uniforms.tInput.value = this.bloomB.texture; this.blur.uniforms.uDir.value.set(0, (1 + i) / qh);
      this.pass(this.blur, this.bloomA);
    }
    // sun rays
    const raysOn = p.sunVis > 0.01 && p.rays > 0;
    if (raysOn) {
      const m = this.rayMask.uniforms;
      m.tColor.value = this.main.texture; m.tDepth.value = this.main.depthTexture; m.uSun.value.copy(p.sun); m.uAspect.value = aspect; m.uSunVis.value = p.sunVis;
      this.pass(this.rayMask, this.rayA);
      this.radial.uniforms.tInput.value = this.rayA.texture; this.radial.uniforms.uSun.value.copy(p.sun);
      this.pass(this.radial, this.rayB);
    }
    const c = this.comp.uniforms;
    c.tColor.value = this.main.texture; c.tBloom.value = this.bloomA.texture; c.tRays.value = this.rayB.texture;
    c.uBloom.value = p.bloom; c.uRays.value = raysOn ? p.rays : 0; c.uExposure.value = p.exposure; c.uSat.value = p.sat;
    c.uTint.value.copy(p.tint);
    this.pass(this.comp, null);
  }
}
