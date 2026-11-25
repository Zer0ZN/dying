// ---------------------------------------------------------------------------
// Post-processing.
//
// RenderPass -> GTAO (contact darkening in the room) -> Bloom (restrained; only
// the lamp and the lit far cabin cross the threshold) -> a small custom grade
// pass (cool shadows, gentle S-curve, vignette) -> OutputPass, which is what
// actually converts from linear to sRGB and applies the ACES tone curve.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 1.0 },
    uShadowTint: { value: new THREE.Color(0x24406e) },
    uHighTint: { value: new THREE.Color(0xffe4cc) },
    uContrast: { value: 1.06 },
    uSaturation: { value: 1.04 },
    uLift: { value: 0.012 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignette;
    uniform vec3 uShadowTint;
    uniform vec3 uHighTint;
    uniform float uContrast;
    uniform float uSaturation;
    uniform float uLift;
    varying vec2 vUv;

    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;                       // already sRGB-ish display values

      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));

      // split tone: push the shadows toward deep blue, the highlights toward
      // warm paper. Additive, so it can never zero a channel out.
      vec3 shadowTint = uShadowTint;
      vec3 highTint = uHighTint;
      float sW = (1.0 - smoothstep(0.0, 0.55, luma)) * 0.55;
      float hW = smoothstep(0.55, 1.0, luma) * 0.30;
      col = mix(col, col + shadowTint * 0.055, sW);
      col = mix(col, col + highTint * 0.045, hW);

      // gentle S-curve about mid grey, no clipping
      col = (col - 0.5) * uContrast + 0.5;

      // lift the floor a hair so the room never crushes to black
      col += uLift * (1.0 - luma) * vec3(0.72, 0.86, 1.10);

      // saturation
      float g = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(g), col, uSaturation);

      // vignette, cinematic and subtle
      vec2 d = vUv - 0.5;
      float vig = 1.0 - dot(d, d) * 0.62 * uVignette;
      col *= clamp(vig, 0.0, 1.0);

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }
  `,
};

export class PostProcessing {
  constructor(renderer, scene, camera, quality = 'high') {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.quality = quality;

    const size = renderer.getSize(new THREE.Vector2());
    const pr = renderer.getPixelRatio();
    const w = Math.max(2, Math.floor(size.x * pr));
    const h = Math.max(2, Math.floor(size.y * pr));

    const target = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      samples: quality === 'low' ? 0 : 4,
    });

    this.composer = new EffectComposer(renderer, target);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(size.x, size.y);

    // --- base render -------------------------------------------------------
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    // --- ambient occlusion -------------------------------------------------
    this.gtao = null;
    if (quality !== 'low') {
      const gtao = new GTAOPass(scene, camera, w, h);
      gtao.output = GTAOPass.OUTPUT.Default;
      gtao.blendIntensity = 0.85;
      gtao.updateGtaoMaterial({
        radius: 0.34,
        distanceExponent: 1.2,
        thickness: 1.0,
        scale: 1.0,
        samples: quality === 'high' ? 16 : 8,
        distanceFallOff: 1.0,
        screenSpaceRadius: false,
      });
      gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, rings: 2, samples: 12 });
      gtao.setSceneClipBox(new THREE.Box3(new THREE.Vector3(-12, -1, -12), new THREE.Vector3(12, 8, 12)));
      this.gtao = gtao;
      this.composer.addPass(gtao);
    }

    // --- bloom -------------------------------------------------------------
    const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.42, 0.7, 0.85);
    bloom.threshold = quality === 'low' ? 1.2 : 0.92;
    bloom.strength = quality === 'low' ? 0.28 : 0.40;
    bloom.radius = 0.62;
    this.bloom = bloom;
    this.composer.addPass(bloom);

    // --- output (tone mapping + colour space) ------------------------------
    // Must come BEFORE the grade: everything upstream works in linear HDR, and
    // a contrast/split-tone/vignette authored for display values will crush the
    // shadows to zero if it runs on linear light.
    this.output = new OutputPass();
    this.composer.addPass(this.output);

    // --- grade (now in display-referred sRGB) ------------------------------
    this.grade = new ShaderPass(GradeShader);
    this.grade.uniforms.uVignette.value = 1.0;
    this.composer.addPass(this.grade);
  }

  setSize(w, h) {
    const pr = this.renderer.getPixelRatio();
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
  }

  render(dt) {
    if (this.grade) this.grade.uniforms.uTime.value += dt || 0;
    this.composer.render(dt);
  }

  dispose() {
    this.composer.dispose();
  }
}
