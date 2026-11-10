import * as THREE from 'three';
import type { VehicleSim } from '../sim/vehicle';

export type CameraMode = 'chase' | 'hood' | 'far';

/**
 * Chase camera that trails the vehicle, leads into corners and widens the FOV
 * as speed rises.
 */
export class ChaseCamera {
  mode: CameraMode = 'chase';

  private pos = new THREE.Vector3(0, 8, -16);
  private look = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private smoothHeading = 0;

  constructor(private camera: THREE.PerspectiveCamera) {}

  update(dt: number, sim: VehicleSim, immediate = false) {
    const speed = sim.speed;
    const speedT = THREE.MathUtils.clamp(speed / 55, 0, 1);

    // Smooth the heading so the camera does not snap when the car spins.
    const diff = Math.atan2(
      Math.sin(sim.heading - this.smoothHeading),
      Math.cos(sim.heading - this.smoothHeading),
    );
    this.smoothHeading += diff * Math.min(1, (immediate ? 1 : 4.5) * dt);

    const fx = Math.cos(this.smoothHeading);
    const fz = Math.sin(this.smoothHeading);

    let distance: number;
    let height: number;
    let lookAhead: number;
    if (this.mode === 'hood') {
      distance = 0.2;
      height = 1.45;
      lookAhead = 14;
    } else if (this.mode === 'far') {
      distance = 20 + speedT * 8;
      height = 9 + speedT * 3;
      lookAhead = 10;
    } else {
      distance = 9.5 + speedT * 5.5;
      height = 4.4 + speedT * 1.4;
      lookAhead = 8 + speedT * 12;
    }

    const targetX = sim.x - fx * distance;
    const targetZ = sim.z - fz * distance;
    const targetY = height;

    const follow = immediate ? 1 : Math.min(1, 6.5 * dt);
    this.pos.x += (targetX - this.pos.x) * follow;
    this.pos.y += (targetY - this.pos.y) * follow;
    this.pos.z += (targetZ - this.pos.z) * follow;

    this.tmp.set(sim.x + fx * lookAhead, 1.4, sim.z + fz * lookAhead);
    if (this.mode !== 'hood') this.tmp.y = 1.6;
    this.look.lerp(this.tmp, immediate ? 1 : Math.min(1, 8 * dt));

    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);

    const targetFov = this.mode === 'hood' ? 72 : 62 + speedT * 16;
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, 4 * dt);
    this.camera.updateProjectionMatrix();
  }

  cycle(): CameraMode {
    this.mode = this.mode === 'chase' ? 'hood' : this.mode === 'hood' ? 'far' : 'chase';
    return this.mode;
  }
}
