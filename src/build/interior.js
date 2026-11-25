// ---------------------------------------------------------------------------
// Interior shell: floor, inner wall skins, ceiling beams, window reveals.
//
// The exterior shell (CabinBuilder) already provides genuine wall openings.
// This module only skins the inside faces, so the room reads as dark
// blue-grey plaster over a timber frame, and the openings keep real depth.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { CABIN, WIN, WORLD } from '../core/config.js';
import { grainSurface, woodFloor } from '../core/textures.js';
import { albedo, boxGeo, mergeByMaterial } from '../core/util.js';

/**
 * Decompose an axis-aligned rectangle minus a set of non-overlapping openings
 * into a handful of covering rectangles. Cheap, exact, and enough for walls.
 */
function coverWithOpenings(x0, x1, y0, y1, openings) {
  const rects = [];
  const sorted = openings.slice().sort((a, b) => a.x0 - b.x0);
  let cursor = x0;
  for (const o of sorted) {
    const a = Math.max(o.x0, x0);
    const b = Math.min(o.x1, x1);
    if (b - a < 1e-4) continue;
    if (a > cursor + 1e-4) rects.push([cursor, a, y0, y1]);
    if (o.y0 > y0 + 1e-4) rects.push([a, b, y0, Math.min(o.y0, y1)]);
    if (o.y1 < y1 - 1e-4) rects.push([a, b, Math.max(o.y1, y0), y1]);
    cursor = Math.max(cursor, b);
  }
  if (cursor < x1 - 1e-4) rects.push([cursor, x1, y0, y1]);
  return rects.filter((r) => r[1] - r[0] > 0.004 && r[3] - r[2] > 0.004);
}

export class InteriorBuilder {
  /**
   * @param {import('./cabin.js').CabinBuilder} cabin
   */
  constructor(cabin) {
    this.cabin = cabin;
    this.entries = [];
    this.colliders = [];
    this.mats = {};
  }

  build() {
    this._materials();

    const g = new THREE.Group();
    g.name = 'interior';

    this._floor();
    this._walls();
    this._ceiling();
    this._reveals();

    g.add(mergeByMaterial(this.entries, 'interior-merged'));
    return g;
  }

  _materials() {
    // Albedo note: these bases are PROPORTIONAL colours, not display pixels.
    // A varnished dark plank in a dim room still reflects ~12 % of the light
    // landing on it; authoring the byte as 40 gives 0.02 linear and the floor
    // renders as (0,0,5), i.e. black. Keep colour white and let the map carry
    // the hue.
    // repeat must stay [1,1]: _floor() writes world-space UVs (one tile per
    // 1.15 m), so a repeat here would multiply on top of them.
    const floorTex = woodFloor({
      seed: 3, base: [156, 116, 80], rows: 7, size: 1024, repeat: [1, 1],
    });
    this.mats.floor = new THREE.MeshStandardMaterial({
      map: floorTex.map,
      normalMap: floorTex.normalMap,
      normalScale: new THREE.Vector2(0.75, 0.75),
      // Slightly satin, not mirror-flat: a varnished plank in a dim room still
      // shows a broad sheen that picks up the window, which is what separates
      // the floor from the wall behind it.
      roughness: 0.42,
      metalness: 0.0,
      color: 0xffffff,
    });

    // repeat is in TILES across the whole wall face, so a 15 m wall with
    // repeat 3 gives a 5 m tile — coarse grain at that scale turns into
    // marbling. Keep the tile around 2 m and let the fine frequencies do the
    // work.
    const wallTex = grainSurface({
      seed: 8, base: [92, 100, 112], scale: 3.4, contrast: 0.075, size: 512, repeat: [1, 1], mottle: 0.015,
    });
    this.mats.wall = new THREE.MeshStandardMaterial({
      map: wallTex.map, roughness: 0.93, metalness: 0.0, color: 0xffffff,
    });

    const ceilTex = grainSurface({
      seed: 27, base: [92, 100, 112], scale: 2.6, contrast: 0.07, size: 512, repeat: [9, 4], mottle: 0.015,
    });
    this.mats.ceiling = new THREE.MeshStandardMaterial({
      map: ceilTex.map, roughness: 0.96, metalness: 0.0, color: 0x9aa6b6,
    });

    this.mats.beam = new THREE.MeshStandardMaterial({ color: albedo(0x4a3b28, 0.76), roughness: 0.8, metalness: 0.0 });
    this.mats.beamDark = new THREE.MeshStandardMaterial({ color: albedo(0x2a2318, 0.80), roughness: 0.86, metalness: 0.0 });
    this.mats.baseboard = new THREE.MeshStandardMaterial({ color: albedo(0x1e1811, 0.72), roughness: 0.84, metalness: 0.0 });
  }

