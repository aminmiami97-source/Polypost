import type { VehicleInput } from './sim/vehicle';

/**
 * Keyboard + touch input mapped onto the arcade vehicle controls.
 */
export class InputController {
  private keys = new Set<string>();
  private touch = { left: false, right: false, gas: false, brake: false };
  private listeners: { onCamera: () => void; onReset: () => void; onPause: () => void } = {
    onCamera: () => {},
    onReset: () => {},
    onPause: () => {},
  };

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyC') this.listeners.onCamera();
      if (e.code === 'KeyR') this.listeners.onReset();
      if (e.code === 'Escape') this.listeners.onPause();
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    if (window.matchMedia('(pointer: coarse)').matches) this.buildTouchControls();
  }

  on(handlers: { onCamera: () => void; onReset: () => void; onPause: () => void }) {
    this.listeners = handlers;
  }

  get current(): VehicleInput {
    const left = this.keys.has('KeyA') || this.keys.has('ArrowLeft') || this.touch.left;
    const right = this.keys.has('KeyD') || this.keys.has('ArrowRight') || this.touch.right;
    const gas = this.keys.has('KeyW') || this.keys.has('ArrowUp') || this.touch.gas;
    const brake = this.keys.has('KeyS') || this.keys.has('ArrowDown') || this.touch.brake;
    const space = this.keys.has('Space');

    let steer = 0;
    if (left) steer -= 1;
    if (right) steer += 1;

    return {
      throttle: gas ? 1 : 0,
      brake: brake ? 1 : 0,
      steer,
      handbrake: space,
      boost: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
    };
  }

  clear() {
    this.keys.clear();
    this.touch.left = this.touch.right = this.touch.gas = this.touch.brake = false;
  }

  private buildTouchControls() {
    const pad = document.createElement('div');
    pad.style.cssText = `
      position:fixed; inset:auto 0 0 0; z-index:15; display:flex; justify-content:space-between;
      padding:18px; pointer-events:none;`;
    const mk = (label: string, on: () => void, off: () => void) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = `
        pointer-events:auto; width:74px; height:74px; border-radius:50%; font-size:22px;
        border:1px solid rgba(255,255,255,.25); background:rgba(18,23,31,.6); color:#eef2f7;`;
      const down = (e: Event) => {
        e.preventDefault();
        on();
      };
      const up = (e: Event) => {
        e.preventDefault();
        off();
      };
      b.addEventListener('touchstart', down, { passive: false });
      b.addEventListener('touchend', up, { passive: false });
      b.addEventListener('touchcancel', up, { passive: false });
      return b;
    };
    const left = mk('◀', () => (this.touch.left = true), () => (this.touch.left = false));
    const right = mk('▶', () => (this.touch.right = true), () => (this.touch.right = false));
    const gas = mk('▲', () => (this.touch.gas = true), () => (this.touch.gas = false));
    const brake = mk('▼', () => (this.touch.brake = true), () => (this.touch.brake = false));
    const l = document.createElement('div');
    l.style.cssText = 'display:flex; gap:12px; pointer-events:none;';
    l.append(left, right);
    const r = document.createElement('div');
    r.style.cssText = 'display:flex; gap:12px; pointer-events:none;';
    r.append(brake, gas);
    pad.append(l, r);
    document.body.appendChild(pad);
  }
}
