/**
 * Procedural low-poly vehicle model builder.
 *
 * Builds each vehicle from a parametric side profile (extruded for the body) plus
 * primitive parts, then exports a single binary GLB per vehicle into public/models/.
 *
 * Naming contract consumed by the runtime (src/render/VehicleModel.ts):
 *   paint   -> body paint material (recolorable per-vehicle at runtime)
 *   glass   -> windows / windscreen
 *   tyre    -> rubber
 *   rim     -> wheel face
 *   light   -> headlights / tail lights
 *   wheel_fl / wheel_fr / wheel_rl / wheel_rr  (cars)
 *   wheel_f / wheel_r (mopeds)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '..', 'public', 'models');

/* ------------------------------------------------------------------ */
/* Node-only shim: three's GLTFExporter expects a browser FileReader.  */
/* ------------------------------------------------------------------ */
globalThis.FileReader = class FileReader {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then(
      (buf) => {
        this.result = buf;
        this.onloadend && this.onloadend({ target: this });
      },
      (err) => {
        this.error = err;
        this.onerror && this.onerror(err);
      },
    );
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((buf) => {
      this.result = `data:application/octet-stream;base64,${Buffer.from(buf).toString('base64')}`;
      this.onloadend && this.onloadend({ target: this });
    });
  }
};

/* ------------------------------------------------------------------ */
/* Palette                                                             */
/* ------------------------------------------------------------------ */
const C = (hex) => new THREE.Color(hex).convertSRGBToLinear();

function mat(name, hex, opts = {}) {
  return new THREE.MeshStandardMaterial({
    name,
    color: C(hex),
    roughness: opts.roughness ?? 0.55,
    metalness: opts.metalness ?? 0.08,
    flatShading: opts.flat ?? true,
    emissive: opts.emissive ? C(opts.emissive) : new THREE.Color(0x000000),
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    side: opts.side ?? THREE.FrontSide,
  });
}

/**
 * Extrudes a side-view silhouette (array of [x, y]) across the vehicle width.
 * The result is a faceted low-poly shell with hard edges.
 */
function extrudeProfile(points, width, bevel = 0) {
  const shape = new THREE.Shape();
  points.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)));
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    bevelEnabled: bevel > 0,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 1,
    steps: 1,
    curveSegments: 1,
  });
  geo.translate(0, 0, -width / 2);
  geo.computeVertexNormals();
  return geo;
}

function mesh(name, geo, material) {
  const m = new THREE.Mesh(geo, material);
  m.name = name;
  m.castShadow = true;
  m.receiveShadow = false;
  return m;
}

function box(w, h, d) {
  return new THREE.BoxGeometry(w, h, d);
}

/* ------------------------------------------------------------------ */
/* Shared part builders                                                */
/* ------------------------------------------------------------------ */

function buildWheel(radius, width, materials, segments = 14) {
  const g = new THREE.Group();
  // Axle runs along the model width axis (Z), so the cylinder is rotated about X.
  const tyre = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, width, segments, 1),
    materials.tyre,
  );
  tyre.rotation.x = Math.PI / 2;
  tyre.castShadow = true;
  tyre.name = 'tyre';
  g.add(tyre);

  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, width * 1.06, segments, 1),
    materials.rim,
  );
  rim.rotation.x = Math.PI / 2;
  rim.name = 'rim';
  g.add(rim);
  return g;
}

/**
 * Generic car. `spec.profile` is the body silhouette, `spec.cabin` the glass house.
 */
