// ---------------------------------------------------------------------------
// World configuration — every module reads its numbers from here so the
// geography stays coherent across the exterior, the interior and the player.
//
// Coordinate system (per spec):
//   +Y up   +X east   +Z north
//   The lake and the mountains are NORTH of the cabin.
//
// One world unit is roughly one metre near the cabin. The mountain ranges are
// deliberately "compressed" in scale (the spec places them 250–400 units away)
// so their apparent angular height above the horizon stays realistic.
// ---------------------------------------------------------------------------

import { fbm, ridged, smoothstep, clamp, lerp } from './noise.js';

export const PALETTE = {
  // --- sky ---------------------------------------------------------------
  skyZenith: 0x02071a,
  skyUpper: 0x06316a,
  skyMid: 0x0a4d92,
  skyLower: 0x1a4a7d,
  skyHorizon: 0x33587f,
  skyGlow: 0x6b7f96,

  // --- mountains ---------------------------------------------------------
  rockShadow: 0x060f26,
  rock: 0x143454,
  rockLight: 0x2b527d,
  snowDeep: 0x3d5f88,
  snow: 0x6d94bd,
  snowLit: 0xa9c4dd,
  alpenglow: 0xffad87,
  alpenglowDeep: 0xff8358,

  // --- water -------------------------------------------------------------
  waterDeep: 0x040a18,
  waterShallow: 0x0a1a30,
  waterTint: 0x143454,

  // --- cabin -------------------------------------------------------------
  cabinWall: 0x5c2028,
  cabinWallDark: 0x3a1319,
  roof: 0x181c22,
  roofEdge: 0x2b3139,
  trim: 0xcfd6db,
  frame: 0xb3bbc2,
  plinth: 0x21252b,
  doorWood: 0x3b161b,

  // --- interior ----------------------------------------------------------
  floorWood: 0x2c1d14,
  floorWoodLight: 0x3f2b1d,
  wallInner: 0x232f3e,
  wallInnerDark: 0x18222e,
  ceiling: 0x1a222c,
  lampWarm: 0xffc691,
  lampGlow: 0xffc978,
  fabricDark: 0x221d1a,
  fabricBlue: 0x1b2533,
  metalDark: 0x121418,
  plantGreen: 0x22331e,

  // --- atmosphere --------------------------------------------------------
  fog: 0x14335c,
};

export const WORLD = {
  waterY: 0,

  cabin: {
    innerX: 7.55,     // interior spans -7.55 .. +7.55  (15.1 wide)
    innerZ: 5.55,     // interior spans -5.55 .. +5.55  (11.1 deep)
    wall: 0.32,       // exterior wall thickness
    partition: 0.24,  // living-room / bedroom wall thickness
    floorY: 1.62,     // top surface of the floor
    ceilingH: 3.20,   // interior height
    ridgeRise: 3.75,  // ridge above the top plate (steeper = reads as a chalet, not a shed)
    eaveOverhang: 0.85,
    get halfXOuter() { return this.innerX + this.wall; },
    get halfZOuter() { return this.innerZ + this.wall; },
    get ceilingY() { return this.floorY + this.ceilingH; },
    get topPlateY() { return this.floorY + this.ceilingH + 0.24; },
    get ridgeY() { return this.topPlateY + this.ridgeRise; },

    // ---- roof geometry, shared so the walls and the slabs never disagree ---
    // The roof plane passes through (z = halfZOuter, y = topPlateY) and peaks at
    // (z = 0, y = ridgeY); the slabs then overhang to z = ±runZ, which is what
    // drops the eave below the wall head.
    get runZ() { return this.halfZOuter + this.eaveOverhang; },
    get roofSlope() { return this.ridgeRise / this.halfZOuter; },
    get roofAngle() { return Math.atan(this.roofSlope); },
    get eaveY() { return this.ridgeY - this.roofSlope * this.runZ; },
    get roofSlabLen() { return Math.hypot(this.runZ, this.ridgeY - this.eaveY); },
  },

  // partition wall between living room (west) and bedroom (east)
  partitionX: 0.62,

  windows: {
    // The north wall is the whole point of the interior: the head of the opening
    // has to clear the summit at (118, 404) as seen from the middle of the room,
    // or the mountain is simply cut off by the lintel. Tall Nordic windows solve
    // this far more honestly than shrinking the range.
    sill: 0.60,
    height: 2.42,
    living: [{ cx: -5.35, w: 2.90 }, { cx: -1.95, w: 2.90 }],
    bedroom: [{ cx: 2.62, w: 2.46 }, { cx: 5.62, w: 2.46 }],
  },

  // lake / shore
  shoreEdgeZ: 11.6,
  lakeFarZ: 216,
  farShoreTopZ: 262,

  // mountains
  rangeStartZ: 206,

  // low, warm, south-south-west alpine afterglow
  sun: {
    // direction TOWARDS the sun (normalised in code)
    dir: [-0.44, 0.088, -0.894],
    // Only enough energy to graze the high snow. Anything stronger and the
    // warm key rakes straight across the cabin's red siding and the whole
    // building glows orange, which is exactly what happens at no point in a
    // blue-hour scene — the alpenglow lives in the mountain shader, not here.
    color: 0xffa878,
    intensity: 0.62,
  },

  // blue sky fill
  skyLight: {
    color: 0x3f6ea8,
    intensity: 1.15,
  },

  fogNear: 0.00055,
  fogFar: 0.9,
};

