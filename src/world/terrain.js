// ---------------------------------------------------------------------------
// TerrainGenerator
//
// Three pieces:
//   * the near bank the cabin stands on — stretched far east/west so the lake
//     never ends in a visible mesh edge, with the sampling warped so almost all
//     of the detail sits around the cabin and the shoreline
//   * the far shore strip between the lake and the mountains
//   * scattered shoreline boulders and snow mounds (instanced)
//
// Everything samples the same shoreHeight()/farShoreHeight() fields the player
// collision uses, so what you walk on is what you see.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { shoreHeight, farShoreHeight, WORLD, BANK_TOP } from '../core/config.js';
import { fbm, clamp, smoothstep } from '../core/noise.js';
import { snowSurface, rockSurface } from '../core/textures.js';

// Warp a [-1,1] parameter so samples bunch up near the origin.
function warpAxis(t, maxNeg, maxPos, a = 0.10, p = 2.25) {
  const s = t < 0 ? -1 : 1;
  const at = Math.abs(t);
  const w = a * at + (1 - a) * Math.pow(at, p);
  return s > 0 ? maxPos * w : -maxNeg * w;
}

function snowColorAt(x, z, h, ny, target) {
  const drift = fbm(x * 0.09, z * 0.09, { seed: 141, octaves: 3 });

  // Linear albedo. Snow in blue hour is BRIGHT and only faintly blue — push
  // it too dark/saturated and the bank reads as water instead of snow.
  // Snow is the brightest thing in the frame after the sky itself. Authored
  // darker it stops reading as snow and starts reading as open water — the
  // near bank and the lake became indistinguishable.
  let r = 0.82;
  let g = 0.87;
  let b = 0.94;

  // rock shows through where the bank gets steep
  const rockAmt = smoothstep(0.86, 0.55, ny);
  if (rockAmt > 0.001) {
    const rr = 0.075 + 0.060 * fbm(x * 0.30, z * 0.30, { seed: 142, octaves: 2 });
    const rg = 0.085 + 0.065 * fbm(x * 0.30, z * 0.30, { seed: 143, octaves: 2 });
    const rb = 0.110 + 0.075 * fbm(x * 0.30, z * 0.30, { seed: 144, octaves: 2 });
    r = r * (1 - rockAmt) + rr * rockAmt;
    g = g * (1 - rockAmt) + rg * rockAmt;
    b = b * (1 - rockAmt) + rb * rockAmt;
  }

  // wet, icy band at the waterline
  const wet = smoothstep(1.7, 0.25, h) * smoothstep(-0.7, 0.15, h);
  r = r * (1 - wet * 0.55) + 0.09 * wet * 0.55;
  g = g * (1 - wet * 0.55) + 0.12 * wet * 0.55;
  b = b * (1 - wet * 0.55) + 0.16 * wet * 0.55;

  const k = 0.94 + 0.14 * drift;
  target.setRGB(r * k, g * k, b * k);
  return target;
}

