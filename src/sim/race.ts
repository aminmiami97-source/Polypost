import { Track } from './track';
import type { VehicleSim } from './vehicle';

export type GameMode = 'race' | 'freeroam';

export interface Rival {
  id: string;
  name: string;
  color: number;
  /** Arc length along the lap. */
  s: number;
  lane: number;
  baseSpeed: number;
  speed: number;
  lap: number;
  /** Unwrapped distance travelled (metres). */
  total: number;
  progress: number;
  x: number;
  z: number;
  heading: number;
  weave: number;
}

export interface Crate {
  x: number;
  z: number;
  collected: boolean;
  bob: number;
}

export interface Gate {
  s: number;
  x: number;
  z: number;
  angle: number;
}

/**
 * Race director: laps, checkpoints, rival AI, standings and the free-roam
 * collectible objective.
 */
export class RaceDirector {
  mode: GameMode = 'race';

  readonly gates: Gate[] = [];
  readonly rivals: Rival[] = [];
  readonly crates: Crate[] = [];

  lapsToFinish = 3;
  lap = 0;
  /** Unwrapped distance travelled around the circuit (metres). */
  progress = 0;
  position = 1;
  lapTimes: number[] = [];
  bestLap: number | null = null;
  lapStart = 0;
  elapsed = 0;
  finished = false;
  finishTime = 0;

  private lastS = 0;
  private rivalsStarted = false;

  constructor(private track: Track) {
    const gateCount = 16;
    for (let i = 0; i < gateCount; i++) {
      const s = (i / gateCount) * track.length;
      const p = track.positionAt(s, 0);
      const ahead = track.positionAt(s + 4, 0);
      this.gates.push({
        s,
        x: p.x,
        z: p.z,
        angle: Math.atan2(ahead.z - p.z, ahead.x - p.x),
      });
    }
  }

  /** Sets up a race with AI rivals. */
  startRace(playerStartS: number, rivalSpecs: { name: string; color: number; speed: number }[]) {
    this.mode = 'race';
    this.lap = 0;
    this.progress = 0;
    this.position = 1;
    this.lapTimes = [];
    this.bestLap = null;
    this.lapStart = 0;
    this.elapsed = 0;
    this.finished = false;
    this.finishTime = 0;
    this.lastS = playerStartS;
    this.rivalsStarted = true;

    this.rivals.length = 0;
    rivalSpecs.forEach((r, i) => {
      this.rivals.push({
        id: `rival_${i}`,
        name: r.name,
        color: r.color,
        s: (playerStartS - 6 - i * 9 + this.track.length * 2) % this.track.length,
        lane: (i % 2 === 0 ? 1 : -1) * (2.5 + (i % 3)),
        baseSpeed: r.speed,
        speed: r.speed * 0.7,
        lap: 0,
        total: 0,
        progress: 0,
        x: 0,
        z: 0,
        heading: 0,
        weave: i * 1.7,
      });
    });
  }

  /** Sets up free roam with collectible crates scattered around the map. */
  startFreeRoam(crates: Crate[]) {
    this.mode = 'freeroam';
    this.lap = 0;
    this.progress = 0;
    this.elapsed = 0;
    this.finished = false;
    this.finishTime = 0;
    this.lapTimes = [];
    this.bestLap = null;
    this.position = 1;
    this.crates.length = 0;
    this.crates.push(...crates);
    this.rivals.length = 0;
    this.rivalsStarted = false;
  }

  get totalCrates(): number {
    return this.crates.length;
  }

  /** Index of the checkpoint the player should be heading for next. */
  get nextGateIndex(): number {
    const gateCount = this.gates.length || 1;
    const perGate = this.track.length / gateCount;
    const inLap = this.progress % this.track.length;
    const idx = Math.floor(inLap / perGate) + 1;
    return idx % gateCount;
  }

  get collectedCrates(): number {
    return this.crates.filter((c) => c.collected).length;
  }

  /** @returns true when the race (or collectible hunt) is complete. */
  update(dt: number, player: VehicleSim): boolean {
    this.elapsed += dt;

    if (this.mode === 'race') {
      const hit = this.track.nearest(player.x, player.z);
      let delta = hit.s - this.lastS;
      const L = this.track.length;
      if (delta > L / 2) delta -= L;
      if (delta < -L / 2) delta += L;
      this.lastS = hit.s;
      this.progress = Math.max(0, this.progress + delta);

      const lap = Math.floor(this.progress / L);
      if (lap > this.lap) {
        const lapTime = this.elapsed - this.lapStart;
        this.lapStart = this.elapsed;
        this.lapTimes.push(lapTime);
        if (this.bestLap === null || lapTime < this.bestLap) this.bestLap = lapTime;
        this.lap = lap;
        if (this.lap >= this.lapsToFinish) {
          this.finished = true;
          this.finishTime = this.elapsed;
        }
      }
      this.updateRivals(dt);
      this.updateStandings();
    } else {
      for (const c of this.crates) {
        c.bob += dt * 2.4;
        if (c.collected) continue;
        const dx = player.x - c.x;
        const dz = player.z - c.z;
        if (dx * dx + dz * dz < 12) {
          c.collected = true;
          if (this.collectedCrates >= this.totalCrates) {
            this.finished = true;
            this.finishTime = this.elapsed;
          }
        }
      }
    }
    return this.finished;
  }

  private updateRivals(dt: number) {
    if (!this.rivalsStarted) return;
    const L = this.track.length;
    for (const r of this.rivals) {
      r.weave += dt;
      const aheadPos = this.track.positionAt(r.s + 12, 0);
      const look = this.track.nearest(aheadPos.x, aheadPos.z);
      const curve = Math.min(0.05, look.curvature);
      let target = r.baseSpeed * (1 - curve * 6.5);
      // Gentle rubber banding keeps the pack together.
      const gap = this.progress - r.progress;
      target *= gap > 0 ? 1.06 : 0.95;
      r.speed += (target - r.speed) * Math.min(1, 1.4 * dt);
      r.speed = Math.max(8, r.speed);
      r.s = (r.s + r.speed * dt) % L;
      r.total += r.speed * dt;
      r.progress = r.total;
      r.lap = Math.floor(r.total / L);
      const lane = r.lane + Math.sin(r.weave * 0.6) * 1.6;
      const p = this.track.positionAt(r.s, lane);
      const ahead = this.track.positionAt(r.s + 6, lane);
      r.x = p.x;
      r.z = p.z;
      r.heading = Math.atan2(ahead.z - p.z, ahead.x - p.x);
    }
  }

  private updateStandings() {
    let position = 1;
    for (const r of this.rivals) {
      if (r.progress > this.progress) position++;
    }
    this.position = position;
  }
}
