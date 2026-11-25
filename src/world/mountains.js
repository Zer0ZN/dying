// ---------------------------------------------------------------------------
// MountainGenerator
//
// The range is a single large displaced mesh — not a textured plane. Heights
// come from the shared `mountainHeight()` field (ridged multifractal + three
// stacked crest lines + five named summits), so the silhouette is genuinely
// three dimensional and casts a correct reflection into the water.
//
// Snow is painted per-vertex from altitude, slope and a gully mask; rock shows
// through on steep faces. A small shader injection then adds the alpenglow
// term only where snow faces the afterglow, which keeps it off the low ridges
// and out of the shadowed faces.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { mountainHeight, WORLD, PALETTE } from '../core/config.js';
import { fbm, ridged, clamp, smoothstep, lerp } from '../core/noise.js';

// The palette hex values are DISPLAY colours — what the peaks should look like
// in the finished frame. Used directly as albedo they are far too dark to be
// recovered by a blue-hour sky (rockShadow #060f26 is 0.02 linear, i.e. black).
// Lift each one toward its own hue so that albedo x irradiance lands back on
// the intended display value under a dim, cool ambient.
function albedoOf(hex) {
  const c = new THREE.Color(hex);
  const lift = (v) => Math.pow(v, 0.68);
  return new THREE.Color(lift(c.r), lift(c.g), lift(c.b));
}

const cRockShadow = albedoOf(PALETTE.rockShadow);
const cRock = albedoOf(PALETTE.rock);
const cRockLight = albedoOf(PALETTE.rockLight);
const cSnowDeep = albedoOf(PALETTE.snowDeep);
const cSnow = albedoOf(PALETTE.snow);
const cSnowLit = albedoOf(PALETTE.snowLit);

// Row distribution: dense near the far shore, coarse toward the horizon.
function rowPositions(count, z0, z1, power) {
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    out[i] = z0 + (z1 - z0) * Math.pow(t, power);
  }
  return out;
}

