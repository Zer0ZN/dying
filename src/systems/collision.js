// ---------------------------------------------------------------------------
// Collision.
//
// The world is made of axis-aligned boxes: walls, the partition, furniture,
// stone plinths. A capsule is not needed — a cylinder of radius r is resolved
// against each box by pushing out along the shallower horizontal axis, which is
// stable, cheap, and good enough for walking around a cabin.
//
// Vertical support is a separate query: it returns the highest surface at or
// below the player's feet plus a step tolerance, falling back to the terrain
// height function outside the building.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { WORLD, groundHeight } from '../core/config.js';

const TMP = new THREE.Vector3();

export class CollisionSystem {
  constructor() {
    /** @type {Array<{min:THREE.Vector3,max:THREE.Vector3,tag?:string,solid?:boolean,walkable?:boolean}>} */
    this.boxes = [];
    this.radius = 0.34;
    this.stepUp = 0.42;
  }

  addBoxes(list) {
    for (const b of list) {
      if (!b || !b.min || !b.max) continue;
      this.boxes.push({
        min: b.min.clone(),
        max: b.max.clone(),
        tag: b.tag || 'solid',
        solid: b.solid !== false,
        walkable: b.walkable !== false,
      });
    }
  }

  /** Add a single AABB from centre + half extents. */
  add(cx, cz, hx, hz, y0, y1, tag = 'solid') {
    this.boxes.push({
      min: new THREE.Vector3(cx - hx, y0, cz - hz),
      max: new THREE.Vector3(cx + hx, y1, cz + hz),
      tag,
      solid: true,
      walkable: true,
    });
  }

  /**
   * Push a cylinder out of every solid box it overlaps.
   * @param {THREE.Vector3} pos feet position, modified in place
   * @param {number} height capsule height
   */
  resolve(pos, height = 1.7) {
    const r = this.radius;
    for (let iter = 0; iter < 3; iter++) {
      let hit = false;
      for (const b of this.boxes) {
        if (!b.solid) continue;
        // vertical overlap (with a small tolerance so standing on a box is not
        // treated as being inside it)
        if (pos.y + height <= b.min.y + 0.02) continue;
        if (pos.y >= b.max.y - 0.02) continue;

        // horizontal distance to the box in each axis
        const dxMin = pos.x - (b.min.x - r);
        const dxMax = (b.max.x + r) - pos.x;
        const dzMin = pos.z - (b.min.z - r);
        const dzMax = (b.max.z + r) - pos.z;
        if (dxMin <= 0 || dxMax <= 0 || dzMin <= 0 || dzMax <= 0) continue;

        // if the player's feet are already above this box's top minus the step
        // tolerance, treat it as ground instead of a wall
        if (b.walkable && pos.y >= b.max.y - this.stepUp) continue;

        const pushX = Math.min(dxMin, dxMax);
        const pushZ = Math.min(dzMin, dzMax);
        if (pushX < pushZ) {
          pos.x += dxMin < dxMax ? -pushX : pushX;
        } else {
          pos.z += dzMin < dzMax ? -pushZ : pushZ;
        }
        hit = true;
      }
      if (!hit) break;
    }
  }

  /**
   * Highest walkable surface under the player, or the terrain height.
   * @param {number} x
   * @param {number} z
   * @param {number} feetY current feet height
   */
  supportAt(x, z, feetY) {
    let best = -Infinity;
    const r = this.radius * 0.72;

    // terrain / bank / lake bed
    const terrain = groundHeight(x, z);
    if (terrain <= feetY + this.stepUp) best = terrain;

    for (const b of this.boxes) {
      if (!b.walkable) continue;
      if (x < b.min.x - r || x > b.max.x + r) continue;
      if (z < b.min.z - r || z > b.max.z + r) continue;
      const top = b.max.y;
      if (top > feetY + this.stepUp) continue;
      if (top > best) best = top;
    }
    return best;
  }

  /**
   * Deep water is not walkable. The lake bed keeps falling away, so without
   * this the player walks off the bank, sinks under the surface and ends up
   * looking at the underside of the water plane. Everything shallower than
   * wading depth stays open so you can reach the very edge of the lake.
   * @param {{x:number,z:number}} p
   */
  atWaterEdge(p) {
    return groundHeight(p.x, p.z) < WORLD.waterY - 0.32;
  }

  /** True when the segment a→b is blocked, used by the camera to avoid walls. */
  isBlocked(a, b) {
    const steps = Math.ceil(a.distanceTo(b) / 0.12);
    for (let i = 1; i < steps; i++) {
      TMP.lerpVectors(a, b, i / steps);
      for (const box of this.boxes) {
        if (!box.solid) continue;
        if (TMP.x < box.min.x || TMP.x > box.max.x) continue;
        if (TMP.y < box.min.y || TMP.y > box.max.y) continue;
        if (TMP.z < box.min.z || TMP.z > box.max.z) continue;
        return true;
      }
    }
    return false;
  }
}
