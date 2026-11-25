// ---------------------------------------------------------------------------
// Noise — deterministic value/gradient noise with fractal helpers.
// Every generator in the project pulls from these so the whole world is
// reproducible for a given seed.
// ---------------------------------------------------------------------------

export function hash2(x, y, seed) {
  let h = x * 374761393 + y * 668265263 + seed * 2147483647;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// Smooth 2D value noise in [0,1]
export function valueNoise2(x, y, seed = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  // quintic fade — avoids the visible grid artifacts of cubic fade
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
  const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

// Gradient (Perlin-ish) noise in [-1,1]
const GRAD = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];
export function gradientNoise2(x, y, seed = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
  const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);

  const dot = (ix, iy, dx, dy) => {
    const g = GRAD[Math.floor(hash2(ix, iy, seed) * 8) & 7];
    return g[0] * dx + g[1] * dy;
  };
  const n00 = dot(xi, yi, xf, yf);
  const n10 = dot(xi + 1, yi, xf - 1, yf);
  const n01 = dot(xi, yi + 1, xf, yf - 1);
  const n11 = dot(xi + 1, yi + 1, xf - 1, yf - 1);
  const nx0 = n00 * (1 - u) + n10 * u;
  const nx1 = n01 * (1 - u) + n11 * u;
  return (nx0 * (1 - v) + nx1 * v) * 1.42;
}

// Fractal brownian motion, ~[0,1]
export function fbm(x, y, { octaves = 5, lacunarity = 2.0, gain = 0.5, seed = 0 } = {}) {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2(x * freq, y * freq, seed + i * 17);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

// Signed fbm in [-1,1] — useful for domain warping
export function fbmSigned(x, y, { octaves = 4, lacunarity = 2.0, gain = 0.5, seed = 0 } = {}) {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * gradientNoise2(x * freq, y * freq, seed + i * 31);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

// Ridged multifractal — the sharp ridge lines that read as real mountains.
// Returns ~[0,1] where 1 is a crest.
export function ridged(x, y, { octaves = 5, lacunarity = 2.05, gain = 0.5, seed = 0, sharpness = 1.0 } = {}) {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  let prev = 1;
  for (let i = 0; i < octaves; i++) {
    const n = valueNoise2(x * freq, y * freq, seed + i * 53);
    let r = 1 - Math.abs(n * 2 - 1); // crease at n=0.5
    r = Math.pow(r, sharpness * 1.5);
    r *= prev * 0.85 + 0.35; // higher octaves ride on lower ones
    prev = r;
    sum += r * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

// 3-octave ripple noise used by vegetation placement and rock scattered geo
export function hashRandom(i, seed = 0) {
  let h = (i + 1) * 2654435761 + seed * 40503;
  h = (h ^ (h >>> 15)) * 2246822519;
  h = (h ^ (h >>> 13)) * 3266489917;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// Small seeded RNG (mulberry32) for repeatable scatter
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const smootherstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
