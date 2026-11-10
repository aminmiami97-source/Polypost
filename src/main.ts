import * as THREE from 'three';
import './styles.css';

import { Stage } from './render/stage';
import { ChaseCamera } from './render/chaseCamera';
import { WorldRenderer } from './render/worldRenderer';
import { VehicleModel } from './render/vehicleModel';

import { Track } from './sim/track';
import { World } from './sim/world';
import { VehicleSim, NEUTRAL_INPUT, type VehicleInput } from './sim/vehicle';
import { RaceDirector, type Crate } from './sim/race';

import { buildCityLayout, type CityLayout } from './game/cityLayout';
import { VEHICLES, type VehicleSpec } from './game/catalog';

import { InputController } from './input';
import { Hud, standingsFromRace } from './ui/hud';
import { Screens } from './ui/screens';

type GameState = 'title' | 'garage' | 'driving' | 'paused' | 'results';

const MODEL_URL = (id: string) => `models/${id}.glb`;

class Game {
  private stage: Stage;
  private track = new Track();
  private layout: CityLayout;
  private world: World;
  private race = new RaceDirector(this.track);
  private chase: ChaseCamera;
  private hud = new Hud();
  private screens: Screens;
  private input = new InputController();

  private playerSim!: VehicleSim;
  private playerGroup = new THREE.Group();
  private modelCache = new Map<string, VehicleModel>();
  private rivalGroup = new THREE.Group();
  private trafficGroup = new THREE.Group();
  private coneGroup = new THREE.Group();
  private crateGroup = new THREE.Group();
  private gateGroup = new THREE.Group();
  private boostFlame!: THREE.Mesh;
  private turntable!: THREE.Mesh;

  private state: GameState = 'title';
  private spec: VehicleSpec = VEHICLES[0];
  private lastTime = performance.now();
  private accumulator = 0;
  private titleAngle = 0;
  private previewAngle = 0;
  private longG = 0;
  private latG = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.stage = new Stage({ canvas });
    this.layout = buildCityLayout(this.track);
    this.world = new World(this.track);
    this.chase = new ChaseCamera(this.stage.camera);

    this.stage.scene.add(new WorldRenderer(this.track, this.layout).group);
    this.stage.scene.add(
      this.playerGroup,
      this.rivalGroup,
      this.trafficGroup,
      this.coneGroup,
      this.crateGroup,
      this.gateGroup,
    );

    this.buildCollisionWorld();
    this.buildTrafficMeshes();
    this.buildConeMeshes();
    this.buildGates();
    this.buildBoostFlame();
    this.buildTurntable();

    this.screens = new Screens({
      onRace: () => this.start('race'),
      onFreeRoam: () => this.start('freeroam'),
      onOpenGarage: () => this.enterGarage(),
      onSelectVehicle: (s) => this.onVehicleSelected(s),
      onDrive: () => this.start(this.pendingMode),
      onBackToTitle: () => this.toTitle(),
      onRetry: () => this.start(this.pendingMode),
      onResultsGarage: () => this.enterGarage(),
      onResultsTitle: () => this.toTitle(),
      onResume: () => this.resume(),
      onRestart: () => this.start(this.pendingMode),
      onQuit: () => this.toTitle(),
    });

    this.input.on({
      onCamera: () => {
        const mode = this.chase.cycle();
        this.hud.flash(`CAMERA · ${mode.toUpperCase()}`, 1.1);
      },
      onReset: () => this.respawn(),
      onPause: () => {
        if (this.state === 'driving') this.pause();
        else if (this.state === 'paused') this.resume();
      },
    });