function buildCar(spec) {
  const g = new THREE.Group();
  const materials = {
    paint: mat('paint', spec.color),
    glass: mat('glass', spec.glass ?? '#1b2430', { roughness: 0.15, metalness: 0.4, flat: false }),
    tyre: mat('tyre', '#14161a', { roughness: 0.95, metalness: 0.0 }),
    rim: mat('rim', spec.rim ?? '#c9ced6', { roughness: 0.3, metalness: 0.85 }),
    light: mat('light', spec.light ?? '#fff3cf', { emissive: '#ffe9a8', emissiveIntensity: 1.4 }),
    trim: mat('trim', spec.trim ?? '#20242b', { roughness: 0.7, metalness: 0.25 }),
  };

  const W = spec.width;
  const body = mesh('body', extrudeProfile(spec.profile, W, spec.bevel ?? 0.03), materials.paint);
  g.add(body);

  if (spec.cabin) {
    const cabin = mesh('cabin', extrudeProfile(spec.cabin, W * 0.86, 0), materials.glass);
    g.add(cabin);
  }
  if (spec.roof) {
    const roof = mesh('roof', box(spec.roof[0], spec.roof[2], W * 0.84), materials.paint);
    roof.position.set(spec.roof[1], spec.roof[2] / 2 + spec.roof[3], 0);
    g.add(roof);
  }

  // bumpers / skirts
  const skirt = mesh('skirt', box(spec.length * 0.96, 0.14, W * 1.02), materials.trim);
  skirt.position.set(0, 0.24, 0);
  g.add(skirt);

  // lights
  const hl = mesh('headlight_l', box(0.08, 0.16, 0.34), materials.light);
  hl.position.set(spec.length * 0.5 - 0.06, spec.lightY ?? 0.6, W * 0.28);
  const hl2 = hl.clone();
  hl2.name = 'headlight_r';
  hl2.position.z = -W * 0.28;
  g.add(hl, hl2);

  const tl = mesh('taillight_l', box(0.07, 0.14, 0.3), mat('taillight', '#ff3b30', { emissive: '#ff2d20', emissiveIntensity: 1.1 }));
  tl.position.set(-spec.length * 0.5 + 0.05, spec.lightY ?? 0.6, W * 0.3);
  const tl2 = tl.clone();
  tl2.name = 'taillight_r';
  tl2.position.z = -W * 0.3;
  g.add(tl, tl2);

  // wheels
  const R = spec.wheelRadius ?? 0.34;
  const wx = spec.wheelBase ?? spec.length * 0.31;
  const wz = W * 0.5 - 0.03;
  const names = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'];
  const pos = [
    [wx, R, wz],
    [wx, R, -wz],
    [-wx, R, wz],
    [-wx, R, -wz],
  ];
  pos.forEach((p, i) => {
    const w = buildWheel(R, spec.wheelWidth ?? 0.24, materials);
    w.name = names[i];
    w.position.set(p[0], p[1], p[2]);
    g.add(w);
  });

  if (spec.spoiler) {
    const s = mesh('spoiler', box(0.1, 0.26, W * 0.9), materials.trim);
    s.position.set(-spec.length * 0.44, spec.spoilerY ?? 1.05, 0);
    g.add(s);
  }
  if (spec.rack) {
    const r = mesh('rack', box(spec.length * 0.5, 0.08, W * 0.8), materials.trim);
    r.position.set(0, spec.rackY ?? 1.42, 0);
    g.add(r);
  }
  if (spec.tub) {
    const t = mesh('tub', box(spec.tub[0], spec.tub[1], spec.tub[2]), materials.trim);
    t.position.set(spec.tub[3], spec.tub[1] / 2 + 0.3, spec.tub[4]);
    g.add(t);
  }
  if (spec.exhaust) {
    const e = mesh('exhaust', new THREE.CylinderGeometry(0.07, 0.07, 0.22, 8), materials.rim);
    e.rotation.z = Math.PI / 2;
    e.position.set(-spec.length * 0.5, 0.28, W * 0.3);
    g.add(e);
  }
  if (spec.stripe) {
    const st = mesh('stripe', box(spec.length * 0.8, 0.02, 0.2), materials.trim);
    st.position.set(0, spec.profile[spec.profile.length - 2][1] + 0.03, 0);
    g.add(st);
  }

  return g;
}

