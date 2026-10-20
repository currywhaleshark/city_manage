import { LiveCitySimulation } from "../simulation/live";
// Procedural box buildings, cone trees, road strips and two-part cars adapted from
// Sudoyan118/mini-traffic-city-sim src/main.ts (MIT). Rendering is now isolated,
// static geometry is merged, and dynamic cars use persistent instanced meshes.
import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CityCamera, type CameraSnapshot } from "./camera";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { BUILDINGS, CONFIG, SCHOOL_NODE, seededRandom } from "../scenario";
import {
  WORLD,
  RIVER,
  DISTRICT_AREAS,
  BUILDABLE_PLOTS,
  WASTE_DEPOT,
  EXTERNAL_CONNECTIONS,
  RIVERBANK_SEGMENTS,
  inCityBounds,
  visibleRoadSegment,
} from "../city/world";
import { signalPhase } from "../simulation/network";
import { vehicleAccesses } from "../simulation/vehicle-access";
import type { TrafficSimulation } from "../simulation";
import type { Lane, RoadMetric } from "../types";
import { DISPLAY_PRESETS, type DisplayQuality } from "./quality";
import { PedestrianRenderer } from "./pedestrians";
import { WasteRenderer } from "./waste";
import { DumpingRenderer } from "./dumping";
import { WaterRenderer } from "./water";
import { WaterSimulation, WATER_SITES } from "../simulation/water";
import {
  DumpingSimulation,
  DUMPING_SITES,
} from "../simulation/services/dumping";
import { WasteSimulation } from "../simulation/services/waste";
import { CITY_FACILITIES, districtName } from "../city/data";
import type { MapLayer } from "../scenarios";
import { FacilityRenderer } from "./facilities";
import { EnvironmentRenderer } from "./environment";
import { ResidentRenderer } from "./residents";
import { PolicyRenderer } from "./policies";
import { LogisticsSimulation } from "../simulation/economy";
import { LogisticsRenderer } from "./logistics";
import { stockBand } from "./map-data";
import { BuildingColors } from "./building-colors";
import { accessBand, wasteColor, cssColor } from "./map-data";
import type { ResidentVoice } from "../simulation/residents";
import {
  EnvironmentSimulation,
  DEVELOPMENT_SITES,
} from "../simulation/environment";
import {
  FacilitySimulation,
  FACILITY_SITES,
  type ServiceKind,
} from "../simulation/facilities";

