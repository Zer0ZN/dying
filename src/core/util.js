// ---------------------------------------------------------------------------
// Small shared helpers: geometry construction with baked transforms, merging,
// and a couple of quick material factories.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * A box geometry whose transform is baked into the vertices, so many of them
 * can be merged into a single draw call.
 */
export function boxGeo(w, h, d, x = 0, y = 0, z = 0, rot = null) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rot) {
    const e = new THREE.Euler(rot[0] || 0, rot[1] || 0, rot[2] || 0);
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(e));
  }
  g.translate(x, y, z);
  return g;
}

/** A box mesh that casts and receives shadows. */
export function boxMesh(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/**
 * Merge a list of { geo, mat } into one mesh per material.
 * Returns a Group. Cuts the draw-call count of the cabin roughly 10x.
 */
export function mergeByMaterial(entries, name = 'merged') {
  const buckets = new Map();
  for (const e of entries) {
    if (!buckets.has(e.mat)) buckets.set(e.mat, []);
    buckets.get(e.mat).push(e.geo);
  }
  const group = new THREE.Group();
  group.name = name;
  for (const [mat, geos] of buckets) {
    const merged = mergeGeometries(geos, false);
    if (!merged) {
      // fall back to separate meshes if the attribute sets disagree
      for (const g of geos) {
        const m = new THREE.Mesh(g, mat);
        m.castShadow = true;
        m.receiveShadow = true;
        group.add(m);
      }
      continue;
    }
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    for (const g of geos) g.dispose();
  }
  return group;
}

/** Convenience: rounded-rectangle 2D path, useful for cushion profiles. */
export function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  const hw = w / 2;
  const hh = h / 2;
  r = Math.min(r, hw, hh);
  s.moveTo(-hw + r, -hh);
  s.lineTo(hw - r, -hh);
  s.quadraticCurveTo(hw, -hh, hw, -hh + r);
  s.lineTo(hw, hh - r);
  s.quadraticCurveTo(hw, hh, hw - r, hh);
  s.lineTo(-hw + r, hh);
  s.quadraticCurveTo(-hw, hh, -hw, hh - r);
  s.lineTo(-hw, -hh + r);
  s.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
  return s;
}

/** Dispose every geometry/material/texture under an object. */
export function disposeObject(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        for (const k of Object.keys(m)) {
          const v = m[k];
          if (v && v.isTexture) v.dispose();
        }
        m.dispose();
      }
    }
  });
}

/**
 * Convert a display-space colour into a usable albedo.
 *
 * A colour picked off a reference image is a PIXEL: it is albedo x irradiance
 * after tone mapping. Using that value directly as albedo makes a "dark
 * walnut" at #2a1c12 (linear 0.024) reflect almost nothing, so in a dim room
 * it renders as (0,0,0) — which is exactly how the sofa and the floor came
 * out.
 *
 * `power` is the gamma exponent applied to the sRGB bytes. Because it is a
 * power of a fraction, SMALLER is BRIGHTER: 1.0 leaves the colour untouched,
 * 0.6 lifts a mid-dark colour into a plausible reflectance, 0.4 is already
 * chalky. Keep it in 0.55–0.75 for painted or varnished surfaces.
 *
 * @param {number|THREE.Color} hex
 * @param {number} power gamma exponent, 0.55–0.75 typical
 * @returns {THREE.Color} linear-space colour, safe to assign to material.color
 */
export function albedo(hex, power = 0.62) {
  const c = new THREE.Color(hex);
  const srgb = c.getHex(THREE.SRGBColorSpace);
  const r = (srgb >> 16) & 255;
  const g = (srgb >> 8) & 255;
  const b = srgb & 255;
  const f = (v) => Math.pow(v / 255, power);
  return new THREE.Color().setRGB(f(r), f(g), f(b), THREE.SRGBColorSpace);
}
