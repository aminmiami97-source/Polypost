import { Track, ROAD_HALF_WIDTH } from '../sim/track';

export interface BuildingPlan {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  color: number;
  windows: number;
}

export interface TreePlan {
  x: number;
  z: number;
  scale: number;
}

export interface LampPlan {
  x: number;
  z: number;
  angle: number;
}

export interface CityLayout {
  buildings: BuildingPlan[];
  trees: TreePlan[];
  lamps: LampPlan[];
  hills: { x: number; z: number; r: number; h: number; color: number }[];
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BUILDING_COLORS = [
  0xd9d3c7, 0xc7d3de, 0xe3d7c4, 0xbcc9c2, 0xd4c8d8, 0xcfc2b0, 0xc2c7d0, 0xe0cdbb,
];

/**
 * Deterministically lays out the city so the renderer and the collision
 * solver always agree on where every building stands.
 */
export function buildCityLayout(track: Track): CityLayout {
  const rnd = mulberry32(20260410);
  const buildings: BuildingPlan[] = [];
  const trees: TreePlan[] = [];
  const lamps: LampPlan[] = [];
  const hills: CityLayout['hills'] = [];

  const clearOf = (x: number, z: number, margin: number) =>
    track.nearest(x, z).distance > ROAD_HALF_WIDTH + margin;

  // --- blocks of buildings on a loose grid -------------------------------
  const block = 34;
  for (let gx = -5; gx <= 5; gx++) {
    for (let gz = -5; gz <= 5; gz++) {
      const cx = gx * block + (rnd() - 0.5) * 9;
      const cz = gz * block + (rnd() - 0.5) * 9;
      if (!clearOf(cx, cz, 15)) continue;
      if (rnd() < 0.22) {
        // courtyard / park
        for (let t = 0; t < 3; t++) {
          const tx = cx + (rnd() - 0.5) * 20;
          const tz = cz + (rnd() - 0.5) * 20;
          if (clearOf(tx, tz, 12)) {
            trees.push({ x: tx, z: tz, scale: 0.8 + rnd() * 0.8 });
          }
        }
        continue;
      }
      const count = 1 + Math.floor(rnd() * 3);
      for (let b = 0; b < count; b++) {
        const w = 9 + rnd() * 10;
        const d = 9 + rnd() * 10;
        const x = cx + (rnd() - 0.5) * 16;
        const z = cz + (rnd() - 0.5) * 16;
        if (!clearOf(x, z, 14)) continue;
        const h = 12 + rnd() * 42;
        buildings.push({
          x,
          z,
          w,
          d,
          h,
          color: BUILDING_COLORS[Math.floor(rnd() * BUILDING_COLORS.length)],
          windows: Math.max(1, Math.floor(h / 6)),
        });
      }
    }
  }

  // --- street lamps lining the circuit -----------------------------------
  for (let i = 0; i < 46; i++) {
    const s = (i / 46) * track.length;
    const side = i % 2 === 0 ? 1 : -1;
    const p = track.positionAt(s, side * (ROAD_HALF_WIDTH + 1.6));
    const ahead = track.positionAt(s + 4, side * (ROAD_HALF_WIDTH + 1.6));
    lamps.push({ x: p.x, z: p.z, angle: Math.atan2(ahead.z - p.z, ahead.x - p.x) });
  }

  // --- scattered trees ---------------------------------------------------
  for (let i = 0; i < 260; i++) {
    const x = (rnd() - 0.5) * 420;
    const z = (rnd() - 0.5) * 420;
    if (!clearOf(x, z, 6)) continue;
    if (buildings.some((b) => Math.abs(b.x - x) < 12 && Math.abs(b.z - z) < 12)) continue;
    trees.push({ x, z, scale: 0.7 + rnd() * 1.1 });
  }

  // --- distant hills ------------------------------------------------------
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + rnd() * 0.3;
    const dist = 330 + rnd() * 130;
    hills.push({
      x: Math.cos(a) * dist,
      z: Math.sin(a) * dist,
      r: 55 + rnd() * 70,
      h: 40 + rnd() * 65,
      color: [0x6d8b7a, 0x7d9490, 0x5f7f78, 0x8a9c94][Math.floor(rnd() * 4)],
    });
  }

  return { buildings, trees, lamps, hills };
}
