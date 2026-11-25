// ---------------------------------------------------------------------------
// Furniture.
//
// Everything here is real geometry, not stacked boxes: cushions come from an
// extruded rounded profile that is then sagged along the top face, pillows are
// puffed and slightly squashed, the duvet is a subdivided slab displaced by
// noise so it creases like cloth, and the lamp arm is a swept tube along a
// curve.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { CABIN, PALETTE, WORLD } from '../core/config.js';
import { artCanvas, fabricWeave, grainSurface, woodGrain } from '../core/textures.js';
import { albedo, boxGeo, mergeByMaterial, roundedRectShape } from '../core/util.js';
import { fbm, makeRng } from '../core/noise.js';

// ---------------------------------------------------------------------------
// Soft-body primitives
// ---------------------------------------------------------------------------

/**
 * An extruded rounded rectangle: the workhorse for cushions, pillows, mattresses
 * and duvets. Built in the XY plane and rotated so the extrusion axis is
 * vertical, i.e. `thickness` becomes the object's height.
 *
 * @param {number} w        size along X
 * @param {number} h        size along Z after rotation
 * @param {number} thickness height along Y
 * @param {number} radius   corner radius of the profile
 * @param {number} bevel    how rounded the top and bottom edges are
 */
export function softSlab(w, h, thickness, radius = 0.09, bevel = 0.05, curveSegments = 6) {
  const bw = Math.max(0.01, bevel);
  const shape = roundedRectShape(
    Math.max(0.02, w - 2 * bw),
    Math.max(0.02, h - 2 * bw),
    Math.max(0.01, Math.min(radius, w / 2 - 0.01, h / 2 - 0.01)),
  );
  const depth = Math.max(0.02, thickness - 2 * bw);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bw,
    bevelSize: bw,
    bevelSegments: 3,
    curveSegments,
  });
  // the extrusion axis becomes vertical; centre the thickness on y = 0
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, -depth / 2, 0);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Sag the top face of a slab so a cushion takes the weight of whoever sat
 * there last. `amount` is in world units, applied with a smooth falloff.
 */
