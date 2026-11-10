import type { VehicleSpec } from '../game/catalog';

export interface VehicleInput {
  throttle: number;
  brake: number;
  /** -1 = full left, +1 = full right. */
  steer: number;
  handbrake: boolean;
  boost: boolean;
}

export const NEUTRAL_INPUT: VehicleInput = {
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
  boost: false,
};

/**
 * Arcade vehicle dynamics.
 *
 * Deliberately not a rigid-body simulation: a bicycle-style model with
 * separate longitudinal / lateral velocity gives predictable, fun handling and
 * stays deterministic across frame rates.
 */
export class VehicleSim {
  readonly spec: VehicleSpec;

  x = 0;
  z = 0;
  heading = 0;
  /** Longitudinal velocity along the nose (m/s). */
  vLong = 0;
  /** Lateral velocity, positive to the right (m/s). */
  vLat = 0;

  yawRate = 0;
  steerAngle = 0;
  /** World-space velocity, refreshed every step. */
  vx = 0;
  vz = 0;

  /** Nitro / boost reservoir, 0..1. */
  boost = 1;

  /** Set by the world each step: true while the car is off the tarmac. */
  offRoad = false;
  /** Set by the world each step: impact magnitude of the last collision. */
  impact = 0;

  constructor(spec: VehicleSpec) {
    this.spec = spec;
  }

  get speed(): number {
    return Math.hypot(this.vLong, this.vLat);
  }

  get forwardX(): number {
    return Math.cos(this.heading);
  }

  get forwardZ(): number {
    return Math.sin(this.heading);
  }

  get worldVx(): number {
    return this.forwardX * this.vLong - this.forwardZ * this.vLat;
  }

  get worldVz(): number {
    return this.forwardZ * this.vLong + this.forwardX * this.vLat;
  }

  reset(x: number, z: number, heading: number) {
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.vLong = 0;
    this.vLat = 0;
    this.yawRate = 0;
    this.steerAngle = 0;
    this.boost = 1;
    this.impact = 0;
  }

  /** Advance the simulation by a fixed timestep. */
  step(dt: number, input: VehicleInput) {
    const spec = this.spec;

    // ---- longitudinal ------------------------------------------------
    const speedFrac = Math.min(1, Math.abs(this.vLong) / spec.topSpeed);
    const powerCurve = 1 - speedFrac * speedFrac;
    if (input.throttle > 0) {
      const boostMul = input.boost && this.boost > 0 ? 1.45 : 1;
      this.vLong += spec.accel * boostMul * input.throttle * powerCurve * dt;
      if (input.boost && this.boost > 0) {
        this.boost = Math.max(0, this.boost - 0.34 * dt);
      } else {
        this.boost = Math.min(1, this.boost + 0.09 * dt);
      }
    } else {
      this.boost = Math.min(1, this.boost + 0.11 * dt);
    }

    if (input.brake > 0) {
      if (this.vLong > 0.6) {
        this.vLong -= 22 * input.brake * dt;
      } else {
        this.vLong -= spec.reverseAccel * input.brake * dt;
      }
    }

    // Engine braking + drag + rolling resistance.
    const drag = (0.5 + Math.abs(this.vLong) * 0.006) * (input.throttle > 0 ? 0.6 : 1);
    this.vLong -= this.vLong * drag * dt;
    if (input.throttle === 0 && input.brake === 0) {
      this.vLong -= this.vLong * 0.55 * dt;
    }
    if (this.offRoad) {
      this.vLong -= this.vLong * 1.35 * dt;
    }

    // ---- lateral grip -------------------------------------------------
    const gripRate = spec.grip * (input.handbrake ? 2.1 : 9.5);
    this.vLat *= Math.exp(-gripRate * dt);
    if (this.offRoad) {
      this.vLat *= Math.exp(-2.2 * dt);
    }

    // ---- steering -----------------------------------------------------
    const authority = Math.min(1, Math.abs(this.vLong) / 2.5);
    const maxYaw = spec.steering / (1 + Math.abs(this.vLong) * 0.055);
    const dir = this.vLong >= 0 ? 1 : -1;
    this.yawRate = input.steer * maxYaw * authority * dir;
    this.heading += this.yawRate * dt;
    this.steerAngle += (input.steer * 0.52 - this.steerAngle) * Math.min(1, 9 * dt);

    // ---- integrate ------------------------------------------------------
    const fx = Math.cos(this.heading);
    const fz = Math.sin(this.heading);
    this.vx = fx * this.vLong - fz * this.vLat;
    this.vz = fz * this.vLong + fx * this.vLat;
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    this.impact = 0;
  }

  /** Apply an impulse-style collision response (used by the world solver). */
  applyImpact(nx: number, nz: number, penetration: number, restitution = 0.32) {
    const vx = this.worldVx;
    const vz = this.worldVz;
    const vn = vx * nx + vz * nz;
    if (vn < 0) {
      const bounce = -(1 + restitution) * vn;
      const newVx = vx + nx * bounce;
      const newVz = vz + nz * bounce;
      // Keep the impact mostly longitudinal so cars glance off walls.
      this.vLong = newVx * this.forwardX + newVz * this.forwardZ;
      this.vLat = -newVx * this.forwardZ + newVz * this.forwardX;
      // A glancing nudge should barely cost speed; a square hit should hurt.
      const severity = Math.min(1, Math.abs(bounce) / 9);
      this.vLong *= 0.68 + 0.32 * (1 - severity);
      this.vLat *= 0.85;
      this.impact = Math.abs(bounce);
    }
    this.x += nx * penetration;
    this.z += nz * penetration;
  }
}
