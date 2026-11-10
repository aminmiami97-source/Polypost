import * as THREE from 'three';
import type { Track } from '../sim/track';
import type { RaceDirector } from '../sim/race';

export interface HudState {
  speedKmh: number;
  boost: number;
  gear: number;
  gears: number;
  lapTime: number;
  bestLap: number | null;
  totalTime: number;
  objective: string;
  standings: { name: string; position: number; gap: string; isPlayer: boolean }[];
}

function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest.toFixed(2).padStart(5, '0')}`;
}

/** DOM heads-up display: speed, timing, boost, standings and the minimap. */
export class Hud {
  private root = document.getElementById('hud') as HTMLDivElement;
  private speedValue = document.getElementById('speed-value') as HTMLSpanElement;
  private boostFill = document.getElementById('boost-fill') as HTMLDivElement;
  private gearStrip = document.getElementById('gear-strip') as HTMLDivElement;
  private lapTimeEl = document.getElementById('lap-time') as HTMLSpanElement;
  private bestTimeEl = document.getElementById('best-time') as HTMLSpanElement;
  private totalTimeEl = document.getElementById('total-time') as HTMLSpanElement;
  private objectiveEl = document.getElementById('objective-value') as HTMLSpanElement;
  private standingsEl = document.getElementById('standings') as HTMLDivElement;
  private centerMsg = document.getElementById('center-msg') as HTMLDivElement;
  private minimap = document.getElementById('minimap') as HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  private gearCells: HTMLDivElement[] = [];
  private gearCount = 0;
  private msgTimer = 0;

  constructor() {
    this.ctx = this.minimap.getContext('2d')!;
  }

  setGearCount(count: number) {
    if (this.gearCount === count) return;
    this.gearCount = count;
    this.gearStrip.innerHTML = '';
    this.gearCells = [];
    for (let i = 0; i < count; i++) {
      const c = document.createElement('div');
      c.className = 'gear-cell';
      this.gearStrip.appendChild(c);
      this.gearCells.push(c);
    }
  }

  show() {
    this.root.classList.remove('hidden');
  }

  hide() {
    this.root.classList.add('hidden');
  }

  update(s: HudState) {
    this.speedValue.textContent = String(Math.round(s.speedKmh));
    this.boostFill.style.width = `${Math.round(s.boost * 100)}%`;
    for (let i = 0; i < this.gearCells.length; i++) {
      this.gearCells[i].classList.toggle('on', i <= s.gear);
    }
    this.lapTimeEl.textContent = formatTime(s.lapTime);
    this.bestTimeEl.textContent = s.bestLap === null ? '--:--.--' : formatTime(s.bestLap);
    this.totalTimeEl.textContent = formatTime(s.totalTime);
    this.objectiveEl.textContent = s.objective;

    this.standingsEl.innerHTML = s.standings
      .map(
        (r) =>
          `<div class="standing-row${r.isPlayer ? ' you' : ''}"><span>${r.position}. ${r.name}</span><span class="sp">${r.gap}</span></div>`,
      )
      .join('');
  }

  flash(html: string, seconds = 1.8) {
    this.centerMsg.innerHTML = html;
    this.centerMsg.classList.remove('hidden');
    this.msgTimer = seconds;
  }

  clearFlash() {
    this.centerMsg.classList.add('hidden');
    this.msgTimer = 0;
  }

  tick(dt: number) {
    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) this.clearFlash();
    }
  }

  drawMinimap(track: Track, player: THREE.Vector3, rivals: THREE.Vector3[], crates?: THREE.Vector3[]) {
    const c = this.ctx;
    const W = this.minimap.width;
    const H = this.minimap.height;
    c.clearRect(0, 0, W, H);

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of track.samples) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    const pad = 14;
    const sx = (W - pad * 2) / (maxX - minX);
    const sz = (H - pad * 2) / (maxZ - minZ);
    const s = Math.min(sx, sz);
    const ox = pad + ((W - pad * 2) - (maxX - minX) * s) / 2;
    const oz = pad + ((H - pad * 2) - (maxZ - minZ) * s) / 2;
    const px = (x: number) => ox + (x - minX) * s;
    const pz = (z: number) => oz + (z - minZ) * s;

    c.lineWidth = 6;
    c.strokeStyle = 'rgba(255,255,255,0.16)';
    c.beginPath();
    track.samples.forEach((p, i) => {
      if (i === 0) c.moveTo(px(p.x), pz(p.z));
      else c.lineTo(px(p.x), pz(p.z));
    });
    c.closePath();
    c.stroke();

    c.lineWidth = 2;
    c.strokeStyle = 'rgba(255,255,255,0.45)';
    c.stroke();

    if (crates) {
      c.fillStyle = '#4fd1c5';
      for (const cr of crates) {
        c.beginPath();
        c.arc(px(cr.x), pz(cr.z), 2.4, 0, Math.PI * 2);
        c.fill();
      }
    }

    c.fillStyle = '#ff5a52';
    for (const r of rivals) {
      c.beginPath();
      c.arc(px(r.x), pz(r.z), 3, 0, Math.PI * 2);
      c.fill();
    }

    c.fillStyle = '#ffb02e';
    c.beginPath();
    c.arc(px(player.x), pz(player.z), 4.2, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.6)';
    c.lineWidth = 1.5;
    c.stroke();
  }
}

/** Shared helper so HUD + results agree on formatting. */
export { formatTime };

export function standingsFromRace(race: RaceDirector, playerName: string) {
  const rows = race.rivals.map((r) => ({
    name: r.name,
    position: 0,
    gap: '',
    isPlayer: false,
    progress: r.progress,
  }));
  rows.push({
    name: playerName,
    position: 0,
    gap: '',
    isPlayer: true,
    progress: race.progress,
  });
  rows.sort((a, b) => b.progress - a.progress);
  const leader = rows[0]?.progress ?? 0;
  return rows.map((r, i) => ({
    name: r.name,
    position: i + 1,
    gap: r.isPlayer ? (i === 0 ? 'LEADER' : `-${Math.round(r.progress - leader)}m`) : `${Math.round(r.progress - leader)}m`,
    isPlayer: r.isPlayer,
  }));
}
