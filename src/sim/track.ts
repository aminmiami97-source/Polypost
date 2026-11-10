import * as THREE from 'three';

/**
 * The race circuit: a closed Catmull-Rom loop sampled into a lookup table so
 * we can answer "where am I on the track?" cheaply every frame.
 */
export interface TrackHit {
  /** Index of the nearest sample. */
  index: number;
  /** Distance in metres from the centre line. */
  distance: number;
  /** Arc length along the lap at that point (0..length). */
  s: number;
  /** Unit tangent (direction of travel). */
  tangent: THREE.Vector2;
  /** Unit lateral (right-hand) normal. */
  normal: THREE.Vector2;
  /** Signed lateral offset from the centre line (metres, + = right). */
  lateral: number;
  /** Approximate curvature at that point (1/m). */
  curvature: number;
}

const CONTROL_POINTS: [number, number][] = [
  [-120, -70],
  [-55, -104],
  [30, -112],
  [104, -78],
  [142, -18],
  [128, 52],
  [66, 96],
  [-18, 108],
  [-104, 74],
  [-148, 12],
];

export const ROAD_HALF_WIDTH = 11;
export const SHOULDER_WIDTH = 5;

export class Track {
  readonly curve: THREE.CatmullRomCurve3;
  readonly samples: THREE.Vector3[] = [];
  readonly cumulative: number[] = [];
  readonly length: number;
  readonly count: number;

  constructor(count = 900) {
    this.curve = new THREE.CatmullRomCurve3(
      CONTROL_POINTS.map(([x, z]) => new THREE.Vector3(x, 0, z)),
      true,
      'catmullrom',
      0.5,
    );
    this.count = count;

    // getSpacedPoints(count) returns count+1 points for a closed curve, where
    // the last duplicates the first. Drop it so the loop has no zero-length
    // segment at the seam.
    const spaced = this.curve.getSpacedPoints(count);
    this.samples = spaced.slice(0, count);

    this.cumulative.push(0);
    let chordTotal = 0;
    for (let i = 1; i < this.samples.length; i++) {
      chordTotal += this.samples[i].distanceTo(this.samples[i - 1]);
      this.cumulative.push(chordTotal);
    }

    // The chord sum underestimates true arc length. Rescale the table so our
    // arc-length values map exactly onto the curve's own parameterisation.
    this.length = this.curve.getLength();
    const scale = this.length / (chordTotal || 1);
    for (let i = 0; i < this.cumulative.length; i++) {
      this.cumulative[i] *= scale;
    }
  }

  /** Sample point at arc length `s` (wrapped around the lap). */
  pointAt(s: number): THREE.Vector3 {
    const L = this.length;
    const t = ((((s % L) + L) % L) / L);
    return this.curve.getPointAt(Math.min(0.999999, Math.max(0, t)));
  }

  /** World position at arc length `s` offset `lateral` metres to the right. */
  positionAt(s: number, lateral = 0, out = new THREE.Vector3()): THREE.Vector3 {
    const p = this.pointAt(s);
    const hit = this.nearest(p.x, p.z);
    out.set(
      p.x + hit.normal.x * lateral,
      0,
      p.z + hit.normal.y * lateral,
    );
    return out;
  }

  /** Heading (radians, matching the vehicle convention) at arc length `s`. */
  headingAt(s: number): number {
    const p = this.pointAt(s);
    const t = this.nearest(p.x, p.z).tangent;
    return Math.atan2(t.y, t.x);
  }

  /**
   * Nearest point on the centre line.
   *
   * The closest sample is found first, then the exact position is projected
   * onto the two segments that touch it. Projecting onto a single chord that
   * spans two samples produces a jumpy, non-monotonic arc length, which
   * corrupts lap counting — so the segment is chosen explicitly here.
   */
  nearest(x: number, z: number): TrackHit {
    const n = this.samples.length;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < n; i++) {
      const p = this.samples[i];
      const dx = x - p.x;
      const dz = z - p.z;
      const d = dx * dx + dz * dz;
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }

    const prev = (best - 1 + n) % n;
    const next = (best + 1) % n;

    const segA = this.projectOnSegment(x, z, prev, best);
    const segB = this.projectOnSegment(x, z, best, next);

    const useA = segA.dist <= segB.dist;
    const seg = useA ? segA : segB;

    // Tangent / normal come from the chosen segment.
    const a = this.samples[seg.i0];
    const b = this.samples[seg.i1];
    const ax = b.x - a.x;
    const az = b.z - a.z;
    const len = Math.hypot(ax, az) || 1;
    const tx = ax / len;
    const tz = az / len;
    const nx = -tz;
    const nz = tx;

    const lateral = (x - seg.px) * nx + (z - seg.pz) * nz;

    // Curvature from the angle change across the neighbouring segment.
    const prev2 = (prev - 1 + n) % n;
    const next2 = (next + 1) % n;
    const t0 = this.tangentBetween(prev2, prev);
    const t1 = this.tangentBetween(next, next2);
    const cross = t0.x * t1.y - t0.y * t1.x;
    const curvature = Math.abs(cross) / 3;

    return {
      index: best,
      distance: seg.dist,
      s: seg.s,
      tangent: new THREE.Vector2(tx, tz),
      normal: new THREE.Vector2(nx, nz),
      lateral,
      curvature,
    };
  }

  private tangentBetween(i0: number, i1: number): THREE.Vector2 {
    const a = this.samples[i0];
    const b = this.samples[i1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    return new THREE.Vector2(dx / l, dz / l);
  }

  /** Projects a point onto a segment and returns the arc length of the foot. */
  private projectOnSegment(
    x: number,
    z: number,
    i0: number,
    i1: number,
  ): { px: number; pz: number; dist: number; s: number; i0: number; i1: number } {
    const a = this.samples[i0];
    const b = this.samples[i1];
    const ax = a.x;
    const az = a.z;
    const sx = b.x - ax;
    const sz = b.z - az;
    const segLen2 = sx * sx + sz * sz;
    let u = segLen2 > 1e-9 ? ((x - ax) * sx + (z - az) * sz) / segLen2 : 0;
    u = Math.max(0, Math.min(1, u));
    const px = ax + sx * u;
    const pz = az + sz * u;
    const dist = Math.hypot(x - px, z - pz);

    // Arc length of the foot: cumulative value at the segment start plus the
    // covered fraction. The final segment wraps back to sample 0.
    const wrapped = i1 === 0 && i0 === this.samples.length - 1;
    const base = wrapped ? this.cumulative[i0] : this.cumulative[i0];
    const segLen = wrapped
      ? this.length - this.cumulative[i0]
      : this.cumulative[i1] - this.cumulative[i0];

    return { px, pz, dist, s: base + u * segLen, i0, i1 };
  }
}
