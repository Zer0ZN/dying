// ---------------------------------------------------------------------------
// SkySystem — a large inverted sphere with a hand-written GLSL gradient.
//
// The gradient is built from four bands (zenith / upper / mid / horizon) that
// the shader blends with a non-linear power curve, which is what makes the
// transition read like a real twilight sky instead of a linear ramp. A warm
// afterglow lobe is added very low on the southern horizon (the sun just set
// behind the viewer) so the snow on the peaks has a plausible light source.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { PALETTE, WORLD } from '../core/config.js';

const VERT = /* glsl */ `
  varying vec3 vWorldDir;
  void main() {
    vWorldDir = (modelMatrix * vec4(position, 1.0)).xyz - cameraPosition;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;

  uniform vec3 uZenith;
  uniform vec3 uUpper;
  uniform vec3 uMid;
  uniform vec3 uLower;
  uniform vec3 uHorizon;
  uniform vec3 uGlow;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uSkyIntensity;

  varying vec3 vWorldDir;

  // cheap hash for the faint high-altitude structure
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i), b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  void main() {
    vec3 dir = normalize(vWorldDir);
    float h = clamp(dir.y, -1.0, 1.0);

    // ------------------------------------------------------------------
    // vertical gradient — power curves keep the mid band wide and the
    // horizon band tight, the way real twilight reads. The stops are spread
    // across the full 0..1 elevation range so the camera, which normally
    // looks at 5-35 degrees, actually sees a gradient and not one flat value.
    // ------------------------------------------------------------------
    float t = clamp(h, 0.0, 1.0);

    // zenith -> upper  (only the very top of the dome goes near-black)
    float k1 = smoothstep(0.42, 1.0, t);
    vec3 col = mix(uUpper, uZenith, pow(k1, 0.78));

    // upper -> mid  (the big band of visible sky)
    float k2 = smoothstep(0.09, 0.58, t);
    col = mix(uMid, col, pow(k2, 0.92));

    // mid -> lower
    float k3 = smoothstep(0.012, 0.205, t);
    col = mix(uLower, col, pow(k3, 0.85));

    // lower -> horizon haze
    float k4 = smoothstep(-0.020, 0.048, t);
    col = mix(uHorizon, col, k4);

    // ------------------------------------------------------------------
    // warm afterglow — a long, low lobe where the sun went down.
    // It is *not* a sun disc; it is the residual scattering that lights
    // the peaks from below.
    // ------------------------------------------------------------------
    vec3 sunFlat = normalize(vec3(uSunDir.x, 0.0, uSunDir.z));
    vec3 dirFlat = normalize(vec3(dir.x, 0.0, dir.z));
    float az = max(dot(sunFlat, dirFlat), 0.0);

    // horizontal width of the glow lobe, and its vertical falloff
    // Kept deliberately narrow and weak. The sun is already well below the
    // ridge, so what is left is a thin band hugging the horizon on one side.
    // A wide lobe colours the whole south sky pink and the bedroom windows
    // then read as a sunset instead of blue hour.
    float azLobe = pow(az, 6.0) * 0.85 + pow(az, 26.0) * 0.55;
    float vertLobe = exp(-pow((t - 0.014) / 0.085, 2.0));
    float glow = azLobe * vertLobe;
    col += uSunColor * glow * 0.30;

    // a very slightly brighter band all along the horizon, cool side too
    float band = exp(-pow(t / 0.070, 2.0));
    col += uGlow * band * 0.075;

    // ------------------------------------------------------------------
    // subtle high cirrus structure — barely visible, keeps the sky from
    // looking like a synthetic gradient.
    // ------------------------------------------------------------------
    vec2 sp = vec2(atan(dir.z, dir.x) * 2.2, dir.y * 9.0);
    float c1 = vnoise(sp * 2.4) * 0.55 + vnoise(sp * 6.1) * 0.30 + vnoise(sp * 14.0) * 0.15;
    float cirrusMask = smoothstep(0.10, 0.62, t);
    col += vec3(0.020, 0.030, 0.045) * (c1 - 0.5) * cirrusMask;

    // ------------------------------------------------------------------
    // below the horizon: fade to the deep water/lake haze colour so the
    // sky sphere never shows a hard seam behind the water plane.
    // ------------------------------------------------------------------
    float below = smoothstep(0.0, -0.10, h);
    col = mix(col, uHorizon * 0.62, below);

    col *= uSkyIntensity;

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export class SkySystem {
  constructor() {
    const geo = new THREE.SphereGeometry(1, 48, 32);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uZenith: { value: new THREE.Color(PALETTE.skyZenith) },
        uUpper: { value: new THREE.Color(PALETTE.skyUpper) },
        uMid: { value: new THREE.Color(PALETTE.skyMid) },
        uLower: { value: new THREE.Color(PALETTE.skyLower) },
        uHorizon: { value: new THREE.Color(PALETTE.skyHorizon) },
        uGlow: { value: new THREE.Color(PALETTE.skyGlow) },
        uSunDir: { value: new THREE.Vector3(...WORLD.sun.dir).normalize() },
        uSunColor: { value: new THREE.Color(PALETTE.alpenglow) },
        uSkyIntensity: { value: 1.0 },
      },
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.scale.setScalar(1);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.name = 'sky';
  }

  addTo(scene) {
    scene.add(this.mesh);
    this.scene = scene;
  }

  // keep the dome centred on the camera, and stretch it past the far plane
  update(camera) {
    this.mesh.position.copy(camera.position);
    // scale so the dome always encloses everything, regardless of far plane
    const far = camera.far;
    this.mesh.scale.setScalar(far * 0.92);
  }

  // ---------------------------------------------------------------------
  // Image-based lighting straight off the dome.
  //
  // A hemisphere light can only interpolate two colours; the real sky here has
  // a zenith gradient, a bright horizon and a warm afterglow lobe, and snow is
  // a near-lambertian surface that reflects ALL of it. Rendering the dome into
  // a PMREM cube is what makes the ground read as moonlit snow instead of a
  // flat blue plate, and it gives the metalness-0 roof a grazing highlight.
  // Returns a texture to assign to scene.environment, or null if unsupported.
  // ---------------------------------------------------------------------
  buildEnvironment(renderer) {
    if (this._env) return this._env;
    let pmrem = null;
    try {
      pmrem = new THREE.PMREMGenerator(renderer);
      pmrem.compileEquirectangularShader();

      // the dome's shader reads cameraPosition, so bake from a sphere sitting
      // at the origin with unit scale — that keeps the gradient undistorted
      const probe = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), this.material);
      probe.frustumCulled = false;
      const tmp = new THREE.Scene();
      tmp.add(probe);

      const rt = pmrem.fromScene(tmp, 0, 0.05, 12);
      this._env = rt.texture;

      tmp.remove(probe);
      probe.geometry.dispose();
      return this._env;
    } catch (err) {
      console.warn('sky environment unavailable', err);
      return null;
    } finally {
      if (pmrem) pmrem.dispose();
    }
  }

  // ---------------------------------------------------------------------
  // Average sky radiance looking straight up — used to derive the ambient
  // fill so the interior blue matches the actual sky.
  // ---------------------------------------------------------------------
  getHorizonColor(target = new THREE.Color()) {
    return target.setHex(PALETTE.skyHorizon);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
