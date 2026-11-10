import { VEHICLES, type VehicleSpec } from '../game/catalog';

type ScreenName = 'title' | 'garage' | 'results' | 'pause';

export interface ScreenHandlers {
  onRace: () => void;
  onFreeRoam: () => void;
  onOpenGarage: () => void;
  onSelectVehicle: (spec: VehicleSpec) => void;
  onDrive: () => void;
  onBackToTitle: () => void;
  onRetry: () => void;
  onResultsGarage: () => void;
  onResultsTitle: () => void;
  onResume: () => void;
  onRestart: () => void;
  onQuit: () => void;
}

/** Owns the DOM overlays: title, garage, results and pause. */
export class Screens {
  private screens: Record<ScreenName, HTMLElement> = {
    title: document.getElementById('title-screen') as HTMLElement,
    garage: document.getElementById('garage-screen') as HTMLElement,
    results: document.getElementById('results-screen') as HTMLElement,
    pause: document.getElementById('pause-screen') as HTMLElement,
  };

  private grid = document.getElementById('garage-grid') as HTMLDivElement;
  private specName = document.getElementById('spec-name') as HTMLElement;
  private specBlurb = document.getElementById('spec-blurb') as HTMLElement;
  private specBars = document.getElementById('spec-bars') as HTMLDivElement;
  private garageBlurb = document.getElementById('garage-blurb') as HTMLElement;
  private loadingNote = document.getElementById('loading-note') as HTMLElement;
  private resultsTitle = document.getElementById('results-title') as HTMLElement;
  private resultsBody = document.getElementById('results-body') as HTMLDivElement;

  selected: VehicleSpec = VEHICLES[0];

  constructor(private handlers: ScreenHandlers) {
    this.buildGrid();
    this.wire();
    this.select(VEHICLES[0]);
  }

  private wire() {
    const on = (id: string, fn: () => void) =>
      (document.getElementById(id) as HTMLButtonElement).addEventListener('click', fn);
    on('btn-race', this.handlers.onRace);
    on('btn-freeroam', this.handlers.onFreeRoam);
    on('btn-garage', this.handlers.onOpenGarage);
    on('btn-drive', this.handlers.onDrive);
    on('btn-back-title', this.handlers.onBackToTitle);
    on('btn-retry', this.handlers.onRetry);
    on('btn-to-garage', this.handlers.onResultsGarage);
    on('btn-to-title', this.handlers.onResultsTitle);
    on('btn-resume', this.handlers.onResume);
    on('btn-restart', this.handlers.onRestart);
    on('btn-quit', this.handlers.onQuit);
  }

  private buildGrid() {
    this.grid.innerHTML = '';
    for (const v of VEHICLES) {
      const card = document.createElement('div');
      card.className = 'vehicle-card';
      card.dataset.id = v.id;
      card.innerHTML = `
        <div class="swatch" style="background:${v.color}"></div>
        <div class="vc-name">${v.name}</div>
        <div class="vc-kind">${v.kind === 'car' ? 'Car' : 'Moped'}<span class="vc-top">${Math.round(v.topSpeed * 3.6)} km/h</span></div>`;
      card.addEventListener('click', () => {
        this.select(v);
        this.handlers.onSelectVehicle(v);
      });
      this.grid.appendChild(card);
    }
  }

  select(spec: VehicleSpec) {
    this.selected = spec;
    this.grid.querySelectorAll('.vehicle-card').forEach((el) => {
      el.classList.toggle('selected', (el as HTMLElement).dataset.id === spec.id);
    });
    this.specName.textContent = spec.name;
    this.specBlurb.textContent = spec.blurb;
    this.garageBlurb.textContent =
      spec.kind === 'car' ? 'Street-legal four-wheeler.' : 'Two-wheeled city runabout.';

    const bars: [string, number, string][] = [
      ['Top speed', spec.topSpeed / 60, `${Math.round(spec.topSpeed * 3.6)} km/h`],
      ['Acceleration', spec.accel / 18, `${spec.accel.toFixed(1)} m/s²`],
      ['Grip', spec.grip, `${Math.round(spec.grip * 100)}%`],
      ['Handling', spec.steering / 2.8, `${spec.steering.toFixed(2)} rad/s`],
    ];
    this.specBars.innerHTML = bars
      .map(
        ([label, frac, value]) => `
        <div class="spec-row">
          <div class="sr-head"><span>${label}</span><b>${value}</b></div>
          <div class="spec-track"><div class="spec-fill" style="width:${Math.min(100, Math.round(frac * 100))}%"></div></div>
        </div>`,
      )
      .join('');
  }

  show(name: ScreenName) {
    for (const [key, el] of Object.entries(this.screens)) {
      el.classList.toggle('hidden', key !== name);
    }
  }

  hideAll() {
    for (const el of Object.values(this.screens)) el.classList.add('hidden');
  }

  setLoading(text: string | null) {
    this.loadingNote.textContent = text ?? '';
    this.loadingNote.style.display = text ? 'block' : 'none';
  }

  showResults(title: string, bodyHtml: string) {
    this.resultsTitle.textContent = title;
    this.resultsBody.innerHTML = bodyHtml;
    this.show('results');
  }
}
