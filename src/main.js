// ---------------------------------------------------------------------------
// Entry point: create the scene, wire the HUD, expose hooks for the screenshot
// harness, and start the frame loop.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { SceneManager } from './core/scene.js';
import { Ambient } from './systems/audio.js';
import { PALETTE } from './core/config.js';

const params = new URLSearchParams(location.search);
const quality = params.get('q') || (window.devicePixelRatio > 2 ? 'high' : 'high');

const canvas = document.getElementById('scene');
const loading = document.getElementById('loading');
const hud = document.getElementById('hud');

let scene;
try {
  scene = new SceneManager(canvas, { quality });
} catch (err) {
  console.error('scene failed to build', err);
  if (loading) {
    loading.innerHTML = `<div class="err"><b>场景构建失败</b><pre>${String(err && err.stack || err)}</pre></div>`;
    loading.classList.remove('hidden');
  }
  throw err;
}

// ---- HUD ------------------------------------------------------------------
const fpsEl = document.getElementById('fps');
const drawEl = document.getElementById('draw');
const triEl = document.getElementById('tris');

function updateHud() {
  if (document.body.classList.contains('hide-ui')) return;
  if (fpsEl) fpsEl.textContent = String(scene.stats.fps);
  if (drawEl) drawEl.textContent = String(scene.stats.calls);
  if (triEl) triEl.textContent = `${Math.round(scene.stats.triangles / 1000)}k`;
}

setInterval(updateHud, 400);

// ---- score ----------------------------------------------------------------
// Browsers refuse to start WebAudio without a gesture, so the piece stays
// silent until the visitor turns it on (the ♪ button or the M key).
const audio = new Ambient();
const soundBtn = document.getElementById('sound');

function paintSound() {
  if (!soundBtn) return;
  soundBtn.classList.toggle('on', !audio.muted);
  soundBtn.textContent = audio.muted ? '♪ 音乐 关' : '♪ 音乐 开';
  soundBtn.title = audio.mode === 'file'
    ? '正在播放 assets/the-rescue'
    : '原创氛围配乐（把 the-rescue 放进 assets/ 即可换成原曲）';
}

async function toggleSound(force) {
  try {
    await audio.toggle(force);
    paintSound();
  } catch (err) {
    console.warn('audio unavailable', err);
  }
}

if (soundBtn) soundBtn.addEventListener('click', () => toggleSound());
paintSound();

// ---- debug / harness hooks -------------------------------------------------
window.__THREE = THREE;
window.__D = scene;
window.__D.audio = audio;
window.__D.toggleSound = toggleSound;

// bind the originals first — window.__D IS the scene, so defining a method on
// it would shadow the very method we are forwarding to (infinite recursion)
const _setView = scene.setView.bind(scene);
const _view = scene.view.bind(scene);
const _resetView = scene.resetView.bind(scene);

window.__D.stats = () => {
  // Read the position defensively: after minification the controller may hold
  // a Vector3-like plain object, and a throwing stats() breaks the whole
  // screenshot harness (it is the only thing that reports fps).
  const p = scene.controller.position || {};
  const num = (v) => (typeof v === 'number' ? +v.toFixed(2) : 0);
  return {
    fps: scene.stats.fps,
    calls: scene.stats.calls,
    triangles: scene.stats.triangles,
    position: [num(p.x), num(p.y), num(p.z)],
    yaw: num(scene.controller.yaw),
    quality,
    water: scene.water.enabled,
    shadows: scene.renderer.shadowMap.enabled,
    composerPasses: scene.post.composer.passes.length,
  };
};

window.__D.setView = (...a) => _setView(...a);
window.__D.view = (name) => _view(name);
window.__D.resetView = () => _resetView();

// a couple of keyboard shortcuts for the demo
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyH') document.body.classList.toggle('hide-ui');
  if (e.code === 'KeyR') scene.resetView();
  if (e.code === 'KeyM') toggleSound();
});

// ---- go -------------------------------------------------------------------
scene.start();

// let the first frames (textures, shaders, shadow maps, reflection) settle
// before the screenshot harness grabs the image
let readyFrames = 0;
function markReady() {
  readyFrames++;
  if (readyFrames < 4) {
    requestAnimationFrame(markReady);
    return;
  }
  scene.sky.update(scene.camera);
  scene.water.renderReflection(scene.renderer, scene.scene, scene.camera);
  scene.post.render(0.016);
  requestAnimationFrame(() => {
    if (loading) {
      loading.classList.add('hidden');
      setTimeout(() => loading.remove(), 700);
    }
    updateHud();
    window.__DL_READY = true;
  });
}
requestAnimationFrame(markReady);

// expose colour palette for console experiments
window.__PALETTE = PALETTE;
