/**
 * Vehicle catalogue: gameplay stats + the GLB model each one loads.
 * Stats are deliberately arcade — cars trade top speed for grip, mopeds are
 * light and nimble but slower in a straight line.
 */
export type VehicleKind = 'car' | 'moped';

export interface VehicleSpec {
  id: string;
  name: string;
  kind: VehicleKind;
  model: string;
  /** Body colour used by the garage preview tint. */
  color: string;
  /** Top speed in m/s. */
  topSpeed: number;
  /** Peak engine acceleration in m/s^2. */
  accel: number;
  /** Reverse acceleration in m/s^2. */
  reverseAccel: number;
  /** 0..1 lateral grip; higher sticks more, lower slides. */
  grip: number;
  /** Peak steering rate in rad/s at low speed. */
  steering: number;
  /** Body radius used for collision (m). */
  radius: number;
  /** Mass proxy — heavier cars shove traffic aside more. */
  mass: number;
  blurb: string;
}

export const VEHICLES: VehicleSpec[] = [
  {
    id: 'falcon_coupe', name: 'Falcon Coupe', kind: 'car', model: 'falcon_coupe', color: '#d9433f',
    topSpeed: 52, accel: 13.5, reverseAccel: 6, grip: 0.86, steering: 1.95, radius: 1.45, mass: 1250,
    blurb: 'Balanced street coupe. Quick enough for anything, playful in the hairpins.',
  },
  {
    id: 'metro_sedan', name: 'Metro Sedan', kind: 'car', model: 'metro_sedan', color: '#3f7fd4',
    topSpeed: 44, accel: 10.5, reverseAccel: 5, grip: 0.92, steering: 1.8, radius: 1.5, mass: 1400,
    blurb: 'Forgiving family cruiser. High grip, soft acceleration, very hard to spin.',
  },
  {
    id: 'pip_compact', name: 'Pip Compact', kind: 'car', model: 'pip_compact', color: '#f2b632',
    topSpeed: 40, accel: 11.5, reverseAccel: 5.5, grip: 0.84, steering: 2.1, radius: 1.35, mass: 980,
    blurb: 'Tiny and eager. Turns in instantly but runs out of legs on the straights.',
  },
  {
    id: 'ranger_suv', name: 'Ranger SUV', kind: 'car', model: 'ranger_suv', color: '#3f9a6a',
    topSpeed: 42, accel: 10, reverseAccel: 4.5, grip: 0.9, steering: 1.62, radius: 1.62, mass: 1900,
    blurb: 'Tall, heavy, planted. Shoves traffic out of the way but understeers.',
  },
  {
    id: 'bull_pickup', name: 'Bull Pickup', kind: 'car', model: 'bull_pickup', color: '#2f6fa8',
    topSpeed: 45, accel: 11, reverseAccel: 4.5, grip: 0.83, steering: 1.55, radius: 1.68, mass: 2050,
    blurb: 'Working truck. Off the racing line it is a brick, on it it is a weapon.',
  },
  {
    id: 'v8_bruiser', name: 'V8 Bruiser', kind: 'car', model: 'v8_bruiser', color: '#f07a1f',
    topSpeed: 50, accel: 14.5, reverseAccel: 5.5, grip: 0.72, steering: 1.72, radius: 1.55, mass: 1500,
    blurb: 'Loud, wide, and loose. Huge power, minimal grip — brake before you turn.',
  },
  {
    id: 'vector_gt', name: 'Vector GT', kind: 'car', model: 'vector_gt', color: '#8b4fd6',
    topSpeed: 58, accel: 16, reverseAccel: 5, grip: 0.8, steering: 2.0, radius: 1.5, mass: 1180,
    blurb: 'Mid-engine prototype. Highest top speed in the garage and razor reflexes.',
  },
  {
    id: 'cargo_van', name: 'Cargo Van', kind: 'car', model: 'cargo_van', color: '#e8eaed',
    topSpeed: 38, accel: 8.5, reverseAccel: 5, grip: 0.88, steering: 1.5, radius: 1.72, mass: 2200,
    blurb: 'Panel van. Slow and stubborn, but it never loses a corner and never lifts.',
  },
  {
    id: 'city_cab', name: 'City Cab', kind: 'car', model: 'city_cab', color: '#f5c518',
    topSpeed: 46, accel: 12.5, reverseAccel: 6, grip: 0.93, steering: 2.05, radius: 1.48, mass: 1350,
    blurb: 'Streets of the city are its home turf. Quick, sticky, relentless.',
  },
  {
    id: 'swift_scoot', name: 'Swift Scooter', kind: 'moped', model: 'swift_scoot', color: '#f25f5c',
    topSpeed: 30, accel: 13, reverseAccel: 6, grip: 0.7, steering: 2.6, radius: 0.8, mass: 130,
    blurb: 'Light and floaty. Points like a dart but slides the moment you breathe on it.',
  },
  {
    id: 'retro_moped', name: 'Retro Moped', kind: 'moped', model: 'retro_moped', color: '#3fa7a0',
    topSpeed: 28, accel: 11.5, reverseAccel: 5.5, grip: 0.75, steering: 2.45, radius: 0.8, mass: 150,
    blurb: 'Old-school pedal moped. Gentle, cheap on speed, charming everywhere else.',
  },
  {
    id: 'scrap_bike', name: 'Scrap Bike', kind: 'moped', model: 'scrap_bike', color: '#8a8f98',
    topSpeed: 34, accel: 14.5, reverseAccel: 6, grip: 0.62, steering: 2.3, radius: 0.82, mass: 145,
    blurb: 'Rattly dirt bike. Terrific off the tarmac, hopeless at staying upright.',
  },
  {
    id: 'racer_125', name: 'Racer 125', kind: 'moped', model: 'racer_125', color: '#d81e4a',
    topSpeed: 40, accel: 17, reverseAccel: 6, grip: 0.78, steering: 2.35, radius: 0.78, mass: 125,
    blurb: 'The best of the two-wheelers. Out-accelerates half the cars on the grid.',
  },
  {
    id: 'cargo_moped', name: 'Cargo Moped', kind: 'moped', model: 'cargo_moped', color: '#f0a63c',
    topSpeed: 26, accel: 10, reverseAccel: 5, grip: 0.74, steering: 2.2, radius: 0.9, mass: 320,
    blurb: 'Delivery moped with a box on the back. Slow, but it never runs out of cargo.',
  },
];

export function vehicleById(id: string): VehicleSpec {
  const v = VEHICLES.find((x) => x.id === id);
  if (!v) throw new Error(`Unknown vehicle: ${id}`);
  return v;
}
