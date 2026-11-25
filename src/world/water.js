// ---------------------------------------------------------------------------
// WaterSystem
//
// A real planar reflection: the scene is rendered from a mirrored camera into
// an off-screen target with an oblique near plane (Lengyel), so the reflection
// contains the actual mountains, the actual afterglow and the actual cabin —
// never a painted-in fake.
//
// The surface itself is a custom shader: Fresnel mix between the reflected
// colour and a very dark, cold lake body colour, two slowly scrolling layers of
// ripple normal, and a broad specular sheen from the afterglow. The lake is
// nearly frozen — the ripple amplitude is tiny and the layers drift at about a
// centimetre per second.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { PALETTE, WORLD } from '../core/config.js';
import { waterRippleNormal } from '../core/textures.js';

const VERT = /* glsl */ `
  uniform mat4 textureMatrix;
  varying vec4 vReflectCoord;
  varying vec3 vWorldPos;
  varying vec3 vNormalW;
  #include <fog_pars_vertex>

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vNormalW = normalize(mat3(modelMatrix) * vec3(0.0, 1.0, 0.0));
    vReflectCoord = textureMatrix * vec4(position, 1.0);

    vec4 mvPosition = viewMatrix * worldPos;
    gl_Position = projectionMatrix * mvPosition;

    #include <fog_vertex>
  }
`;

