import * as THREE from 'three';
import { Track, ROAD_HALF_WIDTH, SHOULDER_WIDTH, type TrackHit } from './track';
import type { VehicleSim } from './vehicle';

export interface Obstacle {
  x: number;
  z: number;
  halfX: number;
  halfZ: number;
}

export interface Cone {
  x: number;
  z: number;
  vx: number;
  vz: number;
  knocked: boolean;
  spin: number;
  angle: number;
}

export interface TrafficCar {
  x: number;
  z: number;
  heading: number;
  speed: number;
  /** Speed the traffic car tries to return to after being knocked. */
  baseSpeed: number;
  s: number;
  lane: number;
  /** Temporary lateral displacement (metres) after being shunted aside. */
  laneOffset: number;
  /** Current lateral position relative to the centre line. */
  lateral: number;
  radius: number;
  wobble: number;
  color: THREE.Color;
}

/**
 * Static + dynamic world content and the collision solver.
 * The solver is intentionally simple: circles against axis-aligned boxes for
 * buildings, circles against circles for traffic and cones.
 */
export class World {
  readonly track: Track;
  readonly obstacles: Obstacle[] = [];
  readonly cones: Cone[] = [];
  readonly traffic: TrafficCar[] = [];

  constructor(track: Track) {
    this.track = track;
  }

  addBuilding(x: number, z: number, halfX: number, halfZ: number) {
    this.obstacles.push({ x, z, halfX, halfZ });
  }

  addCone(x: number, z: number) {
    this.cones.push({ x, z, vx: 0, vz: 0, knocked: false, spin: 0, angle: 0 });
  }

  addTraffic(s: number, lane: number, speed: number, color: number) {
    this.traffic.push({
      x: 0,
      z: 0,
      heading: 0,
      speed,
      baseSpeed: speed,
      s,
      lane,
      laneOffset: 0,
      lateral: lane,
      radius: 1.5,
      wobble: Math.random() * Math.PI * 2,
      color: new THREE.Color(color),
    });
  }

  /** Advance traffic, cones and resolve collisions against the player. */
  update(dt: number, player: VehicleSim, drivingEnabled: boolean, hit?: TrackHit) {
    this.updateTraffic(dt);
    this.updateCones(dt);

    if (!drivingEnabled) return;

    const px = player.x;
    const pz = player.z;
    const pr = player.spec.radius;

    // --- buildings -----------------------------------------------------
    for (const o of this.obstacles) {
      const dx = px - o.x;
      const dz = pz - o.z;
      const closestX = Math.max(o.x - o.halfX, Math.min(px, o.x + o.halfX));
      const closestZ = Math.max(o.z - o.halfZ, Math.min(pz, o.z + o.halfZ));
      const ox = px - closestX;
      const oz = pz - closestZ;
      const d2 = ox * ox + oz * oz;
      if (d2 < pr * pr) {
        const d = Math.sqrt(d2);
        let nx: number;
        let nz: number;
        let pen: number;
        if (d < 1e-4) {
          // Deep inside: push out along the shortest axis.
          const oxPen = o.halfX - Math.abs(dx);
          const ozPen = o.halfZ - Math.abs(dz);
          if (oxPen < ozPen) {
            nx = Math.sign(dx) || 1;
            nz = 0;
            pen = oxPen + pr;
          } else {
            nx = 0;
            nz = Math.sign(dz) || 1;
            pen = ozPen + pr;
          }
        } else {
          nx = ox / d;
          nz = oz / d;
          pen = pr - d;
        }
        player.applyImpact(nx, nz, pen, 0.25);
      }
    }

    // --- traffic --------------------------------------------------------
    for (const t of this.traffic) {
      const dx = player.x - t.x;
      const dz = player.z - t.z;
      const minDist = pr + t.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < minDist * minDist && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const nz = dz / d;
        player.applyImpact(nx, nz, minDist - d, 0.45);
        // The traffic car is shunted towards the shoulder and brakes, then
        // drifts back into its lane — it never becomes a permanent wall.
        const side = hit ? Math.sign(t.lateral - hit.lateral) || 1 : 1;
        t.laneOffset = THREE.MathUtils.clamp(t.laneOffset + side * 2.6, -9, 9);
        t.speed = Math.max(3, t.speed - Math.min(7, player.speed * 0.3));
      }
    }

    // --- cones -----------------------------------------------------------
    for (const c of this.cones) {
      const dx = player.x - c.x;
      const dz = player.z - c.z;
      const minDist = pr + 0.35;
      const d2 = dx * dx + dz * dz;
      if (d2 < minDist * minDist) {
        const d = Math.sqrt(Math.max(d2, 1e-6));
        const nx = dx / d;
        const nz = dz / d;
        if (!c.knocked) {
          c.knocked = true;
          c.vx = nx * player.speed * 0.75 + player.worldVx * 0.2;
          c.vz = nz * player.speed * 0.75 + player.worldVz * 0.2;
          c.spin = (Math.random() - 0.5) * 12;
          player.vLong *= 0.94;
        }
        player.x += nx * (minDist - d) * 0.4;
        player.z += nz * (minDist - d) * 0.4;
      }
    }
  }

  private updateTraffic(dt: number) {
    const track = this.track;
    for (const t of this.traffic) {
      t.wobble += dt * 0.6;
      // Recover towards cruising speed, and ease back towards the lane.
      const delta = t.baseSpeed - t.speed;
      t.speed += THREE.MathUtils.clamp(delta, -9 * dt, 4.5 * dt);
      t.speed = Math.max(3, t.speed);
      t.laneOffset *= Math.exp(-0.7 * dt);
      t.lateral = t.lane + t.laneOffset;
      t.s = (t.s + t.speed * dt) % track.length;
      const p = track.positionAt(t.s, t.lateral);
      const ahead = track.positionAt(t.s + 6, t.lateral);
      t.x = p.x;
      t.z = p.z;
      const dx = ahead.x - p.x;
      const dz = ahead.z - p.z;
      const l = Math.hypot(dx, dz) || 1;
      t.heading = Math.atan2(dz / l, dx / l);
    }
  }

  private updateCones(dt: number) {
    for (const c of this.cones) {
      if (!c.knocked) continue;
      c.x += c.vx * dt;
      c.z += c.vz * dt;
      c.vx *= 1 - 2.2 * dt;
      c.vz *= 1 - 2.2 * dt;
      c.angle += c.spin * dt;
      c.spin *= 1 - 1.6 * dt;
    }
  }

  /**
   * Keep the player on the circuit: the tarmac is a soft-edged corridor and
   * anything beyond it is treated as rough ground.
   */
  updateRoadState(player: VehicleSim) {
    const hit = this.track.nearest(player.x, player.z);
    const limit = ROAD_HALF_WIDTH + SHOULDER_WIDTH;
    player.offRoad = hit.distance > ROAD_HALF_WIDTH;

    if (hit.distance > limit) {
      const nx = -hit.normal.x * Math.sign(hit.lateral || 1);
      const nz = -hit.normal.y * Math.sign(hit.lateral || 1);
      player.applyImpact(nx, nz, hit.distance - limit, 0.2);
      player.vLong *= 0.86;
    }
    return hit;
  }
}
