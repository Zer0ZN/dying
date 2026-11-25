// ---------------------------------------------------------------------------
// SceneManager.
//
// Owns the renderer, scene, camera and every subsystem, and runs the frame
// loop. The composition order matters: the water reflection is refreshed once
// per frame just before the post stack renders, so the mirrored image always
// belongs to the current camera.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import {
  WORLD, CABIN, WIN, BANK_TOP, PALETTE, groundHeight,
} from '../core/config.js';
import { SkySystem } from '../world/sky.js';
import { buildMountainMesh } from '../world/mountains.js';
import { buildNearBank, buildFarShore, buildShoreDetail } from '../world/terrain.js';
import { WaterSystem } from '../world/water.js';
import { CabinBuilder } from '../build/cabin.js';
import { InteriorBuilder } from '../build/interior.js';
import { FurnitureBuilder } from '../build/furniture.js';
import { LightingSystem } from '../systems/lighting.js';
import { PostProcessing } from '../systems/postprocessing.js';
import { CollisionSystem } from '../systems/collision.js';
import { FirstPersonController, EYE_HEIGHT } from '../systems/controller.js';
import { makeRng } from '../core/noise.js';

export class SceneManager {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.quality = opts.quality || 'high';
    this.clock = new THREE.Clock();
    this.frame = 0;
    this.fpsHistory = [];
    this.stats = { fps: 0, calls: 0, triangles: 0 };