export function buildMountainMesh() {
  const COLS = 660;
  const ROWS = 330;
  const X0 = -1050;
  const X1 = 1050;
  const Z0 = WORLD.rangeStartZ - 26;
  const Z1 = 1560;

  const zs = rowPositions(ROWS, Z0, Z1, 1.85);
  const xs = new Float32Array(COLS);
  for (let i = 0; i < COLS; i++) xs[i] = X0 + (X1 - X0) * (i / (COLS - 1));

  const count = COLS * ROWS;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const norms = new Float32Array(count * 3);
  const snowAttr = new Float32Array(count);

  // ---- height field -------------------------------------------------------
  const hgt = new Float32Array(count);
  for (let r = 0; r < ROWS; r++) {
    const z = zs[r];
    for (let c = 0; c < COLS; c++) {
      hgt[r * COLS + c] = mountainHeight(xs[c], z);
    }
  }

  // ---- normals + vertex colour -------------------------------------------
  const col = new THREE.Color();
  const snowCol = new THREE.Color();

  for (let r = 0; r < ROWS; r++) {
    const z = zs[r];
    const rp = Math.min(r + 1, ROWS - 1);
    const rm = Math.max(r - 1, 0);
    const dz = Math.max(zs[rp] - zs[rm], 0.001);
    for (let c = 0; c < COLS; c++) {
      const x = xs[c];
      const i = r * COLS + c;
      const cp = Math.min(c + 1, COLS - 1);
      const cm = Math.max(c - 1, 0);
      const dx = Math.max(xs[cp] - xs[cm], 0.001);

      const hl = hgt[r * COLS + cm];
      const hr = hgt[r * COLS + cp];
      const hd = hgt[rm * COLS + c];
      const hu = hgt[rp * COLS + c];
      const h = hgt[i];

      // gradient of the height field -> normal
      let nx = -(hr - hl) / dx;
      let ny = 1.0;
      let nz = -(hu - hd) / dz;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;

      const idx3 = i * 3;
      positions[idx3] = x;
      positions[idx3 + 1] = h;
      positions[idx3 + 2] = z;
      norms[idx3] = nx;
      norms[idx3 + 1] = ny;
      norms[idx3 + 2] = nz;

      // slope factor: 1 on flat snowfields, 0 on steep rock. The gate has to
      // sit high enough that couloirs and the shaded side of every crest stay
      // bare, because those dark ribs are the only thing that reads as a
      // mountain at this distance; too low and the range turns to meringue.
      const slope = clamp((ny - 0.34) / 0.38, 0, 1);

      // Altitude ramp, calibrated to what the window can frame. From the sofa
      // the opening covers roughly 0-9 degrees, i.e. the foot of the range
      // (~15 m at 260 m) up to the main crest (~75 m at 430 m). The ramp has to
      // run across exactly that span: bare rock at the waterline, snow on the
      // crests. Start it higher and the window fills with blue rock; start it
      // lower and every foothill in sight turns white.
      // The band a standing eye actually sees through a north window is only
      // 0-9 degrees, i.e. roughly 10-45 m of height at 250-430 m. If snow only
      // starts at 52 m that whole band is bare rock in shadow, which is exactly
      // how the windows came to look like a flat blue sheet. Start the ramp at
      // the waterline instead so the visible flank carries snow.
      const alt = smoothstep(9, 48, h);

      // gullies: stretched noise keeps snow in the chutes
      const gully = fbm(x * 0.0135, z * 0.0038, { seed: 121, octaves: 4 });
      const chute = smoothstep(0.40, 0.66, gully);

      // wind-scoured ridges stay bare on the very top of the crests
      const crest = ridged(x * 0.011, z * 0.011, { seed: 122, octaves: 3 });
      const scour = smoothstep(0.70, 0.94, crest) * 0.36;

      let snow = alt * slope * (0.92 + 0.55 * chute);
      snow = clamp(snow - scour * alt * 0.55, 0, 1);
      // Patchiness: a uniform altitude ramp carpets every gentle slope in
      // white, which from the windows reads as one pale sheet with no shape.
      // Breaking it up at a ~120 m wavelength keeps bare rock ribs between the
      // snowfields, and those ribs are what the eye reads as a mountain.
      snow *= 0.45 + 1.05 * fbm(x * 0.0082, z * 0.0082, { seed: 125, octaves: 3 });
      snow = smoothstep(0.26, 0.68, snow);

      // rock: shadowed faces darker, sun-facing faces pick up a little blue lift
      const face = clamp(0.5 + 0.5 * (nx * 0.44 + nz * -0.894), 0, 1);
      col.copy(cRockShadow).lerp(cRock, clamp(face * 1.25, 0, 1));
      col.lerp(cRockLight, clamp((face - 0.55) * 1.1, 0, 1) * 0.55);

      // crevice darkening
      const crev = fbm(x * 0.05, z * 0.05, { seed: 123, octaves: 3 });
      col.multiplyScalar(0.72 + 0.52 * crev);

      // snow: deep blue in shade -> pale blue-white on top
      snowCol.copy(cSnowDeep).lerp(cSnow, clamp(0.35 + alt * 0.9, 0, 1));
      snowCol.lerp(cSnowLit, clamp((alt - 0.35) * 1.25, 0, 1) * 0.55);
      // fine snow variation
      snowCol.multiplyScalar(0.90 + 0.20 * fbm(x * 0.09, z * 0.09, { seed: 124, octaves: 2 }));

      col.lerp(snowCol, snow);

      // the very bottom of the bank sits in shadow, but only the first few
      // metres: darkening the whole 0-26 m band turned everything the windows
      // frame into a silhouette.
      // ...and the first few metres above the waterline are the darkest part
      // of the range, because they are the only part a standing eye sees
      // through a north window. Keeping them above ~0.55 keeps the window
      // band from turning into a black rectangle.
      const foot = smoothstep(-6, 34, h);
      col.multiplyScalar(0.66 + 0.34 * foot);

      colors[idx3] = col.r;
      colors[idx3 + 1] = col.g;
      colors[idx3 + 2] = col.b;
      // The shader-side snow terms (alpenglow, cold-sky bounce) are gated by
      // this attribute, so its altitude ramp has to match the vertex-side one
      // above. It used to fade in over 20-120 m, which meant every slope the
      // north windows actually frame (h = 10-45 m) carried vSnow = 0 and the
      // range read as a flat dark band no matter how the colours were tuned.
      snowAttr[i] = snow * smoothstep(6, 58, h);
    }
  }

  // ---- indices ------------------------------------------------------------
  const quads = (COLS - 1) * (ROWS - 1);
  const indices = new Uint32Array(quads * 6);
  let k = 0;
  for (let r = 0; r < ROWS - 1; r++) {
    for (let c = 0; c < COLS - 1; c++) {
      const a = r * COLS + c;
      const b = a + 1;
      const d = a + COLS;
      const e = d + 1;
      indices[k++] = a; indices[k++] = d; indices[k++] = b;
      indices[k++] = b; indices[k++] = d; indices[k++] = e;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(norms, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aSnow', new THREE.BufferAttribute(snowAttr, 1));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeBoundingSphere();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.94,
    metalness: 0.0,
    dithering: true,
  });

  const uniforms = {
    uSunDir: { value: new THREE.Vector3(...WORLD.sun.dir).normalize() },
    uGlow: { value: new THREE.Color(PALETTE.alpenglow) },
    uGlowDeep: { value: new THREE.Color(PALETTE.alpenglowDeep) },
    uGlowStrength: { value: 1.0 },
  };

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSunDir = uniforms.uSunDir;
    shader.uniforms.uGlow = uniforms.uGlow;
    shader.uniforms.uGlowDeep = uniforms.uGlowDeep;
    shader.uniforms.uGlowStrength = uniforms.uGlowStrength;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         attribute float aSnow;
         uniform vec3 uSunDir;
         varying float vSnow;
         varying float vHeight;
         varying vec3 vWNormal;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vSnow = aSnow;
         vHeight = position.y;
         vWNormal = normalize(mat3(modelMatrix) * normal);`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform vec3 uSunDir;
         uniform vec3 uGlow;
         uniform vec3 uGlowDeep;
         uniform float uGlowStrength;
         varying float vSnow;
         varying float vHeight;
         varying vec3 vWNormal;`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         {
           // The sun is already below the ridge to the north, so the faces the
           // cabin can see are technically in shadow. The alpenglow in this
           // scene is therefore modelled as light that still reaches the high
           // snow from below the horizon: it lives on altitude and on upward
           // facing snow, not on the angle to a sun that has set.
           float facing = max(dot(normalize(vWNormal), uSunDir), 0.0);
           // must match the vertex-side altitude ramp (crests run 60-180 m)
           float hi = smoothstep(24.0, 80.0, vHeight);
           // crest and bowl tops catch it, vertical couloirs do not
           float rim = smoothstep(0.10, 0.80, vWNormal.y);
           float warm = hi * vSnow * (0.30 + 0.70 * rim) * uGlowStrength;
           vec3 glowCol = mix(uGlowDeep, uGlow, clamp(0.35 + facing * 0.9, 0.0, 1.0));
           totalEmissiveRadiance += glowCol * warm * 1.05;
           // Cold sky bounce. A snowfield under a twilight sky is one of the
           // brightest things in the landscape even though no sun touches it —
           // it is lit by the whole dome. The punctual lights here cannot
           // reproduce that, so the snow carries its own sky term. Without it
           // the range reads as a dark blue smudge through the windows, which
           // is exactly what was wrong with the view from the sofa.
           totalEmissiveRadiance += vec3(0.034, 0.047, 0.068) * hi * vSnow;
           // Rock carries a smaller share of the same dome light. A massif
           // 250-430 m away stands between the viewer and half the sky, and
           // the punctual lights here are far too weak and too directional to
           // stand in for that; without this the range flattens into a single
           // dark blue value and the window band loses its ridges.
           float up = clamp(vWNormal.y, 0.0, 1.0);
           totalEmissiveRadiance += mix(vec3(0.009, 0.013, 0.021), vec3(0.030, 0.041, 0.060), up) * (1.0 - vSnow * 0.55);
         }`
      );
  };

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'mountains';
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return { mesh, uniforms, geometry: geo, material: mat };
}
