import * as THREE from "three";
import {
  FACILITY_SITES,
  FacilitySimulation,
  SERVICE_NAMES,
  type ServiceKind,
} from "../simulation/facilities";
import type { Selection } from "./city";
import type { MapLayer } from "../scenarios";
import { accessBand } from "./map-data";
import { facilityCoverage, coverageCells } from "./facility-coverage";

export class FacilityRenderer extends THREE.Group {
  readonly selectable: THREE.Object3D[] = [];
  private labels: {
    element: HTMLElement;
    position: THREE.Vector3;
    neighborhoodId?: string;
    facilityKind?: ServiceKind;
  }[] = [];
  private ownedMaterials: THREE.Material[] = [];
  private route = new THREE.Group();
  private coverage = new THREE.Group();
  private coverageIds: string[] = [];
  private coverageCellCount = 0;
  private coverageMaterials = [
    new THREE.MeshBasicMaterial({
      color: 0x42a3b4,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    new THREE.LineBasicMaterial({
      color: 0x277d8d,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
    }),
  ];
  private selectedNeighborhood?: string;
  private service: ServiceKind = "library";
  constructor(
    readonly simulation: FacilitySimulation,
    root: HTMLElement,
    occupiedPlots: readonly string[] = [],
  ) {
    super();
    this.add(this.route, this.coverage);
    this.ownedMaterials.push(...this.coverageMaterials);
    const material = (color: number) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
      this.ownedMaterials.push(m);
      return m;
    };
    const cream = material(0xe8d6aa),
      teal = material(0x557c7c),
      green = material(0x789b69),
      gold = material(0xc29c59),
      blue = material(0x6b9ba5),
      path = material(0xe5d9bd);
    const box = (
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
      m: THREE.Material,
      selection?: Selection,
    ) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.add(mesh);
      if (selection) {
        mesh.userData.selection = selection;
        this.selectable.push(mesh);
      }
      return mesh;
    };
    const label = (
      text: string,
      x: number,
      z: number,
      neighborhoodId?: string,
      facilityKind?: ServiceKind,
    ) => {
      const element = document.createElement("span");
      element.className = "map-label civic-label";
      element.textContent = text;
      root.append(element);
      this.labels.push({
        element,
        position: new THREE.Vector3(x, neighborhoodId ? 23 : 10, z),
        neighborhoodId,
        facilityKind,
      });
    };
    for (const plot of FACILITY_SITES) {
      if (
        occupiedPlots.includes(plot.id) ||
        simulation.facilities.some((f) => f.siteId === plot.id)
      )
        continue;
      const selection: Selection = {
        kind: "plot",
        id: plot.id,
        title: plot.name,
        description: `${plot.district} · ${plot.width * plot.depth}㎡의 비어 있는 공터예요.`,
      };
      box(
        plot.position.x,
        0.5,
        plot.position.z,
        4.6,
        0.2,
        4.6,
        gold,
        selection,
      );
      box(plot.position.x, 2, plot.position.z, 0.25, 3, 0.25, teal, selection);
      box(
        plot.position.x + 0.7,
        3.1,
        plot.position.z,
        1.4,
        0.9,
        0.1,
        cream,
        selection,
      );
      // Plot lettering is shared with the permanent land map.
    }
    for (const f of simulation.facilities) {
      const { x, z } = f.position;
      const selection: Selection = {
        kind: "civic",
        id: f.id,
        title: f.name,
        description: "위치와 하루 이용 자리를 확인해요.",
      };
      if (f.kind === "library") {
        const width = f.isNew ? 18 : simulation.configuration.expand ? 14 : 9,
          depth = f.isNew ? 18 : 6;
        box(x, 3, z, width, 5.4, depth, cream, selection);
        box(x, 6, z, width + 0.3, 0.5, depth + 0.3, teal, selection);
        box(x, 2, z - depth / 2 - 0.08, 1.4, 3, 0.12, blue, selection);
        for (const dx of [-0.95, 0.95])
          box(x + dx, 4.5, z - depth / 2 - 0.1, 0.65, 0.9, 0.15, blue);
        if (!f.isNew) {
          box(80.9, 0.38, 108, 17.8, 0.15, 1.5, path);
          box(89.8, 0.38, 105.1, 1.5, 0.15, 5.8, path);
          if (simulation.configuration.gate) {
            box(63.1, 0.38, 108, 17.8, 0.15, 1.5, path);
            box(54.2, 0.38, 105.1, 1.5, 0.15, 5.8, path);
          }
        }
      } else if (f.isNew) {
        box(x, 0.45, z, 30, 0.3, 30, green, selection);
        box(x, 0.75, z, 2, 0.1, 30, path);
        box(x, 0.75, z, 30, 0.1, 2, path);
        for (const dx of [-9, 9])
          for (const dz of [-9, 9]) {
            box(x + dx, 2, z + dz, 0.7, 3, 0.7, gold);
            box(x + dx, 4.1, z + dz, 5, 3, 5, green);
          }
        box(x + 5, 1.1, z + 3, 1, 1, 4, gold, selection);
      } else {
        const proxy = box(x, 2, z, 5, 3, 5, green, selection);
        proxy.visible = false; // The existing park geometry is reused; label/buttons offer direct selection.
      }
      label(f.name, x, z, undefined, f.kind);
    }
    for (const n of simulation.neighborhoods)
      label("", n.position.x, n.position.z, n.id);
    this.drawCoverage();
  }
  selectNeighborhood(id?: string) {
    this.selectedNeighborhood = id;
    this.drawRoute();
  }
  setService(kind: ServiceKind) {
    if (this.service === kind) return;
    this.service = kind;
    this.drawRoute();
    this.drawCoverage();
  }
  get coverageSnapshot() {
    return {
      visible: this.coverage.visible,
      service: this.service,
      facilityIds: [...this.coverageIds],
      cells: this.coverageCellCount,
    };
  }
  private drawCoverage() {
    this.coverage.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Line)
        o.geometry.dispose();
    });
    this.coverage.clear();
    const data = facilityCoverage(this.simulation, this.service);
    this.coverageIds = data.facilityIds;
    const cells = coverageCells(data.segments),
      size = 2;
    this.coverageCellCount = cells.size;
    const fill: number[] = [],
      edge: number[] = [];
    for (const cell of cells) {
      const [x, z] = cell.split(",").map(Number);
      const a = [x * size, 0.56, z * size],
        b = [(x + 1) * size, 0.56, z * size];
      const c = [(x + 1) * size, 0.56, (z + 1) * size],
        d = [x * size, 0.56, (z + 1) * size];
      fill.push(...a, ...b, ...c, ...a, ...c, ...d);
      if (!cells.has(`${x},${z - 1}`)) edge.push(...a, ...b);
      if (!cells.has(`${x + 1},${z}`)) edge.push(...b, ...c);
      if (!cells.has(`${x},${z + 1}`)) edge.push(...c, ...d);
      if (!cells.has(`${x - 1},${z}`)) edge.push(...d, ...a);
    }
    const geometry = (vertices: number[]) =>
      new THREE.BufferGeometry().setAttribute(
        "position",
        new THREE.Float32BufferAttribute(vertices, 3),
      );
    this.coverage.add(
      new THREE.Mesh(geometry(fill), this.coverageMaterials[0]),
      new THREE.LineSegments(geometry(edge), this.coverageMaterials[1]),
    );
    for (const f of this.simulation.facilities.filter(
      (f) => f.kind === this.service,
    )) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(f.isNew ? 4 : 8, f.isNew ? 5 : 9, 48),
        this.coverageMaterials[0],
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(f.position.x, 0.6, f.position.z);
      this.coverage.add(ring);
    }
  }
  private drawRoute() {
    for (const child of this.route.children)
      if (child instanceof THREE.Line) child.geometry.dispose();
    this.route.clear();
    const row = this.simulation.access.find(
      (n) => n.id === this.selectedNeighborhood,
    );
    const route = row?.services[this.service].nearest?.route;
    if (!route) return;
    const lineMaterial =
      this.route.userData.material ??
      new THREE.LineBasicMaterial({ color: 0xb27937, depthTest: false });
    if (!this.route.userData.material) {
      this.route.userData.material = lineMaterial;
      this.ownedMaterials.push(lineMaterial);
    }
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(
        route.path.map((p) => new THREE.Vector3(p.x, 0.7, p.z)),
      ),
      lineMaterial,
    );
    line.renderOrder = 8;
    this.route.add(line);
  }
  update(camera: THREE.Camera, width: number, height: number, layer: MapLayer) {
    this.route.visible = layer === "access";
    this.coverage.visible = layer === "access";
    for (const label of this.labels) {
      if (label.neighborhoodId) {
        const service = this.simulation.access.find(
          (n) => n.id === label.neighborhoodId,
        )!.services[this.service];
        label.element.textContent = `${width > 600 ? SERVICE_NAMES[this.service] + " " : ""}${service.nearest ? (service.nearest.route.seconds / 60).toFixed(1) + "분" : "길 없음"} · ${service.served}/${service.demand}명`;
        label.element.dataset.level = accessBand(
          service.nearest?.route.seconds ?? null,
        ).id;
        label.element.dataset.building = label.neighborhoodId;
      }
      label.element.classList.toggle(
        "coverage-source",
        layer === "access" && label.facilityKind === this.service,
      );
      const p = label.position.clone().project(camera);
      label.element.hidden =
        p.z > 1 ||
        p.z < -1 ||
        (!!label.neighborhoodId && layer !== "access") ||
        (layer === "access" &&
          !label.neighborhoodId &&
          label.facilityKind !== this.service);
      label.element.style.left = `${((p.x + 1) / 2) * width}px`;
      label.element.style.top = `${((1 - p.y) / 2) * height}px`;
    }
  }
  dispose() {
    this.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Line)
        o.geometry.dispose();
    });
    this.ownedMaterials.forEach((m) => m.dispose());
    this.labels.forEach((l) => l.element.remove());
    this.removeFromParent();
  }
}
