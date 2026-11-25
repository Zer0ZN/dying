// ---------------------------------------------------------------------------
// CabinBuilder
//
// The exterior shell. Everything is real geometry with thickness — the wall
// boards are actual boxes, window openings are cut with shape holes rather than
// textured on, the frames are boxes set proud of the wall, and the roof has
// separate facia, soffit and rafter tails so the eaves read in silhouette.
//
// The building is hollow: the north wall carries the two window openings and
// the south wall carries the door, so the interior is genuinely enclosed and
// the window openings are the only way the outside light gets in.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { CABIN, WIN, WORLD, PALETTE, farShoreHeight } from '../core/config.js';
import { woodSiding, woodFloor, roofMetal, grainSurface, rockSurface } from '../core/textures.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export class CabinBuilder {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'cabin';
    this.materials = {};
    this.colliders = []; // {min:Vector3, max:Vector3} in world space
  }

  build() {
    this._materials();
    this._foundation();
    this._walls();
    this._windows();
    this._door();
    this._roof();
    this._trims();
    this._farCabin();
    return this.group;
  }

  // -----------------------------------------------------------------------
  _materials() {
    const siding = woodSiding({
      seed: 5,
      base: [104, 40, 48],
      plankCount: 13,
      size: 1024,
      repeat: [1, 1],
    });
    const sidingTrim = woodSiding({
      seed: 12,
      base: [72, 26, 33],
      plankCount: 9,
      size: 512,
      repeat: [1, 1],
    });
    const roof = roofMetal({ size: 512, repeat: [1, 1] });
    const stone = rockSurface({ size: 512, repeat: [1, 1] });

    this.materials.wall = new THREE.MeshStandardMaterial({
      map: siding.map,
      normalMap: siding.normalMap,
      normalScale: new THREE.Vector2(1.1, 1.1),
      color: 0xffffff,
      roughness: 0.86,
      metalness: 0.0,
    });

    this.materials.wallDark = new THREE.MeshStandardMaterial({
      map: sidingTrim.map,
      normalMap: sidingTrim.normalMap,
      normalScale: new THREE.Vector2(1.0, 1.0),
      color: 0xd8d8d8,
      roughness: 0.88,
      metalness: 0.0,
    });

    // Dark slate standing-seam roof. metalness stays near zero on purpose:
    // without an environment map a metallic surface has no diffuse at all, and
    // since this roof faces north it never sees the key light — at 0.35 metal
    // the whole slope rendered as pure black.
    this.materials.roof = new THREE.MeshStandardMaterial({
      map: roof.map,
      normalMap: roof.normalMap,
      normalScale: new THREE.Vector2(1.2, 1.2),
      color: 0xaab6c6,
      roughness: 0.74,
      metalness: 0.08,
      envMapIntensity: 0.7,
    });

    this.materials.frame = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE.frame),
      roughness: 0.68,
      metalness: 0.0,
    });

    // Interior faces (reveals + muntins) are dark walnut per the brief, while
    // the outer casing stays pale so the building still reads correctly from
    // the shore.
    this.materials.frameInner = new THREE.MeshStandardMaterial({
      color: 0x6b5540,
      roughness: 0.78,
      metalness: 0.0,
    });

    this.materials.stone = new THREE.MeshStandardMaterial({
      map: stone.map,
      normalMap: stone.normalMap,
      normalScale: new THREE.Vector2(1.2, 1.2),
      color: 0x6e7783,
      roughness: 0.95,
      metalness: 0.0,
    });

    this.materials.door = new THREE.MeshStandardMaterial({
      map: sidingTrim.map,
      color: 0x9a9a9a,
      roughness: 0.8,
      metalness: 0.0,
    });

    this.materials.dark = new THREE.MeshStandardMaterial({
      color: 0x14171c,
      roughness: 0.9,
      metalness: 0.05,
    });

    // Old, slightly dirty panes. Deliberately almost invisible: at night a
    // sheet of glass in a dark room mostly *is* invisible, and any real opacity
    // here reads as a grey veil over the entire view because it is a large
    // surface sitting directly between the eye and the mountains.
    //
    // MeshBasicMaterial, NOT MeshPhysicalMaterial, on purpose. A physically
    // based glass even at roughness 0.04 still samples the environment map,
    // and the mirrored bright horizon landed as a small round white disc in
    // the middle of the view — it read as a MOON hanging over the lake, and
    // bloom then magnified it. This scene has no moon. A basic material with
    // additive blending adds a flat navy tint and nothing else, so the glass
    // can no longer invent a light source that does not exist.
    this.materials.glass = new THREE.MeshBasicMaterial({
      color: 0x16233a,
      transparent: true,
      opacity: 0.10,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }

  // -----------------------------------------------------------------------
  // Plinth: a band of stone under the walls so the cabin does not float.
  // -----------------------------------------------------------------------
  _foundation() {
    const hx = CABIN.halfXOuter;
    const hz = CABIN.halfZOuter;
    const top = CABIN.floorY;
    const bottom = top - 0.95;

    const base = box(hx * 2 + 0.16, top - bottom, hz * 2 + 0.16, this.materials.stone, 0, (top + bottom) / 2, 0);
    base.name = 'plinth';
    this.group.add(base);

    // Expose the floor edge as a slightly darker wooden rim. This has to be a
    // FRAME of four boards, not one slab: a full-footprint box at top + 0.02
    // covers the interior floor completely and the room renders as a black
    // void with no plank grain anywhere.
    const rimH = 0.14;
    const rimY = top + 0.02;
    const rimT = 0.16;
    const rimX = hx * 2 + 0.30;
    const rimZ = hz * 2 + 0.30;
    this.group.add(box(rimX, rimH, rimT, this.materials.dark, 0, rimY, (rimZ - rimT) / 2));
    this.group.add(box(rimX, rimH, rimT, this.materials.dark, 0, rimY, -(rimZ - rimT) / 2));
    this.group.add(box(rimT, rimH, rimZ - rimT * 2, this.materials.dark, (rimX - rimT) / 2, rimY, 0));
    this.group.add(box(rimT, rimH, rimZ - rimT * 2, this.materials.dark, -(rimX - rimT) / 2, rimY, 0));

    // a shallow stone step in front of the door
    const step = box(2.4, 0.22, 1.0, this.materials.stone, -4.55, top - 0.30, hz + 0.55);
    this.group.add(step);

    this.worldCollider(hx, hx, bottom, top, hz, hz);
  }

  // -----------------------------------------------------------------------
  // Walls — built as four shells plus the interior partition, with the window
  // and door openings left as genuine holes.
  // -----------------------------------------------------------------------
  _walls() {
    const t = CABIN.wall;
    const hx = CABIN.halfXOuter;
    const hz = CABIN.halfZOuter;
    const y0 = CABIN.floorY - 0.30;
    const y1 = CABIN.topPlateY;

    // ---- north wall (carries all four windows) --------------------------
    this.group.add(this._wallWithWindows(
      'north',
      -hx, hx, hz - t / 2, t, y0, y1,
      [...WIN.living, ...WIN.bedroom],
      -hx, hx,
    ));

    // ---- south wall (door + a small window in the bedroom part) ---------
    this.group.add(this._southWall(-hx, hx, -hz + t / 2, t, y0, y1));

    // ---- east / west gable walls ----------------------------------------
    this.group.add(this._sideWall(-1, -hx + t / 2, t, hz, y0, y1));
    this.group.add(this._sideWall(1, hx - t / 2, t, hz, y0, y1));

    // ---- interior partition between living room and bedroom -------------
    const pz = CABIN.halfZOuter - t;
    const px = WORLD.partitionX;
    const pt = CABIN.partition;
    const innerY0 = CABIN.floorY;
    const innerY1 = CABIN.ceilingY + 0.02;

    // the partition has a doorway in its northern half
    const doorW = 1.15;
    const doorH = 2.15;
    const doorCz = pz - 1.5;

    const panelN = box(pt, innerY1 - innerY0, (pz - (doorCz + doorW / 2)), this.materials.wallDark,
      px, (innerY0 + innerY1) / 2, doorCz + doorW / 2 + (pz - (doorCz + doorW / 2)) / 2);
    this.group.add(panelN);

    const panelS = box(pt, innerY1 - innerY0, ((doorCz - doorW / 2) + pz), this.materials.wallDark,
      px, (innerY0 + innerY1) / 2, -pz + ((doorCz - doorW / 2) + pz) / 2);
    this.group.add(panelS);

    // lintel above the doorway
    const lintel = box(pt, innerY1 - (innerY0 + doorH), doorW, this.materials.wallDark,
      px, (innerY0 + doorH + innerY1) / 2, doorCz);
    this.group.add(lintel);

    this.doorway = { x: px, z: doorCz, w: doorW, h: doorH };

    // collide the partition (with the doorway gap handled in the collision pass)
    this.worldColliderSegment(px, -pz, px, doorCz - doorW / 2, pt, innerY0, innerY1);
    this.worldColliderSegment(px, doorCz + doorW / 2, px, pz, pt, innerY0, innerY1);
  }

  // A north wall panel with rectangular window holes constructed from four
  // bands (below the sills, above the heads, and the piers between openings).
  _wallWithWindows(name, x0, x1, cz, thickness, y0, y1, openings) {
    const g = new THREE.Group();
    g.name = `wall-${name}`;

    const sillY = CABIN.floorY + WIN.sill;
    const headY = sillY + WIN.height;

    // sort openings, convert to world x extents
    const ops = openings
      .map(o => ({ x0: o.cx - o.w / 2, x1: o.cx + o.w / 2 }))
      .sort((a, b) => a.x0 - b.x0);

    // band under the openings
    g.add(box(x1 - x0, sillY - y0, thickness, this.materials.wall,
      (x0 + x1) / 2, (y0 + sillY) / 2, cz));

    // band above the openings
    g.add(box(x1 - x0, y1 - headY, thickness, this.materials.wall,
      (x0 + x1) / 2, (headY + y1) / 2, cz));

    // piers between / outside the openings
    let cursor = x0;
    for (const o of ops) {
      if (o.x0 > cursor) {
        g.add(box(o.x0 - cursor, headY - sillY, thickness, this.materials.wall,
          (cursor + o.x0) / 2, (sillY + headY) / 2, cz));
      }
      cursor = Math.max(cursor, o.x1);
    }
    if (cursor < x1) {
      g.add(box(x1 - cursor, headY - sillY, thickness, this.materials.wall,
        (cursor + x1) / 2, (sillY + headY) / 2, cz));
    }

    // collider: full wall
    this.worldColliderSegment(x0, cz, x1, cz, thickness, y0, y1);
    return g;
  }

  _southWall(x0, x1, cz, thickness, y0, y1) {
    const g = new THREE.Group();
    g.name = 'wall-south';

    const doorCx = -4.55;
    const doorW = 1.55;
    const doorH = 2.55;

    // The south elevation is 16 m of wall seen straight on from the shore
    // track, so one door and one small window left it reading as a blank shed.
    // Three windows — one lighting the living room, two the bedroom — give the
    // facade the rhythm a lakeside cabin actually has.
    const windows = [
      { cx: -1.95, w: 1.70, h: 1.62, sill: 0.92 }, // living room
      { cx: 3.45, w: 1.36, h: 1.50, sill: 0.95 }, // bedroom, west
      { cx: 5.95, w: 1.36, h: 1.50, sill: 0.95 }, // bedroom, east
    ];

    // Generic cut-out: the wall is decomposed into the horizontal bands and
    // piers that survive the openings, so every hole is a genuine hole.
    const holes = [
      { x0: doorCx - doorW / 2, x1: doorCx + doorW / 2, y0: CABIN.floorY, y1: CABIN.floorY + doorH },
      ...windows.map((w) => ({
        x0: w.cx - w.w / 2, x1: w.cx + w.w / 2,
        y0: CABIN.floorY + w.sill, y1: CABIN.floorY + w.sill + w.h,
      })),
    ].sort((a, b) => a.x0 - b.x0);

    const band = (bx0, bx1, by0, by1) => {
      if (bx1 - bx0 < 1e-4 || by1 - by0 < 1e-4) return;
      g.add(box(bx1 - bx0, by1 - by0, thickness, this.materials.wall,
        (bx0 + bx1) / 2, (by0 + by1) / 2, cz));
    };

    let cursor = x0;
    for (const h of holes) {
      band(cursor, h.x0, y0, y1);       // full-height pier before the opening
      band(h.x0, h.x1, y0, h.y0);       // sill band under it
      band(h.x0, h.x1, h.y1, y1);       // head band over it
      cursor = Math.max(cursor, h.x1);
    }
    band(cursor, x1, y0, y1);

    this.doorOpening = { cx: doorCx, w: doorW, h: doorH, z: cz };
    this.southWindows = windows.map((w) => ({
      cx: w.cx, w: w.w, h: w.h, sillY: CABIN.floorY + w.sill, cz,
    }));
    // kept for the interior builder's older single-window call sites
    this.southWindow = this.southWindows[0];

    this.worldColliderSegment(x0, cz, x1, cz, thickness, y0, y1);
    return g;
  }

  _sideWall(sign, cx, thickness, hz, y0, y1) {
    const g = new THREE.Group();
    g.name = sign < 0 ? 'wall-west' : 'wall-east';

    // the gable end: a rectangular body plus a triangular pediment
    const body = box(thickness, y1 - y0, hz * 2, this.materials.wall, cx, (y0 + y1) / 2, 0);
    g.add(body);

    const ridgeY = CABIN.ridgeY;
    const hx = CABIN.halfXOuter;
    const rise = ridgeY - y1;
    if (rise > 0.01) {
      const shape = new THREE.Shape();
      shape.moveTo(-hz, 0);
      shape.lineTo(hz, 0);
      shape.lineTo(0, rise);
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
      // extrude is along +Z; rotate so the triangle faces outward along X
      geo.rotateY(Math.PI / 2);
      geo.translate(cx - thickness / 2, y1, 0);
      const ped = new THREE.Mesh(geo, this.materials.wall);
      ped.castShadow = true;
      ped.receiveShadow = true;
      g.add(ped);
    }

    this.worldColliderSegment(cx, -hz, cx, hz, thickness, y0, ridgeY);
    return g;
  }

  // -----------------------------------------------------------------------
  // Windows: a recessed reveal, an outer frame with real depth, a central
  // mullion and horizontal muntins. Four rows of panes.
  // -----------------------------------------------------------------------
  _buildWindow(cx, w, zb, facing, sillY, height, rows = 4, cols = 2) {
    const g = new THREE.Group();
    const f = this.materials.frame;
    const fi = this.materials.frameInner;

    const frameW = 0.085;
    const depth = 0.16;
    const y0 = sillY;
    const y1 = sillY + height;

    // ---- reveal (inner sides of the opening) ---------------------------
    const revealMat = this.materials.frameInner;
    const revDepth = CABIN.wall * 0.92;
    const sides = [
      { w: depth * 0.5, h: height, d: revDepth, x: cx - w / 2 + depth * 0.25, y: (y0 + y1) / 2, z: zb + (facing > 0 ? -revDepth / 2 : revDepth / 2) },
      { w: depth * 0.5, h: height, d: revDepth, x: cx + w / 2 - depth * 0.25, y: (y0 + y1) / 2, z: zb + (facing > 0 ? -revDepth / 2 : revDepth / 2) },
    ];
    for (const s of sides) {
      const m = box(s.w, s.h, s.d, revealMat, s.x, s.y, s.z);
      g.add(m);
    }
    // head + sill reveal
    g.add(box(w, depth * 0.5, revDepth, revealMat, cx, y1 - depth * 0.25, zb + (facing > 0 ? -revDepth / 2 : revDepth / 2)));
    g.add(box(w, depth * 0.5, revDepth, revealMat, cx, y0 + depth * 0.25, zb + (facing > 0 ? -revDepth / 2 : revDepth / 2)));

    // ---- outer frame (proud of the wall) -------------------------------
    const outZ = zb + (facing > 0 ? CABIN.wall / 2 + 0.03 : -CABIN.wall / 2 - 0.03);
    const frameInset = 0.02;
    const fw = w + frameW * 2;

    // top / bottom rails
    g.add(box(fw, frameW, depth, f, cx, y1 + frameW / 2, outZ));
    g.add(box(fw, frameW, depth, f, cx, y0 - frameW / 2, outZ));
    // jambs
    g.add(box(frameW, height + frameW * 2, depth, f, cx - w / 2 - frameW / 2, (y0 + y1) / 2, outZ));
    g.add(box(frameW, height + frameW * 2, depth, f, cx + w / 2 + frameW / 2, (y0 + y1) / 2, outZ));

    // a deeper sill board that projects
    const sillBoard = box(w + 0.34, 0.09, 0.30, f, cx, y0 - frameW - 0.02, outZ + (facing > 0 ? 0.10 : -0.10));
    g.add(sillBoard);

    // ---- mullions -------------------------------------------------------
    const mullW = 0.075;
    const paneY0 = y0;
    const paneY1 = y1;
    const innerW = w - frameInset * 2;
    const innerH = height - frameInset * 2;

    // central vertical mullion (the glass is split into two columns)
    const mullZ = outZ + (facing > 0 ? -0.02 : 0.02);
    if (cols > 1) {
      g.add(box(mullW, innerH, 0.10, fi, cx, (paneY0 + paneY1) / 2, mullZ));
    }

    // horizontal muntins
    const rowH = innerH / rows;
    for (let r = 1; r < rows; r++) {
      const y = paneY0 + rowH * r;
      g.add(box(innerW, 0.055, 0.09, fi, cx, y, mullZ));
    }

    // ---- glass ----------------------------------------------------------
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.03, height - 0.03), this.materials.glass);
    glass.position.set(cx, (y0 + y1) / 2, outZ + (facing > 0 ? 0.01 : -0.01));
    glass.rotation.y = facing > 0 ? 0 : Math.PI;
    g.add(glass);

    return g;
  }

  _windows() {
    const zb = CABIN.halfZOuter - CABIN.wall / 2;
    const sillY = CABIN.floorY + WIN.sill;

    // inside-facing (the interior looks north through these)
    for (const o of [...WIN.living, ...WIN.bedroom]) {
      this.group.add(this._buildWindow(o.cx, o.w, zb, 1, sillY, WIN.height, 4, 2));
    }

    // south elevation: three windows, all facing the shore track
    const szb = -CABIN.halfZOuter + CABIN.wall / 2;
    for (const sw of this.southWindows) {
      this.group.add(this._buildWindow(sw.cx, sw.w, szb, -1, sw.sillY, sw.h, 2, 2));
    }

    this.windowOpenings = {
      north: [...WIN.living, ...WIN.bedroom].map(o => ({
        cx: o.cx, w: o.w, y0: sillY, y1: sillY + WIN.height, z: CABIN.halfZOuter - CABIN.wall,
      })),
      south: this.southWindows.map((sw) => ({
        cx: sw.cx, w: sw.w, y0: sw.sillY, y1: sw.sillY + sw.h, z: -CABIN.halfZOuter + CABIN.wall,
      })),
    };
  }

  _door() {
    const d = this.doorOpening;
    const g = new THREE.Group();
    const zOut = d.z - CABIN.wall / 2 - 0.02;

    // frame
    const fw = 0.11;
    const f = this.materials.frameInner;
    g.add(box(fw, d.h + fw, 0.24, f, d.cx - d.w / 2 - fw / 2, CABIN.floorY + (d.h + fw) / 2, zOut + 0.04));
    g.add(box(fw, d.h + fw, 0.24, f, d.cx + d.w / 2 + fw / 2, CABIN.floorY + (d.h + fw) / 2, zOut + 0.04));
    g.add(box(d.w + fw * 2, fw, 0.24, f, d.cx, CABIN.floorY + d.h + fw / 2, zOut + 0.04));

    // the leaf itself, slightly recessed
    const leaf = box(d.w - 0.04, d.h - 0.03, 0.075, this.materials.door,
      d.cx, CABIN.floorY + d.h / 2, zOut - 0.06);
    g.add(leaf);

    // panel detail: two inset rectangles
    const inset = new THREE.MeshStandardMaterial({ color: 0x2a1114, roughness: 0.85 });
    g.add(box(d.w * 0.62, d.h * 0.30, 0.02, inset, d.cx, CABIN.floorY + d.h * 0.72, zOut - 0.10));
    g.add(box(d.w * 0.62, d.h * 0.34, 0.02, inset, d.cx, CABIN.floorY + d.h * 0.32, zOut - 0.10));

    // handle
    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.022, 0.13, 10),
      new THREE.MeshStandardMaterial({ color: 0x9a8258, roughness: 0.35, metalness: 0.85 }),
    );
    handle.rotation.x = Math.PI / 2;
    handle.position.set(d.cx + d.w / 2 - 0.16, CABIN.floorY + 1.05, zOut - 0.13);
    g.add(handle);

    this.group.add(g);
  }

  // -----------------------------------------------------------------------
  // Gable roof — two slabs with thickness, a ridge cap, facia boards and
  // exposed rafter tails under the eaves.
  // -----------------------------------------------------------------------
  _roof() {
    const hx = CABIN.halfXOuter;
    const hz = CABIN.halfZOuter;
    const over = CABIN.eaveOverhang;
    const ridgeY = CABIN.ridgeY;
    // Take the eave height from the config getter, not from the top plate:
    // the getter is defined so the roof plane passes exactly through
    // (z = halfZOuter, y = topPlateY), which is what closes the wall head.
    const eaveY = CABIN.eaveY;
    const runX = hx + over;
    const runZ = hz + over;

    const slopeLen = Math.hypot(runZ, ridgeY - eaveY);
    const angle = Math.atan2(ridgeY - eaveY, runZ);
    const slabThick = 0.20;
    const slabW = (hx + over) * 2;

    // two slabs, mirrored about z = 0
    // SIGN MATTERS: with rotation.x = -angle the far end of each slab rises to
    // the ridge height, so the pair forms a shallow VALLEY instead of a ridge
    // and the whole roof reads as a plate floating above the wall heads.
    // rotation.x = +angle puts the far end at eaveY at z = ±runZ.
    for (const sign of [1, -1]) {
      const slab = box(slabW, slabThick, slopeLen, this.materials.roof, 0, 0, 0);
      slab.rotation.x = sign * angle;
      slab.position.set(
        0,
        (ridgeY + eaveY) / 2 + Math.cos(angle) * slabThick * 0.5,
        sign * (runZ / 2),
      );
      slab.castShadow = true;
      slab.receiveShadow = true;
      this.group.add(slab);
    }

    // ridge cap
    const cap = box(slabW + 0.05, 0.10, 0.30, this.materials.roof, 0, ridgeY + 0.14, 0);
    this.group.add(cap);

    // barge boards down the gable ends
    // These must use the SAME rotation sign as the slabs above; with the
    // opposite sign they poke out through the roof plane as two long poles.
    for (const sx of [-1, 1]) {
      for (const sz of [1, -1]) {
        const b = box(0.09, 0.30, slopeLen, this.materials.dark,
          sx * (hx + over - 0.02), (ridgeY + eaveY) / 2 - 0.02, sz * (runZ / 2));
        b.rotation.x = sz * angle;
        this.group.add(b);
      }
    }

    // facia + soffit + rafter tails along the east/west eaves
    const faciaDrop = 0.26;
    for (const sz of [1, -1]) {
      const zPos = sz * runZ;
      // facia board
      this.group.add(box(slabW, faciaDrop, 0.06, this.materials.dark, 0, eaveY - faciaDrop / 2, zPos));
      // soffit
      this.group.add(box(slabW, 0.05, over + 0.02, this.materials.dark, 0, eaveY - faciaDrop + 0.02, zPos - sz * (over / 2)));
    }

    // rafter tails (visible from below / outside)
    const nRafters = 11;
    for (let i = 0; i < nRafters; i++) {
      const x = -hx + (2 * hx) * (i / (nRafters - 1));
      for (const sz of [1, -1]) {
        const tail = box(0.09, 0.15, over + 0.10, this.materials.dark,
          x, eaveY - 0.20, sz * (hz + over / 2 - 0.02));
        this.group.add(tail);
      }
    }

    // gable-end rafter tails (running north-south under the barge boards)
    const nEnd = 5;
    for (let i = 0; i < nEnd; i++) {
      const t = (i / (nEnd - 1));
      const z = -hz + 2 * hz * t;
      for (const sx of [1, -1]) {
        const tail = box(0.10, 0.14, 0.55, this.materials.dark,
          sx * (hx + over - 0.26), eaveY - 0.18 + 0.02, z);
        // rotate to follow the slope
        this.group.add(tail);
      }
    }

    // chimney-ish vent stub so the ridge line is not perfectly bare
    const vent = box(0.5, 0.85, 0.5, this.materials.dark, 1.9, ridgeY + 0.30, 0.6);
    this.group.add(vent);
    const ventCap = box(0.65, 0.08, 0.65, this.materials.roof, 1.9, ridgeY + 0.76, 0.6);
    this.group.add(ventCap);
  }

  // -----------------------------------------------------------------------
  _trims() {
    // corner boards
    const hx = CABIN.halfXOuter;
    const hz = CABIN.halfZOuter;
    const y0 = CABIN.floorY - 0.10;
    const y1 = CABIN.topPlateY;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        this.group.add(box(0.16, y1 - y0, 0.16, this.materials.wallDark,
          sx * (hx - 0.02), (y0 + y1) / 2, sz * (hz - 0.02)));
      }
    }

    // a horizontal belt board under the windows so the wall has a datum
    for (const sz of [1, -1]) {
      this.group.add(box(hx * 2 + 0.06, 0.09, 0.05, this.materials.wallDark,
        0, CABIN.floorY + 0.34, sz * (hz + 0.015)));
    }
  }

  // -----------------------------------------------------------------------
  // The small cabin across the lake — just a silhouette anchor at this
  // distance, but it has the same red and the same lit window.
  // -----------------------------------------------------------------------
  _farCabin() {
    const g = new THREE.Group();
    g.name = 'farCabin';

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x5c2028, roughness: 0.9 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x1e232a, roughness: 0.85, metalness: 0.05 });
    // Not a light source: at 245 m a lit window is a dull amber chip. A fully
    // bright MeshBasicMaterial here blooms into a searchlight orb that reads
    // as a UFO through the living-room glass, which is exactly what happened.
    const glowMat = new THREE.MeshBasicMaterial({ color: 0x5e3a18 });

    const body = box(7.0, 3.2, 5.0, bodyMat, 0, 1.6, 0);
    g.add(body);

    const shape = new THREE.Shape();
    shape.moveTo(-3.9, 0);
    shape.lineTo(3.9, 0);
    shape.lineTo(0, 2.1);
    shape.closePath();
    const pedGeo = new THREE.ExtrudeGeometry(shape, { depth: 5.4, bevelEnabled: false });
    pedGeo.translate(0, 3.2, -2.7);
    const ped = new THREE.Mesh(pedGeo, bodyMat);
    g.add(ped);

    // roof slabs
    for (const sign of [1, -1]) {
      const slope = Math.atan2(2.1, 3.9);
      const slab = box(4.6, 0.16, 5.9, roofMat, 0, 0, 0);
      slab.rotation.z = sign * slope;
      slab.position.set(sign * 2.0, 4.15, 0);
      g.add(slab);
    }

    // two lit windows
    const w1 = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.72), glowMat);
    w1.position.set(-1.2, 1.9, 2.52);
    g.add(w1);
    const w2 = new THREE.Mesh(new THREE.PlaneGeometry(0.50, 0.72), glowMat);
    w2.position.set(1.4, 1.9, 2.52);
    g.add(w2);

    // Sit the hut on the far bank, not in the lake. The bank's waterline is at
    // z ~= 242 and it is still only 2.4 m high at z = 256, so the hut is placed
    // where the ground reads solid and its base is sunk 0.3 m into the slope.
    g.position.set(-74, farShoreHeight(-74, 258) - 0.3, 258);
    g.rotation.y = 0.28;
    this.group.add(g);
    this.farCabin = g;
  }

  // -----------------------------------------------------------------------
  // Colliders — axis-aligned world-space boxes for the CollisionSystem.
  // -----------------------------------------------------------------------
  worldCollider(hx, hx2, y0, y1, hz, hz2) {
    this.colliders.push({
      min: V(-hx, y0, -hz),
      max: V(hx2, y1, hz2),
    });
  }

  worldColliderSegment(x0, z0, x1, z1, thickness, y0, y1) {
    const pad = thickness / 2 + 0.02;
    const minX = Math.min(x0, x1) - pad;
    const maxX = Math.max(x0, x1) + pad;
    const minZ = Math.min(z0, z1) - pad;
    const maxZ = Math.max(z0, z1) + pad;
    this.colliders.push({ min: V(minX, y0, minZ), max: V(maxX, y1, maxZ) });
  }

  // Called by the collision system to gather wall volumes — but the walls have
  // window openings, so collision cannot simply use the bounding box. Instead we
  // expose the openings so the player can be pushed back at the sill/head.
  getWindowOpenings() {
    return this.windowOpenings;
  }
}
