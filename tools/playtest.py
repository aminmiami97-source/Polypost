"""Headless playtest for Low Poly Drive.

Loads the built game, drives with synthetic key input, and reports console
errors, gameplay state and screenshots.
"""
import json
import os
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4173/"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/workspace/lowpoly-drive/playtest"


def find_chromium() -> str | None:
    """Locate a full Chromium build (the headless shell is not installed)."""
    roots = [
        os.environ.get("PLAYWRIGHT_BROWSERS_PATH", ""),
        "/root/.cache/ms-playwright",
        str(Path.home() / ".cache/ms-playwright"),
    ]
    for root in roots:
        if not root or not os.path.isdir(root):
            continue
        for entry in sorted(os.listdir(root)):
            if entry.startswith("chromium-"):
                for rel in ("chrome-linux/chrome", "chrome-linux/headless_shell"):
                    cand = os.path.join(root, entry, rel)
                    if os.path.isfile(cand):
                        return cand
    return None

errors = []
logs = []


def main() -> int:
    with sync_playwright() as p:
        exe = find_chromium()
        browser = p.chromium.launch(
            executable_path=exe,
            args=[
                "--use-gl=angle",
                "--use-angle=swiftshader",
                "--enable-unsafe-swiftshader",
                "--ignore-gpu-blocklist",
                "--no-sandbox",
            ]
        )
        page = browser.new_page(viewport={"width": 1440, "height": 860})
        page.on("console", lambda m: (logs.append(f"{m.type}: {m.text}"),
                                      errors.append(m.text) if m.type == "error" else None))
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

        page.goto(URL, wait_until="networkidle")
        page.wait_for_timeout(2500)
        page.screenshot(path=f"{OUT}-1-title.png")
        print("title screen captured")

        # --- garage ------------------------------------------------------
        page.click("#btn-garage")
        page.wait_for_timeout(1800)
        page.screenshot(path=f"{OUT}-2-garage.png")
        cards = page.locator(".vehicle-card").count()
        print(f"garage cards: {cards}")

        # select the moped to check a second model loads
        page.click('.vehicle-card[data-id="racer_125"]')
        page.wait_for_timeout(1500)
        page.screenshot(path=f"{OUT}-3-garage-moped.png")

        # back to a car, then race
        page.click('.vehicle-card[data-id="falcon_coupe"]')
        page.wait_for_timeout(600)
        page.click("#btn-back-title")
        page.wait_for_timeout(400)
        page.click("#btn-race")
        page.wait_for_timeout(1500)
        page.screenshot(path=f"{OUT}-4-race-start.png")

        # --- drive -------------------------------------------------------
        page.keyboard.down("ArrowUp")
        page.wait_for_timeout(3500)
        speed = page.inner_text("#speed-value")
        print(f"speed after 3.5s throttle: {speed}")
        page.screenshot(path=f"{OUT}-5-driving.png")

        page.keyboard.down("ArrowRight")
        page.wait_for_timeout(1200)
        page.keyboard.up("ArrowRight")
        page.wait_for_timeout(1500)
        page.screenshot(path=f"{OUT}-6-corner.png")

        lap = page.inner_text("#lap-time")
        obj = page.inner_text("#objective-value")
        total = page.inner_text("#total-time")
        print(f"lap-time={lap} objective={obj} total={total}")

        # boost
        page.keyboard.down("ShiftLeft")
        page.wait_for_timeout(1200)
        page.screenshot(path=f"{OUT}-7-boost.png")
        page.keyboard.up("ShiftLeft")

        # pause menu
        page.keyboard.press("Escape")
        page.wait_for_timeout(600)
        page.screenshot(path=f"{OUT}-8-pause.png")
        page.click("#btn-resume")
        page.wait_for_timeout(400)

        # camera toggle
        page.keyboard.press("KeyC")
        page.wait_for_timeout(900)
        page.screenshot(path=f"{OUT}-9-hood-cam.png")

        page.keyboard.up("ArrowUp")

        # --- free roam ----------------------------------------------------
        page.keyboard.press("Escape")
        page.wait_for_timeout(400)
        page.click("#btn-quit")
        page.wait_for_timeout(500)
        page.click("#btn-freeroam")
        page.wait_for_timeout(2000)
        page.screenshot(path=f"{OUT}-10-freeroam.png")

        state = page.evaluate(
            """() => {
              const g = window.game;
              const sim = g.playerSim;
              return {
                speed: sim.speed,
                x: sim.x, z: sim.z,
                progress: g.race.progress,
                crates: g.race.collectedCrates,
                rivals: g.race.rivals.length,
                drawCalls: g.stage.renderer.info.render.calls,
                triangles: g.stage.renderer.info.render.triangles,
                geometries: g.stage.renderer.info.memory.geometries,
              };
            }"""
        )
        print("runtime state:", json.dumps(state, indent=2))

        browser.close()

    if errors:
        print("\n=== CONSOLE ERRORS ===")
        for e in errors[:25]:
            print("-", e)
        return 1
    print("\nNo console errors.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
