import * as THREE from 'three';
import { Track, ROAD_HALF_WIDTH } from '../sim/track';
import type { CityLayout } from '../game/cityLayout';

const flat = (color: number, opts: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.92, metalness: 0, ...opts });

/**
 * Builds the static world geometry: ground, tarmac ribbon, kerbs, city
 * blocks, trees, lamps and distant hills.
 */
export class WorldRenderer {
  readonly group = new THREE.Group();

  constructor(track: Track, layout: CityLayout) {
    this.buildGround();
    this.buildRoad(track);
    this.buildBuildings(layout);
    this.buildTrees(layout);
    this.buildLamps(layout);
    this.buildHills(layout);
  }

  private buildGround() {
    const geo = new THREE.PlaneGeometry(1200, 1200, 1, 1);
    const mat = flat(0x6a9b5b, { roughness: 1 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = -0.02;
    mesh.receiveShadow = true;
    this.group.add(mesh);

    // Dirt shoulder ring around the whole map for visual depth.
    const dirt = new THREE.Mesh(
      new THREE.PlaneGeometry(1600, 1600),
      flat(0x8a7c5f, { roughness: 1 }),
    );
    dirt.rotation.x = -Math.PI / 2;
    dirt.position.y = -0.05;
    this.group.add(dirt);
  }

  private buildRoad(track: Track) {
    const N = track.count;
    const half = ROAD_HALF_WIDTH;

    // --- tarmac --------------------------------------------------------
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i < N; i++) {
      const p = track.samples[i];
      const prev = track.samples[(i - 1 + N) % N];
      const next = track.samples[(i + 1) % N];
      let tx = next.x - prev.x;
      let tz = next.z - prev.z;
      const l = Math.hypot(tx, tz) || 1;
      tx /= l;
      tz /= l;
      const nx = -tz;
      const nz = tx;
      positions.push(p.x + nx * half, 0, p.z + nz * half);
      positions.push(p.x - nx * half, 0, p.z - nz * half);
      const v = track.cumulative[i] / 10;
      uvs.push(v, 0, v, 1);
      const a = i * 2;
      const b = ((i + 1) % N) * 2;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    roadGeo.setIndex(indices);
    roadGeo.computeVertexNormals();
    const road = new THREE.Mesh(roadGeo, flat(0x33363c, { roughness: 0.95 }));
    road.receiveShadow = true;
    this.group.add(road);

    // --- kerbs (alternating red / white) ---------------------------------
    const kerbGeo = new THREE.BoxGeometry(0.8, 0.1, 0.9);
    const kerbCount = Math.floor(track.length / 1.35);
    const kerb = new THREE.InstancedMesh(
      kerbGeo,
      new THREE.MeshStandardMaterial({ vertexColors: false, roughness: 0.8, flatShading: true }),
      kerbCount * 2,
    );
    kerb.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(kerbCount * 2 * 3), 3);
    const dummy = new THREE.Object3D();
    const c = new THREE.Color();
    let k = 0;
    for (let i = 0; i < kerbCount; i++) {
      const s = (i / kerbCount) * track.length;
      const p = track.positionAt(s, 0);
      const ahead = track.positionAt(s + 3, 0);
      const ang = Math.atan2(ahead.z - p.z, ahead.x - p.x);
      for (let side = -1; side <= 1; side += 2) {
        const off = track.positionAt(s, side * (half + 0.32));
        dummy.position.set(off.x, 0.05, off.z);
        dummy.rotation.set(0, -ang, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        kerb.setMatrixAt(k, dummy.matrix);
        c.setHex(i % 2 === 0 ? 0xd94b45 : 0xf2f2f2);
        kerb.setColorAt(k, c);
        k++;
      }
    }
    kerb.castShadow = false;
    kerb.receiveShadow = true;
    this.group.add(kerb);

    // --- centre dashes ----------------------------------------------------
    const dashGeo = new THREE.PlaneGeometry(0.34, 3.2);
    const dashCount = Math.floor(track.length / 9);
    const dash = new THREE.InstancedMesh(
      dashGeo,
      new THREE.MeshBasicMaterial({ color: 0xf0e9c8, transparent: true, opacity: 0.75 }),
      dashCount,
    );
    for (let i = 0; i < dashCount; i++) {
      const s = (i / dashCount) * track.length;
      const p = track.positionAt(s, 0);
      const ahead = track.positionAt(s + 3, 0);
      dummy.position.set(p.x, 0.03, p.z);
      dummy.rotation.set(-Math.PI / 2, 0, -Math.atan2(ahead.z - p.z, ahead.x - p.x));
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      dash.setMatrixAt(i, dummy.matrix);
    }
    this.group.add(dash);

    // --- start / finish line ----------------------------------------------
    const startS = 0;
    const sp = track.positionAt(startS, 0);
    const sa = track.positionAt(startS + 3, 0);
    const checker = new THREE.Mesh(
      new THREE.PlaneGeometry(ROAD_HALF_WIDTH * 2, 3),
      new THREE.MeshBasicMaterial({ map: makeCheckerTexture(), transparent: false }),
    );
    checker.rotation.set(-Math.PI / 2, 0, -Math.atan2(sa.z - sp.z, sa.x - sp.x));
    checker.position.set(sp.x, 0.04, sp.z);
    this.group.add(checker);
  }

  private buildBuildings(layout: CityLayout) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.02, flatShading: true });
    const mesh = new THREE.InstancedMesh(geo, mat, layout.buildings.length);
    const dummy = new THREE.Object3D();
    const c = new THREE.Color();
    layout.buildings.forEach((b, i) => {
      dummy.position.set(b.x, b.h / 2, b.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(b.w, b.h, b.d);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      c.setHex(b.color);
      mesh.setColorAt(i, c);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);

    // Rooftop slabs give the skyline some silhouette.
    const capGeo = new THREE.BoxGeometry(1, 0.6, 1);
    const cap = new THREE.InstancedMesh(capGeo, flat(0x9aa0a8), layout.buildings.length);
    layout.buildings.forEach((b, i) => {
      dummy.position.set(b.x, b.h + 0.3, b.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(b.w * 0.82, 1, b.d * 0.82);
      dummy.updateMatrix();
      cap.setMatrixAt(i, dummy.matrix);
    });
    cap.castShadow = true;
    this.group.add(cap);

    // Emissive window bands.
    const winGeo = new THREE.BoxGeometry(1, 1, 1);
    const winMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffd89b,
      emissiveIntensity: 1.4,
      roughness: 0.4,
      flatShading: true,
    });
    const totalWindows = layout.buildings.reduce((a, b) => a + b.windows, 0);
    const win = new THREE.InstancedMesh(winGeo, winMat, totalWindows);
    let w = 0;
    for (const b of layout.buildings) {
      for (let i = 0; i < b.windows; i++) {
        const y = 3 + i * 5.2;
        if (y > b.h - 2) break;
        dummy.position.set(b.x, y, b.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(b.w * 1.01, 1.5, b.d * 1.01);
        dummy.updateMatrix();
        win.setMatrixAt(w++, dummy.matrix);
      }
    }
    win.count = w;
    this.group.add(win);
  }

  private buildTrees(layout: CityLayout) {
    const trunk = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.28, 0.36, 2.4, 6),
      flat(0x6b4a32),
      layout.trees.length,
    );
    const crown = new THREE.InstancedMesh(
      new THREE.ConeGeometry(1.7, 4.2, 7),
      flat(0x3f7a43),
      layout.trees.length,
    );
    const dummy = new THREE.Object3D();
    const c = new THREE.Color();
    layout.trees.forEach((t, i) => {
      dummy.position.set(t.x, 1.2 * t.scale, t.z);
      dummy.rotation.set(0, t.scale * 3, 0);
      dummy.scale.setScalar(t.scale);
      dummy.updateMatrix();
      trunk.setMatrixAt(i, dummy.matrix);
      dummy.position.set(t.x, (2.4 + 2.1) * t.scale, t.z);
      dummy.updateMatrix();
      crown.setMatrixAt(i, dummy.matrix);
      c.setHSL(0.28 + (t.scale - 0.7) * 0.08, 0.42, 0.32 + (t.scale - 0.7) * 0.1);
      crown.setColorAt(i, c);
    });
    trunk.castShadow = true;
    crown.castShadow = true;
    this.group.add(trunk, crown);
  }

  private buildLamps(layout: CityLayout) {
    const pole = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.12, 0.16, 6, 6),
      flat(0x3d4249),
      layout.lamps.length,
    );
    const bulb = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.32, 8, 6),
      new THREE.MeshStandardMaterial({
        color: 0xfff2c4,
        emissive: 0xffd98a,
        emissiveIntensity: 2.2,
        flatShading: true,
      }),
      layout.lamps.length,
    );
    const dummy = new THREE.Object3D();
    layout.lamps.forEach((l, i) => {
      dummy.position.set(l.x, 3, l.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      pole.setMatrixAt(i, dummy.matrix);
      dummy.position.set(l.x + Math.cos(l.angle) * 0.9, 5.9, l.z + Math.sin(l.angle) * 0.9);
      dummy.updateMatrix();
      bulb.setMatrixAt(i, dummy.matrix);
    });
    pole.castShadow = true;
    this.group.add(pole, bulb);
  }

  private buildHills(layout: CityLayout) {
    const geo = new THREE.ConeGeometry(1, 1, 7);
    const mesh = new THREE.InstancedMesh(geo, flat(0x6d8b7a), layout.hills.length);
    const dummy = new THREE.Object3D();
    const c = new THREE.Color();
    layout.hills.forEach((h, i) => {
      dummy.position.set(h.x, h.h / 2, h.z);
      dummy.rotation.set(0, i, 0);
      dummy.scale.set(h.r, h.h, h.r);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      c.setHex(h.color);
      mesh.setColorAt(i, c);
    });
    this.group.add(mesh);
  }
}

function makeCheckerTexture(): THREE.Texture {
  const size = 64;
  const cells = 8;
  const canvas = document.createElement('canvas');
  canvas.width = size * cells;
  canvas.height = size * cells;
  const ctx = canvas.getContext('2d')!;
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#f2f2f2' : '#22252a';
      ctx.fillRect(x * size, y * size, size, size);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
