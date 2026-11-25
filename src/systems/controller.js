// ---------------------------------------------------------------------------
// First person controller.
//
// WASD + mouse look (pointer lock), shift to walk faster, space to jump a
// little, and a very small head bob. Vertical motion is a simple gravity + step
// solver against the CollisionSystem so the player can walk out of the door,
// down the step and onto the shore without teleporting.
// ---------------------------------------------------------------------------

import * as THREE from 'three';

const EYE_HEIGHT = 1.66;
const WALK_SPEED = 3.05;
const RUN_SPEED = 5.1;
const ACCEL = 26.0;
const DAMPING = 11.0;
const GRAVITY = 18.5;
const JUMP = 4.4;
const LOOK_SPEED = 0.0022;

export class FirstPersonController {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {THREE.WebGLRenderer} renderer
   * @param {import('./collision.js').CollisionSystem} collision
   */
  constructor(camera, renderer, collision) {
    this.camera = camera;
    this.renderer = renderer;
    this.collision = collision;

    this.enabled = true;
    this.position = new THREE.Vector3(0, 0, 0); // feet
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.bobPhase = 0;
    this.bobAmount = 0;

    this.keys = new Set();
    this._sensitivity = LOOK_SPEED;
    this._jumpQueued = false;

    this._onKeyDown = (e) => this._key(e, true);
    this._onKeyUp = (e) => this._key(e, false);
    this._onMouseMove = (e) => this._mouse(e);
    this._onPointerLock = () => {};

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    document.addEventListener('mousemove', this._onMouseMove);

    this._bindPointerLock();
  }

  _bindPointerLock() {
    const canvas = this.renderer.domElement;
    // Do not grab the pointer automatically: a screenshot run must never be
    // hijacked by pointer lock, and the user should choose when to look around.
    this._onCanvasClick = () => {
      if (!this.enabled) return;
      if (document.pointerLockElement !== canvas) {
        const p = canvas.requestPointerLock?.({ unadjustedMovement: true });
        if (p && p.catch) p.catch(() => canvas.requestPointerLock?.());
      }
    };
    canvas.addEventListener('click', this._onCanvasClick);
  }

  _key(e, down) {
    const code = e.code;
    if (down) this.keys.add(code); else this.keys.delete(code);
    if (code === 'Space' && down && this.enabled) {
      this._jumpQueued = true;
      if (document.pointerLockElement) e.preventDefault();
    }
  }

  _mouse(e) {
    if (!this.enabled) return;
    if (document.pointerLockElement !== this.renderer.domElement) return;
    this.yaw -= e.movementX * this._sensitivity;
    this.pitch -= e.movementY * this._sensitivity;
    const lim = Math.PI / 2 - 0.02;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  /** Place the player instantly and orient them. */
  teleport(x, y, z, yaw = 0, pitch = 0) {
    this.position.set(x, y, z);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = pitch;
    this._apply();
  }

  /** Position + orientation in one call, used by the screenshot harness. */
  setView(px, py, pz, tx, ty, tz) {
    this.position.set(px, py, pz);
    const dx = tx - px;
    const dy = ty - py;
    const dz = tz - pz;
    const horiz = Math.hypot(dx, dz);
    this.yaw = Math.atan2(-dx, -dz);
    this.pitch = Math.atan2(dy, horiz);
    this.velocity.set(0, 0, 0);
    this._apply();
  }

  update(dt) {
    if (!this.enabled) {
      this._apply();
      return;
    }
    dt = Math.min(dt, 0.05);

    // ---- desired movement in camera space --------------------------------
    const fwd = (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0)
      - (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0);
    const strafe = (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0)
      - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);

    const running = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const speed = running ? RUN_SPEED : WALK_SPEED;

    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    // forward is -Z rotated by yaw
    let wishX = (-sin * fwd) + (cos * strafe);
    let wishZ = (-cos * fwd) + (-sin * strafe);
    const mag = Math.hypot(wishX, wishZ);
    if (mag > 1e-5) {
      wishX = (wishX / mag) * speed;
      wishZ = (wishZ / mag) * speed;
    } else {
      wishX = 0;
      wishZ = 0;
    }

    // ---- horizontal acceleration -----------------------------------------
    const targetVX = wishX;
    const targetVZ = wishZ;
    const damping = this.onGround ? DAMPING : DAMPING * 0.25;
    this.velocity.x += (targetVX - this.velocity.x) * Math.min(1, ACCEL * dt / Math.max(speed, 1) * damping * 0.1);
    this.velocity.z += (targetVZ - this.velocity.z) * Math.min(1, ACCEL * dt / Math.max(speed, 1) * damping * 0.1);
    if (mag < 1e-5 && this.onGround) {
      this.velocity.x *= Math.max(0, 1 - 12 * dt);
      this.velocity.z *= Math.max(0, 1 - 12 * dt);
    }

    // ---- jump / gravity ---------------------------------------------------
    if (this._jumpQueued && this.onGround) {
      this.velocity.y = JUMP;
      this.onGround = false;
    }
    this._jumpQueued = false;

    this.velocity.y -= GRAVITY * dt;

    // ---- integrate --------------------------------------------------------
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    this.collision.resolve(this.position, EYE_HEIGHT + 0.12);

    this.position.y += this.velocity.y * dt;

    const ground = this.collision.supportAt(this.position.x, this.position.z, this.position.y);
    if (Number.isFinite(ground) && this.position.y <= ground + 0.02) {
      this.position.y = ground;
      if (this.velocity.y < 0) this.velocity.y = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }

    // a hard floor so a fall through a hole can never strand the player
    if (this.position.y < -4) {
      this.position.y = 6;
      this.velocity.set(0, 0, 0);
    }

    // ---- head bob ---------------------------------------------------------
    const planar = Math.hypot(this.velocity.x, this.velocity.z);
    const targetBob = this.onGround ? Math.min(1, planar / RUN_SPEED) : 0;
    this.bobAmount += (targetBob - this.bobAmount) * Math.min(1, dt * 6);
    this.bobPhase += dt * (6.4 + planar * 0.9);

    this._apply();
  }

  _apply() {
    const bobY = Math.sin(this.bobPhase * 2) * 0.014 * this.bobAmount;
    const bobX = Math.cos(this.bobPhase) * 0.010 * this.bobAmount;
    this.camera.position.set(
      this.position.x + bobX,
      this.position.y + EYE_HEIGHT - 0.12 + bobY,
      this.position.z,
    );
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    this.camera.rotation.z = Math.sin(this.bobPhase) * 0.0026 * this.bobAmount;
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    document.removeEventListener('mousemove', this._onMouseMove);
    this.renderer.domElement.removeEventListener('click', this._onCanvasClick);
  }
}

export { EYE_HEIGHT };
