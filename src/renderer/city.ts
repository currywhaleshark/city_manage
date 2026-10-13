// Procedural box buildings, cone trees, road strips and two-part cars adapted from
// Sudoyan118/mini-traffic-city-sim src/main.ts (MIT). Rendering is now isolated,
// static geometry is merged, and dynamic cars use persistent instanced meshes.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { BUILDINGS, CONFIG, SCHOOL_NODE, seededRandom } from "../scenario";
import { signalPhase } from "../simulation/network";
import type { TrafficSimulation } from "../simulation";
import type { Lane, RoadMetric } from "../types";
import { DISPLAY_PRESETS, type DisplayQuality } from "./quality";
import { PedestrianRenderer } from "./pedestrians";

export interface Selection {
  kind: "building" | "road" | "node";
  id: string;
  title: string;
  description: string;
}
export class CityRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-160, 160, 160, -160, 1, 1200);
  readonly controls: OrbitControls;
  private city = new THREE.Group();
  private walkers = new PedestrianRenderer();
  private walkSignals: { nodeId: string; material: THREE.MeshBasicMaterial }[] =
    [];
  private roads = new THREE.Group();
  private signals: {
    id: string;
    axis: "ns" | "ew";
    lamps: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[];
  }[] = [];
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
    sun.position.set(-100, 190, 95);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, {
      left: -170,
      right: 170,
      top: 170,
      bottom: -170,
      near: 10,
      far: 450,
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
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.minPolarAngle = 0.25;
    this.controls.maxPolarAngle = 1.22;
    this.controls.minZoom = 0.65;
    this.controls.maxZoom = 3.8;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(8, 8.7, 48),
      new THREE.MeshBasicMaterial({ color: 0xf3be53, side: THREE.DoubleSide }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.65;
    this.ring.visible = false;
    this.scene.add(this.ring);
    this.staticCity();
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
    this.box(this.city, 0, -2.6, 0, 234, 5, 234, 0xb0bca1);
    this.box(this.city, 0, -0.3, 0, 233, 0.6, 233, 0xc8d2b5);
    const random = seededRandom(1337);
    for (const b of BUILDINGS) {
      this.box(
        this.city,
        b.x,
        0.08,
        b.z,
        35,
        0.25,
        35,
        b.kind === "park" ? 0x9fb793 : 0xd9d8c4,
      );
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
        this.box(this.city, b.x, 5.5, b.z - 7, 28, 11, 12, 0xf2dfb3);
        this.box(this.city, b.x, 11.5, b.z - 7, 30, 1.5, 14, 0xaf725d);
        this.box(this.city, b.x - 11, 3, b.z + 3, 6, 6, 10, 0xe3c697);
        this.box(this.city, b.x + 5, 0.4, b.z + 9, 18, 0.4, 11, 0xcba880);
        for (let i = -10; i <= 10; i += 5) {
          this.box(this.city, b.x + i, 7, b.z - 0.85, 2.5, 3, 0.2, 0x769ca6);
          this.box(this.city, b.x + i, 3, b.z - 0.85, 2.5, 2.5, 0.2, 0x769ca6);
        }
        this.box(this.city, b.x, 2, b.z - 0.6, 3, 4, 0.3, 0x705e50);
      } else if (b.kind === "factory") {
        this.box(this.city, b.x, 4, b.z, 27, 8, 21, 0xbbbdaf);
        this.box(this.city, b.x, 8.5, b.z, 28, 1, 22, 0x738a8a);
        this.box(this.city, b.x + 10, 12, b.z - 8, 3, 13, 3, 0xb5957e);
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
          this.box(this.city, x, h / 2, z, 11, h, 11, palette[j % 3]);
          this.box(
            this.city,
            x,
            h + 0.55,
            z,
            12,
            1.1,
            12,
            b.kind === "home" ? 0x889c8c : 0x82999b,
          );
          this.box(this.city, x + 2, h + 1.2, z, 3, 1, 3, 0xa4b3ad);
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
    for (let i = -100; i <= 100; i += 14) {
      this.tree(i, -109, 0.85);
      this.tree(-109, i, 0.9);
      if (i < 40) this.tree(i, 109, 0.8);
    }
    // One draw call per static material, instead of a draw call per window/tree.
    this.city.updateMatrixWorld(true);
    const groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
    for (const object of [...this.city.children])
      if (object instanceof THREE.Mesh) {
        const material = object.material as THREE.Material;
        if (!groups.has(material)) groups.set(material, []);
        const geometry = object.geometry
          .clone()
          .applyMatrix4(object.matrixWorld);
        groups.get(material)!.push(geometry);
        object.geometry.dispose();
      }
    this.city.clear();
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
    this.current = sim;
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
    this.selectable = this.selectable.filter(
      (o) => o.userData.selection?.kind === "building",
    );
    for (const road of sim.network.roads.values()) {
      const a = sim.network.nodes.get(road.startNodeId)!.position,
        b = sim.network.nodes.get(road.endNodeId)!.position;
      const group = new THREE.Group();
      group.position.set((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
      group.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
      this.roads.add(group);
      this.box(group, 0, 0.04, 0, 10.5, 0.3, road.length, 0xbfc5ba);
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(7.4, 0.17, road.length),
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
      for (let z = -16; z <= 16; z += 7)
        this.box(group, 0, 0.34, z, 0.14, 0.025, 3.2, 0xe9dcc0);
      if (road.laneCount > 1)
        for (const lane of sim.network.lanes.values())
          if (lane.roadId === road.id) this.laneArrows(lane);
    }
    for (const node of sim.network.nodes.values()) {
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
          const bulb = new THREE.Mesh(
            new THREE.SphereGeometry(0.31, 8, 6),
            new THREE.MeshBasicMaterial({ color: 0x33443c }),
          );
          bulb.position.set(x, 5.65 - i * 0.8, z + 0.44);
          bulb.userData.ownedMaterial = true;
          group.add(bulb);
          lamps.push(bulb);
        }
        this.signals.push({ id: node.id, axis, lamps });
      }
    }
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
            | Selection
            | undefined)
        : this.selected;
    this.select(
      chosen && (chosen.kind !== "road" || sim.network.roads.has(chosen.id))
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
    this.ring.visible = true;
    if (selection.kind === "building") {
      const b = BUILDINGS.find((b) => b.id === selection.id)!;
      this.ring.position.set(b.x, 0.6, b.z);
      this.ring.scale.set(2.3, 2.3, 2.3);
    } else if (selection.kind === "node") {
      const n = this.current?.network.nodes.get(selection.id);
      if (n) this.ring.position.set(n.position.x, 0.6, n.position.z);
      this.ring.scale.setScalar(1);
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
    this.controls.target.set(35, 0, -2);
    this.camera.position.set(210, 200, 220);
    this.camera.zoom = 1.65;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.select({
      kind: "node",
      id: SCHOOL_NODE,
      title: "학교 앞 교차로",
      description: "가로길과 세로길의 신호를 비교해 보세요.",
    });
  }
  resetCamera() {
    this.camera.position.set(240, 245, 275);
    this.controls.target.set(0, 0, 0);
    this.camera.zoom = 1.16;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }
  zoom(factor: number) {
    this.camera.zoom = THREE.MathUtils.clamp(
      this.camera.zoom * factor,
      0.65,
      3.8,
    );
    this.camera.updateProjectionMatrix();
  }
  private pick(event: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect(),
      pointer = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(pointer, this.camera);
    const hit = ray.intersectObjects(this.selectable, false)[0];
    if (hit) this.select(hit.object.userData.selection);
  }
  private resize() {
    const rect = this.canvas.parentElement!.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    this.renderer.setSize(rect.width, rect.height, false);
    const aspect = rect.width / rect.height;
    const size = aspect < 1 ? 180 / aspect : 164;
    this.camera.left = -size * aspect;
    this.camera.right = size * aspect;
    this.camera.top = size;
    this.camera.bottom = -size;
    this.camera.updateProjectionMatrix();
  }
  render(
    sim: TrafficSimulation,
    overlay: boolean,
    roadMetrics: RoadMetric[],
    paused = false,
  ) {
    this.controls.update();
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
      if (index >= 1500) break;
      const p = v.pose,
        q = v.previousPose,
        x = q.x + (p.x - q.x) * alpha,
        z = q.z + (p.z - q.z) * alpha;
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
        lamp.material.color.setHex(
          i === lit ? [0xe46652, 0xf3c857, 0x83d496][i] : 0x354a40,
        ),
      );
    }
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
      label.element.hidden = p.z > 1;
    }
    this.renderer.render(this.scene, this.camera);
  }
  get drawCalls() {
    return this.renderer.info.render.calls;
  }
}