export function buildNearBank() {
  const SEG_X = 380;
  const SEG_Z = 190;
  const row = SEG_X + 1;

  const xs = new Float32Array(row);
  for (let i = 0; i <= SEG_X; i++) {
    xs[i] = warpAxis((i / SEG_X) * 2 - 1, 1100, 1100);
  }
  const zs = new Float32Array(SEG_Z + 1);
  for (let j = 0; j <= SEG_Z; j++) {
    zs[j] = warpAxis((j / SEG_Z) * 2 - 1, 250, 78);
  }

  const count = row * (SEG_Z + 1);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const normals = new Float32Array(count * 3);
  const hgt = new Float32Array(count);

  for (let j = 0; j <= SEG_Z; j++) {
    const z = zs[j];
    for (let i = 0; i <= SEG_X; i++) {
      hgt[j * row + i] = shoreHeight(xs[i], z);
    }
  }

  const col = new THREE.Color();
  for (let j = 0; j <= SEG_Z; j++) {
    const z = zs[j];
    for (let i = 0; i <= SEG_X; i++) {
      const x = xs[i];
      const id = j * row + i;
      const h = hgt[id];

      const iL = Math.max(i - 1, 0), iR = Math.min(i + 1, SEG_X);
      const jD = Math.max(j - 1, 0), jU = Math.min(j + 1, SEG_Z);
      const dhx = (hgt[j * row + iR] - hgt[j * row + iL]) / Math.max(xs[iR] - xs[iL], 0.001);
      const dhz = (hgt[jU * row + i] - hgt[jD * row + i]) / Math.max(zs[jU] - zs[jD], 0.001);

      let nx = -dhx, ny = 1, nz = -dhz;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;

      const i3 = id * 3;
      positions[i3] = x;
      positions[i3 + 1] = h;
      positions[i3 + 2] = z;
      normals[i3] = nx;
      normals[i3 + 1] = ny;
      normals[i3 + 2] = nz;

      snowColorAt(x, z, h, ny, col);
      colors[i3] = col.r;
      colors[i3 + 1] = col.g;
      colors[i3 + 2] = col.b;

      // ~1 texture repeat per 24 m. Tighter than this and the wind waves in
      // the snow normal map turn into ripple rings that read as open water.
      uvs[id * 2] = x * 0.042;
      uvs[id * 2 + 1] = z * 0.042;
    }
  }

  const indices = new Uint32Array(SEG_X * SEG_Z * 6);
  let k = 0;
  for (let j = 0; j < SEG_Z; j++) {
    for (let i = 0; i < SEG_X; i++) {
      const a = j * row + i;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      indices[k++] = a; indices[k++] = c; indices[k++] = b;
      indices[k++] = b; indices[k++] = c; indices[k++] = d;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeBoundingSphere();

  const snow = snowSurface({ repeat: [1, 1], size: 512, seed: 41 });
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: snow.map,
    normalMap: snow.normalMap,
    normalScale: new THREE.Vector2(0.16, 0.16),
    roughness: 0.78,
    metalness: 0.0,
    dithering: true,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'nearBank';
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return { mesh, geometry: geo, material: mat };
}

export function buildFarShore() {
  const X0 = -1500, X1 = 1500;
  const Z0 = WORLD.lakeFarZ - 30;
  const Z1 = WORLD.farShoreTopZ + 46;
  const SEG_X = 420;
  const SEG_Z = 96;

  const row = SEG_X + 1;
  const count = row * (SEG_Z + 1);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);

  for (let j = 0; j <= SEG_Z; j++) {
    const z = Z0 + (Z1 - Z0) * (j / SEG_Z);
    for (let i = 0; i <= SEG_X; i++) {
      const x = X0 + (X1 - X0) * (i / SEG_X);
      const id = j * row + i;
      const h = farShoreHeight(x, z);
      positions[id * 3] = x;
      positions[id * 3 + 1] = h;
      positions[id * 3 + 2] = z;

      const v = clamp(0.5 + 0.5 * fbm(x * 0.03, z * 0.03, { seed: 151, octaves: 3 }), 0, 1);
      const snowAmt = smoothstep(1.5, 15.0, h) * (0.30 + 0.5 * v);
      // Linear albedo of a snow-covered far bank seen across 200 m of water.
      // At 0.05 these read as a dead-black strip pasted across the horizon.
      const rr = 0.16 + 0.10 * v;
      const gg = 0.20 + 0.12 * v;
      const bb = 0.26 + 0.14 * v;
      const sr = 0.36, sg = 0.48, sb = 0.63;
      colors[id * 3] = rr * (1 - snowAmt) + sr * snowAmt;
      colors[id * 3 + 1] = gg * (1 - snowAmt) + sg * snowAmt;
      colors[id * 3 + 2] = bb * (1 - snowAmt) + sb * snowAmt;
    }
  }

  const indices = new Uint32Array(SEG_X * SEG_Z * 6);
  let k = 0;
  for (let j = 0; j < SEG_Z; j++) {
    for (let i = 0; i < SEG_X; i++) {
      const a = j * row + i;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      indices[k++] = a; indices[k++] = c; indices[k++] = b;
      indices[k++] = b; indices[k++] = c; indices[k++] = d;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.93,
    metalness: 0.0,
    dithering: true,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'farShore';
  return { mesh, geometry: geo, material: mat };
}

// ---------------------------------------------------------------------------
// Shoreline detail — low boulders half buried in the snow. Instanced.
// ---------------------------------------------------------------------------
export function buildShoreDetail(rng) {
  const group = new THREE.Group();
  group.name = 'shoreDetail';

  const rockTex = rockSurface({ repeat: [2, 2], size: 256 });
  const rockMat = new THREE.MeshStandardMaterial({
    map: rockTex.map,
    normalMap: rockTex.normalMap,
    normalScale: new THREE.Vector2(1.0, 1.0),
    color: 0x2b3444,
    roughness: 0.94,
    metalness: 0.0,
  });

  const geo = new THREE.IcosahedronGeometry(1, 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = fbm(x * 1.7 + 11, z * 1.7 + 3, { seed: 161, octaves: 3 });
    const s = 0.72 + n * 0.55;
    pos.setXYZ(i, x * s, y * s * 0.66, z * s);
  }
  geo.computeVertexNormals();

  const N = 46;
  const inst = new THREE.InstancedMesh(geo, rockMat, N);
  inst.name = 'boulders';
  inst.castShadow = true;
  inst.receiveShadow = true;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();

  for (let i = 0; i < N; i++) {
    const side = rng() > 0.5 ? 1 : -1;
    const x = side * (7.5 + Math.pow(rng(), 0.65) * 130);
    const wob = 3.6 * (fbm(x * 0.024, 0.5, { seed: 31, octaves: 3 }) - 0.5);
    const z = WORLD.shoreEdgeZ + wob - 1.2 - rng() * 9.0;
    const h = shoreHeight(x, z);
    const sc = 0.35 + Math.pow(rng(), 2.0) * 1.6;
    v.set(x, h - sc * 0.24, z);
    e.set(rng() * 0.6 - 0.3, rng() * Math.PI * 2, rng() * 0.6 - 0.3);
    q.setFromEuler(e);
    s.set(sc * (0.8 + rng() * 0.6), sc * (0.55 + rng() * 0.5), sc * (0.8 + rng() * 0.6));
    m.compose(v, q, s);
    inst.setMatrixAt(i, m);
  }
  inst.instanceMatrix.needsUpdate = true;
  group.add(inst);

  // wind-packed snow mounds that catch the afterglow
  const moundMat = new THREE.MeshStandardMaterial({ color: 0x4d6c92, roughness: 0.86, metalness: 0 });
  const moundGeo = new THREE.SphereGeometry(1, 18, 10);
  const mounds = new THREE.InstancedMesh(moundGeo, moundMat, 22);
  mounds.receiveShadow = true;
  for (let i = 0; i < 22; i++) {
    const x = (rng() - 0.5) * 190;
    const z = WORLD.shoreEdgeZ - 5 - rng() * 34;
    const h = shoreHeight(x, z);
    const sc = 1.4 + rng() * 3.6;
    v.set(x, h - sc * 0.62, z);
    q.identity();
    s.set(sc, sc * 0.30, sc * 0.78);
    m.compose(v, q, s);
    mounds.setMatrixAt(i, m);
  }
  mounds.instanceMatrix.needsUpdate = true;
  group.add(mounds);

  return group;
}
