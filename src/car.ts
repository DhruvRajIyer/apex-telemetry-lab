import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import {
  heatColorHex,
  heatIntensity,
  summarizeLayer,
  type Layer,
  type LayerSummary,
  type Sample,
} from "./telemetry";

export type { Layer } from "./telemetry";

export class CarView {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  private controls: OrbitControls;
  private car = new THREE.Group();
  private rotors: THREE.MeshBasicMaterial[] = [];
  private tyreOverlays: THREE.Mesh[] = [];
  private thermalHalos: THREE.MeshBasicMaterial[] = [];
  private loadHalos: THREE.MeshBasicMaterial[] = [];
  private wheels: THREE.Group[] = [];
  private rims: THREE.Group[] = [];
  private ranges: Partial<Record<Layer, LayerSummary>> = {};
  private aero = new THREE.MeshBasicMaterial({
    color: "#00bfff",
    toneMapped: false,
  });
  private aeroMeshes: THREE.Mesh[] = [];
  private observer: ResizeObserver;
  private environment: THREE.WebGLRenderTarget;
  private layer: Layer = "brakes";
  private needsRender = true;
  private lastSample: Sample | null = null;
  private bodyPaint!: THREE.MeshStandardMaterial;
  private accentPaint!: THREE.MeshStandardMaterial;

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.setAttribute(
      "aria-label",
      "Interactive 3D open-wheel car. Drag to orbit, scroll to zoom, or use the camera buttons.",
    );
    this.renderer.domElement.setAttribute("role", "img");
    host.append(this.renderer.domElement);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, 0.04);
    this.scene.environment = this.environment.texture;
    room.dispose();
    pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight("#ebeee2", "#343b35", 2));
    const key = new THREE.DirectionalLight("#fff8e9", 5);
    key.position.set(3, 8, -3);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, {
      left: -5,
      right: 5,
      top: 5,
      bottom: -5,
      near: 0.1,
      far: 20,
    });
    key.shadow.normalBias = 0.025;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight("#d2ee86", 3);
    rim.position.set(-4, 3, 4);
    this.scene.add(rim);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.ShadowMaterial({ color: "#000000", opacity: 0.4 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.025;
    ground.receiveShadow = true;
    this.scene.add(ground);
    const grid = new THREE.GridHelper(16, 32, "#3b4038", "#2b3029");
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.45;
    grid.position.y = -0.02;
    this.scene.add(grid, this.car);
    this.buildCar();
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.addEventListener("change", () => { this.needsRender = true; });
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 17;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.03;
    this.controls.target.set(0, 0.45, 0);
    this.setCamera("orbit");
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
  }

  private resize() {
    this.needsRender = true;
    const { width, height } = this.host.getBoundingClientRect();
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  setCamera(view: "orbit" | "top" | "side") {
    const distance = this.host.clientWidth < 550 ? 1 : 0.9;
    const positions = {
      orbit: [7.3, 5.4, -8.1],
      top: [0, 11.5, -0.01],
      side: [11, 2.4, 0],
    };
    this.camera.position.fromArray(positions[view]).multiplyScalar(distance);
    this.controls.target.set(0, 0.45, 0);
    this.controls.update();
  }

  setTeamColor(color: string) {
    this.needsRender = true;
    this.bodyPaint.color.set(color);
    this.accentPaint.color.set("#eff0e7");
    this.host.dataset.teamColor = color;
  }

  clearTelemetry() {
    this.ranges = {};
    this.rotors.forEach((material) => material.color.set("#626b6a"));
    [...this.thermalHalos, ...this.loadHalos].forEach((material) => {
      material.opacity = 0;
    });
    [...this.tyreOverlays, ...this.aeroMeshes].forEach((mesh) => {
      mesh.visible = false;
    });
    this.wheels.forEach((wheel) => {
      wheel.rotation.y = 0;
    });
    this.setTeamColor("#e5e7dd");
    delete this.host.dataset.teamColor;
  }

  setTelemetry(samples: Sample[]) {
    this.needsRender = true;
    for (const layer of ["brakes", "loads", "aero"] as const)
      this.ranges[layer] = summarizeLayer(samples, layer);
  }

  setLayer(layer: Layer) {
    this.needsRender = true;
    this.layer = layer;
    this.aeroMeshes.forEach((mesh) => {
      mesh.visible = layer === "aero";
    });
    this.tyreOverlays.forEach((mesh) => {
      mesh.visible = layer === "loads";
    });
  }

  private buildCar() {
    const pearl = (this.bodyPaint = new THREE.MeshStandardMaterial({
      color: "#e5e7dd",
      metalness: 0.48,
      roughness: 0.3,
    }));
    const lime = (this.accentPaint = new THREE.MeshStandardMaterial({
      color: "#cce879",
      metalness: 0.35,
      roughness: 0.32,
    }));
    const carbon = new THREE.MeshStandardMaterial({
      color: "#151a1a",
      metalness: 0.45,
      roughness: 0.5,
    });
    const silver = new THREE.MeshStandardMaterial({
      color: "#67706e",
      metalness: 0.85,
      roughness: 0.27,
    });
    const black = new THREE.MeshStandardMaterial({
      color: "#080c0c",
      roughness: 0.8,
    });
    const add = (
      geometry: THREE.BufferGeometry,
      material: THREE.Material,
      x: number,
      y: number,
      z: number,
      parent: THREE.Object3D = this.car,
    ) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const box = (
      w: number,
      h: number,
      d: number,
      x: number,
      y: number,
      z: number,
      mat: THREE.Material = carbon,
      parent: THREE.Object3D = this.car,
    ) => add(new THREE.BoxGeometry(w, h, d), mat, x, y, z, parent);
    const rod = (
      a: number[],
      b: number[],
      radius: number,
      mat: THREE.Material = carbon,
    ) => {
      const start = new THREE.Vector3(...a),
        end = new THREE.Vector3(...b);
      const delta = end.clone().sub(start);
      const mesh = add(
        new THREE.CylinderGeometry(radius, radius, delta.length(), 10),
        mat,
        0,
        0,
        0,
      );
      mesh.position.copy(start.add(end).multiplyScalar(0.5));
      mesh.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        delta.normalize(),
      );
      return mesh;
    };
    const hull = (sections: number[][], mat: THREE.Material, offsetX = 0) => {
      const vertices: number[] = [],
        indices: number[] = [];
      const ring = [
        [-0.7, 0],
        [0.7, 0],
        [1, 0.25],
        [0.78, 0.8],
        [0.45, 1],
        [-0.45, 1],
        [-0.78, 0.8],
        [-1, 0.25],
      ];
      sections.forEach(([z, width, bottom, height]) =>
        ring.forEach(([x, y]) =>
          vertices.push(x * width + offsetX, bottom + y * height, z),
        ),
      );
      for (let j = 0; j < sections.length - 1; j++) {
        for (let k = 0; k < 8; k++) {
          const a = j * 8 + k,
            b = j * 8 + ((k + 1) % 8),
            c = b + 8,
            d = a + 8;
          indices.push(a, b, c, a, c, d);
        }
      }
      for (let k = 1; k < 7; k++) {
        indices.push(0, k + 1, k);
        const end = (sections.length - 1) * 8;
        indices.push(end, end + k, end + k + 1);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(vertices, 3),
      );
      geo.setIndex(indices);
      geo.computeVertexNormals();
      return add(geo, mat, 0, 0, 0);
    };
    hull(
      [
        [-1.2, 0.66, 0.12, 0.07],
        [-0.5, 0.98, 0.12, 0.07],
        [1.7, 0.82, 0.12, 0.07],
        [2, 0.55, 0.16, 0.16],
      ],
      carbon,
    );
    hull(
      [
        [-2.65, 0.1, 0.28, 0.12],
        [-2.2, 0.18, 0.32, 0.16],
        [-1.3, 0.3, 0.32, 0.3],
        [-0.7, 0.36, 0.25, 0.44],
        [0.65, 0.35, 0.25, 0.43],
        [1.7, 0.13, 0.24, 0.18],
      ],
      pearl,
    );
    hull(
      [
        [-2.64, 0.035, 0.4, 0.013],
        [-1.25, 0.075, 0.63, 0.012],
        [-0.76, 0.09, 0.68, 0.014],
      ],
      lime,
    );
    for (const side of [-1, 1]) {
      hull(
        [
          [-0.6, 0.26, 0.22, 0.33],
          [-0.28, 0.38, 0.2, 0.42],
          [0.5, 0.3, 0.2, 0.3],
          [1.35, 0.08, 0.2, 0.16],
        ],
        pearl,
        side * 0.53,
      );
      box(0.41, 0.16, 0.045, side * 0.56, 0.45, -0.615, black);
      box(0.04, 0.018, 1.28, side * 0.87, 0.21, 0.22, lime);
      box(0.12, 0.1, 0.25, side * 0.63, 0.74, -0.55, pearl);
      rod([side * 0.28, 0.66, -0.55], [side * 0.63, 0.74, -0.55], 0.019);
      for (const z of [-1.57, 1.48]) {
        rod([side * 0.26, 0.3, z - 0.4], [side * 1.05, 0.4, z], 0.028);
        rod([side * 0.26, 0.3, z + 0.4], [side * 1.05, 0.4, z], 0.028);
        rod([side * 0.26, 0.56, z - 0.25], [side * 1.03, 0.45, z], 0.023);
        rod([side * 0.26, 0.56, z + 0.3], [side * 1.03, 0.45, z], 0.023);
      }
      box(0.055, 0.29, 0.64, side * 1.2, 0.26, -2.46, pearl);
      box(0.055, 0.54, 0.67, side * 0.91, 0.98, 2.1, pearl);
      box(0.07, 0.13, 0.67, side * 0.91, 1.22, 2.1, lime);
      rod([side * 0.18, 0.3, 1.65], [side * 0.25, 1.04, 2.12], 0.045);
    }
    for (let i = 0; i < 4; i++) {
      const wing = box(
        2.38,
        0.045,
        0.145,
        0,
        0.16 + i * 0.045,
        -2.72 + i * 0.16,
        i === 3 ? lime : carbon,
      );
      wing.rotation.x = -0.14;
    }
    box(1.78, 0.055, 0.44, 0, 1.12, 2.1, carbon).rotation.x = 0.12;
    box(1.78, 0.055, 0.19, 0, 1.23, 2.34, lime).rotation.x = 0.28;
    hull(
      [
        [0.25, 0.2, 0.52, 0.53],
        [0.56, 0.23, 0.4, 0.64],
        [1.12, 0.13, 0.35, 0.4],
        [1.7, 0.05, 0.26, 0.16],
      ],
      pearl,
    );
    box(0.035, 0.3, 0.85, 0, 0.78, 0.95, lime);
    const cockpit = add(
      new THREE.SphereGeometry(1, 32, 16),
      black,
      0,
      0.67,
      -0.23,
    );
    cockpit.scale.set(0.265, 0.07, 0.44);
    const helmet = add(
      new THREE.SphereGeometry(0.14, 24, 16),
      lime,
      0,
      0.79,
      0.03,
    );
    helmet.scale.y = 1.08;
    const visor = add(
      new THREE.SphereGeometry(
        0.143,
        24,
        16,
        Math.PI * 0.6,
        Math.PI * 0.8,
        Math.PI * 0.36,
        Math.PI * 0.2,
      ),
      black,
      0,
      0.79,
      0.03,
    );
    visor.rotation.y = Math.PI;
    const haloCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.3, 0.86, 0.18),
      new THREE.Vector3(-0.33, 0.98, -0.24),
      new THREE.Vector3(0, 0.94, -0.64),
      new THREE.Vector3(0.33, 0.98, -0.24),
      new THREE.Vector3(0.3, 0.86, 0.18),
    ]);
    add(
      new THREE.TubeGeometry(haloCurve, 40, 0.033, 8, false),
      carbon,
      0,
      0,
      0,
    );
    rod([0, 0.68, -0.67], [0, 0.94, -0.64], 0.027);
    const wheelPositions = [
      [-1.08, -1.57],
      [1.08, -1.57],
      [-1.08, 1.48],
      [1.08, 1.48],
    ];
    wheelPositions.forEach(([x, z], i) => {
      const wheel = new THREE.Group();
      wheel.position.set(x, 0.43, z);
      this.car.add(wheel);
      this.wheels.push(wheel);
      const tyre = new THREE.MeshStandardMaterial({
        color: "#181d1c",
        roughness: 0.83,
        metalness: 0.02,
        emissiveIntensity: 0,
      });
      const width = i < 2 ? 0.37 : 0.43;
      const loadOverlay = add(
        new THREE.CylinderGeometry(0.435, 0.435, width + 0.008, 48),
        new THREE.MeshBasicMaterial({
          color: "#00bfff",
          transparent: true,
          opacity: 0.82,
          toneMapped: false,
        }),
        0,
        0,
        0,
        wheel,
      );
      loadOverlay.rotation.z = Math.PI / 2;
      this.tyreOverlays.push(loadOverlay);
      const tyreMesh = add(
        new THREE.CylinderGeometry(0.43, 0.43, width, 48),
        tyre,
        0,
        0,
        0,
        wheel,
      );
      tyreMesh.rotation.z = Math.PI / 2;
      const spin = new THREE.Group();
      wheel.add(spin);
      this.rims.push(spin);
      const rotor = new THREE.MeshBasicMaterial({
        color: "#626b6a",
        toneMapped: false,
      });
      this.rotors.push(rotor);
      const thermal = new THREE.MeshBasicMaterial({
        color: "#00bfff",
        transparent: true,
        opacity: 0,
        toneMapped: false,
        depthWrite: false,
      });
      this.thermalHalos.push(thermal);
      for (const face of [-1, 1]) {
        const heatRing = add(
          new THREE.TorusGeometry(0.445, 0.028, 12, 48),
          thermal,
          face * (width / 2 + 0.02),
          0,
          0,
          wheel,
        );
        heatRing.rotation.y = Math.PI / 2;
        const rimMesh = add(
          new THREE.CylinderGeometry(0.285, 0.285, 0.018, 40),
          silver,
          face * (width / 2 + 0.006),
          0,
          0,
          spin,
        );
        rimMesh.rotation.z = Math.PI / 2;
        const disc = add(
          new THREE.TorusGeometry(0.205, 0.073, 12, 48),
          rotor,
          face * (width / 2 + 0.02),
          0,
          0,
          spin,
        );
        disc.rotation.y = Math.PI / 2;
        const stripe = add(
          new THREE.TorusGeometry(0.352, 0.009, 6, 48),
          lime,
          face * (width / 2 + 0.012),
          0,
          0,
          wheel,
        );
        stripe.rotation.y = Math.PI / 2;
        for (let spoke = 0; spoke < 6; spoke++) {
          const angle = (spoke / 6) * Math.PI * 2;
          const bar = box(
            0.018,
            0.48,
            0.032,
            face * (width / 2 + 0.04),
            0,
            0,
            carbon,
            spin,
          );
          bar.rotation.x = angle;
        }
        const hub = add(
          new THREE.CylinderGeometry(0.075, 0.075, 0.03, 16),
          carbon,
          face * (width / 2 + 0.06),
          0,
          0,
          spin,
        );
        hub.rotation.z = Math.PI / 2;
      }
      const loadMat = new THREE.MeshBasicMaterial({
        color: "#ff7338",
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
      });
      this.loadHalos.push(loadMat);
      const halo = add(
        new THREE.RingGeometry(0.28, 0.52, 48),
        loadMat,
        x,
        0.008,
        z,
      );
      halo.rotation.x = -Math.PI / 2;
      halo.scale.x = 0.75;
    });
    for (const side of [-1, 1]) {
      this.aeroMeshes.push(
        box(0.15, 0.024, 2.25, side * 0.88, 0.23, 0.42, this.aero),
      );
      this.aeroMeshes.push(
        box(0.68, 0.025, 0.4, side * 0.64, 0.385, -2.45, this.aero),
      );
      for (let i = 0; i < 4; i++) {
        const vane = box(
          0.025,
          0.15,
          0.6,
          side * (0.3 + i * 0.15),
          0.22,
          1.78,
          carbon,
        );
        vane.rotation.x = -0.16;
      }
    }
    this.aeroMeshes.push(box(1.7, 0.025, 0.39, 0, 1.16, 2.1, this.aero));
    this.aeroMeshes.push(box(1.86, 0.025, 2.5, 0, 0.215, 0.32, this.aero));
    for (const z of [-1.4, 0, 1.4]) {
      this.aeroMeshes.push(box(0.025, 0.55, 0.025, 0, 1.85, z, this.aero));
      const arrow = add(
        new THREE.ConeGeometry(0.1, 0.22, 12),
        this.aero,
        0,
        1.48,
        z,
      );
      arrow.rotation.x = Math.PI;
      this.aeroMeshes.push(arrow);
    }
    this.setLayer(this.layer);
  }

  update(sample: Sample | null, dt: number) {
    this.controls.update();
    if (!this.needsRender && sample === this.lastSample && dt === 0) return;
    this.lastSample = sample;
    if (sample) {
      this.rotors.forEach((mat, i) => {
        const brakeLevel = heatIntensity(
          sample.brakeTemp[i],
          this.ranges.brakes ?? { min: 150, max: 600 },
        );
        const loadLevel = heatIntensity(
          sample.loads[i],
          this.ranges.loads ?? { min: 0, max: 12000 },
        );
        const brakeColor = heatColorHex(brakeLevel),
          loadColor = heatColorHex(loadLevel);
        mat.color.set(this.layer === "brakes" ? brakeColor : "#626b6a");
        this.thermalHalos[i].color.set(brakeColor);
        this.thermalHalos[i].opacity =
          this.layer === "brakes" ? 0.5 + brakeLevel * 0.5 : 0;
        (this.tyreOverlays[i].material as THREE.MeshBasicMaterial).color.set(
          loadColor,
        );
        this.loadHalos[i].color.set(
          this.layer === "brakes" ? brakeColor : loadColor,
        );
        this.loadHalos[i].opacity =
          this.layer === "loads"
            ? 0.65
            : this.layer === "brakes"
              ? 0.2 + brakeLevel * 0.35
              : 0;
        this.rims[i].rotation.x += (sample.speed / 3.6 / 0.43) * dt;
        if (i < 2) this.wheels[i].rotation.y = sample.latG * 0.035;
      });
      this.aero.color.set(
        heatColorHex(
          heatIntensity(
            sample.downforce,
            this.ranges.aero ?? { min: 0, max: 15000 },
          ),
        ),
      );
    }
    this.renderer.render(this.scene, this.camera);
    this.needsRender = false;
  }

  dispose() {
    this.observer.disconnect();
    this.controls.dispose();
    this.environment.dispose();
    this.scene.traverse((object) => {
      if (
        object instanceof THREE.Mesh ||
        object instanceof THREE.LineSegments
      ) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        materials.forEach((material) => material.dispose());
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