/** Two-wheeled moped / scooter. */
function buildMoped(spec) {
  const g = new THREE.Group();
  const materials = {
    paint: mat('paint', spec.color),
    glass: mat('glass', spec.glass ?? '#1b2430', { roughness: 0.15, metalness: 0.4, flat: false }),
    tyre: mat('tyre', '#14161a', { roughness: 0.95, metalness: 0.0 }),
    rim: mat('rim', spec.rim ?? '#c9ced6', { roughness: 0.3, metalness: 0.85 }),
    light: mat('light', spec.light ?? '#fff3cf', { emissive: '#ffe9a8', emissiveIntensity: 1.4 }),
    trim: mat('trim', spec.trim ?? '#20242b', { roughness: 0.7, metalness: 0.25 }),
  };

  const wheelR = spec.wheelRadius ?? 0.26;
  const bodyWidth = spec.width ?? 0.44;

  if (spec.body) {
    const body = mesh('body', extrudeProfile(spec.body, bodyWidth, 0.02), materials.paint);
    g.add(body);
  }

  // frame spine
  const spine = mesh('frame', box(spec.spineLen ?? 0.9, 0.11, 0.16), materials.trim);
  spine.position.set(spec.spineX ?? 0, spec.spineY ?? 0.45, 0);
  g.add(spine);

  // seat
  const seat = mesh('seat', box(spec.seatLen ?? 0.52, 0.14, spec.seatW ?? 0.3), materials.trim);
  seat.position.set(spec.seatX ?? -0.18, spec.seatY ?? 0.72, 0);
  g.add(seat);

  // fork
  const fork = mesh('fork', box(0.09, spec.forkLen ?? 0.62, 0.09), materials.rim);
  fork.position.set(spec.forkX ?? 0.62, wheelR + 0.18, 0);
  fork.rotation.z = spec.forkAngle ?? -0.28;
  g.add(fork);

  // handlebar
  const bar = mesh('handlebar', new THREE.CylinderGeometry(0.035, 0.035, spec.barW ?? 0.62, 8), materials.trim);
  bar.rotation.x = Math.PI / 2;
  bar.position.set(spec.barX ?? 0.5, spec.barY ?? 1.02, 0);
  g.add(bar);

  // headlight
  const head = mesh('headlight', new THREE.CylinderGeometry(0.11, 0.11, 0.1, 10), materials.light);
  head.rotation.z = Math.PI / 2;
  head.position.set(spec.headX ?? 0.72, spec.headY ?? 0.92, 0);
  g.add(head);

  // mudguards
  if (spec.guard) {
    // Half-shell mudguard wrapping the top of the wheel (axle along Z).
    const fg = mesh(
      'guard_front',
      new THREE.CylinderGeometry(wheelR * 1.18, wheelR * 1.18, 0.24, 12, 1, true, Math.PI / 2, Math.PI),
      materials.paint,
    );
    fg.rotation.x = Math.PI / 2;
    fg.position.set(spec.guardX ?? 0.68, wheelR, 0);
    g.add(fg);
  }

  // delivery box
  if (spec.box) {
    const b = mesh('cargo_box', box(spec.box[0], spec.box[1], spec.box[2]), materials.paint);
    b.position.set(spec.box[3], spec.box[1] / 2 + 0.6, spec.box[4]);
    g.add(b);
    const stripe = mesh('cargo_stripe', box(spec.box[0] * 0.9, 0.06, spec.box[2] * 1.02), materials.trim);
    stripe.position.set(spec.box[3], 0.6 + spec.box[1] * 0.5, spec.box[4]);
    g.add(stripe);
  }

  // wheels
  const wz = spec.wheelZ ?? 0.02;
  const wf = buildWheel(wheelR, spec.wheelWidth ?? 0.16, materials, 12);
  wf.name = 'wheel_f';
  wf.position.set(spec.frontX ?? 0.68, wheelR, wz);
  g.add(wf);

  const wr = buildWheel(wheelR, spec.wheelWidth ?? 0.16, materials, 12);
  wr.name = 'wheel_r';
  wr.position.set(spec.rearX ?? -0.62, wheelR, wz);
  g.add(wr);

  return g;
}

