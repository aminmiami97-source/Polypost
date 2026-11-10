"""
Deterministic gameplay validation for Low Poly Drive.

Runs inside the page: an autopilot drives the car with a pure-pursuit
controller so acceleration, steering, collision, lap counting and the race
flow can be validated without depending on real-time rendering speed.
"""
import json
import sys

from playwright.sync_api import sync_playwright

sys.path.insert(0, "tools")
from playtest import find_chromium  # noqa: E402

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4173/"

AUTOPILOT = """
(maxSeconds) => {
  const g = window.game;
  const track = g.track;
  const dt = 1 / 60;
  const input = { throttle: 1, brake: 0, steer: 0, handbrake: false, boost: false };
  const samples = [];
  let maxSpeed = 0;
  let offRoadTicks = 0;
  let impacts = 0;
  const steps = Math.round(maxSeconds / dt);
  for (let i = 0; i < steps; i++) {
    const sim = g.playerSim;
    const hit = track.nearest(sim.x, sim.z);
    // Pure pursuit: aim at a point ahead on the racing line.
    const target = track.positionAt(hit.s + 22, 0);
    const desired = Math.atan2(target.z - sim.z, target.x - sim.x);
    let diff = desired - sim.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    input.steer = Math.max(-1, Math.min(1, diff * 2.2));
    input.throttle = Math.abs(diff) > 0.55 ? 0.45 : 1;
    g.stepOnce(dt, input);
    maxSpeed = Math.max(maxSpeed, sim.speed);
    if (sim.offRoad) offRoadTicks++;
    if (sim.impact > 0.5) impacts++;
    if (i % 600 === 0) {
      samples.push({
        t: +(i * dt).toFixed(1),
        speedKmh: +(sim.speed * 3.6).toFixed(1),
        lap: g.race.lap,
        progress: +g.race.progress.toFixed(1),
        offRoad: sim.offRoad,
      });
    }
    if (g.race.finished) break;
  }
  return {
    samples,
    maxSpeedKmh: +(maxSpeed * 3.6).toFixed(1),
    finalSpeedKmh: +(g.playerSim.speed * 3.6).toFixed(1),
    lap: g.race.lap,
    lapTimes: g.race.lapTimes.map((t) => +t.toFixed(2)),
    bestLap: g.race.bestLap,
    progress: +g.race.progress.toFixed(1),
    trackLength: +track.length.toFixed(1),
    position: g.race.position,
    finished: g.race.finished,
    offRoadPct: +((offRoadTicks / steps) * 100).toFixed(1),
    impactFrames: impacts,
    state: g.state,
    rivals: g.race.rivals.length,
  };
}
"""


def main() -> int:
    failures = []
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=find_chromium(),
            args=[
                "--use-gl=angle",
                "--use-angle=swiftshader",
                "--enable-unsafe-swiftshader",
                "--no-sandbox",
            ],
        )
        page = browser.new_page(viewport={"width": 900, "height": 560})
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on(
            "console",
            lambda m: errors.append(m.text) if m.type == "error" else None,
        )
        page.goto(URL, wait_until="domcontentloaded")
        page.wait_for_function("() => window.game && window.game.playerSim", timeout=30000)
        page.wait_for_timeout(1200)

        # --- race ------------------------------------------------------
        page.click("#btn-race")
        page.wait_for_timeout(600)
        race = page.evaluate(AUTOPILOT, 200)
        print("=== RACE AUTOPILOT ===")
        print(json.dumps(race, indent=2))

        if race["maxSpeedKmh"] < 90:
            failures.append(f"vehicle never reached speed (max {race['maxSpeedKmh']} km/h)")
        if race["lap"] < 1:
            failures.append(f"lap counter never advanced (lap={race['lap']})")
        if race["trackLength"] < 300:
            failures.append("track length looks wrong")
        if not race["lapTimes"]:
            failures.append("no lap time recorded")
        if race["offRoadPct"] > 25:
            failures.append(f"autopilot spent {race['offRoadPct']}% of the time off road")
        if race["rivals"] != 5:
            failures.append("expected 5 AI rivals")

        # --- free roam --------------------------------------------------
        # The race ends on the results screen; return to the main menu.
        if page.locator("#results-screen:not(.hidden)").count():
            page.click("#btn-to-title")
        else:
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)
            page.click("#btn-quit")
        page.wait_for_timeout(500)
        page.click("#btn-freeroam")
        page.wait_for_timeout(600)
        roam = page.evaluate(AUTOPILOT, 60)
        print("\n=== FREE ROAM AUTOPILOT ===")
        print(json.dumps({k: v for k, v in roam.items() if k != "samples"}, indent=2))
        if roam["state"] != "driving":
            failures.append("free roam did not enter driving state")

        # --- every vehicle loads and drives -------------------------------
        if page.locator("#results-screen:not(.hidden)").count():
            page.click("#btn-to-title")
        else:
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)
            page.click("#btn-quit")
        page.wait_for_timeout(400)
        page.click("#btn-garage")
        page.wait_for_timeout(400)
        ids = page.evaluate("() => Array.from(document.querySelectorAll('.vehicle-card')).map(e => e.dataset.id)")
        results = []
        for vid in ids:
            page.click(f'.vehicle-card[data-id="{vid}"]')
            page.wait_for_timeout(250)
            page.click("#btn-drive")
            page.wait_for_timeout(500)
            state = page.evaluate(
                """() => {
                    const g = window.game;
                    g.simulateFor(2.0, {throttle:1, brake:0, steer:0, handbrake:false, boost:false});
                    return { id: g.spec.id, speedKmh: +(g.playerSim.speed*3.6).toFixed(1), state: g.state };
                }"""
            )
            results.append(state)
            if page.locator("#results-screen:not(.hidden)").count():
                page.click("#btn-to-title")
            else:
                page.keyboard.press("Escape")
                page.wait_for_timeout(200)
                page.click("#btn-quit")
            page.wait_for_timeout(300)
            page.click("#btn-garage")
            page.wait_for_timeout(300)
        print("\n=== PER-VEHICLE SMOKE TEST ===")
        for r in results:
            print(f"  {r['id']:<16} {r['speedKmh']:>6} km/h  state={r['state']}")
        slow = [r for r in results if r["speedKmh"] < 20]
        if len(results) != 14:
            failures.append(f"expected 14 vehicles, tested {len(results)}")
        if slow:
            failures.append(f"vehicles that failed to accelerate: {[r['id'] for r in slow]}")

        browser.close()

    if errors:
        print("\n=== JS ERRORS ===")
        for e in errors[:20]:
            print("-", e)
        failures.append(f"{len(errors)} console/page errors")

    print("\n=== VERDICT ===")
    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    print("PASS: all gameplay checks succeeded")
    return 0


if __name__ == "__main__":
    sys.exit(main())
