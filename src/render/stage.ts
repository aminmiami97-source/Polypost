import * as THREE from 'three';

export interface StageOptions {
  canvas: HTMLCanvasElement;
}

/**
 * Renderer, scene, lighting and camera rig for the game.
 */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;

  private resizeHandler: () => void;
  private frameTimes: number[] = [];
  private qualityWindow = 0;
  private qualityLevel = 2;
  private lowFx = new URLSearchParams(location.search).has('lowfx');

  constructor(opts: StageOptions) {
    this.renderer = new THREE.WebGLRenderer({
      canvas: opts.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(this.lowFx ? 0.5 : Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = !this.lowFx;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene.background = new THREE.Color(0x9fd0e8);
    this.scene.fog = new THREE.Fog(0x9fd0e8, 240, 720);
    this.addSky();

    this.camera = new THREE.PerspectiveCamera(
      62,
      window.innerWidth / window.innerHeight,
      0.1,
      2000,
    );
    this.camera.position.set(0, 12, -22);

    // --- lighting ------------------------------------------------------
    const hemi = new THREE.HemisphereLight(0xcfe9ff, 0x6a8a54, 1.05);
    this.scene.add(hemi);

    this.sun = new THREE.DirectionalLight(0xfff0d2, 2.1);
    this.sun.position.set(90, 120, 60);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 420;
    const d = 85;
    this.sun.shadow.camera.left = -d;
    this.sun.shadow.camera.right = d;
    this.sun.shadow.camera.top = d;
    this.sun.shadow.camera.bottom = -d;
    this.sun.shadow.bias = -0.0008;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.resizeHandler = () => this.resize();
    window.addEventListener('resize', this.resizeHandler);
  }

  /** A simple gradient sky dome so the horizon is not a flat colour. */
  private addSky() {
    const geo = new THREE.SphereGeometry(900, 24, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x4d8fd0) },
        mid: { value: new THREE.Color(0xa9d8ee) },
        bottom: { value: new THREE.Color(0xf6e3c8) },
      },
      vertexShader: `
        varying float vH;
        void main() {
          vH = normalize(position).y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 top; uniform vec3 mid; uniform vec3 bottom;
        varying float vH;
        void main() {
          float h = clamp(vH, -1.0, 1.0);
          vec3 col = h > 0.0
            ? mix(mid, top, pow(h, 0.65))
            : mix(mid, bottom, pow(-h, 0.5));
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const sky = new THREE.Mesh(geo, mat);
    sky.frustumCulled = false;
    this.scene.add(sky);
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  /** Keeps the shadow frustum centred on the player. */
  focusShadow(x: number, z: number) {
    this.sun.position.set(x + 90, 120, z + 60);
    this.sun.target.position.set(x, 0, z);
    this.sun.target.updateMatrixWorld();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Adaptive quality: drops shadows / resolution when the frame rate sags so
   * the simulation keeps a steady pace on weak GPUs.
   */
  updateQuality(dt: number) {
    this.frameTimes.push(dt);
    this.qualityWindow += dt;
    if (this.qualityWindow < 0.5) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    this.qualityWindow = 0;
    const fps = 1 / Math.max(avg, 0.0001);
    if (fps < 26 && this.qualityLevel > 0) this.setQuality(this.qualityLevel - 1);
    else if (fps > 56 && this.qualityLevel < 2) this.setQuality(this.qualityLevel + 1);
  }

  private setQuality(level: number) {
    this.qualityLevel = level;
    if (level >= 2) {
      this.renderer.setPixelRatio(this.lowFx ? 0.5 : Math.min(window.devicePixelRatio, 2));
      this.renderer.shadowMap.enabled = !this.lowFx;
      this.sun.shadow.mapSize.set(1024, 1024);
    } else if (level === 1) {
      this.renderer.setPixelRatio(1);
      this.renderer.shadowMap.enabled = true;
      this.sun.shadow.mapSize.set(512, 512);
    } else {
      this.renderer.setPixelRatio(0.75);
      this.renderer.shadowMap.enabled = false;
    }
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    this.renderer.shadowMap.needsUpdate = true;
    this.resize();
  }

  dispose() {
    window.removeEventListener('resize', this.resizeHandler);
    this.renderer.dispose();
  }
}
