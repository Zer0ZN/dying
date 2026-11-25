// ---------------------------------------------------------------------------
// Procedural textures — everything is drawn into canvases at load time, so the
// project ships without a single image asset and still has real surface
// detail (wood grain, plank gaps, fabric weave, plaster grain, snow drift).
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { fbm, valueNoise2, ridged, clamp, smoothstep, makeRng } from './noise.js';

const cache = new Map();

function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function finish(canvas, { repeat = [1, 1], srgb = true, aniso = 8 } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = aniso;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// Normal map from a greyscale height canvas (sobel)
// ---------------------------------------------------------------------------
export function normalFromHeight(heightCanvas, strength = 2.2, repeat = [1, 1]) {
  const w = heightCanvas.width;
  const h = heightCanvas.height;
  const src = heightCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const out = makeCanvas(w, h);
  const ctx = out.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;

  const at = (x, y) => {
    const xi = (x + w) % w;
    const yi = (y + h) % h;
    return src[(yi * w + xi) * 4] / 255;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tl = at(x - 1, y - 1), t = at(x, y - 1), tr = at(x + 1, y - 1);
      const l = at(x - 1, y), r = at(x + 1, y);
      const bl = at(x - 1, y + 1), b = at(x, y + 1), br = at(x + 1, y + 1);
      const dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const dy = (bl + 2 * b + br) - (tl + 2 * t + tr);
      let nx = -dx * strength;
      let ny = -dy * strength;
      let nz = 1.0;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const i = (y * w + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return finish(out, { repeat, srgb: false, aniso: 4 });
}

// ---------------------------------------------------------------------------
// Vertical plank siding — used on the cabin exterior.
// ---------------------------------------------------------------------------
export function woodSiding({ seed = 5, base = [92, 34, 42], plankCount = 11, size = 1024, repeat = [1, 1] } = {}) {
  const key = `siding${seed}${base.join('')}${plankCount}${size}`;
  if (cache.has(key)) return cache.get(key);

  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const hc = makeCanvas(size);
  const hctx = hc.getContext('2d');

  const img = ctx.createImageData(size, size);
  const himg = hctx.createImageData(size, size);
  const d = img.data;
  const hd = himg.data;

  // irregular plank edges
  const rng = makeRng(seed);
  const edges = [0];
  let acc = 0;
  const weights = [];
  for (let i = 0; i < plankCount; i++) {
    const wgt = 0.7 + rng() * 0.7;
    weights.push(wgt);
    acc += wgt;
  }
  let run = 0;
  for (let i = 0; i < plankCount; i++) {
    run += weights[i] / acc;
    edges.push(run);
  }
  // per-plank tone + phase
  const tone = [];
  const phase = [];
  for (let i = 0; i < plankCount; i++) {
    tone.push(0.72 + rng() * 0.56);
    phase.push(rng() * 100);
  }
  // staggered board seams (a plank run ends somewhere vertically)
  const seams = [];
  for (let i = 0; i < plankCount; i++) seams.push(0.18 + rng() * 0.64);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;

      // find plank
      let p = 0;
      while (p < plankCount - 1 && u > edges[p + 1]) p++;
      const lo = edges[p];
      const hi = edges[p + 1];
      const local = (u - lo) / (hi - lo);

      // recessed gap between planks
      const gap = smoothstep(0.0, 0.035, local) * smoothstep(1.0, 0.965, local);

      // long vertical grain: high frequency across, very low along
      const g1 = fbm(u * 190 + phase[p], v * 5.5, { seed: seed + p * 13, octaves: 4 });
      const g2 = fbm(u * 620 + phase[p], v * 2.2, { seed: seed + p * 29, octaves: 3 });
      const knotField = fbm(u * 26, v * 26, { seed: seed + 91, octaves: 2 });

      // dark knots
      const knots = [];
      // board seam
      const seam = Math.abs(v - seams[p]) < 0.004 ? 0.35 : 1.0;

      let shade = 0.62 + 0.5 * g1 + 0.16 * g2;
      shade *= 0.55 + 0.45 * gap;
      shade *= seam;

      // faint horizontal weathering
      shade *= 0.94 + 0.12 * valueNoise2(u * 8, v * 120, seed + 4);

      // knots
      if (knotField > 0.735) {
        const k = (knotField - 0.735) / 0.265;
        shade *= 1 - 0.45 * k;
      }

      shade *= tone[p];

      let r = base[0] * shade;
      let g = base[1] * shade;
      let b = base[2] * shade;

      // a touch of desaturated grey in the grain so it is not candy-red
      const grey = (r + g + b) / 3;
      r = r * 0.82 + grey * 0.18;
      g = g * 0.82 + grey * 0.18;
      b = b * 0.86 + grey * 0.14;

      const i = (y * size + x) * 4;
      d[i] = clamp(r, 0, 255);
      d[i + 1] = clamp(g, 0, 255);
      d[i + 2] = clamp(b, 0, 255);
      d[i + 3] = 255;

      const hv = clamp(60 + 140 * gap * (0.7 + 0.3 * g1) + 40 * g2, 0, 255);
      hd[i] = hd[i + 1] = hd[i + 2] = hv;
      hd[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  hctx.putImageData(himg, 0, 0);

  const map = finish(c, { repeat });
  const normalMap = normalFromHeight(hc, 1.5, repeat);
  const res = { map, normalMap, canvas: c };
  cache.set(key, res);
  return res;
}

// ---------------------------------------------------------------------------
// Floor boards — long horizontal planks with visible grain + wear.
// ---------------------------------------------------------------------------
export function woodFloor({ seed = 9, base = [58, 38, 26], rows = 9, size = 1024, repeat = [1, 1] } = {}) {
  const key = `floor${seed}${base.join('')}${rows}${size}`;
  if (cache.has(key)) return cache.get(key);

  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const hc = makeCanvas(size);
  const hctx = hc.getContext('2d');
  const img = ctx.createImageData(size, size);
  const himg = hctx.createImageData(size, size);
  const d = img.data;
  const hd = himg.data;

  const rng = makeRng(seed);
  const rowEdges = [0];
  const wts = [];
  let acc = 0;
  for (let i = 0; i < rows; i++) { const w = 0.75 + rng() * 0.6; wts.push(w); acc += w; }
  let run = 0;
  for (let i = 0; i < rows; i++) { run += wts[i] / acc; rowEdges.push(run); }

  const tone = [], phase = [], breaks = [];
  for (let i = 0; i < rows; i++) {
    tone.push(0.74 + rng() * 0.5);
    phase.push(rng() * 100);
    breaks.push(0.2 + rng() * 0.6);
  }

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      let r0 = 0;
      while (r0 < rows - 1 && v > rowEdges[r0 + 1]) r0++;
      const lo = rowEdges[r0], hi = rowEdges[r0 + 1];
      const local = (v - lo) / (hi - lo);
      const gap = smoothstep(0, 0.06, local) * smoothstep(1, 0.94, local);

      // grain runs along X for floor boards
      const g1 = fbm(u * 5.0, v * 210 + phase[r0], { seed: seed + r0 * 17, octaves: 4 });
      const g2 = fbm(u * 3.0, v * 640 + phase[r0], { seed: seed + r0 * 31, octaves: 3 });

      // end joint
      const brk = Math.abs(u - breaks[r0]) < 0.0035 ? 0.45 : 1.0;

      let shade = 0.62 + 0.46 * g1 + 0.15 * g2;
      shade *= 0.5 + 0.5 * gap;
      shade *= brk;
      shade *= tone[r0];

      // worn paths — brighter, less saturated patches
      const wear = smoothstep(0.55, 0.85, fbm(u * 3.2, v * 3.2, { seed: seed + 77, octaves: 3 }));
      shade *= 1 + wear * 0.24;

      const i = (y * size + x) * 4;
      d[i] = clamp(base[0] * shade, 0, 255);
      d[i + 1] = clamp(base[1] * shade, 0, 255);
      d[i + 2] = clamp(base[2] * shade, 0, 255);
      d[i + 3] = 255;

      const hv = clamp(50 + 150 * gap + 55 * g1, 0, 255);
      hd[i] = hd[i + 1] = hd[i + 2] = hv;
      hd[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  hctx.putImageData(himg, 0, 0);

  const res = {
    map: finish(c, { repeat }),
    normalMap: normalFromHeight(hc, 1.25, repeat),
    canvas: c,
  };
  cache.set(key, res);
  return res;
}

// ---------------------------------------------------------------------------
// Fine grain texture (plaster / painted wall / ceiling)
// ---------------------------------------------------------------------------
// Long-grain timber for furniture. woodFloor() paints plank COURSES, which on
// a 0.5 m cabinet door reads as brickwork; grainSurface() is a plaster tooth
// whose blobs read as camouflage. Furniture needs grain that runs one way,
// stretched hard along the board and thin across it.
export function woodGrain({ seed = 12, base = [132, 98, 70], size = 512, repeat = [1, 1], stretch = 210, warp = 3.4, rings = 5.0 } = {}) {
  const key = `grain${seed}${base.join('')}${size}${stretch}${warp}`;
  if (cache.has(key)) return cache.get(key);

  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const hc = makeCanvas(size);
  const hctx = hc.getContext('2d');
  const img = ctx.createImageData(size, size);
  const himg = hctx.createImageData(size, size);
  const d = img.data;
  const hd = himg.data;
  const rng = makeRng(seed);
  // A handful of mineral streaks, each at its own offset, so the grain is not
  // one uniform stripe field.
  const streaks = [];
  for (let i = 0; i < 5; i++) streaks.push({ p: rng() * 100, w: 0.006 + rng() * 0.016, s: 0.25 + rng() * 0.5 });

  // Grain runs along V (up a cabinet door, along a table leg). The lines are
  // therefore HIGH frequency in U and LOW in V — the opposite of the first
  // version, which drew its bands the other way and, once the warp was added,
  // closed them into the contour rings of a topographic map.
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      // Slow warp across the board so the lines wander like real grain
      const w1 = fbm(u * warp, v * 2.0, { seed: seed + 5, octaves: 3 }) - 0.5;
      const w2 = fbm(u * warp * 3.2, v * 5.0, { seed: seed + 9, octaves: 2 }) - 0.5;
      const fine = fbm((u + w1 * 0.06 + w2 * 0.018) * stretch, v * 2.4, { seed, octaves: 4 });
      const broad = fbm((u + w1 * 0.09) * rings * 2.0, v * 1.3, { seed: seed + 23, octaves: 3 });

      let k = 0.90 + 0.30 * fine + 0.10 * (broad - 0.5);
      for (const st of streaks) {
        const dline = Math.abs(((u + w1 * 0.12) - st.p) % 1.0);
        const band = 1 - smoothstep(0, st.w, Math.min(dline, 1 - dline));
        k *= 1 - st.s * band * 0.55;
      }
      k = clamp(k, 0.45, 1.30);

      const i = (y * size + x) * 4;
      d[i] = clamp(base[0] * k, 0, 255);
      d[i + 1] = clamp(base[1] * k, 0, 255);
      d[i + 2] = clamp(base[2] * k, 0, 255);
      d[i + 3] = 255;

      // Height carries the FINE lines, not the broad bands: a normal map built
      // from the broad band turns a cabinet door into wavy corrugation.
      const hv = clamp(128 + (fine - 0.5) * 92 + (w2) * 26, 0, 255);
      hd[i] = hd[i + 1] = hd[i + 2] = hv;
      hd[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  hctx.putImageData(himg, 0, 0);

  const res = { map: finish(c, { repeat }), normalMap: normalFromHeight(hc, 0.7, repeat), canvas: c };
  cache.set(key, res);
  return res;
}

export function grainSurface({ seed = 3, base = [34, 45, 60], scale = 0.055, contrast = 0.16, size = 512, repeat = [1, 1], mottle = 0.1 } = {}) {
  const key = `grain${seed}${base.join('')}${scale}${contrast}${size}${mottle}${repeat.join('')}`;
  if (cache.has(key)) return cache.get(key);

  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const hc = makeCanvas(size);
  const hctx = hc.getContext('2d');
  const img = ctx.createImageData(size, size);
  const himg = hctx.createImageData(size, size);
  const d = img.data;
  const hd = himg.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;

      // Three octave bands, all sampled on INTEGER frequencies so the tile
      // wraps seamlessly: paint tooth, roller texture, and a very soft
      // large-scale unevenness. Nothing below ~8 cycles per tile — at a 2 m
      // tile that is 25 cm, and anything coarser reads as marble rather than
      // painted plaster.
      const tooth = fbm(u * 256, v * 256, { seed, octaves: 2 });
      const roller = fbm(u * 24, v * 24, { seed: seed + 11, octaves: 3 });
      const broad = fbm(u * 8, v * 8, { seed: seed + 23, octaves: 2 });

      let k = 1 + (roller - 0.5) * 2 * contrast + (tooth - 0.5) * contrast * 0.45;
      k *= 1 + (broad - 0.5) * 2 * mottle * 0.35;

      const i = (y * size + x) * 4;
      d[i] = clamp(base[0] * k, 0, 255);
      d[i + 1] = clamp(base[1] * k, 0, 255);
      d[i + 2] = clamp(base[2] * k, 0, 255);
      d[i + 3] = 255;

      const hv = clamp(128 + (roller - 0.5) * 70 + (tooth - 0.5) * 130, 0, 255);
      hd[i] = hd[i + 1] = hd[i + 2] = hv;
      hd[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  hctx.putImageData(himg, 0, 0);

  const res = {
    map: finish(c, { repeat }),
    normalMap: normalFromHeight(hc, 0.55, repeat),
    canvas: c,
  };
  cache.set(key, res);
  return res;
}

// ---------------------------------------------------------------------------
// Fabric weave — sofa / bedding. Woven threads + subtle pile variation.
// ---------------------------------------------------------------------------
export function fabricWeave({ seed = 21, base = [34, 29, 27], size = 512, repeat = [1, 1], threads = 150 } = {}) {
  const key = `fabric${seed}${base.join('')}${threads}`;
  if (cache.has(key)) return cache.get(key);

  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const hc = makeCanvas(size);
  const hctx = hc.getContext('2d');
  const img = ctx.createImageData(size, size);
  const himg = hctx.createImageData(size, size);
  const d = img.data;
  const hd = himg.data;

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      // over/under weave
      const tx = Math.sin(u * threads * Math.PI * 2);
      const ty = Math.sin(v * threads * Math.PI * 2);
      const over = Math.sign(tx * ty);
      const weave = (tx * 0.5 + 0.5) * 0.5 + (ty * 0.5 + 0.5) * 0.5;

      // slub / pile irregularity
      const slub = fbm(u * 46, v * 46, { seed, octaves: 4 });
      const pile = fbm(u * 220, v * 220, { seed: seed + 7, octaves: 2 });

      let k = 0.80 + 0.30 * weave + (slub - 0.5) * 0.26 + (pile - 0.5) * 0.16;
      k *= over > 0 ? 1.06 : 0.94;

      const i = (y * size + x) * 4;
      d[i] = clamp(base[0] * k, 0, 255);
      d[i + 1] = clamp(base[1] * k, 0, 255);
      d[i + 2] = clamp(base[2] * k, 0, 255);
      d[i + 3] = 255;

      const hv = clamp(110 + (weave - 0.5) * 70 + (slub - 0.5) * 60, 0, 255);
      hd[i] = hd[i + 1] = hd[i + 2] = hv;
      hd[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  hctx.putImageData(himg, 0, 0);

  const res = {
    map: finish(c, { repeat }),
    normalMap: normalFromHeight(hc, 0.9, repeat),
    canvas: c,
  };
  cache.set(key, res);
  return res;
}

// ---------------------------------------------------------------------------
// Snow — very low contrast, wind-carved micro relief.
// ---------------------------------------------------------------------------
export function snowSurface({ size = 512, repeat = [1, 1], seed = 41 } = {}) {
  const key = `snow${size}${seed}`;
  if (cache.has(key)) return cache.get(key);

  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const hc = makeCanvas(size);
  const hctx = hc.getContext('2d');
  const img = ctx.createImageData(size, size);
  const himg = hctx.createImageData(size, size);
  const d = img.data;
  const hd = himg.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const drift = fbm(u * 6, v * 6, { seed, octaves: 4 });
      const wind = ridged(u * 22, v * 9, { seed: seed + 3, octaves: 3 });
      const micro = fbm(u * 190, v * 190, { seed: seed + 5, octaves: 2 });

      const k = 0.94 + (drift - 0.5) * 0.10 + (wind - 0.45) * 0.055 + (micro - 0.5) * 0.06;

      const i = (y * size + x) * 4;
      d[i] = clamp(228 * k, 0, 255);
      d[i + 1] = clamp(236 * k, 0, 255);
      d[i + 2] = clamp(248 * k, 0, 255);
      d[i + 3] = 255;

      const hv = clamp(128 + (drift - 0.5) * 120 + (wind - 0.45) * 90 + (micro - 0.5) * 40, 0, 255);
      hd[i] = hd[i + 1] = hd[i + 2] = hv;
      hd[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  hctx.putImageData(himg, 0, 0);

  const res = {
    map: finish(c, { repeat }),
    normalMap: normalFromHeight(hc, 0.5, repeat),
    canvas: c,
  };
  cache.set(key, res);
  return res;
}

// ---------------------------------------------------------------------------
// Roof — dark standing-seam metal with fine horizontal ribs.
// ---------------------------------------------------------------------------
export function roofMetal({ size = 512, repeat = [1, 1], seed = 55 } = {}) {
  const key = `roof${size}`;
  if (cache.has(key)) return cache.get(key);

  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const hc = makeCanvas(size);
  const hctx = hc.getContext('2d');
  const img = ctx.createImageData(size, size);
  const himg = hctx.createImageData(size, size);
  const d = img.data;
  const hd = himg.data;
  const seams = 8;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const s = Math.abs(((u * seams) % 1) - 0.5) * 2; // 1 at seam
      const seam = 1 - Math.pow(s, 8) * 0.8;
      const grain = fbm(u * 260, v * 30, { seed, octaves: 3 });
      const dirt = fbm(u * 5, v * 5, { seed: seed + 9, octaves: 3 });
      const k = (0.72 + 0.30 * grain) * (0.86 + 0.28 * dirt) * seam;
      const i = (y * size + x) * 4;
      // NOTE: these are sRGB bytes. 40/255 is 0.157 sRGB = 0.021 LINEAR, so a
      // "dark slate" authored at RGB 40 has almost no albedo left after tone
      // mapping and renders as pure black. Slate that reads as dark in the
      // final image has to be authored around 150 here.
      d[i] = clamp(152 * k, 0, 255);
      d[i + 1] = clamp(158 * k, 0, 255);
      d[i + 2] = clamp(166 * k, 0, 255);
      d[i + 3] = 255;
      const hv = clamp(110 + 90 * seam + 25 * grain, 0, 255);
      hd[i] = hd[i + 1] = hd[i + 2] = hv;
      hd[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  hctx.putImageData(himg, 0, 0);

  const res = {
    map: finish(c, { repeat }),
    normalMap: normalFromHeight(hc, 1.4, repeat),
    canvas: c,
  };
  cache.set(key, res);
  return res;
}

// ---------------------------------------------------------------------------
// Stone / rock — the shoreline boulders.
// ---------------------------------------------------------------------------
export function rockSurface({ size = 512, repeat = [1, 1], seed = 63 } = {}) {
  const key = `rock${size}`;
  if (cache.has(key)) return cache.get(key);

  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const hc = makeCanvas(size);
  const hctx = hc.getContext('2d');
  const img = ctx.createImageData(size, size);
  const himg = hctx.createImageData(size, size);
  const d = img.data;
  const hd = himg.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const a = fbm(u * 5, v * 5, { seed, octaves: 5 });
      const b = ridged(u * 16, v * 16, { seed: seed + 3, octaves: 4 });
      const f = fbm(u * 120, v * 120, { seed: seed + 7, octaves: 2 });
      let k = 0.55 + 0.55 * a + 0.24 * b + 0.12 * f;
      // cracks
      const cr = Math.abs(b - 0.52);
      if (cr < 0.02) k *= 0.55;
      const i = (y * size + x) * 4;
      d[i] = clamp(44 * k, 0, 255);
      d[i + 1] = clamp(50 * k, 0, 255);
      d[i + 2] = clamp(58 * k, 0, 255);
      d[i + 3] = 255;
      const hv = clamp(60 + 150 * a + 90 * b, 0, 255);
      hd[i] = hd[i + 1] = hd[i + 2] = hv;
      hd[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  hctx.putImageData(himg, 0, 0);

  const res = {
    map: finish(c, { repeat }),
    normalMap: normalFromHeight(hc, 1.8, repeat),
    canvas: c,
  };
  cache.set(key, res);
  return res;
}

// ---------------------------------------------------------------------------
// Water ripple normal — layered directional waves, tiles cleanly.
// ---------------------------------------------------------------------------
export function waterRippleNormal(size = 512, repeat = [1, 1]) {
  const key = `ripple${size}`;
  if (cache.has(key)) return cache.get(key);

  const hc = makeCanvas(size);
  const hctx = hc.getContext('2d');
  const img = hctx.createImageData(size, size);
  const d = img.data;

  // a few directional wave trains, all integer frequency so they tile
  const waves = [
    { fx: 3, fy: 1, amp: 0.55, phase: 0.0 },
    { fx: -2, fy: 3, amp: 0.35, phase: 1.7 },
    { fx: 5, fy: -2, amp: 0.22, phase: 3.1 },
    { fx: 8, fy: 4, amp: 0.12, phase: 0.6 },
    { fx: -11, fy: 6, amp: 0.07, phase: 2.2 },
    { fx: 17, fy: -9, amp: 0.04, phase: 4.4 },
  ];

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      let hh = 0;
      for (const w of waves) {
        hh += Math.sin((u * w.fx + v * w.fy) * Math.PI * 2 + w.phase) * w.amp;
      }
      // soften with a little noise so it is not a pure interference pattern
      hh += (valueNoise2(u * 64, v * 64, 7) - 0.5) * 0.06;
      const hv = clamp(128 + hh * 62, 0, 255);
      const i = (y * size + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = hv;
      d[i + 3] = 255;
    }
  }
  hctx.putImageData(img, 0, 0);
  const tex = normalFromHeight(hc, 3.4, repeat);
  cache.set(key, tex);
  return tex;
}

// ---------------------------------------------------------------------------
// Painted canvas art for the wall frames (tiny, hand-painted look)
// ---------------------------------------------------------------------------
export function artCanvas(kind, size = 256) {
  const key = `art${kind}${size}`;
  if (cache.has(key)) return cache.get(key);

  const c = makeCanvas(size, Math.round(size * 1.25));
  const ctx = c.getContext('2d');
  const w = c.width, h = c.height;

  if (kind === 'flower') {
    ctx.fillStyle = '#1d2430';
    ctx.fillRect(0, 0, w, h);
    // stems
    ctx.strokeStyle = '#3d4a44';
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(w * (0.35 + i * 0.15), h * 0.9);
      ctx.quadraticCurveTo(w * (0.3 + i * 0.16), h * 0.62, w * (0.36 + i * 0.14), h * 0.42);
      ctx.lineWidth = 2.4;
      ctx.stroke();
    }
    // blossoms
    const buds = [[0.36, 0.40], [0.50, 0.36], [0.64, 0.44]];
    for (const [bx, by] of buds) {
      for (let p = 0; p < 5; p++) {
        const a = (p / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(w * bx + Math.cos(a) * 11, h * by + Math.sin(a) * 11, 8, 5, a, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(196,168,150,0.72)';
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(w * bx, h * by, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#8a6a52';
      ctx.fill();
    }
  } else if (kind === 'ridge') {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#16223a');
    g.addColorStop(1, '#2c3f56');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#0d1524';
    ctx.beginPath();
    ctx.moveTo(0, h * 0.72);
    ctx.lineTo(w * 0.28, h * 0.44);
    ctx.lineTo(w * 0.46, h * 0.62);
    ctx.lineTo(w * 0.66, h * 0.34);
    ctx.lineTo(w, h * 0.66);
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(190,150,140,0.35)';
    ctx.beginPath();
    ctx.moveTo(w * 0.66, h * 0.34);
    ctx.lineTo(w * 0.76, h * 0.46);
    ctx.lineTo(w * 0.60, h * 0.48);
    ctx.closePath();
    ctx.fill();
  } else {
    // abstract ink
    ctx.fillStyle = '#20262e';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(180,190,200,0.5)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(w * 0.16, h * (0.22 + i * 0.13));
      ctx.bezierCurveTo(w * 0.4, h * (0.1 + i * 0.16), w * 0.62, h * (0.34 + i * 0.1), w * 0.84, h * (0.2 + i * 0.14));
      ctx.stroke();
    }
  }

  // paper grain
  const im = ctx.getImageData(0, 0, w, h);
  const dd = im.data;
  for (let i = 0; i < dd.length; i += 4) {
    const n = (Math.random() - 0.5) * 12;
    dd[i] = clamp(dd[i] + n, 0, 255);
    dd[i + 1] = clamp(dd[i + 1] + n, 0, 255);
    dd[i + 2] = clamp(dd[i + 2] + n, 0, 255);
  }
  ctx.putImageData(im, 0, 0);

  const tex = finish(c, { repeat: [1, 1] });
  cache.set(key, tex);
  return tex;
}

export function disposeTextures() {
  for (const v of cache.values()) {
    if (v && v.dispose) v.dispose();
    else if (v && v.map) { v.map.dispose(); v.normalMap?.dispose(); }
  }
  cache.clear();
}
