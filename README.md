# Low Poly Drive

A 3D low-poly driving game that runs in the browser. Race a circuit around a
low-poly city in one of **14 hand-built vehicles** (9 cars and 5 mopeds), or
roam free collecting delivery crates.

Built with Three.js + TypeScript + Vite. Every vehicle model is generated
procedurally and exported as a GLB, so the whole game is a static site — no
server, no assets pipeline at runtime.

**Play it:** <https://aminmiami97-source.github.io/low-poly-drive/>

## Features

- **14 low-poly vehicles** — 9 cars (coupe, sedan, compact, SUV, pickup, muscle
  car, supercar, van, taxi) and 5 mopeds (scooter, retro moped, dirt bike,
  café racer, delivery moped). Each has its own silhouette, colour and driving
  characteristics.
- **Two modes** — a 3-lap circuit race against 5 AI rivals with live standings
  and lap timing, or free roam collecting 12 crates.
- **Arcade driving model** — separate longitudinal and lateral velocity, so
  the cars understeer, drift and slide; handbrake, nitrous boost and a
  speed-reactive chase camera.
- **A city worth driving** — 810 m circuit, kerbs, traffic to dodge, cones to
  scatter, street lamps, park blocks and distant hills.
- **Garage** — browse all 14 vehicles on a turntable with stat bars.
- **Model gallery** — a separate page (`gallery.html`) that displays every
  exported model, useful for inspecting the low-poly work.
- **Adaptive quality** — the renderer drops shadows and resolution if the
  frame rate drops, and scales back up when it recovers.

## Controls

| Key | Action |
| --- | --- |
| `W` / `↑` | Throttle |
| `S` / `↓` | Brake / reverse |
| `A` `D` / `←` `→` | Steer |
| `Space` | Handbrake (drift) |
| `Shift` | Nitrous boost |
| `C` | Cycle camera (chase / bonnet / wide) |
| `R` | Reset to the track |
| `Esc` | Pause |

Touch controls appear automatically on touch devices.

## Running locally

```bash
npm install
npm run dev        # dev server on http://localhost:5173
npm run build      # regenerate models + typecheck + production bundle
npm run preview    # serve the production build
```

## The vehicle models

Models are **not** hand-modelled in a DCC tool — they are generated from
parametric recipes so the whole set stays consistent and is reproducible:

```bash
npm run models     # writes public/models/*.glb
```

`tools/build-models.mjs` builds each vehicle from an extruded side profile plus
primitive parts (wheels, lights, bumpers, racks, cargo boxes), then exports one
binary GLB per vehicle with `GLTFExporter`. The generator validates every mesh
for non-finite vertex data before writing.

Runtime contract between the generator and the game:

- node names `wheel_fl` / `wheel_fr` / `wheel_rl` / `wheel_rr` (cars) and
  `wheel_f` / `wheel_r` (mopeds) are used to steer and spin the wheels;
- materials are named `paint`, `glass`, `tyre`, `rim`, `light`, `trim` so the
  paint colour can be swapped at runtime.

## Project layout

```
src/
  main.ts              game bootstrap, state machine, game loop
  gallery.ts           model gallery page
  game/
    catalog.ts         vehicle catalogue (stats + model references)
    cityLayout.ts      deterministic city generation
  sim/                 pure simulation, no rendering
    track.ts           circuit spline, arc-length lookup, projection
    vehicle.ts         arcade vehicle dynamics
    world.ts           buildings, traffic, cones, collision solver
    race.ts            laps, checkpoints, rival AI, standings
  render/
    stage.ts           renderer, lighting, gradient sky, adaptive quality
    worldRenderer.ts   ground, tarmac, kerbs, city blocks, props
    vehicleModel.ts    GLB loading, wheel animation, paint
    chaseCamera.ts     camera rig
  ui/                  DOM HUD and screens
tools/
  build-models.mjs     procedural low-poly model generator
  playtest.py          headless browser screenshots + smoke test
  gametest.py          deterministic gameplay validation (autopilot lap runs)
```

## Tests

```bash
npm run build
npx vite preview --port 4173 &
python3 tools/gametest.py     # autopilot races a full lap, checks all 14 vehicles
python3 tools/playtest.py     # screenshots + console-error check
```

`gametest.py` drives the simulation directly (no renderer dependency) with a
pure-pursuit autopilot and asserts that laps complete, lap times are recorded,
every vehicle accelerates and no JavaScript errors are raised.

## Licence

MIT — see [LICENSE](LICENSE).