export function sagSlab(geo, amount = 0.035, insetX = 0.18, insetZ = 0.18) {
  const pos = geo.attributes.position;
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const hx = (bb.max.x - bb.min.x) / 2;
  const hz = (bb.max.z - bb.min.z) / 2;
  const top = bb.max.y;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (y < top - 0.001) continue;
    const fx = Math.max(0, 1 - Math.pow(Math.abs(x) / Math.max(hx - insetX, 1e-3), 2));
    const fz = Math.max(0, 1 - Math.pow(Math.abs(z) / Math.max(hz - insetZ, 1e-3), 2));
    const blend = Math.min(1, Math.max(0, (y - bb.min.y) / Math.max(top - bb.min.y, 1e-4)));
    pos.setY(i, y - amount * fx * fz * blend);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/**
 * Puff a pillow: the middle bulges out along Y, the seams stay thin.
 */
export function puffSlab(geo, amount = 0.06) {
  const pos = geo.attributes.position;
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const hx = (bb.max.x - bb.min.x) / 2;
  const hz = (bb.max.z - bb.min.z) / 2;
  const cy = (bb.max.y + bb.min.y) / 2;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / hx;
    const z = pos.getZ(i) / hz;
    const r = Math.min(1, Math.hypot(x, z));
    const bulge = Math.pow(Math.cos(r * Math.PI * 0.5), 1.6);
    const y = pos.getY(i);
    pos.setY(i, cy + (y - cy) * (1 + bulge * (amount / Math.max(bb.max.y - bb.min.y, 1e-3)) * 2.6));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/**
 * A subdivided blanket slab with cloth creases. Noise displaced, stronger near
 * the edges where a duvet drapes off a mattress.
 */
export function creasedSlab(w, h, thickness, radius, seed = 7, amp = 0.022) {
  const geo = new THREE.PlaneGeometry(w, h, Math.max(8, Math.round(w * 6)), Math.max(8, Math.round(h * 6)));
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const hx = w / 2;
  const hz = h / 2;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const ex = Math.abs(x) / hx;
    const ez = Math.abs(z) / hz;
    const edge = Math.max(0, Math.max(ex, ez) - 0.62) / 0.38;
    const n1 = fbm(x * 1.5 + 11.2, z * 1.5, { seed, octaves: 4 }) - 0.5;
    const n2 = fbm(x * 4.1, z * 4.1 + 3.3, { seed: seed + 7, octaves: 3 }) - 0.5;
    const fold = Math.sin(z * 2.4 + n1 * 5.0) * 0.5;
    const y = (n1 * 1.5 + n2 * 0.85 + fold * edge * 1.2) * amp * (0.45 + edge * 1.6);
    pos.setY(i, y);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.userData.thickness = thickness;
  geo.userData.radius = radius;
  return geo;
}

// ---------------------------------------------------------------------------
// Materials shared by every piece of furniture.
// ---------------------------------------------------------------------------
function furnitureMaterials() {
  // Every base below is a PROPORTIONAL colour, not a display pixel: material
  // colour stays white and the hue lives in the texture. Multiplying a dark
  // texture by a dark `color` squares the darkness, which is exactly how the
  // sofa ended up rendering as (0,0,0). Same reason the bytes are high — see
  // the albedo() note in util.js.
  // Deep brown, close to black, exactly as the brief asks. Anything lighter
  // under a 2700 K lamp reads as honey rather than as a dark wool sofa.
  const fabric = fabricWeave({ seed: 31, base: [82, 70, 60], size: 512, repeat: [2, 2], threads: 160 });
  const fabricBlue = fabricWeave({ seed: 44, base: [56, 68, 88], size: 512, repeat: [2, 2], threads: 150 });
  // grainSurface, NOT woodFloor. woodFloor paints plank COURSES, which is
  // correct for a floor but on a 0.5 m cabinet door reads as brickwork —
  // that is exactly how the sideboard came out. Furniture wants uninterrupted
  // grain.
  const wood = woodGrain({ seed: 12, base: [146, 108, 76], size: 512, repeat: [1, 1], stretch: 170, warp: 2.6 });
  const woodDark = woodGrain({ seed: 31, base: [116, 84, 58], size: 512, repeat: [1, 1], stretch: 140, warp: 3.1 });
  const wallGrain = grainSurface({ seed: 71, base: [104, 82, 62], scale: 4, contrast: 0.4, size: 256, repeat: [1, 1] });

  return {
    sofa: new THREE.MeshStandardMaterial({
      map: fabric.map, normalMap: fabric.normalMap, normalScale: new THREE.Vector2(0.55, 0.55),
      color: 0xffffff, roughness: 0.96, metalness: 0.0,
    }),
    sofaDark: new THREE.MeshStandardMaterial({
      map: fabric.map, color: 0x5a534c, roughness: 0.97, metalness: 0.0,
    }),
    cushionBlue: new THREE.MeshStandardMaterial({
      map: fabricBlue.map, normalMap: fabricBlue.normalMap, normalScale: new THREE.Vector2(0.5, 0.5),
      color: 0xffffff, roughness: 0.95, metalness: 0.0,
    }),
    duvet: new THREE.MeshStandardMaterial({
      map: fabricBlue.map, normalMap: fabricBlue.normalMap, normalScale: new THREE.Vector2(0.7, 0.7),
      // The brief asks for a dark blue-grey duvet. Left at 0xffffff the woven
      // map reads as a bright powder blue under the cool window spill, which
      // looks like daylight bedding in a room that has no daylight.
      color: 0x6a7789, roughness: 0.94, metalness: 0.0,
    }),
    sheet: new THREE.MeshStandardMaterial({ color: albedo(0x9aa6b4, 0.66), roughness: 0.9, metalness: 0.0 }),
    darkWood: new THREE.MeshStandardMaterial({
      map: wood.map, normalMap: wood.normalMap, normalScale: new THREE.Vector2(0.7, 0.7),
      color: 0xffffff, roughness: 0.62, metalness: 0.04,
    }),
    // The sideboard, bed frame and wardrobe are large flat panels: their grain
    // has to run along the panel, so they get the darker, longer-stretched map
    // instead of borrowing the small-parts one.
    panelWood: new THREE.MeshStandardMaterial({
      map: woodDark.map, normalMap: woodDark.normalMap, normalScale: new THREE.Vector2(0.6, 0.6),
      color: 0xffffff, roughness: 0.58, metalness: 0.04,
    }),
    midWood: new THREE.MeshStandardMaterial({
      map: wallGrain.map, color: 0x8d8279, roughness: 0.72, metalness: 0.03,
    }),
    metal: new THREE.MeshStandardMaterial({ color: albedo(0x14161a, 0.72), roughness: 0.42, metalness: 0.55 }),
    metalDark: new THREE.MeshStandardMaterial({ color: albedo(0x0d0f12, 0.78), roughness: 0.55, metalness: 0.45 }),
    // DoubleSide is not cosmetic here. The bulb sits INSIDE this open cylinder,
    // so the only faces the light's shadow map can see are the back faces;
    // with FrontSide they are culled and the shade casts no shadow at all —
    // which is why the lamp lit the whole ceiling and the beams.
    shadeOuter: new THREE.MeshStandardMaterial({
      color: albedo(0x191b1f, 0.74), roughness: 0.62, metalness: 0.2,
      side: THREE.DoubleSide, shadowSide: THREE.DoubleSide,
    }),
    shadeInner: new THREE.MeshStandardMaterial({
      color: 0x2a2118, emissive: new THREE.Color(0xffb457), emissiveIntensity: 1.0,
      roughness: 0.9, metalness: 0.0, side: THREE.BackSide,
    }),
    bulb: new THREE.MeshBasicMaterial({ color: 0xffcf95 }),
    plant: new THREE.MeshStandardMaterial({ color: albedo(0x2d4128, 0.62), roughness: 0.85, metalness: 0.0 }),
    pot: new THREE.MeshStandardMaterial({ color: albedo(0x3b3229, 0.64), roughness: 0.8, metalness: 0.05 }),
    paper: new THREE.MeshStandardMaterial({ color: albedo(0x6c6355, 0.68), roughness: 1.0, metalness: 0.0 }),
  };
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------
export class FurnitureBuilder {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'furniture';
    this.colliders = [];
    this.mats = furnitureMaterials();
    this.lampAnchor = new THREE.Vector3();
    this.emissives = [];
    this._rng = makeRng(90210);
  }

  build() {
    const y = CABIN.floorY;

    // ---- living room ------------------------------------------------------
    this._sofa(-3.55, -3.02, 0, y);
    this._floorLamp(-5.85, -3.42, y);
    this._coffeeTable(-3.55, -1.05, y);
    this._rug(-3.55, -2.05, 4.9, 3.5, y);
    this._sideboard(-7.15, 0.95, y);
    this._wallFrames(y);
    // On the coffee-table top, not floating beside it: the table surface is
    // floorY + 0.4275, and the group's origin is the base of the pot.
    this._smallPlant(-3.95, -1.05, y + 0.4275);

    // ---- bedroom ----------------------------------------------------------
    this._bed(4.30, -3.28, y);
    this._nightstand(2.86, -4.18, y);
    this._bench(4.30, -1.72, y);
    this._wardrobe(7.06, 1.9, y);
    this._bedroomFrames(y);

    // merge everything that shares a material to keep the draw call count low
    const merged = [];
    this.group.traverse((o) => {
      if (o.isMesh && o.userData.mergeable) merged.push({ geo: o.geometry, mat: o.material });
    });
    const flat = mergeByMaterial(merged, 'furniture-merged');
    flat.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
    for (const m of this.group.children.slice()) {
      if (m.isMesh && m.userData.mergeable) this.group.remove(m);
    }
    this.group.add(flat);

    return this.group;
  }

  // --- helpers -------------------------------------------------------------
  _add(geo, mat, opts = {}) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = opts.cast !== false;
    m.receiveShadow = opts.receive !== false;
    m.userData.mergeable = opts.merge !== false;
    if (opts.pos) m.position.copy(opts.pos);
    if (opts.rot) m.rotation.set(opts.rot[0] || 0, opts.rot[1] || 0, opts.rot[2] || 0);
    this.group.add(m);
    return m;
  }

  _collide(cx, cz, hx, hz, y0, y1, tag) {
    this.colliders.push({
      min: new THREE.Vector3(cx - hx, y0, cz - hz),
      max: new THREE.Vector3(cx + hx, y1, cz + hz),
      tag: tag || 'furniture',
    });
  }

  // --- sofa ----------------------------------------------------------------
  _sofa(cx, cz, rotY, floorY) {
    const M = this.mats;
    const g = new THREE.Group();
    g.position.set(cx, floorY, cz);

    const width = 3.30;
    const depth = 1.10;
    const seatH = 0.44;
    const backH = 0.92;

    // plinth / legs
    const legGeo = new THREE.CylinderGeometry(0.035, 0.028, 0.16, 8);
    const legOff = [[-width / 2 + 0.22, -depth / 2 + 0.2], [width / 2 - 0.22, -depth / 2 + 0.2],
      [-width / 2 + 0.22, depth / 2 - 0.2], [width / 2 - 0.22, depth / 2 - 0.2]];
    for (const [lx, lz] of legOff) {
      const leg = new THREE.Mesh(legGeo, M.darkWood);
      leg.position.set(lx, 0.08, lz);
      leg.castShadow = true;
      g.add(leg);
    }

    // frame block
    const base = new THREE.Mesh(softSlab(width, depth, 0.30, 0.10, 0.05), M.sofaDark);
    base.position.set(0, 0.26, 0);
    base.castShadow = true;
    base.receiveShadow = true;
    g.add(base);

    // backrest: a thick slab leaning back a few degrees
    const back = new THREE.Mesh(softSlab(width, 0.34, backH, 0.10, 0.06), M.sofa);
    puffSlab(back.geometry, 0.03);
    back.position.set(0, backH / 2 + 0.12, -depth / 2 + 0.20);
    back.rotation.x = -0.07;
    back.castShadow = true;
    back.receiveShadow = true;
    g.add(back);

    // armrests
    for (const sx of [-1, 1]) {
      const arm = new THREE.Mesh(softSlab(0.26, depth - 0.02, 0.62, 0.11, 0.07), M.sofa);
      puffSlab(arm.geometry, 0.02);
      arm.position.set(sx * (width / 2 - 0.13), 0.30, 0.0);
      arm.castShadow = true;
      arm.receiveShadow = true;
      g.add(arm);
    }

    // three seat cushions with a worn sag
    const innerW = width - 0.52;
    const cw = innerW / 3 - 0.03;
    for (let i = 0; i < 3; i++) {
      const x = -innerW / 2 + cw / 2 + i * (cw + 0.03);
      const geo = softSlab(cw, depth - 0.30, 0.20, 0.09, 0.045);
      sagSlab(geo, 0.030, 0.14, 0.20);
      const c = new THREE.Mesh(geo, M.sofa);
      c.position.set(x, seatH - 0.05, 0.04);
      c.castShadow = true;
      c.receiveShadow = true;
      g.add(c);
    }

    // back cushions, slightly different sizes so they do not look stamped
    const bcw = innerW / 3 - 0.04;
    for (let i = 0; i < 3; i++) {
      const x = -innerW / 2 + bcw / 2 + i * (bcw + 0.04);
      const geo = softSlab(bcw, 0.22, 0.52, 0.10, 0.06);
      puffSlab(geo, 0.025);
      const c = new THREE.Mesh(geo, M.sofa);
      c.position.set(x, 0.62 + (i === 1 ? 0.01 : 0), -depth / 2 + 0.34);
      c.rotation.x = -0.10;
      c.castShadow = true;
      c.receiveShadow = true;
      g.add(c);
    }

    // two throw pillows
    const pillowSpec = [[-1.02, 0.20, 0.02], [1.06, -0.16, -0.05]];
    for (let i = 0; i < pillowSpec.length; i++) {
      const [px, py, pz] = pillowSpec[i];
      const geo = softSlab(0.44, 0.42, 0.16, 0.15, 0.05, 10);
      puffSlab(geo, 0.045);
      const p = new THREE.Mesh(geo, i === 0 ? M.cushionBlue : M.sofaDark);
      p.position.set(px, 0.58 + py, -depth / 2 + 0.42 + pz);
      p.rotation.set(-0.22, i === 0 ? 0.14 : -0.10, i === 0 ? 0.06 : -0.12);
      p.castShadow = true;
      p.receiveShadow = true;
      g.add(p);
    }

    this.group.add(g);
    this._collide(cx, cz, width / 2 + 0.02, depth / 2 + 0.02, floorY, floorY + backH + 0.16, 'sofa');
  }

  // --- floor lamp ----------------------------------------------------------
  _floorLamp(x, z, floorY) {
    const M = this.mats;
    const g = new THREE.Group();
    g.position.set(x, floorY, z);

    // weighted base
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.23, 0.05, 28), M.metalDark);
    base.position.y = 0.025;
    base.castShadow = true;
    base.receiveShadow = true;
    g.add(base);

    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.10, 12), M.metal);
    stem.position.y = 0.09;
    g.add(stem);

    // slim curved arm sweeping up and out over the sofa
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.07, 0),
      new THREE.Vector3(0.02, 0.62, 0.0),
      new THREE.Vector3(0.10, 1.28, 0.06),
      new THREE.Vector3(0.34, 1.62, 0.14),
      new THREE.Vector3(0.56, 1.66, 0.18),
    ]);
    const arm = new THREE.Mesh(new THREE.TubeGeometry(curve, 30, 0.021, 8, false), M.metal);
    arm.castShadow = true;
    g.add(arm);

    // shade: truncated cone, dark outside / warm inside
    const shadeTop = 0.15;
    const shadeBot = 0.30;
    const shadeH = 0.30;
    const shadeX = 0.56;
    const shadeY = 1.60;

    const shadeGeo = new THREE.CylinderGeometry(shadeTop, shadeBot, shadeH, 28, 1, true);
    const shade = new THREE.Mesh(shadeGeo, M.shadeOuter);
    shade.position.set(shadeX, shadeY, 0.18);
    shade.castShadow = true;
    g.add(shade);

    const innerGeo = new THREE.CylinderGeometry(shadeTop * 0.96, shadeBot * 0.96, shadeH * 0.97, 28, 1, true);
    const inner = new THREE.Mesh(innerGeo, M.shadeInner);
    inner.position.copy(shade.position);
    g.add(inner);

    // cap on top of the shade
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(shadeTop + 0.006, shadeTop + 0.006, 0.018, 28), M.metal);
    cap.position.set(shadeX, shadeY + shadeH / 2, 0.18);
    cap.castShadow = true;
    g.add(cap);

    // bulb
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), M.bulb);
    bulb.position.set(shadeX, shadeY - 0.02, 0.18);
    bulb.scale.set(1, 1.15, 1);
    g.add(bulb);

    this.group.add(g);

    // where the LightingSystem should put the point light
    this.lampAnchor.set(x + shadeX, floorY + shadeY - 0.09, z + 0.18);
    this.lampShadeWorld = new THREE.Vector3(x + shadeX, floorY + shadeY, z + 0.18);

    this._collide(x, z, 0.26, 0.26, floorY, floorY + 0.2, 'lamp');
  }

  // --- coffee table --------------------------------------------------------
  _coffeeTable(cx, cz, floorY) {
    const M = this.mats;
    const g = new THREE.Group();
    g.position.set(cx, floorY, cz);

    const w = 1.52;
    const d = 0.74;
    const h = 0.40;

    const top = new THREE.Mesh(new THREE.BoxGeometry(w, 0.055, d), M.darkWood);
    top.position.y = h;
    top.castShadow = true;
    top.receiveShadow = true;
    g.add(top);

    const apron = new THREE.Mesh(new THREE.BoxGeometry(w - 0.10, 0.07, d - 0.10), M.midWood);
    apron.position.y = h - 0.06;
    g.add(apron);

    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.055, h - 0.03, 0.055), M.darkWood);
        leg.position.set(sx * (w / 2 - 0.09), (h - 0.03) / 2, sz * (d / 2 - 0.09));
        leg.castShadow = true;
        g.add(leg);
      }
    }

    // two books and a small tray
    const b1 = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.035, 0.22), M.paper);
    b1.position.set(-0.34, h + 0.045, -0.04);
    b1.rotation.y = 0.16;
    b1.castShadow = true;
    g.add(b1);

    const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.028, 0.19), M.cushionBlue);
    b2.position.set(-0.33, h + 0.077, -0.03);
    b2.rotation.y = -0.08;
    b2.castShadow = true;
    g.add(b2);

    this.group.add(g);
    this._collide(cx, cz, w / 2, d / 2, floorY, floorY + h + 0.1, 'table');
  }

  // --- rug -----------------------------------------------------------------
  _rug(cx, cz, w, d, floorY) {
    const geo = softSlab(w, d, 0.02, 0.04, 0.008, 4);
    // rest it just above the boards
    const m = new THREE.Mesh(geo, this.mats.cushionBlue);
    m.position.set(cx, floorY + 0.012, cz);
    m.receiveShadow = true;
    m.castShadow = false;
    m.userData.mergeable = false;
    this.group.add(m);
  }

  // --- sideboard -----------------------------------------------------------
  _sideboard(cx, cz, floorY) {
    const M = this.mats;
    const g = new THREE.Group();
    g.position.set(cx, floorY, cz);

    const h = 0.68;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.46, h, 1.55), M.panelWood);
    body.position.y = h / 2 + 0.14;
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);

    // door seams
    for (const sz of [-0.26, 0.26]) {
      const seam = new THREE.Mesh(new THREE.BoxGeometry(0.008, h - 0.08, 0.012), M.metalDark);
      seam.position.set(0.235, h / 2 + 0.14, sz);
      g.add(seam);
    }

    for (const sz of [-1, 1]) {
      for (const sx of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.018, 0.14, 8), M.metalDark);
        leg.position.set(sx * 0.16, 0.07, sz * 0.66);
        g.add(leg);
      }
    }

    // a candle holder on top
    const cnd = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.16, 14), M.paper);
    cnd.position.set(0, h + 0.22, 0.28);
    g.add(cnd);

    this.group.add(g);
    this._collide(cx, cz, 0.24, 0.78, floorY, floorY + h + 0.2, 'sideboard');
  }

  // --- wall art ------------------------------------------------------------
  _frame(x, z, y, w, h, rotY, kind) {
    const tex = artCanvas(kind, 256);
    tex.colorSpace = THREE.SRGBColorSpace;
    const art = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0.0 });
    const frameMat = this.mats.darkWood;

    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = rotY;

    const border = 0.055;
    const depth = 0.045;
    const back = new THREE.Mesh(new THREE.BoxGeometry(w + border * 2, h + border * 2, depth), frameMat);
    back.castShadow = true;
    back.receiveShadow = true;
    g.add(back);

    const canvasGeo = new THREE.PlaneGeometry(w, h);
    const paper = new THREE.Mesh(canvasGeo, art);
    paper.position.z = depth / 2 + 0.003;
    paper.receiveShadow = true;
    g.add(paper);

    this.group.add(g);
    return g;
  }

  _wallFrames(floorY) {
    const wallX = CABIN.innerX;      // east face of the west wall (x = -7.55) → frames face +X
    const px = WORLD.partitionX - CABIN.partition / 2 - 0.005; // living-room face of the partition

    // west wall, facing into the room
    this._frame(-wallX + 0.01, 1.65, floorY + 1.72, 0.46, 0.62, Math.PI / 2, 'ridge');
    this._frame(-wallX + 0.01, 2.62, floorY + 1.90, 0.36, 0.30, Math.PI / 2, 'ink');

    // partition, living side
    this._frame(px, 1.30, floorY + 1.86, 0.52, 0.40, -Math.PI / 2, 'flower');
    this._frame(px, 2.45, floorY + 1.62, 0.34, 0.46, -Math.PI / 2, 'ink');

    // above the sofa on the south wall
    this._frame(-3.55, -CABIN.innerZ + 0.01, floorY + 1.95, 0.86, 0.56, 0, 'ridge');
  }

  _bedroomFrames(floorY) {
    const px = WORLD.partitionX + CABIN.partition / 2 + 0.005;
    this._frame(px, 1.15, floorY + 1.80, 0.44, 0.58, Math.PI / 2, 'ink');
    // east wall
    this._frame(CABIN.innerX - 0.01, -1.2, floorY + 1.72, 0.50, 0.38, -Math.PI / 2, 'flower');
  }

  // --- plant ---------------------------------------------------------------
  _smallPlant(x, z, y) {
    const M = this.mats;
    const g = new THREE.Group();
    g.position.set(x, y, z);

    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.058, 0.11, 16), M.pot);
    pot.position.y = 0.055;
    pot.castShadow = true;
    g.add(pot);

    const soil = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.068, 0.012, 14), M.darkWood);
    soil.position.y = 0.108;
    g.add(soil);

    const rng = makeRng(4242);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + rng() * 0.5;
      const tilt = 0.35 + rng() * 0.55;
      const len = 0.13 + rng() * 0.13;
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(1, 6, 5), M.plant);
      leaf.scale.set(0.016, len, 0.035);
      leaf.position.set(Math.cos(a) * 0.026, 0.11 + len * 0.72, Math.sin(a) * 0.026);
      leaf.rotation.set(Math.sin(a) * tilt, 0, -Math.cos(a) * tilt);
      leaf.castShadow = true;
      g.add(leaf);
    }

    this.group.add(g);
  }

  // --- bed -----------------------------------------------------------------
  _bed(cx, cz, floorY) {
    const M = this.mats;
    const g = new THREE.Group();
    g.position.set(cx, floorY, cz);

    const w = 1.86;      // width along X
    const len = 2.10;    // length along Z
    const frameH = 0.30;
    const mattH = 0.24;

    // dark timber frame, flush at the foot, taller at the head
    const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.10, frameH, len + 0.08), M.darkWood);
    frame.position.y = frameH / 2 + 0.12;
    frame.castShadow = true;
    frame.receiveShadow = true;
    g.add(frame);

    // legs
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.09), M.darkWood);
        leg.position.set(sx * (w / 2 - 0.06), 0.07, sz * (len / 2 - 0.06));
        leg.castShadow = true;
        g.add(leg);
      }
    }

    // mattress
    const matt = new THREE.Mesh(softSlab(w, len, mattH, 0.10, 0.055), M.sheet);
    matt.position.y = frameH + 0.12 + mattH / 2;
    matt.castShadow = true;
    matt.receiveShadow = true;
    g.add(matt);

    // duvet: creased blanket sitting on the mattress, drawn up to the pillows
    const duvet = new THREE.Mesh(creasedSlab(w + 0.16, len - 0.36, 0.10, 0.12, 17, 0.020), M.duvet);
    duvet.position.set(0, frameH + 0.12 + mattH + 0.035, len * 0.5 - 0.10 - (len - 0.36) / 2);
    duvet.castShadow = true;
    duvet.receiveShadow = true;
    g.add(duvet);

    // hem hanging over each side and the foot
    const hemGeo = new THREE.BoxGeometry(0.035, 0.26, len - 0.34);
    for (const sx of [-1, 1]) {
      const hem = new THREE.Mesh(hemGeo, M.duvet);
      hem.position.set(sx * (w / 2 + 0.07), frameH + 0.12 + mattH - 0.10, -0.02);
      hem.castShadow = true;
      g.add(hem);
    }

    // turned-down sheet band at the head of the duvet
    const band = new THREE.Mesh(softSlab(w + 0.12, 0.30, 0.055, 0.05, 0.02), M.sheet);
    band.position.set(0, frameH + 0.12 + mattH + 0.045, len * 0.5 - 0.42);
    g.add(band);

    // headboard
    const hb = new THREE.Mesh(softSlab(w + 0.14, 0.10, 0.72, 0.05, 0.035), M.midWood);
    hb.position.set(0, frameH + 0.12 + 0.34, -len / 2 - 0.02);
    hb.castShadow = true;
    g.add(hb);

    // two pillows, one slightly askew
    const pillowGeos = [
      { x: -0.46, rot: 0.055, tilt: -0.10, mat: M.sheet },
      { x: 0.46, rot: -0.035, tilt: -0.14, mat: M.sheet },
    ];
    for (const p of pillowGeos) {
      const geo = softSlab(0.74, 0.46, 0.17, 0.14, 0.05, 10);
      puffSlab(geo, 0.05);
      const m = new THREE.Mesh(geo, p.mat);
      m.position.set(p.x, frameH + 0.12 + mattH + 0.13, -len / 2 + 0.42);
      m.rotation.set(p.tilt, p.rot, 0);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }

    this.group.add(g);
    this._collide(cx, cz, w / 2 + 0.12, len / 2 + 0.06, floorY, floorY + 1.05, 'bed');
  }

  // --- nightstand ----------------------------------------------------------
  _nightstand(cx, cz, floorY) {
    const M = this.mats;
    const h = 0.52;
    const g = new THREE.Group();
    g.position.set(cx, floorY, cz);

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.46, h - 0.12, 0.40), M.midWood);
    body.position.y = (h - 0.12) / 2 + 0.10;
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);

    const top = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.035, 0.44), M.darkWood);
    top.position.y = h;
    top.castShadow = true;
    g.add(top);

    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.014, 0.10, 8), M.metalDark);
        leg.position.set(sx * 0.18, 0.05, sz * 0.15);
        g.add(leg);
      }
    }

    // a small book and a mug
    const bk = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.03, 0.13), M.paper);
    bk.position.set(-0.06, h + 0.033, 0.03);
    bk.rotation.y = 0.4;
    bk.castShadow = true;
    g.add(bk);

    const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.034, 0.085, 14), M.pot);
    mug.position.set(0.10, h + 0.06, -0.06);
    g.add(mug);

    this.group.add(g);
    this._collide(cx, cz, 0.25, 0.22, floorY, floorY + h, 'nightstand');
  }

  // --- bench at the foot of the bed ---------------------------------------
  _bench(cx, cz, floorY) {
    const M = this.mats;
    const g = new THREE.Group();
    g.position.set(cx, floorY, cz);

    const w = 1.55;
    const d = 0.44;
    const h = 0.44;

    const seat = new THREE.Mesh(softSlab(w, d, 0.12, 0.06, 0.04), M.sofaDark);
    seat.position.y = h;
    seat.castShadow = true;
    seat.receiveShadow = true;
    g.add(seat);

    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, h - 0.02, 0.05), M.darkWood);
        leg.position.set(sx * (w / 2 - 0.10), (h - 0.02) / 2, sz * (d / 2 - 0.07));
        leg.castShadow = true;
        g.add(leg);
      }
    }

    const rail = new THREE.Mesh(new THREE.BoxGeometry(w - 0.16, 0.04, 0.04), M.darkWood);
    rail.position.set(0, 0.14, d / 2 - 0.07);
    g.add(rail);

    this.group.add(g);
    this._collide(cx, cz, w / 2, d / 2, floorY, floorY + h, 'bench');
  }

  // --- wardrobe ------------------------------------------------------------
  _wardrobe(cx, cz, floorY) {
    const M = this.mats;
    const g = new THREE.Group();
    g.position.set(cx, floorY, cz);

    const depth = 0.58;
    const width = 1.70;
    const h = 2.10;

    const body = new THREE.Mesh(new THREE.BoxGeometry(depth, h, width), M.panelWood);
    body.position.y = h / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);

    // door gap + two pulls
    const gap = new THREE.Mesh(new THREE.BoxGeometry(0.008, h - 0.14, 0.010), M.metalDark);
    gap.position.set(-depth / 2 - 0.002, h / 2, 0);
    g.add(gap);

    for (const sz of [-0.11, 0.11]) {
      const pull = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.13, 8), M.metal);
      pull.position.set(-depth / 2 - 0.03, h * 0.55, sz);
      g.add(pull);
    }

    this.group.add(g);
    this._collide(cx, cz, depth / 2, width / 2, floorY, floorY + h, 'wardrobe');
  }
}