export interface Selection {
  kind:
    | "building"
    | "road"
    | "node"
    | "service"
    | "civic"
    | "plot"
    | "development"
    | "policy"
    | "supply"
    | "river"
    | "parking"
    | "dumping"
    | "water";
  id: string;
  title: string;
  description: string;
}
export class CityRenderer {
  private placementView?: PlacementRenderer;
  private placementCamera?: CameraSnapshot;
  private choosePlacement: (id: string) => void = () => {};
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  private cameraView: CityCamera;
  private inspection?: {
    camera: CameraSnapshot;
    position: { x: number; z: number };
    ringVisible: boolean;
  };
  private inspectionRing = new THREE.Mesh(
    new THREE.RingGeometry(9, 9.8, 48),
    new THREE.MeshBasicMaterial({ color: 0xf3be53, side: THREE.DoubleSide }),
  );
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private city = new THREE.Group();
  private worldLabels: {
    element: HTMLElement;
    position: THREE.Vector3;
    plotId?: string;
  }[] = [];
  private walkers = new PedestrianRenderer();
  private wasteView?: WasteRenderer;
  private dumpingView?: DumpingRenderer;
  private waterView?: WaterRenderer;
  private logisticsView?: LogisticsRenderer;
  private parkingView?: ParkingRenderer;
  private facilityView?: FacilityRenderer;
  private environmentView?: EnvironmentRenderer;
  private residentView: ResidentRenderer;
  private policyView: PolicyRenderer;
  private mapLayer: MapLayer = "normal";
  private accessService: ServiceKind = "library";
  private buildingColors = new BuildingColors();
  private facilityLabels: {
    id: string;
    element: HTMLElement;
    position: THREE.Vector3;
  }[] = [];
  private walkSignals: { nodeId: string; material: THREE.MeshBasicMaterial }[] =
    [];
  private roads = new THREE.Group();
  private signals: {
    id: string;
    axis: "ns" | "ew";
    lamps: number[];
  }[] = [];
  private signalBulbs?: THREE.InstancedMesh;
  private roadMeshes = new Map<
    string,
    THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>
  >();
  private selectable: THREE.Object3D[] = [];
  private materials = new Map<number, THREE.MeshStandardMaterial>();
  private proxyMaterial = new THREE.MeshBasicMaterial({ visible: false });
  private carBody = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.8, 0.95, CONFIG.carLength),
    new THREE.MeshStandardMaterial({ roughness: 0.65 }),
    1500,
  );
  private carCabin = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.5, 0.65, 1.8),
    new THREE.MeshStandardMaterial({ color: 0x405866, roughness: 0.4 }),
    1500,
  );
  private carLights = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.5, 0.16, 0.12),
    new THREE.MeshBasicMaterial({ color: 0xffc6a4 }),
    1500,
  );
  private dummy = new THREE.Object3D();
  private carColor = new THREE.Color();
  private sun = new THREE.DirectionalLight(0xfff6df, 2.6);
  private quality: DisplayQuality;
  private ring: THREE.Mesh;
  private current?: TrafficSimulation;
  private width = 1;
  private height = 1;
  private selected?: Selection;
  private compass = document.querySelector<SVGElement>(".compass svg");
  private labelElements: { element: HTMLElement; position: THREE.Vector3 }[] =
    [];
  onSelect: (selection: Selection) => void = () => {};
  onResidentSelect: (
    voice: ResidentVoice,
    index: number,
    count: number,
  ) => void = () => {};
  constructor(
    private canvas: HTMLCanvasElement,
    private labels: HTMLElement,
    quality: DisplayQuality = "normal",
  ) {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
    });
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, DISPLAY_PRESETS[quality].pixelRatio),
    );
    this.renderer.shadowMap.enabled = DISPLAY_PRESETS[quality].shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color(0xe1e7dd);
    this.scene.add(new THREE.HemisphereLight(0xfffaf0, 0x7f9678, 2.3));
    const sun = this.sun;
    sun.position.set(-100, 350, 180);
    sun.target.position.set(WORLD.center, 0, WORLD.center);
    this.scene.add(sun.target);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, {
      left: -360,
      right: 360,
      top: 360,
      bottom: -360,
      near: 10,
      far: 850,
    });
    sun.shadow.normalBias = 0.5;
    this.scene.add(sun);
    this.scene.add(
      this.city,
      this.roads,
      this.carBody,
      this.carCabin,
      this.carLights,
      this.walkers,
    );
    this.carBody.castShadow = true;
    this.carCabin.castShadow = true;
    this.carBody.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.carCabin.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.carLights.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.carBody.frustumCulled = false;
    this.carCabin.frustumCulled = false;
    this.carLights.frustumCulled = false;
    this.cameraView = new CityCamera(canvas);
    this.camera = this.cameraView.camera;
    this.controls = this.cameraView.controls;
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(8, 8.7, 48),
      new THREE.MeshBasicMaterial({ color: 0xf3be53, side: THREE.DoubleSide }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.65;
    this.ring.visible = false;
    this.scene.add(this.ring);
    this.inspectionRing.rotation.x = -Math.PI / 2;
    this.inspectionRing.visible = false;
    this.scene.add(this.inspectionRing);
    this.staticCity();
    this.residentView = new ResidentRenderer(labels.parentElement!);
    this.scene.add(this.residentView);
    this.policyView = new PolicyRenderer(
      labels.parentElement!, document.body.classList.contains("living-city"),
    );
    this.scene.add(this.policyView);
    this.policyView.onSelect = (place) =>
      this.select({
        kind: "policy",
        id: place.id,
        title: place.name,
        description: `${place.scope} · 시행한 정책 ${place.policies.length}개`,
      });
    this.residentView.onChoose = (voice, index, count) => {
      if (this.residentView.visible) this.ensureResidentVisible();
      this.onResidentSelect(voice, index, count);
    };
    for (const facility of CITY_FACILITIES) {
      const element = document.createElement("span");
      element.className = "map-label facility-data";
      element.hidden = true;
      this.labels.append(element);
      this.facilityLabels.push({
        id: facility.id,
        element,
        position: new THREE.Vector3(
          facility.position.x,
          24,
          facility.position.z,
        ),
      });
    }
    this.resize();
    this.resetCamera();
    let down = { x: 0, y: 0 };
    canvas.addEventListener("pointerdown", (e) => {
      down = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener("pointerup", (e) => {
      if (
        e.button === 0 &&
        Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5
      )
        this.pick(e);
    });
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement!);
  }
  setQuality(quality: DisplayQuality) {
    if (quality === this.quality) return;
    this.quality = quality;
    const preset = DISPLAY_PRESETS[quality];
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, preset.pixelRatio),
    );
    this.renderer.shadowMap.enabled = preset.shadows;
    this.renderer.shadowMap.needsUpdate = true;
    if (!preset.shadows) {
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
      this.sun.shadow.mapPass?.dispose();
      this.sun.shadow.mapPass = null;
    }
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        materials.forEach((material) => (material.needsUpdate = true));
      }
    });
    this.resize();
  }
  get displaySettings() {
    return {
      quality: this.quality,
      pixelRatio: this.renderer.getPixelRatio(),
      shadows: this.renderer.shadowMap.enabled,
      maxFPS: DISPLAY_PRESETS[this.quality].maxFPS,
      width: this.canvas.width,
      height: this.canvas.height,
    };
  }
  private material(color: number) {
    if (!this.materials.has(color))
      this.materials.set(
        color,
        new THREE.MeshStandardMaterial({ color, roughness: 0.86 }),
      );
    return this.materials.get(color)!;
  }
  private box(
    parent: THREE.Group,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    color: number,
  ) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      this.material(color),
    );
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  private tree(x: number, z: number, size = 1) {
    this.box(this.city, x, 1.5, z, 0.7, 3, 0.7, 0x9d8263);
    const mesh = new THREE.Mesh(
      new THREE.ConeGeometry(3 * size, 7 * size, 7),
      this.material(0x578268),
    );
    mesh.position.set(x, 5 * size, z);
    mesh.castShadow = true;
    this.city.add(mesh);
    const top = new THREE.Mesh(
      new THREE.ConeGeometry(2.3 * size, 5 * size, 7),
      this.material(0x739377),
    );
    top.position.set(x, 8 * size, z);
    top.castShadow = true;
    this.city.add(top);
  }
  private staticCity() {
    this.box(
      this.city,
      WORLD.center,
      -2.6,
      WORLD.center,
      WORLD.size,
      5,
      WORLD.size,
      0xb0bca1,
    );
    this.box(
      this.city,
      WORLD.center,
      -0.3,
      WORLD.center,
      WORLD.size - 1,
      0.6,
      WORLD.size - 1,
      0xc8d2b5,
    );
    const worldLabel = (
      text: string,
      x: number,
      z: number,
      plotId?: string,
    ) => {
      const element = document.createElement("span");
      element.className = `map-label ${plotId ? "plot-label" : "district-label"}`;
      element.textContent = text;
      this.labels.append(element);
      this.worldLabels.push({
        element,
        position: new THREE.Vector3(x, plotId ? 5 : 1, z),
        plotId,
      });
    };
    for (const district of DISTRICT_AREAS) {
      this.box(
        this.city,
        district.x,
        0.02,
        district.z,
        district.width,
        0.06,
        district.depth,
        district.color,
      );
      worldLabel(
        district.name,
        district.x,
        district.z - district.depth / 2 - 14,
      );
    }
    this.box(
      this.city,
      RIVER.x,
      0.08,
      WORLD.center,
      RIVER.width,
      0.18,
      WORLD.size - 1,
      0x76acb4,
    );
    for (const x of [RIVER.x - 14, RIVER.x + 14])
      for (const bank of RIVERBANK_SEGMENTS)
        this.box(
          this.city,
          x,
          0.18,
          (bank.minZ + bank.maxZ) / 2,
          4,
          0.4,
          bank.maxZ - bank.minZ,
          0xa6bb9c,
        );
    for (let z = WORLD.min + 22; z < WORLD.max; z += 44) {
      // Keep the entire arrow clear of bridge decks instead of showing fragments.
      if (RIVER.bridges.some((row) => Math.abs(z - (row - 2) * 48) < 11))
        continue;
      this.box(this.city, RIVER.x, 0.21, z, 1.3, 0.08, 9, 0xb5d9d7);
      // Both wings meet the shaft's downstream (+z) tip at z + 4.5.
      const arrow = this.box(
        this.city,
        RIVER.x - 1.5,
        0.21,
        z + 3,
        0.9,
        0.08,
        3 * Math.SQRT2,
        0xb5d9d7,
      );
      arrow.rotation.y = Math.PI / 4;
      const other = this.box(
        this.city,
        RIVER.x + 1.5,
        0.21,
        z + 3,
        0.9,
        0.08,
        3 * Math.SQRT2,
        0xb5d9d7,
      );
      other.rotation.y = -Math.PI / 4;
    }
    worldLabel("새봄천 · 상류 → 하류", RIVER.x, 288);
    const river = new THREE.Mesh(
      new THREE.BoxGeometry(RIVER.width, 0.15, WORLD.size),
      this.proxyMaterial,
    );
    river.position.set(RIVER.x, 0.2, WORLD.center);
    river.userData.selection = {
      kind: "river",
      id: "river",
      title: "새봄천",
      description:
        "주거·상업지구와 산업지구 사이를 흐르는 하천이에요. 북쪽 상류에서 남쪽 하류로 흘러요.",
    };
    this.scene.add(river);
    this.selectable.push(river);
    for (const plot of BUILDABLE_PLOTS) {
      const { x, z } = plot.position;
      this.box(this.city, x, 0.2, z, plot.width, 0.25, plot.depth, 0xdbc99e);
      for (const side of [-1, 1]) {
        this.box(
          this.city,
          x + (side * plot.width) / 2,
          0.4,
          z,
          0.4,
          0.25,
          plot.depth,
          0xb39b65,
        );
        this.box(
          this.city,
          x,
          0.4,
          z + (side * plot.depth) / 2,
          plot.width,
          0.25,
          0.4,
          0xb39b65,
        );
      }
      const proxy = new THREE.Mesh(
        new THREE.BoxGeometry(plot.width, 0.8, plot.depth),
        this.proxyMaterial,
      );
      proxy.position.set(x, 0.6, z);
      proxy.userData.selection = {
        kind: "plot",
        id: plot.id,
        title: plot.name,
        description: `${plot.district} · ${plot.width * plot.depth}㎡의 비어 있는 건설 부지예요.`,
      };
      this.scene.add(proxy);
      this.selectable.push(proxy);
      worldLabel(
        `${plot.name.split(" · ")[0]} · ${plot.width * plot.depth}㎡`,
        x,
        z,
        plot.id,
      );
    }
    for (const entry of EXTERNAL_CONNECTIONS) {
      worldLabel(
        `${entry.name} ↔ 도시 밖`,
        entry.edgeX + (entry.id === "west" ? 14 : -14),
        24,
      );
    }
    const random = seededRandom(1337);
    for (const b of BUILDINGS) {
      const ground = this.box(
        this.city,
        b.x,
        0.08,
        b.z,
        35,
        0.25,
        35,
        b.kind === "park" ? 0x9fb793 : 0xd9d8c4,
      );
      if (b.kind === "park") ground.userData.mapBuilding = b.id;
      const proxy = new THREE.Mesh(
        new THREE.BoxGeometry(33, 18, 33),
        this.proxyMaterial,
      );
      proxy.position.set(b.x, 9, b.z);
      proxy.userData.selection = {
        kind: "building",
        id: b.id,
        title: b.name,
        description: b.description,
      };
      this.scene.add(proxy);
      this.selectable.push(proxy);
      if (b.kind === "park") {
        this.box(this.city, b.x, 0.3, b.z, 3, 0.2, 33, 0xe5d9bd);
        this.box(this.city, b.x, 0.3, b.z, 33, 0.2, 3, 0xe5d9bd);
        for (const [dx, dz] of [
          [-10, -10],
          [10, -10],
          [-10, 10],
          [10, 10],
        ])
          this.tree(b.x + dx, b.z + dz, 1.05);
        this.box(this.city, b.x + 6, 1, b.z + 3, 4, 1, 1.4, 0xa4896c);
      } else if (b.kind === "school") {
        this.box(
          this.city,
          b.x,
          5.5,
          b.z - 7,
          28,
          11,
          12,
          0xf2dfb3,
        ).userData.mapBuilding = b.id;
        this.box(
          this.city,
          b.x,
          11.5,
          b.z - 7,
          30,
          1.5,
          14,
          0xaf725d,
        ).userData.mapBuilding = b.id;
        this.box(
          this.city,
          b.x - 11,
          3,
          b.z + 3,
          6,
          6,
          10,
          0xe3c697,
        ).userData.mapBuilding = b.id;
        this.box(this.city, b.x + 5, 0.4, b.z + 9, 18, 0.4, 11, 0xcba880);
        for (let i = -10; i <= 10; i += 5) {
          this.box(this.city, b.x + i, 7, b.z - 0.85, 2.5, 3, 0.2, 0x769ca6);
          this.box(this.city, b.x + i, 3, b.z - 0.85, 2.5, 2.5, 0.2, 0x769ca6);
        }
        this.box(this.city, b.x, 2, b.z - 0.6, 3, 4, 0.3, 0x705e50);
      } else if (b.kind === "waste") {
        this.box(
          this.city,
          b.x,
          3,
          b.z,
          28,
          6,
          22,
          0x79938b,
        ).userData.mapBuilding = b.id;
        this.box(
          this.city,
          b.x,
          6.3,
          b.z,
          29,
          0.8,
          23,
          0x456e69,
        ).userData.mapBuilding = b.id;
        for (const dx of [-8, 0, 8])
          this.box(this.city, b.x + dx, 2, b.z + 12, 5, 4, 5, 0xbdab77);
        worldLabel("자원순환센터", b.x, b.z - 18);
      } else if (b.kind === "factory") {
        this.box(
          this.city,
          b.x,
          4,
          b.z,
          27,
          8,
          21,
          0xbbbdaf,
        ).userData.mapBuilding = b.id;
        this.box(
          this.city,
          b.x,
          8.5,
          b.z,
          28,
          1,
          22,
          0x738a8a,
        ).userData.mapBuilding = b.id;
        this.box(
          this.city,
          b.x + 10,
          12,
          b.z - 8,
          3,
          13,
          3,
          0xb5957e,
        ).userData.mapBuilding = b.id;
        for (let i = -9; i <= 9; i += 6)
          this.box(this.city, b.x + i, 4, b.z + 10.6, 4, 3, 0.2, 0x7d9598);
      } else {
        const palette =
          b.kind === "home"
            ? [0xe6d9ba, 0xc5d5c8, 0xe0bdac]
            : [0xc2d4d6, 0xdce2d5, 0xccd2da];
        for (let j = 0; j < 4; j++) {
          const x = b.x + (j % 2 ? 8 : -8),
            z = b.z + (j < 2 ? -8 : 8),
            h = (b.kind === "office" ? 12 : 7) + Math.floor(random() * 6);
          this.box(
            this.city,
            x,
            h / 2,
            z,
            11,
            h,
            11,
            palette[j % 3],
          ).userData.mapBuilding = b.id;
          this.box(
            this.city,
            x,
            h + 0.55,
            z,
            12,
            1.1,
            12,
            b.kind === "home" ? 0x889c8c : 0x82999b,
          ).userData.mapBuilding = b.id;
          this.box(
            this.city,
            x + 2,
            h + 1.2,
            z,
            3,
            1,
            3,
            0xa4b3ad,
          ).userData.mapBuilding = b.id;
          for (let y = 3; y < h - 1; y += 3.3)
            for (let q = -3; q <= 3; q += 3) {
              this.box(this.city, x + q, y, z + 5.55, 1.3, 1.6, 0.15, 0x718c97);
              this.box(this.city, x + 5.55, y, z + q, 0.15, 1.6, 1.3, 0x718c97);
            }
        }
      }
      this.tree(b.x - 17, b.z + 12, 0.65);
      this.tree(b.x + 17, b.z - 12, 0.65);
    }
    for (let i = WORLD.min + 18; i <= WORLD.max - 18; i += 24) {
      if (Math.abs(i - RIVER.x) > 22) {
        this.tree(i, WORLD.min + 8, 0.85);
        this.tree(i, WORLD.max - 8, 0.85);
      }
      if (i < -10 || i > 60) {
        this.tree(WORLD.min + 8, i, 0.9);
        this.tree(WORLD.max - 8, i, 0.9);
      }
    }
    // One draw call per static material, instead of a draw call per window/tree.
    this.city.updateMatrixWorld(true);
    const groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
    for (const object of [...this.city.children])
      if (object instanceof THREE.Mesh) {
        if (object.userData.mapBuilding) {
          this.buildingColors.capture(object, object.userData.mapBuilding);
          object.geometry.dispose();
          continue;
        }
        const material = object.material as THREE.Material;
        if (!groups.has(material)) groups.set(material, []);
        const geometry = object.geometry
          .clone()
          .applyMatrix4(object.matrixWorld);
        groups.get(material)!.push(geometry);
        object.geometry.dispose();
      }
    this.city.clear();
    this.city.add(this.buildingColors.build());
    for (const [material, geometries] of groups) {
      const merged = mergeGeometries(geometries);
      if (merged) {
        const mesh = new THREE.Mesh(merged, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.city.add(mesh);
      }
      geometries.forEach((g) => g.dispose());
    }
    this.addLabel("새봄초등학교", 24, 17, -24, "school");
    this.addLabel("햇살 주거단지", -69, 22, 25, "");
    this.addLabel("다함께 상가", 72, 22, -24, "");
  }
  private addLabel(
    text: string,
    x: number,
    y: number,
    z: number,
    className: string,
  ) {
    const element = document.createElement("span");
    element.className = `map-label ${className}`;
    element.textContent = text;
    this.labels.append(element);
    this.labelElements.push({ element, position: new THREE.Vector3(x, y, z) });
  }
  setSimulation(sim: TrafficSimulation) {
    const water =
      sim instanceof LiveCitySimulation
        ? sim.water
        : sim instanceof WaterSimulation
          ? sim
          : undefined;
    const parking =
      sim instanceof LiveCitySimulation
        ? sim.parking
        : sim instanceof ParkingSimulation
          ? sim
          : undefined;
    const logistics =
      sim instanceof LiveCitySimulation
        ? sim.logistics
        : sim instanceof LogisticsSimulation
          ? sim
          : undefined;
    const facilities =
      sim instanceof LiveCitySimulation
        ? sim.facilities
        : sim instanceof FacilitySimulation
          ? sim
          : undefined;

    this.clearPlacement();
    this.current = sim;
    this.waterView?.dispose();
    this.waterView = undefined;
    this.dumpingView?.dispose();
    this.dumpingView = undefined;
    this.parkingView?.dispose();
    this.parkingView = undefined;
    this.logisticsView?.dispose();
    this.logisticsView = undefined;
    this.policyView.setSimulation(sim);
    this.environmentView?.dispose();
    this.environmentView = undefined;
    this.facilityView?.dispose();
    this.facilityView = undefined;
    this.wasteView?.dispose();
    this.wasteView = undefined;
    for (const child of this.roads.children)
      child.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          if (obj.userData.ownedMaterial) obj.material.dispose();
        }
      });
    this.roads.clear();
    this.roadMeshes.clear();
    this.signals = [];
    this.walkSignals = [];
    this.selectable = this.scene.children.filter(
      (o) =>
        ["building", "river", "plot"].includes(o.userData.selection?.kind) &&
        !(
          o.userData.selection.kind === "plot" &&
          (sim instanceof LiveCitySimulation
            ? sim.parcels
            : facilities?.plan.buildings
          )?.some((b) => b.siteId === o.userData.selection.id)
        ),
    );
    if (sim instanceof WasteSimulation) {
      // Service views own their selectable meshes.
      this.wasteView = new WasteRenderer(sim);
      this.scene.add(this.wasteView);
      this.selectable.push(...this.wasteView.selectable);
    }
    if (water) {
      this.waterView = new WaterRenderer(
        water,
        this.labels.parentElement!,
        (id) => this.focusWater(id),
      );
      this.scene.add(this.waterView);
      this.selectable.push(...this.waterView.selectable);
    }
    if (sim instanceof DumpingSimulation) {
      this.dumpingView = new DumpingRenderer(
        sim,
        this.labels.parentElement!,
        (id) => this.focusDumping(id),
      );
      this.scene.add(this.dumpingView);
      this.selectable.push(...this.dumpingView.selectable);
    }
    if (logistics) {
      this.logisticsView = new LogisticsRenderer(logistics, this.labels);
      this.scene.add(this.logisticsView);
      this.selectable.push(...this.logisticsView.selectable);
    }
    if (parking) {
      this.parkingView = new ParkingRenderer(parking, this.labels, (id) =>
        this.focusParking(id),
      );
      this.scene.add(this.parkingView);
      this.selectable.push(...this.parkingView.selectable);
    }
    if (facilities) {
      this.facilityView = new FacilityRenderer(
        facilities,
        this.labels,
        sim instanceof LiveCitySimulation
          ? sim.parcels.map((p) => p.siteId)
          : [],
      );
      this.scene.add(this.facilityView);
      this.selectable.push(...this.facilityView.selectable);
    }
    if (sim instanceof EnvironmentSimulation) {
      this.environmentView = new EnvironmentRenderer(sim, this.labels);
      this.scene.add(this.environmentView);
      this.selectable.push(...this.environmentView.selectable);
    }
    for (const road of sim.network.roads.values()) {
      const segment = visibleRoadSegment(
        sim.network.nodes.get(road.startNodeId)!.position,
        sim.network.nodes.get(road.endNodeId)!.position,
      );
      if (!segment) continue;
      const { a, b } = segment;
      const visibleLength = Math.hypot(b.x - a.x, b.z - a.z);
      const group = new THREE.Group();
      group.position.set((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
      group.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
      this.roads.add(group);
      this.box(group, 0, 0.04, 0, 10.5, 0.3, visibleLength, 0xbfc5ba);
      if (
        Math.min(a.x, b.x) < RIVER.x &&
        Math.max(a.x, b.x) > RIVER.x &&
        a.z === b.z
      ) {
        for (const side of [-1, 1])
          this.box(group, side * 5.2, 1, 0, 0.4, 1.2, visibleLength, 0x97aaa3);
      }
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(7.4, 0.17, visibleLength),
        new THREE.MeshStandardMaterial({ color: 0x778580, roughness: 1 }),
      );
      mesh.position.y = 0.23;
      mesh.receiveShadow = true;
      mesh.userData.ownedMaterial = true;
      group.add(mesh);
      this.roadMeshes.set(road.id, mesh);
      mesh.userData.selection = {
        kind: "road",
        id: road.id,
        title: road.name,
        description:
          road.direction === "one-way"
            ? "학교 쪽 일방통행 · 왼쪽은 좌회전·직진, 오른쪽은 직진·우회전. 차들은 안전한 틈이 있을 때 차로를 바꿔요."
            : "양방향 도로 · 방향마다 1차로",
      };
      this.selectable.push(mesh);
      for (let z = -visibleLength / 2 + 8; z <= visibleLength / 2 - 8; z += 7)
        this.box(group, 0, 0.34, z, 0.14, 0.025, 3.2, 0xe9dcc0);
      if (road.laneCount > 1)
        for (const lane of sim.network.lanes.values())
          if (lane.roadId === road.id) this.laneArrows(lane);
    }
    if (sim instanceof LiveCitySimulation) for (const access of vehicleAccesses(sim.network)) {
      const [start, toward] = access.points;
      const entrance = new THREE.Group();
      entrance.position.set(start.x, 0, start.z);
      entrance.rotation.y = Math.atan2(toward.x - start.x, toward.z - start.z);
      this.roads.add(entrance);
      this.box(entrance, 0, 0.37, 0, 4.4, 0.15, 5.2, 0x87918a);
      // An open parking bay and a short apron visibly join the existing street.
      this.box(entrance, 0, 0.36, 3.3, 4.4, 0.12, 1.8, 0x87918a);
      for (const side of [-1, 1])
        this.box(entrance, side * 1.8, 0.47, 0, 0.13, 0.025, 4.6, 0xeee5cf);
      this.box(entrance, 0, 0.47, -2.3, 3.6, 0.025, 0.13, 0xeee5cf);
    }
    this.signalBulbs = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.31, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      sim.network.nodes.size * 6,
    );
    this.signalBulbs.userData.ownedMaterial = true;
    this.roads.add(this.signalBulbs);
    let bulbIndex = 0;
    for (const node of sim.network.nodes.values()) {
      if (node.boundary || !inCityBounds(node.position)) continue;
      const group = new THREE.Group();
      group.position.set(node.position.x, 0, node.position.z);
      this.roads.add(group);
      const pad = this.box(group, 0, 0.31, 0, 11, 0.1, 11, 0x778580);
      pad.userData.selection = {
        kind: "node",
        id: node.id,
        title: node.id === SCHOOL_NODE ? "학교 앞 교차로" : "동네 교차로",
        description: "초록불에 출발하고, 출구가 막히면 기다려요.",
      };
      this.selectable.push(pad);
      for (const lane of sim.network.lanes.values())
        if (lane.to === node.id && !node.signal.walk) {
          const x = lane.end.x - node.position.x,
            z = lane.end.z - node.position.z;
          const crossing = new THREE.Group();
          crossing.position.set(x, 0.4, z);
          crossing.rotation.y = lane.axis === "ns" ? 0 : Math.PI / 2;
          group.add(crossing);
          for (let i = -1; i <= 1; i++)
            this.box(crossing, i * 0.85, 0, 0, 0.48, 0.04, 1.7, 0xeeeade);
        }
      for (const axis of ["ns", "ew"] as const) {
        const x = axis === "ns" ? 4.8 : -4.8,
          z = 4.8;
        this.box(group, x, 2.3, z, 0.35, 4.6, 0.35, 0x4c6359);
        this.box(group, x, 4.8, z, 1, 2.8, 0.8, 0x3e5049);
        const lamps = [];
        for (let i = 0; i < 3; i++) {
          this.signalBulbs.setMatrixAt(
            bulbIndex,
            new THREE.Matrix4().makeTranslation(
              node.position.x + x,
              5.65 - i * 0.8,
              node.position.z + z + 0.44,
            ),
          );
          this.signalBulbs.setColorAt(bulbIndex, new THREE.Color(0x33443c));
          lamps.push(bulbIndex++);
        }
        this.signals.push({ id: node.id, axis, lamps });
      }
    }
    this.signalBulbs.count = bulbIndex;
    for (const route of sim.pedestrians.routes.values()) {
      const a = route.points[2],
        b = route.points[3];
      const dx = b.x - a.x,
        dz = b.z - a.z;
      const length = Math.hypot(dx, dz);
      const crosswalk = new THREE.Group();
      crosswalk.position.set((a.x + b.x) / 2, 0.4, (a.z + b.z) / 2);
      crosswalk.rotation.y = Math.atan2(dx, dz);
      this.roads.add(crosswalk);
      for (let d = -4.8; d <= 4.8; d += 1.05)
        this.box(crosswalk, 0, 0, d, 1.3, 0.035, 0.55, 0xf8f1da);
      // Sidewalk approaches and a waiting area outside the vehicle swept paths.
      for (const [start, end] of [
        [0, 1],
        [4, 5],
      ]) {
        const p = route.points[start],
          q = route.points[end];
        const strip = this.box(
          this.roads,
          (p.x + q.x) / 2,
          0.18,
          (p.z + q.z) / 2,
          1.3,
          0.22,
          Math.hypot(q.x - p.x, q.z - p.z) + 1.3,
          0xd8d6c3,
        );
        strip.rotation.y = Math.atan2(q.x - p.x, q.z - p.z);
      }
      for (const p of [a, b]) {
        const x = p.x + (dz / length) * 1.15,
          z = p.z - (dx / length) * 1.15;
        this.box(this.roads, x, 1.6, z, 0.18, 2.6, 0.18, 0x435d54);
        const housing = new THREE.Group();
        housing.position.set(x, 3.05, z);
        housing.rotation.y = Math.atan2(dx, dz) + (p === a ? 0 : Math.PI);
        this.roads.add(housing);
        this.box(housing, 0, 0, 0, 0.9, 1.2, 0.3, 0x293e37);
        const material = new THREE.MeshBasicMaterial({ color: 0xe46652 });
        const glyphParts: THREE.BufferGeometry[] = [];
        for (const [xx, yy, w, h] of [
          [0, 0.31, 0.22, 0.22],
          [0, -0.02, 0.19, 0.35],
          [-0.18, 0.02, 0.15, 0.13],
          [0.18, 0.02, 0.15, 0.13],
          [-0.12, -0.32, 0.14, 0.3],
          [0.12, -0.32, 0.14, 0.3],
        ]) {
          glyphParts.push(
            new THREE.BoxGeometry(w, h, 0.025).translate(xx, yy, 0.17),
          );
        }
        const mark = new THREE.Mesh(mergeGeometries(glyphParts)!, material);
        glyphParts.forEach((part) => part.dispose());
        mark.userData.ownedMaterial = true;
        housing.add(mark);
        this.walkSignals.push({ nodeId: route.nodeId, material });
      }
    }
    // Merge road decorations; interactive road surfaces and signal lamps stay separate.
    this.roads.updateMatrixWorld(true);
    const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const removable: THREE.Mesh[] = [];
    this.roads.traverse((object) => {
      if (
        object instanceof THREE.Mesh &&
        !object.userData.selection &&
        !object.userData.ownedMaterial
      ) {
        const material = object.material as THREE.Material;
        if (!batches.has(material)) batches.set(material, []);
        batches
          .get(material)!
          .push(object.geometry.clone().applyMatrix4(object.matrixWorld));
        removable.push(object);
      }
    });
    for (const object of removable) {
      object.removeFromParent();
      object.geometry.dispose();
    }
    for (const [material, geometries] of batches) {
      const geometry = mergeGeometries(geometries);
      if (geometry) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.receiveShadow = true;
        mesh.castShadow = true;
        this.roads.add(mesh);
      }
      geometries.forEach((g) => g.dispose());
    }
    const chosen =
      this.selected?.kind === "road"
        ? (this.roadMeshes.get(this.selected.id)?.userData.selection as
            Selection | undefined)
        : this.selected;
    this.select(
      chosen &&
        (chosen.kind !== "policy" || !!this.appliedPolicy(chosen.id)) &&
        (chosen.kind !== "road" || sim.network.roads.has(chosen.id)) &&
        (chosen.kind !== "supply" ||
          (sim instanceof LogisticsSimulation &&
            sim.sources.some((s) => s.id === chosen.id))) &&
        (chosen.kind !== "development" ||
          sim instanceof EnvironmentSimulation) &&
        (!["civic", "plot"].includes(chosen.kind) ||
          sim instanceof FacilitySimulation)
        ? chosen
        : {
            kind: "node",
            id: SCHOOL_NODE,
            title: "학교 앞 교차로",
            description:
              "등교 차량이 모이는 교차로예요. 동서 방향 초록불은 기본 7초예요.",
          },
    );
    this.renderer.shadowMap.needsUpdate = true;
  }
  private laneArrows(lane: Lane) {
    const dx = (lane.end.x - lane.start.x) / lane.length,
      dz = (lane.end.z - lane.start.z) / lane.length;
    const x = lane.end.x - dx * 5,
      z = lane.end.z - dz * 5;
    const line = (u1: number, v1: number, u2: number, v2: number) => {
      const ax = x + dx * v1 - dz * u1,
        az = z + dz * v1 + dx * u1;
      const bx = x + dx * v2 - dz * u2,
        bz = z + dz * v2 + dx * u2;
      const mark = this.box(
        this.roads,
        (ax + bx) / 2,
        0.37,
        (az + bz) / 2,
        0.16,
        0.025,
        Math.hypot(bx - ax, bz - az),
        0xf5efda,
      );
      mark.rotation.y = Math.atan2(bx - ax, bz - az);
    };
    line(0, -2.3, 0, 0.6);
    if (lane.turns.includes("straight")) {
      line(0, 0.6, 0, 2);
      line(0, 2, -0.45, 1.25);
      line(0, 2, 0.45, 1.25);
    }
    for (const [turn, side] of [
      ["left", -1],
      ["right", 1],
    ] as const) {
      if (!lane.turns.includes(turn)) continue;
      line(0, -0.5, side * 1.05, 0.3);
      line(side * 1.05, 0.3, side * 0.5, 0.4);
      line(side * 1.05, 0.3, side * 0.85, -0.3);
    }
  }
  select(selection: Selection) {
    this.selected = selection;
    this.facilityView?.selectNeighborhood(
      selection.kind === "building" ? selection.id : undefined,
    );
    this.ring.visible = true;
    if (selection.kind === "policy" || selection.kind === "river") {
      this.ring.visible = false;
    } else if (selection.kind === "water") {
      const s = WATER_SITES.find((s) => s.id === selection.id)!;
      this.ring.position.set(s.position.x - 8, 0.6, s.position.z);
      this.ring.scale.setScalar(0.6);
    } else if (selection.kind === "dumping") {
      const s = DUMPING_SITES.find((s) => s.id === selection.id)!;
      this.ring.position.set(s.position.x, 0.6, s.position.z);
      this.ring.scale.setScalar(0.6);
    } else if (selection.kind === "parking") {
      const s = PARKING_SITES.find((s) => s.id === selection.id)!;
      this.ring.position.set(s.position.x, 0.6, s.position.z);
      this.ring.scale.setScalar(0.7);
    } else if (selection.kind === "building") {
      const b = BUILDINGS.find((b) => b.id === selection.id)!;
      this.ring.position.set(b.x, 0.6, b.z);
      this.ring.scale.set(2.3, 2.3, 2.3);
    } else if (selection.kind === "development") {
      const site = DEVELOPMENT_SITES.find((s) => s.id === selection.id);
      if (site) this.ring.position.set(site.position.x, 0.6, site.position.z);
      this.ring.scale.setScalar(1.3);
    } else if (selection.kind === "plot" || selection.kind === "civic") {
      const target =
        selection.kind === "plot"
          ? FACILITY_SITES.find((s) => s.id === selection.id)
          : this.current instanceof FacilitySimulation
            ? this.current.facilities.find((f) => f.id === selection.id)
            : undefined;
      if (target)
        this.ring.position.set(target.position.x, 0.6, target.position.z);
      this.ring.scale.setScalar(selection.kind === "plot" ? 1.8 : 1);
    } else if (selection.kind === "supply") {
      const source =
        this.current instanceof LogisticsSimulation
          ? this.current.sources.find((s) => s.id === selection.id)
          : undefined;
      this.ring.visible = !!source;
      if (source)
        this.ring.position.set(source.position.x, 0.6, source.position.z);
      this.ring.scale.setScalar(0.7);
    } else if (selection.kind === "node") {
      const n = this.current?.network.nodes.get(selection.id);
      if (n) this.ring.position.set(n.position.x, 0.6, n.position.z);
      this.ring.scale.setScalar(1);
    } else if (selection.kind === "service") {
      const car = this.current?.vehicles.get(Number(selection.id));
      if (car) this.ring.position.set(car.pose.x, 0.6, car.pose.z);
      this.ring.scale.setScalar(0.45);
    } else {
      const road = this.current?.network.roads.get(selection.id);
      if (road) {
        const a = this.current!.network.nodes.get(road.startNodeId)!.position,
          b = this.current!.network.nodes.get(road.endNodeId)!.position;
        this.ring.position.set((a.x + b.x) / 2, 0.6, (a.z + b.z) / 2);
      }
      this.ring.scale.setScalar(1);
    }
    this.onSelect(selection);
  }
  focusSchool() {
    this.focusPosition({ x: 35, z: -2 });
    this.select({
      kind: "node",
      id: SCHOOL_NODE,
      title: "학교 앞 교차로",
      description: "가로길과 세로길의 신호를 비교해 보세요.",
    });
  }
  focusParking(id: string) {
    const s = PARKING_SITES.find((s) => s.id === id);
    if (!s) return;
    this.focusPosition(s.position, 110);
    this.select({
      kind: "parking",
      id: s.id,
      title: s.name,
      description: s.reason,
    });
  }
  focusSupply(id: string) {
    const source =
      this.current instanceof LogisticsSimulation
        ? this.current.sources.find((s) => s.id === id)
        : undefined;
    if (!source) return;
    this.focusPosition(source.position);
    this.select({
      kind: "supply",
      id,
      title: source.name,
      description: "상점으로 보내기 전에 물자를 준비하는 곳이에요.",
    });
  }
  resetCamera() {
    this.cameraView.overview(this.current instanceof WaterSimulation);
  }
  focusPosition(position: { x: number; z: number }, span = 180) {
    this.cameraView.focus(position, span);
  }
  beginInspection(position: { x: number; z: number }) {
    if (this.inspection) return;
    this.inspection = {
      camera: this.cameraView.snapshot(),
      position: { ...position },
      ringVisible: this.ring.visible,
    };
    this.resize();
    this.recenterInspection();
    this.ring.visible = false;
    this.inspectionRing.position.set(position.x, 0.8, position.z);
    this.inspectionRing.visible = true;
    this.policyView.visible = false;
  }
  recenterInspection() {
    if (this.inspection) this.cameraView.focus(this.inspection.position, 90);
  }
  endInspection() {
    if (!this.inspection) return;
    const previous = this.inspection;
    this.inspection = undefined;
    this.inspectionRing.visible = false;
    this.policyView.visible = true;
    this.ring.visible = previous.ringVisible;
    this.resize();
    this.cameraView.restore(previous.camera);
  }
  focusDumping(id: string) {
    const s = DUMPING_SITES.find((s) => s.id === id);
    if (!s) return;
    this.focusPosition(s.position, 120);
    this.select({
      kind: "dumping",
      id,
      title: s.name,
      description: "지정된 곳 밖의 투기물을 조사해요.",
    });
  }
  focusWater(id: string) {
    const s = WATER_SITES.find((s) => s.id === id);
    if (!s) return;
    this.focusPosition(s.position, 160);
    this.select({
      kind: "water",
      id,
      title: s.name,
      description: "물의 흐름을 따라 상류와 하류의 자료를 비교해요.",
    });
  }
  showPlacement(
    title: string,
    targets: readonly PlacementTarget[],
    selectedId: string | undefined,
    onChoose: (id: string) => void,
    onCancel: () => void,
  ) {
    this.clearPlacement();
    this.placementCamera = this.cameraView.snapshot();
    this.choosePlacement = onChoose;
    this.placementView = new PlacementRenderer(
      this.labels.parentElement!,
      title,
      targets,
      selectedId,
      onChoose,
      onCancel,
    );
    this.scene.add(this.placementView);
    document.body.setAttribute("data-placing-policy", "");
    this.ring.visible = false;
    const x = targets.reduce((n, t) => n + t.position.x, 0) / targets.length,
      z = targets.reduce((n, t) => n + t.position.z, 0) / targets.length;
    const corners = targets.flatMap((t) =>
      [-1, 1].flatMap((dx) =>
        [-1, 1].map(
          (dz) =>
            new THREE.Vector3(
              t.position.x + (dx * t.width) / 2,
              0,
              t.position.z + (dz * t.depth) / 2,
            ),
        ),
      ),
    );
    this.cameraView.frame(new THREE.Vector3(x, 0, z), corners, {
      x: 0.82,
      y: 0.52,
    });
  }
  clearPlacement() {
    this.placementView?.dispose();
    this.placementView = undefined;
    document.body.removeAttribute("data-placing-policy");
    if (this.placementCamera) {
      this.cameraView.restore(this.placementCamera);
      this.placementCamera = undefined;
    }
  }
  zoom(factor: number) {
    this.cameraView.zoom(factor);
  }
  setMapLayer(layer: MapLayer) {
    this.mapLayer = layer;
  }
  setResidentVoices(voices: ResidentVoice[]) {
    this.residentView.setVoices(voices);
  }
  appliedPolicy(id: string) {
    return [
      ...this.policyView.data.places,
      ...this.policyView.data.shared,
    ].find((place) => place.id === id);
  }
  setResidentMode(open: boolean) {
    this.residentView.setOpen(open);
    this.ring.visible =
      !open && !!this.selected && this.selected.kind !== "policy";
    if (open) this.ensureResidentVisible();
  }
  nextResident(direction: number) {
    this.residentView.step(direction);
  }
  private ensureResidentVisible() {
    if (this.inspection) return;
    const position = this.residentView.activePosition;
    if (!position) return;
    const projected = position.clone().project(this.camera);
    if (
      projected.z > -1 &&
      projected.z < 1 &&
      Math.abs(projected.x) < 0.8 &&
      Math.abs(projected.y) < 0.65
    )
      return;
    this.cameraView.center(position);
  }
  focusDevelopment(id: string) {
    const site = DEVELOPMENT_SITES.find((s) => s.id === id);
    if (!site || !(this.current instanceof EnvironmentSimulation)) return;
    this.focusPosition(site.position, 140);
    this.select({
      kind: "development",
      id,
      title: site.name,
      description: "개발과 녹지 보전을 비교하는 지정 부지예요.",
    });
  }
  setAccessService(kind: ServiceKind) {
    this.accessService = kind;
    this.facilityView?.setService(kind);
  }
  get mapVisualization() {
    return {
      buildings: this.buildingColors.snapshot,
      coverage: this.facilityView?.coverageSnapshot,
    };
  }
  focusCivic(id: string, plot = false) {
    const target = plot
      ? FACILITY_SITES.find((s) => s.id === id)
      : this.current instanceof FacilitySimulation
        ? this.current.facilities.find((f) => f.id === id)
        : undefined;
    if (!target) return;
    this.focusPosition(target.position, 140);
    this.select({
      kind: plot ? "plot" : "civic",
      id,
      title: target.name,
      description: plot
        ? "면적과 예산을 살펴 시설을 지을 수 있는 공터예요."
        : "시설의 위치와 이용 자리를 살펴봐요.",
    });
  }
  focusFacility(id: string) {
    const facility = CITY_FACILITIES.find((f) => f.id === id)!;
    this.focusPosition(facility.position, 140);
    this.select({
      kind: "building",
      id,
      title: facility.name,
      description: `${districtName(facility.districtId)} · ${facility.purpose}`,
    });
  }
  private pick(event: PointerEvent) {
    if (this.inspection) return;
    const rect = this.canvas.getBoundingClientRect(),
      pointer = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(pointer, this.camera);
    if (this.placementView) {
      const hit = ray.intersectObjects(this.placementView.selectable, false)[0];
      if (hit) this.choosePlacement(hit.object.userData.placementId);
      return;
    }
    const hits = ray.intersectObjects(this.selectable, false);
    // Civic props are inside broad legacy building hit boxes; prefer their exact mesh when hit.
    const hit =
      this.current instanceof FacilitySimulation
        ? (hits.find((h) =>
            ["civic", "plot"].includes(h.object.userData.selection?.kind),
          ) ?? hits[0])
        : hits[0];
    if (hit) this.select(hit.object.userData.selection);
  }
  private resize() {
    const rect = this.canvas.parentElement!.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    this.renderer.setSize(rect.width, rect.height, false);
    this.cameraView.resize(rect.width, rect.height);
  }
  render(
    sim: TrafficSimulation,
    overlay: boolean,
    roadMetrics: RoadMetric[],
    paused = false,
  ) {
    const water =
      sim instanceof LiveCitySimulation
        ? sim.water
        : sim instanceof WaterSimulation
          ? sim
          : undefined;
    const parking =
      sim instanceof LiveCitySimulation
        ? sim.parking
        : sim instanceof ParkingSimulation
          ? sim
          : undefined;
    const logistics =
      sim instanceof LiveCitySimulation
        ? sim.logistics
        : sim instanceof LogisticsSimulation
          ? sim
          : undefined;
    const facilities =
      sim instanceof LiveCitySimulation
        ? sim.facilities
        : sim instanceof FacilitySimulation
          ? sim
          : undefined;

    this.controls.update();
    this.camera.updateMatrixWorld();
    const colors = new Map<string, number>();
    if (this.mapLayer === "stock" && logistics)
      for (const shop of logistics.shops)
        colors.set(shop.facilityId, stockBand(shop.stock).color);
    if (this.mapLayer === "waste" && sim instanceof WasteSimulation)
      for (const site of sim.sites.filter((s) => !s.kind))
        colors.set(site.facilityId, wasteColor(site.remaining));
    if (this.mapLayer === "access" && facilities)
      for (const row of facilities.access)
        colors.set(
          row.id,
          accessBand(
            row.services[this.accessService].nearest?.route.seconds ?? null,
          ).color,
        );
    this.buildingColors.update(colors);
    for (const label of this.worldLabels) {
      const p = label.position.clone().project(this.camera);
      const occupied =
        label.plotId &&
        (sim instanceof LiveCitySimulation
          ? sim.parcels
          : facilities?.plan.buildings
        )?.some((b) => b.siteId === label.plotId);
      label.element.hidden =
        !!occupied ||
        p.z < -1 ||
        p.z > 1 ||
        (label.plotId
          ? this.mapLayer !== "land" &&
            !(sim instanceof FacilitySimulation && this.mapLayer === "normal")
          : this.mapLayer !== "normal" && this.mapLayer !== "land");
      label.element.style.left = `${((p.x + 1) / 2) * this.width}px`;
      label.element.style.top = `${((1 - p.y) / 2) * this.height}px`;
    }
    this.residentView.update(this.camera, this.width, this.height);
    let index = 0;
    if (this.compass) {
      const north = new THREE.Vector3(0, 0, -10).project(this.camera);
      const origin = new THREE.Vector3(0, 0, 0).project(this.camera);
      const angle = Math.atan2(
        (north.x - origin.x) * this.width,
        (north.y - origin.y) * this.height,
      );
      this.compass.style.transform = `rotate(${angle}rad)`;
    }
    const alpha = paused ? 1 : sim.alpha;
    this.wasteView?.update(alpha);
    this.logisticsView?.update(
      this.camera,
      this.width,
      this.height,
      this.mapLayer,
      alpha,
    );
    this.policyView.update(this.camera, this.width, this.height);
    this.parkingView?.update(
      this.camera,
      this.width,
      this.height,
      alpha,
      !(sim instanceof LiveCitySimulation),
    );
    this.dumpingView?.update(
      this.camera,
      this.width,
      this.height,
      !(sim instanceof LiveCitySimulation) || this.mapLayer === "waste",
    );
    this.waterView?.update(
      this.camera,
      this.width,
      this.height,
      this.mapLayer === "water",
      !(sim instanceof LiveCitySimulation) || this.mapLayer === "water",
    );
    this.placementView?.update(this.camera, this.width, this.height);
    this.environmentView?.update(
      this.camera,
      this.width,
      this.height,
      this.mapLayer,
    );
    this.facilityView?.update(
      this.camera,
      this.width,
      this.height,
      this.mapLayer,
    );
    if (this.inspection) this.ring.visible = false;
    if (!this.inspection && this.selected?.kind === "service") {
      const v = sim.vehicles.get(Number(this.selected.id));
      this.ring.visible = !!v && inCityBounds(v.pose);
      if (v) this.ring.position.set(v.pose.x, 0.6, v.pose.z);
    }
    this.walkers.update(sim, alpha);
    for (const signal of this.walkSignals) {
      const phase = signalPhase(
        sim.network.nodes.get(signal.nodeId)!.signal,
        sim.time,
      );
      const green =
        (phase === "pedestrian-green" &&
          !sim.nodeLocks.get(signal.nodeId)?.size) ||
        (phase === "pedestrian-clearance" &&
          Math.floor(sim.time * 2) % 2 === 0);
      signal.material.color.setHex(
        green
          ? 0x79eb99
          : phase === "pedestrian-clearance"
            ? 0x354a40
            : 0xed6754,
      );
    }
    for (const v of sim.vehicles.values()) {
      if (sim.serviceJourneys.has(v.id)) continue;
      if (index >= 1500) break;
      const p = v.pose,
        q = v.previousPose,
        x = q.x + (p.x - q.x) * alpha,
        z = q.z + (p.z - q.z) * alpha;
      if (!inCityBounds({ x, z })) continue;
      const angle =
        q.angle +
        Math.atan2(Math.sin(p.angle - q.angle), Math.cos(p.angle - q.angle)) *
          alpha;
      this.dummy.position.set(x, 0.92, z);
      this.dummy.rotation.set(0, angle, 0);
      this.dummy.updateMatrix();
      this.carBody.setMatrixAt(index, this.dummy.matrix);
      this.carBody.setColorAt(index, this.carColor.setHex(v.trip.color));
      this.dummy.position.y = 1.68;
      this.dummy.updateMatrix();
      this.carCabin.setMatrixAt(index, this.dummy.matrix);
      this.dummy.position.set(
        x - Math.sin(angle) * 1.91,
        0.92,
        z - Math.cos(angle) * 1.91,
      );
      this.dummy.updateMatrix();
      this.carLights.setMatrixAt(index, this.dummy.matrix);
      index++;
    }
    for (const mesh of [this.carBody, this.carCabin, this.carLights]) {
      mesh.count = index;
      mesh.instanceMatrix.needsUpdate = true;
    }
    if (this.carBody.instanceColor)
      this.carBody.instanceColor.needsUpdate = true;
    for (const signal of this.signals) {
      const phase = signalPhase(
          sim.network.nodes.get(signal.id)!.signal,
          sim.time,
        ),
        active = phase.startsWith(signal.axis);
      const lit = active ? (phase.endsWith("green") ? 2 : 1) : 0;
      signal.lamps.forEach((lamp, i) =>
        this.signalBulbs!.setColorAt(
          lamp,
          this.carColor.setHex(
            i === lit ? [0xe46652, 0xf3c857, 0x83d496][i] : 0x354a40,
          ),
        ),
      );
    }
    if (this.signalBulbs?.instanceColor)
      this.signalBulbs.instanceColor.needsUpdate = true;
    for (const road of roadMetrics) {
      this.roadMeshes
        .get(road.id)
        ?.material.color.setHex(
          overlay
            ? road.congestion < 0.35
              ? 0x659e88
              : road.congestion < 0.62
                ? 0xceb66d
                : 0xc87763
            : 0x778580,
        );
    }
    for (const label of this.labelElements) {
      const p = label.position.clone().project(this.camera);
      label.element.style.left = `${((p.x + 1) / 2) * this.width}px`;
      label.element.style.top = `${((1 - p.y) / 2) * this.height}px`;
      label.element.hidden =
        p.z < -1 ||
        p.z > 1 ||
        this.mapLayer === "land" ||
        !this.cameraView.showDetailLabels ||
        this.mapLayer === "waste" ||
        this.mapLayer === "access" ||
        this.mapLayer === "stock" ||
        this.mapLayer === "water";
    }
    for (const label of this.facilityLabels) {
      const facility = CITY_FACILITIES.find((f) => f.id === label.id)!;
      const site =
        sim instanceof WasteSimulation
          ? sim.sites.find((s) => s.facilityId === label.id)
          : undefined;
      const visible =
        this.mapLayer === "population" || (this.mapLayer === "waste" && !!site);
      label.element.hidden = !visible;
      if (!visible) continue;
      label.element.textContent =
        this.mapLayer === "waste"
          ? `${this.width > 600 ? site!.name + " · " : ""}${site!.remaining.toFixed(1)}봉투`
          : `${facility.purpose} · ${facility.population ? `거주 ${facility.population}` : `이용 ${facility.users}`}명`;
      label.element.dataset.level =
        site && this.mapLayer === "waste"
          ? site.remaining > 30
            ? "high"
            : site.remaining > 10
              ? "middle"
              : "low"
          : "population";
      label.element.dataset.layer = this.mapLayer;
      label.element.dataset.building = label.id;
      if (site && this.mapLayer === "waste") {
        label.element.style.setProperty(
          "--waste-color",
          cssColor(wasteColor(site.remaining)),
        );
      }
      const p = label.position.clone().project(this.camera);
      label.element.style.left = `${((p.x + 1) / 2) * this.width}px`;
      label.element.style.top = `${((1 - p.y) / 2) * this.height}px`;
    }
    if (this.residentView.visible) this.ring.visible = false;
    this.renderer.render(this.scene, this.camera);
  }
  get drawCalls() {
    return this.renderer.info.render.calls;
  }
}
import { ParkingSimulation, PARKING_SITES } from "../simulation/parking";
import { ParkingRenderer } from "./parking";
import { PlacementRenderer, type PlacementTarget } from "./placement";