    this.hud.setGearCount(5);
  }

  private pendingMode: 'race' | 'freeroam' = 'race';

  // ---------------------------------------------------------------- setup

  private buildCollisionWorld() {
    for (const b of this.layout.buildings) {
      this.world.addBuilding(b.x, b.z, b.w / 2, b.d / 2);
    }
    for (const t of this.layout.trees) {
      this.world.addBuilding(t.x, t.z, 0.45, 0.45);
    }
    // Cones marking the racing line.
    for (let i = 0; i < 26; i++) {
      const s = (i / 26) * this.track.length + 18;
      const side = i % 2 === 0 ? 1 : -1;
      const p = this.track.positionAt(s, side * 9.4);
      this.world.addCone(p.x, p.z);
    }
    // Ambient traffic sharing the circuit.
    const trafficColors = [0xe8e8e8, 0x2f6fa8, 0xd9433f, 0xf2b632, 0x4a4f57, 0x6fbf73];
    for (let i = 0; i < 8; i++) {
      this.world.addTraffic(
        (i / 8) * this.track.length + 30,
        i % 2 === 0 ? 7.6 : -7.6,
        11 + (i % 3) * 3,
        trafficColors[i % trafficColors.length],
      );
    }
  }

  /** Visual bodies for the ambient traffic cars. */
  private buildTrafficMeshes() {
    this.trafficGroup.clear();
    for (const t of this.world.traffic) {
      const mesh = makeTrafficMesh(t.color.getHex());
      mesh.position.set(t.x, 0, t.z);
      this.trafficGroup.add(mesh);
    }
  }

  /** Visual cones that get knocked about by the player. */
  private buildConeMeshes() {
    this.coneGroup.clear();
    const geo = new THREE.ConeGeometry(0.32, 0.75, 6);
    const mat = new THREE.MeshStandardMaterial({ color: 0xf07a1f, flatShading: true });
    const base = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, flatShading: true });
    for (const c of this.world.cones) {
      const g = new THREE.Group();
      const cone = new THREE.Mesh(geo, mat);
      cone.position.y = 0.38;
      cone.castShadow = true;
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.06, 0.6), base);
      foot.position.y = 0.03;
      g.add(cone, foot);
      g.position.set(c.x, 0, c.z);
      this.coneGroup.add(g);
    }
  }

  private buildGates() {
    const postGeo = new THREE.BoxGeometry(0.5, 7, 0.5);
    const bannerGeo = new THREE.BoxGeometry(0.4, 1.1, 21);
    for (const gate of this.race.gates) {
      const g = new THREE.Group();
      const postMat = new THREE.MeshStandardMaterial({ color: 0xd94b45, flatShading: true });
      const left = new THREE.Mesh(postGeo, postMat);
      left.position.set(0, 3.5, 10.4);
      const right = left.clone();
      right.position.z = -10.4;
      const banner = new THREE.Mesh(
        bannerGeo,
        new THREE.MeshStandardMaterial({ color: 0xf2f2f2, flatShading: true }),
      );
      banner.position.set(0, 7, 0);
      g.add(left, right, banner);
      g.position.set(gate.x, 0, gate.z);
      g.rotation.y = -gate.angle;
      g.visible = false;
      this.gateGroup.add(g);
    }
  }

  /** Showroom plinth used behind the car in the garage. */
  private buildTurntable() {
    const geo = new THREE.CylinderGeometry(4.2, 4.4, 0.35, 24);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x2a3140,
      roughness: 0.6,
      metalness: 0.25,
      flatShading: true,
    });
    this.turntable = new THREE.Mesh(geo, mat);
    this.turntable.receiveShadow = true;
    this.turntable.visible = false;
    this.stage.scene.add(this.turntable);
  }

  private buildBoostFlame() {
    const geo = new THREE.ConeGeometry(0.22, 1.1, 8, 1, true);
    geo.rotateZ(Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x8be9fd,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    });
    this.boostFlame = new THREE.Mesh(geo, mat);
    this.boostFlame.visible = false;
    this.playerGroup.add(this.boostFlame);
  }

  private async getModel(spec: VehicleSpec): Promise<VehicleModel> {
    const cached = this.modelCache.get(spec.id);
    if (cached) return cached;
    const model = await VehicleModel.load(MODEL_URL(spec.model));
    this.modelCache.set(spec.id, model);
    return model;
  }

  // ---------------------------------------------------------------- flow

  async boot() {
    this.screens.setLoading('Building the city…');
    await this.getModel(this.spec);
    this.applyVehicleModel(this.spec);

    // Warm the rest of the garage so switching is instant.
    for (const v of VEHICLES) {
      await this.getModel(v);
    }
    this.screens.setLoading(null);
    this.toTitle();
    requestAnimationFrame(this.loop);
  }

  private applyVehicleModel(spec: VehicleSpec) {
    const model = this.modelCache.get(spec.id);
    if (!model) return;
    this.playerGroup.clear();
    this.playerGroup.add(model.root);
    this.playerSim = new VehicleSim(spec);
    this.playerSim.reset(0, 0, 0);
    this.playerGroup.add(this.boostFlame);
    this.spec = spec;
  }

  private async onVehicleSelected(spec: VehicleSpec) {
    this.spec = spec;
    const model = await this.getModel(spec);
    this.playerGroup.clear();
    this.playerGroup.add(model.root);
    this.playerGroup.add(this.boostFlame);
    this.playerSim = new VehicleSim(spec);
    this.placeAtStart();
  }

  private placeAtStart() {
    const s = 3;
    const p = this.track.positionAt(s, -4.2);
    this.playerSim.reset(p.x, p.z, this.track.headingAt(s));
    this.playerGroup.position.set(p.x, 0, p.z);
    this.playerGroup.rotation.y = -this.playerSim.heading;
  }

  private toTitle() {
    this.state = 'title';
    this.screens.hideAll();
    this.screens.show('title');
    this.hud.hide();
    this.input.clear();
    this.rivalGroup.clear();
    this.crateGroup.clear();
    this.turntable.visible = false;
    this.gateGroup.children.forEach((g) => (g.visible = false));
  }

  private enterGarage() {
    this.state = 'garage';
    this.screens.hideAll();
    this.screens.show('garage');
    this.hud.hide();
    this.input.clear();
    const p = this.track.positionAt(22, 17);
    this.playerGroup.position.set(p.x, 0.35, p.z);
    this.playerGroup.rotation.y = 0;
    this.playerSim.reset(p.x, p.z, 0);
    this.previewAngle = 0;
    this.turntable.visible = true;
    this.turntable.position.set(p.x, 0.17, p.z);
  }

  private start(mode: 'race' | 'freeroam') {
    this.pendingMode = mode;
    this.state = 'driving';
    this.screens.hideAll();
    this.hud.show();
    this.input.clear();

    this.placeAtStart();
    this.chase.update(1, this.playerSim, true);

    this.rivalGroup.clear();
    this.crateGroup.clear();

    if (mode === 'race') {
      const rivalDefs = [
        { name: 'V. Kestrel', color: 0x8b4fd6, speed: 40 },
        { name: 'R. Tempo', color: 0x3f9a6a, speed: 38 },
        { name: 'S. Blaze', color: 0xf07a1f, speed: 41 },
        { name: 'M. Drift', color: 0x2f6fa8, speed: 39 },
        { name: 'J. Nitro', color: 0xf5c518, speed: 42 },
      ];
      this.race.startRace(3, rivalDefs);
      for (const r of this.race.rivals) this.rivalGroup.add(makeRivalMesh(r.color));
      this.hud.flash('GO!', 1.2);
    } else {
      const crates: Crate[] = [];
      const count = 12;
      for (let i = 0; i < count; i++) {
        const s = (i / count) * this.track.length + 25;
        const side = i % 2 === 0 ? 1 : -1;
        const p = this.track.positionAt(s, side * (6 + (i % 3) * 3));
        crates.push({ x: p.x, z: p.z, collected: false, bob: i });
      }
      this.race.startFreeRoam(crates);
      for (let i = 0; i < this.race.crates.length; i++) this.crateGroup.add(makeCrateMesh());
      this.hud.flash('Collect 12 crates', 1.6);
    }
  }

  private pause() {
    this.state = 'paused';
    this.screens.show('pause');
    this.input.clear();
  }

  private resume() {
    this.state = 'driving';
    this.screens.hideAll();
  }

  private respawn() {
    if (this.state !== 'driving') return;
    const hit = this.track.nearest(this.playerSim.x, this.playerSim.z);
    const p = this.track.positionAt(hit.s, -3.5);
    this.playerSim.reset(p.x, p.z, this.track.headingAt(hit.s));
    this.hud.flash('RESET', 0.9);
  }

  private finish() {
    this.state = 'results';
    const r = this.race;
    let body = '';
    let title = 'Race complete';

    if (r.mode === 'race') {
      const pos = r.position;
      const ordinal = pos === 1 ? '1st' : pos === 2 ? '2nd' : pos === 3 ? '3rd' : `${pos}th`;
      title = pos === 1 ? 'Victory!' : 'Race complete';
      body = `
        <div class="result-big">${ordinal} place</div>
        <div class="result-sub">Total ${format(r.finishTime)} · Best lap ${
          r.bestLap === null ? '--' : format(r.bestLap)
        }</div>
        <div style="margin-top:18px">
          ${r.lapTimes
            .map(
              (t, i) =>
                `<div class="result-row"><span>Lap ${i + 1}</span><span class="t">${format(t)}</span></div>`,
            )
            .join('')}
        </div>`;
    } else {
      const total = r.totalCrates;
      const got = r.collectedCrates;
      title = got >= total ? 'All crates collected!' : 'Time up';
      body = `
        <div class="result-big">${got} / ${total}</div>
        <div class="result-sub">Crates collected in ${format(r.finishTime)}</div>`;
    }
    this.screens.showResults(title, body);
    this.hud.hide();
  }

  // ---------------------------------------------------------------- loop

  private loop = () => {
    requestAnimationFrame(this.loop);
    const now = performance.now();
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (dt > 0.25) dt = 0.25;
    this.stage.updateQuality(dt);

    if (this.state === 'driving') {
      this.accumulator += dt;
      const step = 1 / 60;
      let steps = 0;
      while (this.accumulator >= step && steps < 8) {
        this.stepSimulation(step);
        this.accumulator -= step;
        steps++;
      }
    }

    this.updateVisuals(dt);
    this.stage.render();
  };

  private stepSimulation(dt: number, override?: VehicleInput) {
    const input = override ?? (this.state === 'driving' ? this.input.current : NEUTRAL_INPUT);

    const prevLong = this.playerSim.vLong;
    const prevLat = this.playerSim.vLat;
    this.playerSim.step(dt, input);
    this.longG = (this.playerSim.vLong - prevLong) / dt;
    this.latG = (this.playerSim.vLat - prevLat) / dt;

    const hit = this.world.updateRoadState(this.playerSim);
    this.world.update(dt, this.playerSim, true, hit);

    const finished = this.race.update(dt, this.playerSim);
    if (finished) this.finish();

  }

  /**
   * Test hook: advances the simulation deterministically, without rendering.
   * Used by the automated playtest to validate driving, laps and collisions.
   */
  stepOnce(dt: number, input: VehicleInput) {
    this.stepSimulation(dt, input);
  }

  simulateFor(seconds: number, input: VehicleInput) {
    const step = 1 / 60;
    const n = Math.round(seconds / step);
    for (let i = 0; i < n; i++) this.stepSimulation(step, input);
  }

  private updateVisuals(dt: number) {
    const sim = this.playerSim;

    if (this.state === 'title') {
      this.titleAngle += dt * 0.06;
      const r = 250;
      this.stage.camera.position.set(
        Math.cos(this.titleAngle) * r,
        95,
        Math.sin(this.titleAngle) * r,
      );
      this.stage.camera.lookAt(0, 10, 0);
      this.stage.camera.fov = 55;
      this.stage.camera.updateProjectionMatrix();
      this.stage.focusShadow(0, 0);
      return;
    }

    if (this.state === 'garage') {
      this.previewAngle += dt * 0.3;
      const p = this.playerGroup.position;
      const r = 9.6;
      this.stage.camera.position.set(
        p.x + Math.cos(this.previewAngle) * r,
        3.1,
        p.z + Math.sin(this.previewAngle) * r,
      );
      this.stage.camera.lookAt(p.x, 1.05, p.z);
      this.stage.camera.fov = 40;
      this.stage.camera.updateProjectionMatrix();
      this.stage.focusShadow(p.x, p.z);
      this.playerModelSpin(dt);
      return;
    }

    // --- driving ------------------------------------------------------
    this.playerGroup.position.set(sim.x, 0, sim.z);
    this.playerGroup.rotation.y = -sim.heading;

    const model = this.modelCache.get(this.spec.id);
    if (model) {
      model.update(
        dt,
        sim.vLong,
        sim.steerAngle,
        this.latG,
        this.longG,
        this.spec.kind === 'moped' ? 0.28 : 0.34,
      );
    }

    this.boostFlame.position.set(this.spec.kind === 'moped' ? -0.62 : -2.02, 0.44, 0);
    const boosting = this.input.current.boost && sim.boost > 0.02 && sim.vLong > 1;
    this.boostFlame.visible = boosting;
    if (boosting) {
      const s = 0.7 + Math.random() * 0.6;
      this.boostFlame.scale.set(s, 1, s);
    }

    this.chase.update(dt, sim);
    this.stage.focusShadow(sim.x, sim.z);

    // rivals
    this.race.rivals.forEach((r, i) => {
      const mesh = this.rivalGroup.children[i];
      if (!mesh) return;
      mesh.position.set(r.x, 0, r.z);
      mesh.rotation.y = -r.heading;
    });

    // ambient traffic
    this.world.traffic.forEach((t, i) => {
      const mesh = this.trafficGroup.children[i];
      if (!mesh) return;
      mesh.position.set(t.x, 0, t.z);
      mesh.rotation.y = -t.heading;
    });

    // knocked-about cones
    this.world.cones.forEach((c, i) => {
      const g = this.coneGroup.children[i];
      if (!g) return;
      g.position.set(c.x, c.knocked ? 0.12 : 0, c.z);
      if (c.knocked) {
        g.rotation.set(Math.PI / 2.2, c.angle, 0);
      } else {
        g.rotation.set(0, c.angle, 0);
      }
    });

    // crates
    this.race.crates.forEach((c, i) => {
      const mesh = this.crateGroup.children[i];
      if (!mesh) return;
      mesh.visible = !c.collected;
      if (!c.collected) {
        mesh.position.set(c.x, 1.1 + Math.sin(c.bob) * 0.25, c.z);
        mesh.rotation.y = c.bob * 0.8;
        mesh.rotation.x = 0.3;
      }
    });

    // gates: highlight the next one
    const nextGate = this.race.nextGateIndex;
    this.gateGroup.children.forEach((g, i) => {
      g.visible = this.race.mode === 'race' && i === nextGate;
    });

    this.updateHud(dt);
  }

  private playerModelSpin(dt: number) {
    const model = this.modelCache.get(this.spec.id);
    if (!model) return;
    model.update(dt, 0, 0, 0, 0, 0.3);
  }

  private updateHud(dt: number) {
    const sim = this.playerSim;
    const r = this.race;
    const speedKmh = sim.speed * 3.6;
    const gear = Math.max(1, Math.min(5, Math.floor((sim.speed / this.spec.topSpeed) * 5) + 1));

    const objective =
      r.mode === 'race'
        ? `Lap ${Math.min(r.lap + 1, r.lapsToFinish)} / ${r.lapsToFinish} · P${r.position}`
        : `Crates ${r.collectedCrates} / ${r.totalCrates}`;

    this.hud.update({
      speedKmh,
      boost: sim.boost,
      gear,
      gears: 5,
      lapTime: r.mode === 'race' ? r.elapsed - r.lapStart : r.elapsed,
      bestLap: r.bestLap,
      totalTime: r.elapsed,
      objective,
      standings:
        r.mode === 'race'
          ? standingsFromRace(r, this.spec.name)
          : [{ name: this.spec.name, position: 1, gap: `${r.collectedCrates}/${r.totalCrates}`, isPlayer: true }],
    });

    this.hud.tick(dt);

    const playerPos = new THREE.Vector3(sim.x, 0, sim.z);
    const rivalPos = r.rivals.map((rv) => new THREE.Vector3(rv.x, 0, rv.z));
    const cratePos = r.mode === 'freeroam' ? r.crates.map((c) => new THREE.Vector3(c.x, 0, c.z)) : undefined;
    this.hud.drawMinimap(this.track, playerPos, rivalPos, cratePos);
  }
}