  // --- floor ---------------------------------------------------------------
  _floor() {
    const hx = CABIN.innerX;
    const hz = CABIN.innerZ;
    const y = CABIN.floorY;

    const g = new THREE.PlaneGeometry(hx * 2, hz * 2, 1, 1);
    g.rotateX(-Math.PI / 2);
    g.translate(0, y + 0.002, 0);
    // World-space UVs, one tile per 1.15 m. A plane's native 0..1 UVs stretch
    // the whole 15 x 11 m floor across one texture tile, so each board came out
    // seven metres wide and every grain line vanished into a flat gradient.
    this._planarUV(g, 1.15);
    this.entries.push({ geo: g, mat: this.mats.floor });

    // Solid sub-floor so nothing leaks through at grazing angles.
    this.entries.push({
      geo: boxGeo(hx * 2 + 0.1, 0.14, hz * 2 + 0.1, 0, y - 0.08, 0),
      mat: this.mats.beamDark,
    });

    this.colliders.push({
      min: new THREE.Vector3(-hx, y - 0.2, -hz),
      max: new THREE.Vector3(hx, y, hz),
      tag: 'floor',
    });
  }

  // --- inner wall skins ----------------------------------------------------
  _walls() {
    const hx = CABIN.innerX;
    const hz = CABIN.innerZ;
    const y0 = CABIN.floorY;
    const y1 = CABIN.ceilingY;
    const px = WORLD.partitionX;
    const pt = CABIN.partition;
    const eps = 0.004;

    // ---- north wall (two rooms' worth of windows) -------------------------
    const northOpenings = WIN.living.concat(WIN.bedroom).map((o) => ({
      x0: o.cx - o.w / 2,
      x1: o.cx + o.w / 2,
      y0: y0 + WIN.sill,
      y1: y0 + WIN.sill + WIN.height,
    }));
    for (const [a, b, c, d] of coverWithOpenings(-hx, hx, y0, y1, northOpenings)) {
      this._panelZ(a, b, c, d, hz - eps, -1);
    }

    // ---- south wall (entry door + three windows) -------------------------
    const d = this.cabin.doorOpening;
    const southOpenings = [
      { x0: d.cx - d.w / 2, x1: d.cx + d.w / 2, y0, y1: y0 + d.h },
      ...this.cabin.southWindows.map((sw) => ({
        x0: sw.cx - sw.w / 2,
        x1: sw.cx + sw.w / 2,
        y0: sw.sillY,
        y1: sw.sillY + sw.h,
      })),
    ];
    for (const [a, b, c, e] of coverWithOpenings(-hx, hx, y0, y1, southOpenings)) {
      this._panelZ(a, b, c, e, -hz + eps, 1);
    }

    // ---- east / west gable walls -----------------------------------------
    this._panelX(-hz + eps, hz - eps, y0, y1, hx - eps, -1);
    this._panelX(-hz + eps, hz - eps, y0, y1, -hx + eps, 1);

    // ---- partition with the doorway --------------------------------------
    const dw = this.cabin.doorway;
    const partOpenings = [{
      x0: dw.z - dw.w / 2, x1: dw.z + dw.w / 2, y0, y1: y0 + dw.h,
    }];
    const livingFace = px - pt / 2 - eps;
    const bedroomFace = px + pt / 2 + eps;
    for (const [a, b, c, e] of coverWithOpenings(-hz, hz, y0, y1, partOpenings)) {
      this._panelX(a, b, c, e, livingFace, -1);
      this._panelX(a, b, c, e, bedroomFace, 1);
    }
  }

