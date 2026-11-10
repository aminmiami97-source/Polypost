import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import './styles.css';
import { VEHICLES } from './game/catalog';

/**
 * Model gallery: every vehicle on a turntable, with the camera orbiting the
 * selected one. Doubles as a quick visual QA sheet for the exported GLBs.
 */
const canvas = document.getElementById('gallery') as HTMLCanvasElement;
const labelsEl = document.getElementById('g-labels') as HTMLDivElement;
const nameEl = document.getElementById('g-name') as HTMLDivElement;
const metaEl = document.getElementById('g-meta') as HTMLDivElement;
const indexEl = document.getElementById('g-index') as HTMLSpanElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x121822);
scene.fog = new THREE.Fog(0x121822, 26, 62);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 200);

scene.add(new THREE.HemisphereLight(0xcfe9ff, 0x2a3240, 1.0));
const key = new THREE.DirectionalLight(0xfff0d2, 2.2);
key.position.set(8, 14, 6);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.near = 0.5;
key.shadow.camera.far = 60;
key.shadow.camera.left = -18;
key.shadow.camera.right = 18;
key.shadow.camera.top = 18;
key.shadow.camera.bottom = -18;
scene.add(key);
const rim = new THREE.DirectionalLight(0x6fb6ff, 0.8);
rim.position.set(-9, 6, -8);
scene.add(rim);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(60, 48),
  new THREE.MeshStandardMaterial({ color: 0x1b2230, roughness: 0.95 }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// Plinths
const plinthGeo = new THREE.CylinderGeometry(2.9, 3.1, 0.3, 24);
const plinthMat = new THREE.MeshStandardMaterial({
  color: 0x232b3a,
  roughness: 0.55,
  metalness: 0.3,
  flatShading: true,
});
const loader = new GLTFLoader();
const entries: {
  spec: (typeof VEHICLES)[number];
  group: THREE.Group;
  label: HTMLDivElement;
  angle: number;
}[] = [];

const RING = 13.5;

async function loadAll() {
  for (let i = 0; i < VEHICLES.length; i++) {
    const spec = VEHICLES[i];
    const gltf = await loader.loadAsync(`models/${spec.model}.glb`);
    const group = new THREE.Group();
    gltf.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.receiveShadow = false;
      }
    });
    group.add(gltf.scene);

    const angle = (i / VEHICLES.length) * Math.PI * 2;
    group.position.set(Math.cos(angle) * RING, 0.3, Math.sin(angle) * RING);
    group.rotation.y = -angle + Math.PI / 2;
    scene.add(group);

    const plinth = new THREE.Mesh(plinthGeo, plinthMat);
    plinth.position.set(group.position.x, 0.15, group.position.z);
    plinth.receiveShadow = true;
    scene.add(plinth);

    const label = document.createElement('div');
    label.className = 'g-label';
    label.textContent = spec.name;
    labelsEl.appendChild(label);

    entries.push({ spec, group, label, angle });
  }
}

let current = 0;
let camAngle = 0;

function setCurrent(i: number) {
  current = (i + entries.length) % entries.length;
  const e = entries[current];
  indexEl.textContent = String(current + 1);
  nameEl.textContent = e.spec.name;
  metaEl.innerHTML = `
    <span>${e.spec.kind === 'car' ? 'Car' : 'Moped'}</span>
    <span>${Math.round(e.spec.topSpeed * 3.6)} km/h</span>
    <span>${e.spec.accel.toFixed(1)} m/s²</span>
    <span>grip ${Math.round(e.spec.grip * 100)}%</span>`;
}

document.getElementById('g-prev')!.addEventListener('click', () => setCurrent(current - 1));
document.getElementById('g-next')!.addEventListener('click', () => setCurrent(current + 1));
window.addEventListener('keydown', (e) => {
  if (e.code === 'ArrowLeft') setCurrent(current - 1);
  if (e.code === 'ArrowRight') setCurrent(current + 1);
});

const tmp = new THREE.Vector3();
const clock = new THREE.Clock();

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.1);

  const e = entries[current];
  if (e) {
    // Slow orbit around the focused vehicle.
    camAngle += dt * 0.25;
    const r = 7.8;
    camera.position.set(
      e.group.position.x + Math.cos(camAngle) * r,
      2.9,
      e.group.position.z + Math.sin(camAngle) * r,
    );
    camera.lookAt(e.group.position.x, 0.9, e.group.position.z);
  }

  // Project labels to screen space.
  for (const entry of entries) {
    tmp.copy(entry.group.position);
    tmp.y += 1.9;
    tmp.project(camera);
    const x = (tmp.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-tmp.y * 0.5 + 0.5) * window.innerHeight;
    const visible = tmp.z < 1;
    entry.label.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
    entry.label.style.opacity = visible ? (entry === e ? '1' : '0.25') : '0';
    entry.label.style.pointerEvents = 'none';
  }

  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

loadAll().then(() => {
  setCurrent(0);
  loop();
  (window as unknown as { setGallery: (i: number) => void }).setGallery = setCurrent;
});