/* ------------------------------------------------------------------ */
/* Vehicle catalogue (14 vehicles)                                     */
/* ------------------------------------------------------------------ */
const CAR_BODY = [
  [-2.0, 0.26], [-2.02, 0.62], [-1.78, 0.78], [-0.75, 0.84],
  [0.62, 0.8], [1.6, 0.7], [2.0, 0.6], [2.02, 0.26],
];

const CARS = [
  {
    id: 'falcon_coupe', kind: 'car', name: 'Falcon Coupe',
    color: '#d9433f', length: 4.04, width: 1.86, wheelRadius: 0.34, lightY: 0.62,
    profile: CAR_BODY,
    cabin: [[-1.42, 0.84], [-1.05, 1.3], [0.28, 1.34], [0.92, 0.82]],
    roof: [1.2, 0.35, 0.1, 1.3],
    spoiler: true, spoilerY: 1.06, exhaust: true,
  },
  {
    id: 'metro_sedan', kind: 'car', name: 'Metro Sedan',
    color: '#3f7fd4', length: 4.5, width: 1.84, wheelRadius: 0.33, lightY: 0.6,
    profile: [[-2.22, 0.28], [-2.24, 0.66], [-1.95, 0.8], [-0.85, 0.86], [0.9, 0.84], [1.8, 0.72], [2.24, 0.6], [2.26, 0.28]],
    cabin: [[-1.5, 0.86], [-1.18, 1.36], [0.42, 1.38], [1.02, 0.84]],
    roof: [1.5, 0.2, 0.1, 1.36],
  },
  {
    id: 'pip_compact', kind: 'car', name: 'Pip Compact',
    color: '#f2b632', length: 3.62, width: 1.74, wheelRadius: 0.3, lightY: 0.58,
    profile: [[-1.78, 0.26], [-1.8, 0.6], [-1.55, 0.74], [-0.6, 0.78], [0.72, 0.74], [1.5, 0.66], [1.8, 0.56], [1.82, 0.26]],
    cabin: [[-1.24, 0.78], [-0.94, 1.22], [0.5, 1.22], [0.96, 0.76]],
    roof: [1.4, 0.1, 0.08, 1.2],
  },
  {
    id: 'ranger_suv', kind: 'car', name: 'Ranger SUV',
    color: '#3f9a6a', length: 4.42, width: 1.96, wheelRadius: 0.38, lightY: 0.74,
    profile: [[-2.16, 0.3], [-2.18, 0.86], [-1.9, 0.98], [1.86, 0.96], [2.16, 0.82], [2.18, 0.3]],
    cabin: [[-1.72, 0.98], [-1.44, 1.52], [0.86, 1.5], [1.32, 0.96]],
    roof: [2.0, 0.3, 0.12, 1.48], rack: true, rackY: 1.62,
  },
  {
    id: 'bull_pickup', kind: 'car', name: 'Bull Pickup',
    color: '#2f6fa8', length: 4.86, width: 1.98, wheelRadius: 0.39, lightY: 0.76,
    profile: [[-2.4, 0.32], [-2.42, 0.84], [-2.05, 0.94], [-0.55, 0.94], [-0.5, 0.96], [1.9, 0.94], [2.4, 0.8], [2.42, 0.32]],
    cabin: [[-1.5, 0.96], [-1.2, 1.5], [0.22, 1.48], [0.82, 0.94]],
    roof: [1.0, 0.3, 0.12, 1.46],
    tub: [1.9, 0.46, 1.86, 0.85, 0], exhaust: true,
  },
  {
    id: 'v8_bruiser', kind: 'car', name: 'V8 Bruiser',
    color: '#f07a1f', length: 4.66, width: 1.96, wheelRadius: 0.36, lightY: 0.62,
    profile: [[-2.3, 0.26], [-2.32, 0.68], [-1.9, 0.84], [-0.5, 0.9], [0.9, 0.86], [1.85, 0.74], [2.3, 0.62], [2.32, 0.26]],
    cabin: [[-1.42, 0.9], [-1.08, 1.38], [0.34, 1.36], [0.96, 0.86]],
    roof: [1.3, 0.34, 0.1, 1.36],
    stripe: true, exhaust: true,
  },
  {
    id: 'vector_gt', kind: 'car', name: 'Vector GT',
    color: '#8b4fd6', length: 4.4, width: 2.02, wheelRadius: 0.35, lightY: 0.56,
    profile: [[-2.18, 0.2], [-2.2, 0.5], [-1.95, 0.66], [-0.6, 0.72], [0.8, 0.68], [1.8, 0.58], [2.18, 0.46], [2.2, 0.2]],
    cabin: [[-1.34, 0.72], [-0.98, 1.16], [0.36, 1.14], [0.96, 0.7]],
    roof: [1.2, 0.32, 0.09, 1.12],
    spoiler: true, spoilerY: 0.94, exhaust: true,
  },
  {
    id: 'cargo_van', kind: 'car', name: 'Cargo Van',
    color: '#e8eaed', length: 4.9, width: 1.98, wheelRadius: 0.36, lightY: 0.8,
    profile: [[-2.4, 0.3], [-2.42, 1.1], [-1.9, 1.24], [1.7, 1.22], [2.4, 1.02], [2.42, 0.3]],
    cabin: [[1.05, 1.2], [0.86, 1.66], [1.95, 1.64], [2.2, 1.0]],
    trim: '#5b6470',
  },
  {
    id: 'city_cab', kind: 'car', name: 'City Cab',
    color: '#f5c518', length: 4.46, width: 1.86, wheelRadius: 0.33, lightY: 0.6,
    profile: [[-2.2, 0.28], [-2.22, 0.66], [-1.92, 0.8], [-0.85, 0.86], [0.88, 0.84], [1.78, 0.72], [2.22, 0.6], [2.24, 0.28]],
    cabin: [[-1.48, 0.86], [-1.16, 1.36], [0.4, 1.38], [1.0, 0.84]],
    roof: [1.5, 0.2, 0.1, 1.36],
    roofSign: true,
  },
];