export const CABIN = WORLD.cabin;
export const WIN = WORLD.windows;

// ---------------------------------------------------------------------------
// Shore height field — shared by the terrain mesh and the player collision so
// the camera never sinks into the snow.
// ---------------------------------------------------------------------------
export const BANK_TOP = CABIN.floorY - 0.09;

export function shoreHeight(x, z) {
  // the waterline wanders east/west so it does not read as a ruler line
  const wob =
    3.6 * (fbm(x * 0.024, 0.5, { seed: 31, octaves: 3 }) - 0.5) +
    1.15 * (fbm(x * 0.105, 0.5, { seed: 32, octaves: 3 }) - 0.5);
  const edge = WORLD.shoreEdgeZ + wob;

  const d = z - edge; // > 0 means out in the lake
  const rise = smoothstep(-12.0, 0.0, d);

  let h = BANK_TOP * (1.0 - rise) + -0.55 * rise;
  if (d > 0) h = -0.55 - d * 0.22; // lake bed falls away

  // rock / snow undulation on the bank, damped near the water's edge
  const amp = BANK_TOP * 0.26 * (1.0 - rise * 0.6);
  h += (fbm(x * 0.072, z * 0.072, { seed: 33, octaves: 4 }) - 0.5) * 2.6 * amp;
  h += (ridged(x * 0.040, z * 0.040, { seed: 34, octaves: 3 }) - 0.42) * amp * 1.7;

  // a couple of low rock shelves breaking the shoreline
  const shelf = ridged(x * 0.017 + 4.1, z * 0.019, { seed: 35, octaves: 3 });
  h += smoothstep(0.56, 0.96, shelf) * 1.5 * smoothstep(-16, -3, -Math.abs(d - 2.0));

  // flat pad under the cabin so the building sits level
  const padX = smoothstep(CABIN.innerX + 6.0, CABIN.innerX * 0.35, Math.abs(x));
  const padZ = smoothstep(CABIN.innerZ + 4.5, CABIN.innerZ * 0.30, Math.abs(z + 0.35));
  const pad = padX * padZ;
  h = lerp(h, BANK_TOP - 0.12, pad);

  return h;
}

export function insideCabinFootprint(x, z) {
  return Math.abs(x) < CABIN.halfXOuter && Math.abs(z) < CABIN.halfZOuter;
}

