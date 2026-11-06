// Tiny synthesized sound effects (no external assets).
let ctx = null;
let master = null;
export let volume = 0.6;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = volume; master.connect(ctx.destination);
  } catch (e) { ctx = null; }
}
export function setVolume(v) { volume = v; if (master) master.gain.value = v; }

function noiseBuf(dur) {
  const n = Math.floor(ctx.sampleRate * dur);
  const b = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

function burst(freq, dur, gain, q = 1, type = 'bandpass') {
  if (!ctx) return;
  const src = ctx.createBufferSource(); src.buffer = noiseBuf(dur);
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); g.gain.setValueAtTime(gain, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
  src.connect(f); f.connect(g); g.connect(master); src.start();
}
function tone(freq, dur, gain, type = 'sine', slide = 0) {
  if (!ctx) return;
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, ctx.currentTime);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), ctx.currentTime + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(gain, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
  o.connect(g); g.connect(master); o.start(); o.stop(ctx.currentTime + dur);
}

const MAT_FREQ = { stone: 1800, wood: 700, dirt: 400, sand: 2500, grass: 900, glass: 4000, wool: 300 };
export function matOf(key) {
  if (/glass|ice/.test(key)) return 'glass';
  if (/wool|bed/.test(key)) return 'wool';
  if (/sand|gravel|snow/.test(key)) return 'sand';
  if (/dirt|farmland|clay/.test(key)) return 'dirt';
  if (/grass|leaves|flower|poppy|dandelion|sapling|wheat|cane|bush|mushroom|cactus|hay/.test(key)) return 'grass';
  if (/log|plank|table|chest|bookshelf|fence|ladder|pumpkin|melon/.test(key)) return 'wood';
  return 'stone';
}
export const sfx = {
  dig(key) { burst(MAT_FREQ[matOf(key)] || 1000, 0.12, 0.35, 1.2); },
  break(key) { burst(MAT_FREQ[matOf(key)] || 1000, 0.25, 0.6, 0.8); },
  place(key) { burst((MAT_FREQ[matOf(key)] || 1000) * 0.8, 0.15, 0.5, 1); },
  step(key) { burst((MAT_FREQ[matOf(key)] || 1000) * 0.7, 0.08, 0.12, 1.5); },
  hurt() { tone(220, 0.18, 0.4, 'square', -80); },
  hit() { burst(600, 0.1, 0.5, 2); tone(150, 0.1, 0.3, 'triangle', -50); },
  pop() { tone(700, 0.08, 0.25, 'sine', 500); },
  eat() { burst(1200, 0.08, 0.3, 3); setTimeout(() => burst(1000, 0.08, 0.3, 3), 120); },
  splash() { burst(800, 0.35, 0.4, 0.5, 'lowpass'); },
  bow() { tone(400, 0.15, 0.25, 'triangle', -200); burst(3000, 0.1, 0.2, 1); },
  mob(type) {
    if (type === 'pig') { tone(300, 0.15, 0.25, 'sawtooth', 120); }
    else if (type === 'cow') { tone(140, 0.5, 0.3, 'sawtooth', -30); }
    else if (type === 'sheep') { tone(380, 0.35, 0.2, 'triangle', 20); tone(390, 0.35, 0.1, 'square', 15); }
    else if (type === 'chicken') { tone(1200, 0.07, 0.15, 'square', 300); }
    else if (type === 'zombie') { tone(110, 0.6, 0.3, 'sawtooth', -40); }
    else if (type === 'skeleton') { burst(2500, 0.1, 0.3, 4); setTimeout(() => burst(2200, 0.1, 0.3, 4), 90); }
    else if (type === 'spider') { burst(3500, 0.25, 0.2, 6); }
  },
  click() { tone(900, 0.04, 0.15, 'square'); },
};