const MOPEDS = [
  {
    id: 'swift_scoot', kind: 'moped', name: 'Swift Scooter',
    color: '#f25f5c', wheelRadius: 0.25, frontX: 0.66, rearX: -0.6, wheelZ: 0.0,
    body: [[-0.5, 0.34], [-0.52, 0.66], [-0.2, 0.72], [0.55, 0.66], [0.78, 0.46], [0.8, 0.32]],
    spineLen: 0.95, spineX: 0.0, spineY: 0.42,
    seatLen: 0.5, seatW: 0.3, seatX: -0.18, seatY: 0.7,
    forkLen: 0.6, forkX: 0.6, forkAngle: -0.3,
    barW: 0.6, barX: 0.48, barY: 1.0,
    headX: 0.7, headY: 0.9, guard: true,
  },
  {
    id: 'retro_moped', kind: 'moped', name: 'Retro Moped',
    color: '#3fa7a0', wheelRadius: 0.28, frontX: 0.72, rearX: -0.66, wheelZ: 0.0,
    body: [[-0.56, 0.32], [-0.58, 0.72], [-0.24, 0.8], [0.6, 0.72], [0.84, 0.48], [0.86, 0.3]],
    spineLen: 1.05, spineX: 0.02, spineY: 0.44,
    seatLen: 0.56, seatW: 0.32, seatX: -0.2, seatY: 0.78,
    forkLen: 0.66, forkX: 0.66, forkAngle: -0.26,
    barW: 0.64, barX: 0.52, barY: 1.06,
    headX: 0.76, headY: 0.94, guard: true,
    trim: '#e6d9c3',
  },
  {
    id: 'scrap_bike', kind: 'moped', name: 'Scrap Bike',
    color: '#8a8f98', wheelRadius: 0.32, frontX: 0.8, rearX: -0.78, wheelZ: 0.0,
    body: [[-0.5, 0.36], [-0.52, 0.6], [0.3, 0.58], [0.62, 0.5]],
    spineLen: 1.1, spineX: 0.05, spineY: 0.48,
    seatLen: 0.44, seatW: 0.24, seatX: -0.16, seatY: 0.66,
    forkLen: 0.8, forkX: 0.7, forkAngle: -0.34,
    barW: 0.68, barX: 0.56, barY: 1.02,
    headX: 0.84, headY: 0.9, guard: true,
    trim: '#5a6069',
  },
  {
    id: 'racer_125', kind: 'moped', name: 'Racer 125',
    color: '#d81e4a', wheelRadius: 0.28, frontX: 0.76, rearX: -0.7, wheelZ: 0.0,
    body: [[-0.52, 0.34], [-0.54, 0.68], [0.1, 0.74], [0.62, 0.6], [0.84, 0.42]],
    spineLen: 1.0, spineX: 0.04, spineY: 0.44,
    seatLen: 0.48, seatW: 0.26, seatX: -0.2, seatY: 0.74,
    forkLen: 0.72, forkX: 0.68, forkAngle: -0.32,
    barW: 0.6, barX: 0.54, barY: 1.0,
    headX: 0.82, headY: 0.9, guard: true,
    trim: '#1c1f24',
  },
  {
    id: 'cargo_moped', kind: 'moped', name: 'Cargo Moped',
    color: '#f0a63c', wheelRadius: 0.26, frontX: 0.7, rearX: -0.64, wheelZ: 0.0,
    body: [[-0.5, 0.34], [-0.52, 0.68], [0.5, 0.62], [0.76, 0.44]],
    spineLen: 0.9, spineX: 0.02, spineY: 0.44,
    seatLen: 0.46, seatW: 0.28, seatX: -0.16, seatY: 0.7,
    forkLen: 0.62, forkX: 0.62, forkAngle: -0.28,
    barW: 0.6, barX: 0.5, barY: 1.0,
    headX: 0.74, headY: 0.9, guard: true,
    box: [0.62, 0.56, 0.56, -0.62, 0], trim: '#2f3540',
  },
];

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */
function exportGLB(root) {
  return new Promise((resolve, reject) => {
    const exporter = new GLTFExporter();
    exporter.parse(
      root,
      (result) => resolve(Buffer.from(result)),
      (err) => reject(err),
      { binary: true },
    );
  });
}