  /**
   * Panels are cut around openings, so a wall is many rectangles, not one
   * plane. Giving every rectangle its own 0..1 UVs restarts the paint texture
   * at every cut and the seams read as a grid over the whole room. Instead the
   * UVs are taken from the panel's position in metres, so all panels on all
   * walls share one continuous coordinate system and the grain simply runs on
   * through the cuts. The wall texture itself therefore uses repeat [1,1].
   */
  // Planar world UVs for horizontal surfaces (floor, rug): U follows X, V
  // follows Z, so board grain keeps a constant real-world width everywhere.
  _planarUV(g, tile) {
    const pos = g.attributes.position;
    const uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      uv.setXY(i, pos.getX(i) / tile, pos.getZ(i) / tile);
    }
    uv.needsUpdate = true;
    return g;
  }

  _worldUV(g, axis) {
    const pos = g.attributes.position;
    const uv = g.attributes.uv;
    const tile = 2.2;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      // axis 'z' -> wall runs along X, axis 'x' -> wall runs along Z
      const u = (axis === 'z' ? x : z) / tile;
      uv.setXY(i, u, y / tile);
    }
    uv.needsUpdate = true;
    return g;
  }

  /** Panel on a wall with constant Z. `face` -1 looks toward -Z. */
  _panelZ(x0, x1, y0, y1, z, face) {
    const g = new THREE.PlaneGeometry(x1 - x0, y1 - y0, 1, 1);
    if (face < 0) g.rotateY(Math.PI);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, z);
    this.entries.push({ geo: this._worldUV(g, 'z'), mat: this.mats.wall });
  }

  /** Panel on a wall with constant X. `face` +1 looks toward +X. */
  _panelX(z0, z1, y0, y1, x, face) {
    const g = new THREE.PlaneGeometry(z1 - z0, y1 - y0, 1, 1);
    g.rotateY((face > 0 ? 1 : -1) * (Math.PI / 2));
    g.translate(x, (y0 + y1) / 2, (z0 + z1) / 2);
    this.entries.push({ geo: this._worldUV(g, 'x'), mat: this.mats.wall });
  }

  // --- ceiling -------------------------------------------------------------
  _ceiling() {
    const hx = CABIN.innerX;
    const hz = CABIN.innerZ;
    const y = CABIN.ceilingY;

    const g = new THREE.PlaneGeometry(hx * 2, hz * 2, 1, 1);
    g.rotateX(Math.PI / 2);
    g.translate(0, y - 0.003, 0);
    this.entries.push({ geo: g, mat: this.mats.ceiling });

    // Exposed beams running north-south, plus a ledger along each flat wall.
    const beamW = 0.17;
    const beamH = 0.22;
    const count = 6;
    const span = (hx * 2) / (count + 1);
    for (let i = 1; i <= count; i++) {
      const x = -hx + span * i;
      this.entries.push({
        geo: boxGeo(beamW, beamH, hz * 2 - 0.02, x, y - beamH / 2 - 0.004, 0),
        mat: this.mats.beam,
      });
    }
    // ridge beam across the middle
    this.entries.push({
      geo: boxGeo(beamW * 1.35, beamH * 1.1, hz * 2 - 0.02, 0, y - beamH * 0.6, 0),
      mat: this.mats.beamDark,
    });

    // baseboards, tucked just above the boards
    const bh = 0.12;
    this.entries.push({ geo: boxGeo(hx * 2, bh, 0.035, 0, CABIN.floorY + bh / 2, hz - 0.02), mat: this.mats.beamDark });
    this.entries.push({ geo: boxGeo(hx * 2, bh, 0.035, 0, CABIN.floorY + bh / 2, -hz + 0.02), mat: this.mats.beamDark });
    this.entries.push({ geo: boxGeo(0.035, bh, hz * 2, hx - 0.02, CABIN.floorY + bh / 2, 0), mat: this.mats.beamDark });
    this.entries.push({ geo: boxGeo(0.035, bh, hz * 2, -hx + 0.02, CABIN.floorY + bh / 2, 0), mat: this.mats.beamDark });
  }

  // --- window reveals ------------------------------------------------------
  // Dark timber linings so the openings read with real depth from inside.
  _reveals() {
    const y0 = CABIN.floorY;
    const zIn = CABIN.innerZ;
    const depth = CABIN.wall;
    const t = 0.06;

    for (const o of WIN.living.concat(WIN.bedroom)) {
      const x0 = o.cx - o.w / 2;
      const x1 = o.cx + o.w / 2;
      const sy = y0 + WIN.sill;
      const ty = sy + WIN.height;
      const cz = zIn - depth / 2;

      // sill board, slightly proud of the wall face
      this.entries.push({
        geo: boxGeo(o.w + 0.18, 0.055, depth + 0.10, o.cx, sy - 0.028, cz - 0.01),
        mat: this.mats.beam,
      });
      // head lining
      this.entries.push({
        geo: boxGeo(o.w + 0.18, t, depth, o.cx, ty + t / 2, cz),
        mat: this.mats.beam,
      });
      // jambs
      this.entries.push({
        geo: boxGeo(t, WIN.height + t, depth, x0 - t / 2, sy + WIN.height / 2, cz),
        mat: this.mats.beam,
      });
      this.entries.push({
        geo: boxGeo(t, WIN.height + t, depth, x1 + t / 2, sy + WIN.height / 2, cz),
        mat: this.mats.beam,
      });
    }

    // The south elevation now has three windows, and from inside they need the
    // same timber lining as the north ones or the openings read as raw holes
    // punched through the plaster.
    for (const o of this.cabin.southWindows) {
      const x0 = o.cx - o.w / 2;
      const x1 = o.cx + o.w / 2;
      const sy = o.sillY;
      const ty = sy + o.h;
      const cz = -zIn + depth / 2;

      this.entries.push({
        geo: boxGeo(o.w + 0.18, 0.055, depth + 0.10, o.cx, sy - 0.028, cz + 0.01),
        mat: this.mats.beam,
      });
      this.entries.push({
        geo: boxGeo(o.w + 0.18, t, depth, o.cx, ty + t / 2, cz),
        mat: this.mats.beam,
      });
      this.entries.push({
        geo: boxGeo(t, o.h + t, depth, x0 - t / 2, sy + o.h / 2, cz),
        mat: this.mats.beam,
      });
      this.entries.push({
        geo: boxGeo(t, o.h + t, depth, x1 + t / 2, sy + o.h / 2, cz),
        mat: this.mats.beam,
      });
    }
  }
}