function makeRivalMesh(color: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.85, 1.9), mat);
  body.position.y = 0.72;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.62, 1.72), mat);
  cabin.position.set(-0.2, 1.42, 0);
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(2.12, 0.4, 1.74),
    new THREE.MeshStandardMaterial({ color: 0x1b2430, flatShading: true, roughness: 0.2 }),
  );
  glass.position.set(-0.2, 1.5, 0);
  g.add(body, cabin, glass);
  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 12);
  wheelGeo.rotateX(Math.PI / 2);
  const tyre = new THREE.MeshStandardMaterial({ color: 0x14161a, flatShading: true });
  for (const [x, z] of [
    [1.35, 0.88],
    [1.35, -0.88],
    [-1.35, 0.88],
    [-1.35, -0.88],
  ]) {
    const w = new THREE.Mesh(wheelGeo, tyre);
    w.position.set(x, 0.34, z);
    w.castShadow = true;
    g.add(w);
  }
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  return g;
}

function makeTrafficMesh(color: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.55 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1b2430, flatShading: true, roughness: 0.25 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.9, 1.85), mat);
  body.position.y = 0.74;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.68, 1.72), glass);
  cabin.position.set(-0.25, 1.5, 0);
  g.add(body, cabin);
  const wheelGeo = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 10);
  wheelGeo.rotateX(Math.PI / 2);
  const tyre = new THREE.MeshStandardMaterial({ color: 0x14161a, flatShading: true });
  for (const [x, z] of [
    [1.3, 0.85],
    [1.3, -0.85],
    [-1.3, 0.85],
    [-1.3, -0.85],
  ]) {
    const w = new THREE.Mesh(wheelGeo, tyre);
    w.position.set(x, 0.33, z);
    g.add(w);
  }
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  return g;
}

function makeCrateMesh(): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 1.1, 1.1),
    new THREE.MeshStandardMaterial({
      color: 0x4fd1c5,
      emissive: 0x2fbfae,
      emissiveIntensity: 1.1,
      flatShading: true,
    }),
  );
  mesh.castShadow = true;
  return mesh;
}

function format(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const rest = seconds - m * 60;
  return `${m}:${rest.toFixed(2).padStart(5, '0')}`;
}

const canvas = document.getElementById('game') as HTMLCanvasElement;
const game = new Game(canvas);
game.boot().catch((err) => {
  console.error(err);
  const note = document.getElementById('loading-note');
  if (note) note.textContent = 'Failed to start: ' + err.message;
});

// Expose for debugging / automated playtests.
(window as unknown as { game: Game }).game = game;