    // ---- renderer ---------------------------------------------------------
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false, // the composer does its own resolve with MSAA samples
      powerPreference: 'high-performance',
      stencil: false,
      alpha: false,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality === 'low' ? 1 : 1.75));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.autoClear = true;
    // the composer issues several render calls per frame and each one would
    // reset the counters; accumulate them and reset once at the top instead
    renderer.info.autoReset = false;
    this.renderer = renderer;

    // ---- scene / camera ---------------------------------------------------
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(PALETTE.fog, WORLD.fogNear);
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.08, 6000);
    camera.rotation.order = 'YXZ';
    this.camera = camera;

    this._build();

    // ---- systems ----------------------------------------------------------
    this.post = new PostProcessing(renderer, scene, camera, this.quality);
    this.collision = new CollisionSystem();
    this.collision.addBoxes(this.cabin.colliders);
    this.collision.addBoxes(this.interior.colliders);
    this.collision.addBoxes(this.furniture.colliders);

    this.controller = new FirstPersonController(camera, renderer, this.collision);

    // ---- start inside the living room, looking north at the view ----------
    // yaw = PI faces +Z, which is where the lake and the peaks are. The seat is
    // behind the sofa so the first frame contains the sofa, the lamp and the lit
    // range through the windows — the composition the room exists for.
    const seat = new THREE.Vector3(-6.90, CABIN.floorY, -5.15);
    // Seated in the south-west corner looking north-east along the room's long
    // axis: the sofa back and a lit arm sit in the near left, the arc lamp lands
    // near centre with its warm pool on the rug and the coffee table's plant,
    // and both north window grids plus the sideboard close the frame. Standing
    // behind the sofa instead put a black slab across the bottom third, so this
    // corner seat is the one composition the brief asks to be recognised by.
    // yaw/pitch measured from the target below rather than guessed: the view
    // must open on exactly this framing, so both are derived from the same
    // numbers as view('living').
    const lookAt = new THREE.Vector3(-1.60, CABIN.floorY + 0.93, 5.90);
    const dx = lookAt.x - seat.x;
    const dy = lookAt.y - (seat.y + 1.54);
    const dz = lookAt.z - seat.z;
    this.controller.teleport(seat.x, seat.y, seat.z, Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
    this.homePosition = seat.clone();
    this.homeYaw = Math.atan2(-dx, -dz);
    this.homePitch = Math.atan2(dy, Math.hypot(dx, dz));

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();

    this._running = false;
    this._animate = this._animate.bind(this);
  }

  // -------------------------------------------------------------------------
  _build() {
    const scene = this.scene;
    const rng = makeRng(20260124);

    // sky first: everything else is lit by it
    this.sky = new SkySystem();
    this.sky.addTo(scene);

    // image-based fill baked from the dome itself, so every surface picks up
    // the same twilight the camera sees (gives the snow its blue and the roof
    // its grazing sheen)
    const env = this.sky.buildEnvironment(this.renderer);
    if (env) {
      scene.environment = env;
      scene.environmentIntensity = 0.34;
    }

    // mountains: one displaced mesh, vertex-coloured, with the alpenglow
    // injected into the standard material
    const mountains = buildMountainMesh();
    this.mountains = mountains;
    scene.add(mountains.mesh);

    // near bank and far shore
    const near = buildNearBank();
    this.nearBank = near;
    scene.add(near.mesh);

    const far = buildFarShore();
    this.farShore = far;
    scene.add(far.mesh);

    scene.add(buildShoreDetail(rng));

    // water last of the world pieces, so its reflection target size is valid
    this.water = new WaterSystem(this.renderer);
    this.water.addTo(scene);

    // cabin shell
    this.cabinBuilder = new CabinBuilder();
    const cabinGroup = this.cabinBuilder.build();
    this.cabin = this.cabinBuilder;
    scene.add(cabinGroup);

    // interior skin
    this.interiorBuilder = new InteriorBuilder(this.cabinBuilder);
    this.interior = this.interiorBuilder;
    scene.add(this.interiorBuilder.build());

    // furniture
    this.furnitureBuilder = new FurnitureBuilder();
    this.furniture = this.furnitureBuilder;
    scene.add(this.furnitureBuilder.build());

    // lights
    this.lighting = new LightingSystem();
    scene.add(this.lighting.build(this.furnitureBuilder.lampAnchor, this.cabinBuilder));
  }

  start() {
    if (this._running) return;
    this._running = true;
    this.renderer.setAnimationLoop(this._animate);
  }

  stop() {
    this._running = false;
    this.renderer.setAnimationLoop(null);
  }

  _animate() {
    const dt = Math.min(this.clock.getDelta(), 0.08);
    this.frame++;
    this.renderer.info.reset();

    this.controller.update(dt);
    this.sky.update(this.camera);
    this.water.tick(dt);

    // refresh the mirror image once for this camera, before the composer reads it
    this.water.renderReflection(this.renderer, this.scene, this.camera);

    this.post.render(dt);

    // fps, averaged over a second
    const fps = dt > 0 ? 1 / dt : 0;
    this.fpsHistory.push(fps);
    if (this.fpsHistory.length > 30) this.fpsHistory.shift();
    const avg = this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length;
    this.stats.fps = Math.round(avg);
    const info = this.renderer.info;
    this.stats.calls = info.render.calls;
    this.stats.triangles = info.render.triangles;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h);
    this.water.setSize(w, h);
  }

  /** Screenshot harness hook: place the camera, return once the frame is drawn. */
  setView(px, py, pz, tx, ty, tz, fov) {
    this.controller.enabled = false;
    this.controller.setView(px, py, pz, tx, ty, tz);
    if (fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.frameDirty = true;
  }

  resetView() {
    this.controller.enabled = true;
    this.controller.teleport(this.homePosition.x, this.homePosition.y, this.homePosition.z, this.homeYaw, this.homePitch);
  }

  /** A handful of curated viewpoints used by the screenshot passes. */
  view(name) {
    // NOTE: setView takes a FEET position — the controller adds EYE_HEIGHT on
    // top. Never pass an eye height here or the camera ends up in the ceiling.
    const y = CABIN.floorY;
    switch (name) {
      case 'living':
        return this.setView(-6.90, y, -5.15, -1.60, y + 0.93, 5.90, 72);
      case 'living-sofa':
        return this.setView(-0.9, y, 1.0, -5.2, y + 0.9, -3.2, 62);
      case 'bedroom':
        // Close enough that the bed fills the middle of the frame with the two
        // north windows above it: at the old corner seat the bed was a small
        // object in the far corner and the room read as an empty blue box with
        // a bed pushed against one wall.
        return this.setView(1.60, y, 2.30, 4.90, y + 0.48, -3.60, 58);
      case 'bedroom-bed':
        return this.setView(6.6, y, -0.2, 3.6, y + 0.8, -4.2, 62);
      case 'window':
        // Two metres from the glass, looking slightly up: at the old seat eight
        // metres back the mullions filled the frame and the view through the
        // panes was a strip of water. Up close the grid frames the snow crest.
        return this.setView(-3.60, y, 3.10, -3.85, y + 0.68, 30, 60);
      case 'doorway':
        // Stand in the living room west of the partition and look east through
        // the opening: the dark timber jamb frames the bedroom floor and its
        // north windows. Aiming south instead framed the closed front door.
        return this.setView(-1.10, y, 3.55, 3.20, y + 0.63, 4.15, 62);
      case 'exterior':
        return this.setView(2.5, 3.1, -22.5, 0, 4.0, 5, 46);
      case 'exterior-front':
        return this.setView(-1.0, 2.9, -17.0, -0.6, 4.2, 4, 44);
      case 'shore':
        return this.setView(-6.0, 0.75, 21.0, 0.5, 7.0, 260, 52);
      case 'lake':
        return this.setView(0.0, 6.5, 60.0, 2.0, 30.0, 420, 46);
      case 'aerial':
        return this.setView(-26, 26, -46, 2, 8, 120, 52);
      case 'peak':
        return this.setView(-2.0, 4.0, 8.0, 118, 96, 404, 30);
      case 'cabin-back':
        return this.setView(-14.0, 4.2, 26.0, 0.0, 3.2, 4.0, 48);
      default:
        return this.resetView();
    }
  }

  dispose() {
    this.stop();
    window.removeEventListener('resize', this._onResize);
    this.controller.dispose();
    this.post.dispose();
    this.water.dispose();
    this.sky.dispose();
    this.lighting.dispose();
    this.renderer.dispose();
  }
}