// ---------------------------------------------------------------------------
// Mountain height field — the whole range north of the lake.
// ---------------------------------------------------------------------------
const gauss = (v, c, w) => Math.exp(-((v - c) / w) * ((v - c) / w));

export function mountainHeight(x, z) {
  // How far the range has risen out of the far shore. Everything below ~206
  // is still lake bed, so the range starts exactly at the waterline.
  const rise = smoothstep(WORLD.rangeStartZ, WORLD.rangeStartZ + 74, z);
  if (rise <= 0.0005) return -6;

  // ---- range envelope: stacked crest lines ------------------------------
  // The heights here are chosen against the interior windows: the head of a
  // 2.42 m opening sits ~14.5 degrees above the eye when you stand in the
  // middle of the room, so the dominant summit has to peak just under that
  // or the mountain is cropped by the lintel and the whole room loses its
  // reason to exist. Farther ranges are free to run higher — fog eats them.
  // The spec puts the main massif 250-400 m from the cabin; pushing it back was
  // the wrong fix for the lintel problem, because a range at 900 m subtends so
  // little that it reads as a strip of haze no matter how tall it is. It sits at
  // ~420 m and is capped in height instead, which is what the window budget
  // actually constrains.
  // Layered on purpose: a low near ridge, the dominant crest at ~420 m that
  // carries the summit and its snow, and two receding ranges. The near ridge is
  // deliberately LOW — when it was 24 m tall it filled the whole 0-7 degree band
  // with dark rock and hid the snow peaks behind it, so the room looked out on a
  // featureless blue wall instead of a mountain.
  const env =
    13 * gauss(z, 296, 84) +
    35 * gauss(z, 430, 120) +
    40 * gauss(z, 700, 210) +
    46 * gauss(z, 1200, 340) +
    8; // constant foothill lift so nothing sinks below the shore

  // ---- ridged multifractal: the actual rock -----------------------------
  const r1 = ridged(x * 0.0052, z * 0.0056, { seed: 71, octaves: 6, sharpness: 1.15, gain: 0.52 });
  const r2 = ridged(x * 0.0148, z * 0.0163, { seed: 72, octaves: 5, sharpness: 0.95, gain: 0.5 });
  const r3 = ridged(x * 0.0385, z * 0.0408, { seed: 73, octaves: 4, sharpness: 0.85, gain: 0.48 });

  // warp the big ridges a little so they are not axis-aligned
  const wx = x + 42 * (fbm(x * 0.0031, z * 0.0031, { seed: 75, octaves: 3 }) - 0.5);
  const wz = z + 34 * (fbm(x * 0.0036, z * 0.0036, { seed: 76, octaves: 3 }) - 0.5);
  const rw = ridged(wx * 0.0024, wz * 0.0026, { seed: 77, octaves: 6, sharpness: 1.05, gain: 0.53 });

  let shape = 0.30 + 0.92 * rw;
  shape *= 0.62 + 0.60 * r1;
  shape += 0.34 * r2;
  shape += 0.13 * r3;

  let h = env * shape;

  // ---- named summits ----------------------------------------------------
  // Amplitudes are modest on purpose: the ridges already carry most of the
  // height, and a big additive bump on top of them is exactly what turns a
  // mountain into a cone.
  const peaks = [
    { x: 78, z: 426, sx: 128, sz: 94, a: 40, s: 0.0125 },    // dominant summit
    { x: 10, z: 452, sx: 96, sz: 76, a: 7, s: 0.016 },       // west shoulder
    { x: 206, z: 452, sx: 104, sz: 82, a: 8, s: 0.0145 },    // second summit
    { x: 292, z: 486, sx: 108, sz: 84, a: 9, s: 0.015 },     // east shoulder
    { x: -196, z: 486, sx: 128, sz: 94, a: 6, s: 0.013 },    // far west ridge
    { x: 392, z: 512, sx: 138, sz: 100, a: 7, s: 0.012 },    // far east ridge
  ];
  for (const p of peaks) {
    const dx = (x - p.x) / p.sx;
    const dz = (z - p.z) / p.sz;
    const falloff = Math.exp(-dx * dx - dz * dz * 0.85);
    if (falloff < 0.004) continue;
    // a hard crease plus a finer burr: keeps the summit a summit but stops
    // the flanks from reading as a smooth cone
    const jag =
      0.26 +
      0.98 * ridged(x * p.s, z * p.s, { seed: 78, octaves: 5, sharpness: 1.55, gain: 0.5 }) +
      0.34 * ridged(x * p.s * 4.1, z * p.s * 4.1, { seed: 82, octaves: 4, sharpness: 1.2, gain: 0.5 });
    h += p.a * Math.pow(falloff, 0.72) * jag;
  }

  // ---- carve gullies so the rock reads as glaciated ---------------------
  const gully = ridged(x * 0.0215, z * 0.0124, { seed: 79, octaves: 4, sharpness: 1.7, gain: 0.45 });
  h -= (1 - gully) * env * 0.26;

  // fine rock detail
  h += (fbm(x * 0.045, z * 0.045, { seed: 80, octaves: 3 }) - 0.5) * 2.4;
  h += (ridged(x * 0.062, z * 0.062, { seed: 81, octaves: 3 }) - 0.4) * 4.0;
  // very fine breakup: this is what the eye reads as scree when the mesh is
  // dense enough, and it is what stops big faces from looking like clay
  h += (ridged(x * 0.145, z * 0.145, { seed: 83, octaves: 2 }) - 0.4) * 1.5;

  // ---- fit the crests inside the window --------------------------------
  // Measured from the sofa the head of a north window opens to 9.5 degrees and
  // the summit sat at 10.8, so the crest was clipped and the range read as a
  // featureless pale band with no skyline. 0.76 brings the highest crest to
  // about 8.2 degrees: the skyline and a strip of twilight sky now sit inside
  // the opening, which is the whole reason the room has two big windows. Going
  // lower than this starts to flatten the range when seen from the shore.

  h *= 0.76;

  // ---- blend into the far shore ----------------------------------------
  h = h * rise - (1 - rise) * 4.0;

  // keep the very front edge tucked behind the far bank
  const frontGuard = smoothstep(WORLD.rangeStartZ - 2, WORLD.rangeStartZ + 18, z);
  return h * frontGuard - 4 * (1 - frontGuard);
}

