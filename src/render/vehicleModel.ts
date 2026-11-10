import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface WheelHandle {
  node: THREE.Object3D;
  isFront: boolean;
}

export interface VehicleModelOptions {
  /** Paint colour override (hex). */
  paint?: number;
}

/**
 * A loaded vehicle: the GLB scene graph plus handles to the named wheels so
 * the runtime can steer and spin them.
 */
export class VehicleModel {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly wheels: WheelHandle[] = [];
  readonly model: THREE.Object3D;

  private spin = 0;
  private roll = 0;
  private pitch = 0;

  private constructor(model: THREE.Object3D) {
    this.model = model;
    this.root.add(this.body);
    this.body.add(model);

    model.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = true;
        obj.receiveShadow = false;
      }
      const name = obj.name.toLowerCase();
      if (name.startsWith('wheel_')) {
        this.wheels.push({ node: obj, isFront: name.includes('_f') && !name.includes('_r') });
      }
    });
  }

  static async load(url: string, opts: VehicleModelOptions = {}): Promise<VehicleModel> {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(url);
    const vm = new VehicleModel(gltf.scene);
    if (opts.paint !== undefined) vm.setPaint(opts.paint);
    return vm;
  }

  setPaint(hex: number) {
    this.model.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        if (m && (m as THREE.MeshStandardMaterial).name === 'paint') {
          (m as THREE.MeshStandardMaterial).color.set(hex);
          (m as THREE.MeshStandardMaterial).color.convertSRGBToLinear();
        }
      }
    });
  }

  /**
   * @param speed    forward speed in m/s
   * @param steerAngle visual steering angle in radians
   * @param lateralG  lateral acceleration (drives body roll)
   * @param longG    longitudinal acceleration (drives body pitch)
   */
  update(dt: number, speed: number, steerAngle: number, lateralG: number, longG: number, wheelRadius = 0.34) {
    this.spin -= (speed / wheelRadius) * dt;
    for (const w of this.wheels) {
      w.node.rotation.set(0, w.isFront ? steerAngle : 0, this.spin);
    }
    const targetRoll = THREE.MathUtils.clamp(-lateralG * 0.012, -0.09, 0.09);
    const targetPitch = THREE.MathUtils.clamp(-longG * 0.008, -0.05, 0.05);
    this.roll += (targetRoll - this.roll) * Math.min(1, 7 * dt);
    this.pitch += (targetPitch - this.pitch) * Math.min(1, 7 * dt);
    this.body.rotation.z = this.roll;
    this.body.rotation.x = this.pitch;
  }

  dispose() {
    this.model.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => m?.dispose());
      }
    });
  }
}