const FRAG = /* glsl */ `
  precision highp float;

  uniform sampler2D tReflect;
  uniform sampler2D tRipple;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uTint;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uTime;
  uniform float uRippleStrength;
  uniform float uReflectStrength;

  varying vec4 vReflectCoord;
  varying vec3 vWorldPos;
  varying vec3 vNormalW;

  #include <fog_pars_fragment>

  void main() {
    vec3 viewDir = normalize(cameraPosition - vWorldPos);

    // ---- ripple normal: two layers drifting at different speeds ----------
    vec2 uvA = vWorldPos.xz * 0.0105 + vec2(uTime * 0.0042, uTime * 0.0031);
    vec2 uvB = vWorldPos.xz * 0.0230 - vec2(uTime * 0.0034, uTime * 0.0056);
    vec3 nA = texture2D(tRipple, uvA).rgb * 2.0 - 1.0;
    vec3 nB = texture2D(tRipple, uvB).rgb * 2.0 - 1.0;
    vec2 ripple = (nA.xy * 0.62 + nB.xy * 0.38);

    // fade the ripple out with distance so the far water reads glassy
    float dist = length(vWorldPos.xz - cameraPosition.xz);
    float attenuate = exp(-dist * 0.0075);
    ripple *= uRippleStrength * (0.30 + 0.70 * attenuate);

    vec3 N = normalize(vec3(ripple.x, 1.0, ripple.y));

    // ---- Fresnel ---------------------------------------------------------
    float fres = pow(1.0 - clamp(dot(N, viewDir), 0.0, 1.0), 4.2);
    fres = mix(0.035, 1.0, fres);

    // ---- planar reflection + distortion ---------------------------------
    vec3 coord = vReflectCoord.xyz / vReflectCoord.w;
    vec2 distort = ripple * vec2(0.010, 0.014) * (0.35 + 0.65 * attenuate);
    vec2 ruv = clamp(coord.xy + distort, vec2(0.002), vec2(0.998));

    vec3 refl = texture2D(tReflect, ruv).rgb;
    // a second, jittered tap softens the mirror without blurring it flat
    vec3 refl2 = texture2D(tReflect, clamp(coord.xy + distort * 2.6, vec2(0.002), vec2(0.998))).rgb;
    refl = mix(refl, refl2, 0.22);

    // ---- body colour: near-black teal, slightly lighter near the shore ---
    // A steep exponential here banded visibly on the wide lake when seen from
    // above (8-bit steps across a 200 m gradient), so the falloff is stretched
    // out; the near-shore tint now arrives gradually instead of stepping.
    float shore = exp(-max(vWorldPos.z - 8.0, 0.0) * 0.045);
    vec3 body = mix(uDeep, uShallow, shore * 0.55);
    body = mix(body, uTint, 0.16);

    vec3 col = mix(body, refl * uReflectStrength, fres);

    // ---- grazing sheen from the afterglow --------------------------------
    // The direct sun is already below the horizon, so there is no solar disc
    // left to make a point glint. A tight pow(ndh, 420) lobe is nonetheless
    // mathematically correct here (sun ~5 deg up, eye looking ~2 deg down,
    // so H lands almost on the normal) and produced a small white searchlight
    // out on the lake that bloom then blew up into a UFO. What is actually
    // left at this hour is a broad, soft sheen, so the tight term is dropped
    // to a barely-visible hint and the wide term carries the light.
    // Even the residual tight lobe still produced a small round white disc
    // out on the water that bloom turned into something that read as a MOON
    // seen through the window. There is no moon in this scene. What is left at
    // this hour is a broad, soft sheen with no point at all, so the tight term
    // is removed entirely and the wide term is widened further.
    vec3 H = normalize(uSunDir + viewDir);
    float ndh = max(dot(N, H), 0.0);
    // Kept deliberately weak: with a rippled normal a broad lobe breaks into
    // radial streaks that read as searchlights fanning out from the shore.
    float spec = pow(ndh, 5.0) * 0.030;
    // only where the water actually faces the southern glow
    float southFacing = smoothstep(-0.15, 0.85, dot(normalize(vec3(viewDir.x, 0.0, viewDir.z)), normalize(vec3(uSunDir.x, 0.0, uSunDir.z))));
    col += uSunColor * spec * (0.35 + 0.65 * southFacing);

    // ---- cold rim where the water meets the ice at the shore -------------
    col += vec3(0.020, 0.028, 0.040) * shore;

    gl_FragColor = vec4(col, 1.0);

    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export class WaterSystem {
  constructor(renderer) {
    this.renderer = renderer;
    this.enabled = true;
    this.time = 0;
    this._frame = 0;
    this._renderedFrame = -1;

    const size = renderer.getSize(new THREE.Vector2());
    const rtW = Math.max(512, Math.round(size.x * 0.55));
    const rtH = Math.max(320, Math.round(size.y * 0.55));

    this.renderTarget = new THREE.WebGLRenderTarget(rtW, rtH, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType,
      depthBuffer: true,
    });
    this.renderTarget.texture.colorSpace = THREE.NoColorSpace;

    this.virtualCamera = new THREE.PerspectiveCamera();

    const ripple = waterRippleNormal(512, [1, 1]);
    this.rippleTexture = ripple;

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          tReflect: { value: this.renderTarget.texture },
          tRipple: { value: ripple },
          uDeep: { value: new THREE.Color(PALETTE.waterDeep) },
          uShallow: { value: new THREE.Color(PALETTE.waterShallow) },
          uTint: { value: new THREE.Color(PALETTE.waterTint) },
          uSunDir: { value: new THREE.Vector3(...WORLD.sun.dir).normalize() },
          uSunColor: { value: new THREE.Color(PALETTE.alpenglow) },
          uTime: { value: 0 },
          uRippleStrength: { value: 1.0 },
          uReflectStrength: { value: 1.0 },
        },
      ]),
    });
    // UniformsUtils.merge deep-clones; re-bind the ones holding objects
    this.material.uniforms.tReflect.value = this.renderTarget.texture;
    this.material.uniforms.tRipple.value = ripple;
    this.material.uniforms.textureMatrix = { value: new THREE.Matrix4() };

    const geo = new THREE.PlaneGeometry(3400, 3400, 96, 96);
    geo.rotateX(-Math.PI / 2);

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'water';
    this.mesh.position.set(0, WORLD.waterY, 0);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.updateMatrix();

    // reflection bookkeeping
    this._reflPlane = new THREE.Plane();
    this._normal = new THREE.Vector3();
    this._reflWorldPos = new THREE.Vector3();
    this._camWorldPos = new THREE.Vector3();
    this._rotMat = new THREE.Matrix4();
    this._lookTarget = new THREE.Vector3();
    this._view = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._clipPlane = new THREE.Vector4();
    this._q = new THREE.Vector4();
    this._texMatrix = new THREE.Matrix4();

    this.mesh.onBeforeRender = (r, scene, camera) => this.renderReflection(r, scene, camera);
    this.mesh.onAfterRender = () => {};
  }

  addTo(scene) {
    scene.add(this.mesh);
    this.scene = scene;
  }

  // call once per animation frame before rendering
  tick(dt) {
    this.time += dt;
    this._frame++;
    this.material.uniforms.uTime.value = this.time;
  }

  setSize(w, h) {
    this.renderTarget.setSize(Math.max(512, Math.round(w * 0.55)), Math.max(320, Math.round(h * 0.55)));
  }

  // ---------------------------------------------------------------------
  // Mirrored-camera render with an oblique near plane.
  // ---------------------------------------------------------------------
  renderReflection(renderer, scene, camera) {
    if (!this.enabled) return;
    // the depth / normal prepasses of the post stack also touch this mesh;
    // only pay for one reflection per animation frame
    if (this._renderedFrame === this._frame) return;
    this._renderedFrame = this._frame;

    const scope = this;
    const normal = this._normal;
    const reflWorldPos = this._reflWorldPos;
    const camWorldPos = this._camWorldPos;
    const rotMat = this._rotMat;
    const view = this._view;
    const target = this._target;

    reflWorldPos.setFromMatrixPosition(this.mesh.matrixWorld);
    camWorldPos.setFromMatrixPosition(camera.matrixWorld);
    rotMat.extractRotation(this.mesh.matrixWorld);

    normal.set(0, 1, 0).applyMatrix4(rotMat);
    view.subVectors(reflWorldPos, camWorldPos);

    if (view.dot(normal) > 0) return; // camera is below the surface

    view.reflect(normal).negate();
    view.add(reflWorldPos);

    rotMat.extractRotation(camera.matrixWorld);
    this._lookTarget.set(0, 0, -1).applyMatrix4(rotMat).add(camWorldPos);
    target.subVectors(reflWorldPos, this._lookTarget).reflect(normal).negate().add(reflWorldPos);

    const vc = this.virtualCamera;
    vc.position.copy(view);
    vc.up.set(0, 1, 0).applyMatrix4(rotMat).reflect(normal);
    vc.lookAt(target);
    vc.far = camera.far;
    vc.near = camera.near;
    vc.fov = camera.fov;
    vc.aspect = camera.aspect;
    vc.updateMatrixWorld();
    vc.projectionMatrix.copy(camera.projectionMatrix);

    // texture matrix
    this._texMatrix.set(
      0.5, 0.0, 0.0, 0.5,
      0.0, 0.5, 0.0, 0.5,
      0.0, 0.0, 0.5, 0.5,
      0.0, 0.0, 0.0, 1.0,
    );
    this._texMatrix.multiply(vc.projectionMatrix);
    this._texMatrix.multiply(vc.matrixWorldInverse);
    this._texMatrix.multiply(this.mesh.matrixWorld);
    this.material.uniforms.textureMatrix.value.copy(this._texMatrix);

    // oblique near plane
    this._reflPlane.setFromNormalAndCoplanarPoint(normal, reflWorldPos);
    this._reflPlane.applyMatrix4(vc.matrixWorldInverse);

    const clipPlane = this._clipPlane;
    clipPlane.set(
      this._reflPlane.normal.x,
      this._reflPlane.normal.y,
      this._reflPlane.normal.z,
      this._reflPlane.constant,
    );

    const pm = vc.projectionMatrix;
    const q = this._q;
    q.x = (Math.sign(clipPlane.x) + pm.elements[8]) / pm.elements[0];
    q.y = (Math.sign(clipPlane.y) + pm.elements[9]) / pm.elements[5];
    q.z = -1.0;
    q.w = (1.0 + pm.elements[10]) / pm.elements[14];
    clipPlane.multiplyScalar(2.0 / clipPlane.dot(q));
    pm.elements[2] = clipPlane.x;
    pm.elements[6] = clipPlane.y;
    pm.elements[10] = clipPlane.z + 1.0 - 0.003;
    pm.elements[14] = clipPlane.w;

    // ---- render --------------------------------------------------------
    this.mesh.visible = false;

    const prevRT = renderer.getRenderTarget();
    const prevXR = renderer.xr.enabled;
    const prevShadow = renderer.shadowMap.autoUpdate;
    const prevScissor = renderer.getScissorTest();

    renderer.xr.enabled = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.renderTarget);
    renderer.state.buffers.depth.setMask(true);
    if (renderer.autoClear === false) renderer.clear();
    renderer.render(scene, vc);

    renderer.xr.enabled = prevXR;
    renderer.shadowMap.autoUpdate = prevShadow;
    renderer.setRenderTarget(prevRT);
    if (prevScissor) {
      const vp = camera.viewport;
      if (vp !== undefined) renderer.state.viewport(vp);
    }

    this.mesh.visible = true;
  }

  dispose() {
    this.renderTarget.dispose();
    this.material.dispose();
    this.mesh.geometry.dispose();
    this.rippleTexture.dispose();
  }
}