// Far-shore height: the strip of land between the lake and the mountains.
export function farShoreHeight(x, z) {
  // A low dark bank, not a beach and not a wall. Seen from the cabin at 3 m
  // over 200 m of water, anything that climbs more than ~15 m hides the range
  // behind it; anything flatter than ~4 m reads as a ruler line drawn across
  // the horizon. The bank climbs to ~15 m and then hands over to the range.
  const wob = 9.0 * (fbm(x * 0.0042, 0.5, { seed: 91, octaves: 3 }) - 0.5)
    + 2.2 * (fbm(x * 0.023, 0.5, { seed: 94, octaves: 3 }) - 0.5);
  const zz = z + wob;

  let h = -6.5 + smoothstep(WORLD.lakeFarZ - 6, WORLD.lakeFarZ + 34, zz) * 7.6;
  h += smoothstep(WORLD.lakeFarZ + 22, WORLD.farShoreTopZ + 46, zz)
    * (7.0 + 6.5 * fbm(x * 0.016, z * 0.012, { seed: 92, octaves: 4 }));
  h += (fbm(x * 0.030, z * 0.030, { seed: 93, octaves: 3 }) - 0.5) * 2.6;
  return h;
}

export function groundHeight(x, z) {
  if (insideCabinFootprint(x, z)) return CABIN.floorY;
  if (z > WORLD.lakeFarZ - 14) return Math.max(farShoreHeight(x, z), -6);
  return shoreHeight(x, z);
}
