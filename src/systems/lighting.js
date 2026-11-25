// ---------------------------------------------------------------------------
// Lighting.
//
// Outdoor: a very low, strongly directional warm light that only has enough
// energy to graze the high snow; a cool sky fill from above; a hemisphere term
// so shadowed snow still reads as blue rather than black.
//
// Indoor: the amber floor lamp lights the sofa corner and nothing else, plus a
// weak cool "window spill" that comes in through the north wall so the room is
// legible without ever looking warm overall.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { CABIN, PALETTE, WIN, WORLD } from '../core/config.js';

export class LightingSystem {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'lighting';
    this.lampLight = null;
    this.spillLights = [];
    this.bedroomSpill = [];
  }

  /**
   * @param {THREE.Vector3} lampPos world position of the lamp bulb
   * @param {object} cabin the CabinBuilder, for its south-elevation openings
   */
  build(lampPos, cabin) {
    const sun = WORLD.sun;

    // --- key: the last of the sun, aimed low across the range --------------
    // WORLD.sun.dir points TOWARDS the sun (south-west, behind the viewer), so
    // the lamp itself must sit on that side; placing it at -dir puts the light
    // behind the mountains, where it lights nothing the camera can see.
    const dir = new THREE.DirectionalLight(sun.color, sun.intensity);
    const targetAt = new THREE.Vector3(0, 60, 320);
    dir.target.position.copy(targetAt);
    dir.position.copy(targetAt).addScaledVector(
      new THREE.Vector3(...sun.dir).normalize(),
      620,
    );
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.near = 120;
    dir.shadow.camera.far = 1500;
    dir.shadow.camera.left = -420;
    dir.shadow.camera.right = 420;
    dir.shadow.camera.top = 420;
    dir.shadow.camera.bottom = -220;
    dir.shadow.bias = -0.0009;
    dir.shadow.normalBias = 0.9;
    dir.shadow.radius = 3;
    this.group.add(dir);
    this.group.add(dir.target);
    this.sun = dir;

    // a much weaker second key aimed at the near shore and the cabin, so the
    // building is not lit by ambient alone
    const near = new THREE.DirectionalLight(0x8fb4e0, 0.55);
    near.position.set(-160, 120, -220);
    near.target.position.set(0, 4, 6);
    near.castShadow = false;
    this.group.add(near);
    this.group.add(near.target);

    // --- downward sky fill --------------------------------------------------
    // The key is nearly horizontal (5 deg of elevation), so an up-facing
    // surface gets NdotL ~= 0.09 from it: the snowfield was lit almost
    // entirely by the dark-blue ambient term and rendered the same value as
    // the lake. A directional light pointing straight down deposits energy on
    // up-facing normals only — it brightens the snow, the roofs and the
    // mountain tops, and casts exactly zero light on the ceiling of the room,
    // because that faces down.
    const skylight = new THREE.DirectionalLight(0x9dbada, 1.45);
    skylight.position.set(30, 420, -10);
    skylight.target.position.set(0, 0, 0);
    // MUST cast shadows. A downward fill with no shadow map shines straight
    // through the roof: it was lighting the top faces of the ceiling beams and
    // the interior floor from above, which washed the beams out to pale grey
    // and left the floor a flat blue. The shadow camera is deliberately small
    // (it only has to cover the cabin) so the cost is one 1024 map.
    skylight.castShadow = true;
    skylight.shadow.mapSize.set(1024, 1024);
    skylight.shadow.camera.near = 300;
    skylight.shadow.camera.far = 620;
    skylight.shadow.camera.left = -26;
    skylight.shadow.camera.right = 26;
    skylight.shadow.camera.top = 26;
    skylight.shadow.camera.bottom = -26;
    skylight.shadow.bias = -0.0016;
    skylight.shadow.normalBias = 0.06;
    this.group.add(skylight);
    this.group.add(skylight.target);

    // --- cool sky fill -----------------------------------------------------
    // Deliberately weak indoors: ambient light is uniform, so a large ambient
    // term flattens the room into one blue value and the lamp stops reading as
    // a light source. Most of the interior illumination comes from the window
    // spill below, which has a direction.
    const hemi = new THREE.HemisphereLight(PALETTE.skyMid, 0x16283c, 0.30);
    hemi.position.set(0, 200, 0);
    this.group.add(hemi);
    this.hemi = hemi;

    // Just enough ambient to keep shadowed material detail away from pure
    // black; any more and the room turns monochrome blue.
    const amb = new THREE.AmbientLight(0x44618a, 0.17);
    this.group.add(amb);
    this.amb = amb;

    // --- the one warm interior light --------------------------------------
    // Intensity is in candela and the shade sits ~1.3 m from the sofa, so
    // 26 put roughly 1.5 units of irradiance on the fabric — four times over
    // white, which turned a dark brown sofa into a beige slab. 9.0 keeps the
    // arm reading as brown with a warm rim instead of a blown highlight.
    const lamp = new THREE.PointLight(PALETTE.lampWarm, 3.6, 13.0, 2.0);
    lamp.position.copy(lampPos);
    lamp.castShadow = true;
    lamp.shadow.mapSize.set(1024, 1024);
    lamp.shadow.camera.near = 0.12;
    lamp.shadow.camera.far = 12;
    lamp.shadow.bias = -0.0015;
    lamp.shadow.normalBias = 0.04;
    this.group.add(lamp);
    this.lampLight = lamp;

    // a tiny warm bounce under the shade, purely decorative
    const fill = new THREE.PointLight(0xffc078, 1.2, 3.6, 2.0);
    fill.position.copy(lampPos).add(new THREE.Vector3(0.0, 0.16, 0.0));
    this.group.add(fill);

    // Warm bounce off the floor and the ceiling around the lamp. A single point
    // light falls off as 1/r^1.65 and leaves the rest of the room flat blue;
    // these two cheap lights fake the inter-reflection that a lit corner of a
    // real room has, so the warm side reads as a volume rather than a dot.
    const bounceFloor = new THREE.PointLight(0xff9a4c, 0.9, 6.0, 2.0);
    bounceFloor.position.copy(lampPos).add(new THREE.Vector3(-0.25, -1.15, 0.15));
    this.group.add(bounceFloor);

    const bounceCeil = new THREE.PointLight(0xffb877, 0.55, 4.5, 2.0);
    bounceCeil.position.copy(lampPos).add(new THREE.Vector3(0.15, 0.92, -0.1));
    this.group.add(bounceCeil);

    // --- blue window spill -------------------------------------------------
    // One broad, weak area-ish fill per window: a spotlight aimed away from the
    // glass into the room reads better than a point light and costs less than
    // a real RectAreaLight with a shadow map.
    for (const o of WIN.living) {
      const sp = new THREE.SpotLight(0x9ab8d8, 10.0, 21, Math.PI * 0.40, 0.82, 1.3);
      const cx = o.cx;
      sp.position.set(cx, CABIN.floorY + WIN.sill + WIN.height * 0.62, CABIN.innerZ - 0.4);
      sp.target.position.set(cx * 0.82, CABIN.floorY + 0.9, -CABIN.innerZ * 0.4);
      sp.castShadow = false;
      this.group.add(sp);
      this.group.add(sp.target);
      this.spillLights.push(sp);
    }

    // The bedroom has no lamp of its own: everything the eye can read in
    // there comes through these two windows, so the spill has to be far
    // stronger than a daylight spill would be, and it has to reach the bed
    // rather than the floor in front of it.
    for (const o of WIN.bedroom) {
      const sp = new THREE.SpotLight(0x8fb4d8, 8.5, 21, Math.PI * 0.50, 0.88, 1.35);
      const cx = o.cx;
      sp.position.set(cx, CABIN.floorY + WIN.sill + WIN.height * 0.66, CABIN.innerZ - 0.5);
      sp.target.position.set(cx * 0.86, CABIN.floorY + 0.55, -CABIN.innerZ * 0.72);
      sp.castShadow = false;
      this.group.add(sp);
      this.group.add(sp.target);
      this.bedroomSpill.push(sp);
    }

    // A cold wall bounce: with no fixture in the room, a single spot leaves
    // the far corner and the headboard in total darkness, which reads as a
    // void rather than as a dim room.
    const bedBounce = new THREE.PointLight(0x6f93bb, 4.4, 12.0, 1.6);
    bedBounce.position.set(4.35, CABIN.floorY + 2.45, 1.05);
    this.group.add(bedBounce);
    const bedBounce2 = new THREE.PointLight(0x5b7ea8, 2.4, 9.0, 1.7);
    bedBounce2.position.set(2.1, CABIN.floorY + 1.5, -3.4);
    this.group.add(bedBounce2);

    // --- a whisper of warm light bleeding out of the windows ---------------
    const out = new THREE.PointLight(0xffb066, 2.4, 16, 2.0);
    out.position.set(-3.6, CABIN.floorY + 1.7, CABIN.innerZ + 0.2);
    out.castShadow = false;
    this.group.add(out);

    // The south windows face away from the lake, so their light is pure sky
    // spill: dim, cold and directional, and it only has to make the back of
    // the living room readable instead of swallowing it. Without it the sofa
    // end of the room fell to a flat black shape in the exterior and doorway
    // frames.
    for (const sw of cabin.southWindows) {
      const sp = new THREE.SpotLight(0x7fa3cc, sw.h < 1.6 ? 2.6 : 4.2, 14, Math.PI * 0.46, 0.94, 1.5);
      sp.position.set(sw.cx, sw.sillY + sw.h * 0.6, -CABIN.innerZ + 0.5);
      sp.target.position.set(sw.cx * 0.9, CABIN.floorY + 0.8, CABIN.innerZ * 0.55);
      sp.castShadow = false;
      this.group.add(sp);
      this.group.add(sp.target);
    }

    return this.group;
  }

  /** The lamp is the only thing that changes at runtime. */
  setLampIntensity(v) {
    if (this.lampLight) this.lampLight.intensity = v;
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.isLight) {
        if (o.shadow && o.shadow.map) o.shadow.map.dispose();
        o.dispose();
      }
    });
  }
}
