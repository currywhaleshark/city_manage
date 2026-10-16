import { LabelClock } from "./label-clock";
import * as THREE from "three";
import {
  DumpingSimulation,
  DUMPING_SITES,
  dumpingBinPosition,
} from "../simulation/services/dumping";
import type { Selection } from "./city";
export class DumpingRenderer extends THREE.Group {
  private labelClock = new LabelClock();
  readonly selectable: THREE.Object3D[] = [];
  private root = document.createElement("div");
  private markers: {
    id: string;
    button: HTMLButtonElement;
    line: SVGLineElement;
    point: THREE.Vector3;
    bags: THREE.InstancedMesh;
  }[] = [];
  private overflow?: THREE.InstancedMesh;
  constructor(
    private sim: DumpingSimulation,
    container: HTMLElement,
    onChoose: (id: string) => void,
  ) {
    super();
    this.root.className = "dumping-map parking-map";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("aria-hidden", "true");
    this.root.append(svg);
    container.append(this.root);
    const bagGeometry = new THREE.IcosahedronGeometry(0.7, 1),
      bagMaterial = new THREE.MeshStandardMaterial({
        color: 0x6d4d35,
        roughness: 1,
      });
    const makeBags = (x: number, z: number, selection: Selection) => {
      const bags = new THREE.InstancedMesh(bagGeometry, bagMaterial, 40),
        dummy = new THREE.Object3D();
      for (let i = 0; i < 40; i++) {
        dummy.position.set(
          ((i % 3) - 1) * 1.1,
          0.9 + Math.floor(i / 9) * 1.0,
          ((Math.floor(i / 3) % 3) - 1) * 1.1,
        );
        dummy.scale.set(1, 0.9, 1);
        dummy.updateMatrix();
        bags.setMatrixAt(i, dummy.matrix);
      }
      bags.position.set(x, 0, z);
      bags.castShadow = true;
      bags.userData.selection = selection;
      this.add(bags);
      this.selectable.push(bags);
      return bags;
    };
    for (const site of DUMPING_SITES) {
      const selection: Selection = {
        kind: "dumping",
        id: site.id,
        title: site.name,
        description: "지정된 곳 밖의 투기물을 조사해요.",
      };
      const bags = makeBags(site.position.x, site.position.z, selection);
      const button = document.createElement("button");
      button.className = "parking-label dumping-label";
      button.dataset.dumpingLabel = site.id;
      button.addEventListener("click", () => onChoose(site.id));
      const line = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "line",
      );
      svg.append(line);
      this.root.append(button);
      this.markers.push({
        id: site.id,
        button,
        line,
        point: new THREE.Vector3(site.position.x, 3, site.position.z),
        bags,
      });
      if (sim.dumpingConfiguration.dropoff && sim.plan.dropoff === site.id) {
        const p = dumpingBinPosition(site.id),
          bin = new THREE.Mesh(
            new THREE.BoxGeometry(3, 1.7, 4),
            new THREE.MeshStandardMaterial({ color: 0x4d8a79 }),
          );
        bin.position.set(p.x, 1.1, p.z);
        bin.userData.selection = selection;
        this.add(bin);
        this.selectable.push(bin);
        this.overflow = makeBags(p.x, p.z + 3.5, selection);
      }
    }
  }
  update(
    camera: THREE.Camera,
    width: number,
    height: number,
    showLabels = true,
  ) {
    for (const marker of this.markers)
      marker.bags.count = Math.min(
        40,
        Math.ceil(this.sim.illegal(marker.id).remaining / 2),
      );
    if (this.overflow)
      this.overflow.count = Math.min(
        40,
        Math.ceil(
          Math.max(0, this.sim.bin(this.sim.plan.dropoff).remaining - 16) / 2,
        ),
      );
    this.root.hidden = !showLabels;
    if (!showLabels || !this.labelClock.due(camera, width, height)) return;
    const root = this.root.getBoundingClientRect();
    const occupied = [
      ...document.querySelectorAll<HTMLElement>(
        ".applied-policy-pin,.mission-peek,.map-tools,#overlay-legend,.map-controls",
      ),
    ]
      .filter((el) => !el.hidden && el.offsetWidth)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x - root.x, y: r.y - root.y, w: r.width, h: r.height };
      });
    const overlaps = (
      a: { x: number; y: number; w: number; h: number },
      b: { x: number; y: number; w: number; h: number },
    ) =>
      Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x) - 5 &&
      Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y) - 5;
    for (const marker of this.markers) {
      const s = this.sim.illegal(marker.id),
        p = marker.point.clone().project(camera),
        sx = ((p.x + 1) * width) / 2,
        sy = ((1 - p.y) * height) / 2;
      marker.bags.count = Math.min(40, Math.ceil(s.remaining / 2));
      marker.button.textContent = `${s.name.replace(" · 투기물", "")} · ${s.remaining.toFixed(0)}봉투`;
      marker.button.hidden =
        Math.abs(p.x) > 1 || Math.abs(p.y) > 1 || Math.abs(p.z) > 1;
      const w = marker.button.offsetWidth || 150,
        h = 30,
        x = Math.max(8, Math.min(width - w - 8, sx - w / 2));
      let y = Math.max(130, Math.min(height - h - 8, sy - 40));
      const options = [
        y,
        ...Array.from({ length: 14 }, (_, i) => 130 + i * 38),
      ].filter((v) => v < height - h - 8);
      y =
        options.find(
          (v) => !occupied.some((o) => overlaps({ x, y: v, w, h }, o)),
        ) ?? y;
      marker.button.style.left = `${x + w / 2}px`;
      marker.button.style.top = `${y + h}px`;
      occupied.push({ x, y, w, h });
      marker.line.style.display = marker.button.hidden ? "none" : "";
      for (const [key, value] of Object.entries({
        x1: sx,
        y1: sy,
        x2: x + w / 2,
        y2: y + h - 2,
      }))
        marker.line.setAttribute(key, String(value));
    }
    if (this.overflow)
      this.overflow.count = Math.min(
        40,
        Math.ceil(
          Math.max(0, this.sim.bin(this.sim.plan.dropoff).remaining - 16) / 2,
        ),
      );
  }
  dispose() {
    this.root.remove();
    const geometries = new Set<THREE.BufferGeometry>(),
      materials = new Set<THREE.Material>();
    this.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        if (o instanceof THREE.InstancedMesh) o.dispose();
        geometries.add(o.geometry);
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) =>
          materials.add(m),
        );
      }
    });
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    this.removeFromParent();
  }
}