async function buildOne(spec) {
  const root = new THREE.Group();
  root.name = spec.id;
  const model = spec.kind === 'car' ? buildCar(spec) : buildMoped(spec);

  // taxi roof sign
  if (spec.roofSign) {
    const sign = mesh('roof_sign', box(0.5, 0.16, 0.24), mat('sign', '#1b1b1b', { roughness: 0.6 }));
    sign.position.set(0.15, 1.52, 0);
    model.add(sign);
  }

  root.add(model);
  root.updateMatrixWorld(true);

  // Guard against malformed geometry (NaN from undefined parameters etc).
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const pos = obj.geometry.getAttribute('position');
    if (!pos) throw new Error(`${spec.id}: ${obj.name} has no position attribute`);
    for (let i = 0; i < pos.count * 3; i++) {
      if (!Number.isFinite(pos.array[i])) {
        throw new Error(`${spec.id}: ${obj.name} has non-finite vertex data`);
      }
    }
    obj.geometry.computeBoundingBox();
    const bb = obj.geometry.boundingBox;
    if (!bb || !Number.isFinite(bb.min.x) || !Number.isFinite(bb.max.x)) {
      throw new Error(`${spec.id}: ${obj.name} has an invalid bounding box`);
    }
  });

  const buf = await exportGLB(root);
  const file = path.join(OUT_DIR, `${spec.id}.glb`);
  fs.writeFileSync(file, buf);
  return { id: spec.id, name: spec.name, kind: spec.kind, bytes: buf.byteLength };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const all = [...CARS, ...MOPEDS];
  const manifest = [];
  for (const spec of all) {
    const info = await buildOne(spec);
    manifest.push(info);
    console.log(`  ${info.id.padEnd(16)} ${String(info.bytes).padStart(7)} bytes`);
  }
  fs.writeFileSync(
    path.join(OUT_DIR, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  );
  console.log(`\nExported ${manifest.length} models to public/models/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
