import * as THREE from "three";
import { ParkingSimulation, PARKING_SITES } from "../simulation/parking";
import { BUILDABLE_PLOTS, inCityBounds } from "../city/world";
import type { Selection } from "./city";
export class ParkingRenderer extends THREE.Group {
  readonly selectable: THREE.Object3D[] = [];
  private cars = new Map<number, THREE.Group>();
  private layer = document.createElement("div");
  private labels: {
    element: HTMLElement;
    point: THREE.Vector3;
    id: string;
    line: SVGLineElement;
  }[] = [];
  constructor(
    private sim: ParkingSimulation,
    root: HTMLElement,
    onChoose: (id: string) => void,
  ) {
    super();
    this.layer.className = "parking-map";
    root.parentElement!.append(this.layer);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("aria-hidden", "true");
    this.layer.append(svg);
    const box = (
      g: THREE.Group,
      w: number,
      h: number,
      d: number,
      x: number,
      y: number,
      z: number,
      color: number,
      selection?: Selection,
    ) => {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshStandardMaterial({ color, roughness: 0.85 }),
      );
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
      if (selection) {
        m.userData.selection = selection;
        this.selectable.push(m);
      }
      return m;
    };
    for (const s of PARKING_SITES) {
      const element = document.createElement("button");
      element.className = "parking-label";
      element.dataset.parkingLabel = s.id;
      element.addEventListener("click", () => onChoose(s.id));
      const line = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "line",
      );
      svg.append(line);
      this.layer.append(element);
      this.labels.push({
        element,
        point: new THREE.Vector3(s.position.x, 3, s.position.z),
        id: s.id,
        line,
      });
      const selection: Selection = {
        kind: "parking",
        id: s.id,
        title: s.name,
        description: s.reason,
      };
      box(
        this,
        1,
        4,
        1,
        s.position.x,
        2,
        s.position.z + 8,
        0xb46b4d,
        selection,
      );
      box(
        this,
        5,
        2,
        0.5,
        s.position.x,
        4,
        s.position.z + 8,
        0xffdfb2,
        selection,
      );
    }
    if (sim.configuration.parkingLot) {
      const p = BUILDABLE_PLOTS.find((p) => p.id === sim.plan.siteId)!;
      box(
        this,
        p.width,
        0.15,
        p.depth,
        p.position.x,
        0.64,
        p.position.z,
        0x637777,
      );
      for (let i = 0; i <= sim.lotCapacity; i++)
        box(
          this,
          0.14,
          0.05,
          6,
          p.position.x - 10.5 + i * 5,
          0.75,
          p.position.z,
          0xe4e8de,
        );
    }
    if (sim.configuration.loadingBay) {
      const p = sim.bayPose(sim.plan.loadingSite);
      box(this, 7, 0.16, 4, p.x, 0.65, p.z, 0x4d957b);
    }
    for (const ep of sim.episodes) {
      const g = new THREE.Group();
      this.add(g);
      this.cars.set(ep.request.id, g);
      const site = PARKING_SITES.find((s) => s.id === ep.request.siteId)!;
      const sel: Selection = {
        kind: "parking",
        id: site.id,
        title: site.name,
        description: site.reason,
      };
      box(g, 3.8, 1, 1.8, 0, 1.05, 0, ep.request.color, sel);
      box(g, 1.9, 0.6, 1.55, -0.2, 1.8, 0, 0x46616a, sel);
      for (const x of [-1.1, 1.1])
        for (const z of [-0.9, 0.9])
          box(g, 0.7, 0.6, 0.22, x, 0.7, z, 0x303e3c, sel);
      if (ep.destination === "illegal")
        box(g, 4.6, 0.08, 2.6, 0, 0.5, 0, 0xcc7658);
    }
  }
  update(
    camera: THREE.Camera,
    width: number,
    height: number,
    alpha: number,
    showLabels = true,
  ) {
    for (const ep of this.sim.episodes) {
      const g = this.cars.get(ep.request.id)!;
      const car = this.sim.vehicles.get(ep.request.id);
      const p = car
        ? {
            x: THREE.MathUtils.lerp(car.previousPose.x, car.pose.x, alpha),
            z: THREE.MathUtils.lerp(car.previousPose.z, car.pose.z, alpha),
            angle: car.pose.angle,
          }
        : ep.pose;
      g.visible = ep.phase !== "finished" && inCityBounds(p);
      g.position.set(p.x, 0, p.z);
      g.rotation.y = Math.PI / 2 + p.angle;
    }
    if (!showLabels) return;
    const rect = this.layer.getBoundingClientRect();
    const occupied = [
      ...document.querySelectorAll<HTMLElement>(".applied-policy-pin"),
    ]
      .filter((el) => !el.hidden && el.offsetWidth > 0)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          x: r.x - rect.x + r.width / 2,
          y: r.y - rect.y + r.height / 2,
          w: r.width,
          h: r.height,
        };
      });
    for (const l of this.labels) {
      const p = l.point.clone().project(camera),
        s = this.sim.parkingStats.sites.find((s) => s.id === l.id)!;
      l.element.hidden =
        p.z < -1 || p.z > 1 || Math.abs(p.x) > 1 || Math.abs(p.y) > 1;
      l.element.textContent = `${s.name} · ${s.illegal}대`;
      const w = l.element.offsetWidth || 135,
        sx = ((p.x + 1) * width) / 2,
        sy = ((1 - p.y) * height) / 2;
      const x = Math.max(w / 2 + 8, Math.min(width - w / 2 - 8, sx));
      let y = Math.max(100, Math.min(height - 10, sy - 12));
      while (
        occupied.some(
          (b) =>
            Math.abs(b.x - x) < (b.w + w) / 2 + 6 &&
            Math.abs(b.y - (y - 14)) < (b.h + 28) / 2 + 6,
        ) &&
        y < height - 44
      )
        y += 34;
      l.element.style.left = `${x}px`;
      l.element.style.top = `${y}px`;
      l.element.setAttribute(
        "aria-label",
        `${s.name} 불법주차 ${s.illegal}대 살펴보기`,
      );
      l.line.style.display = l.element.hidden ? "none" : "";
      l.line.setAttribute("x1", String(sx));
      l.line.setAttribute("y1", String(sy));
      l.line.setAttribute("x2", String(x));
      l.line.setAttribute("y2", String(y - 5));
      if (!l.element.hidden) occupied.push({ x, y: y - 14, w, h: 28 });
    }
  }
  dispose() {
    this.layer.remove();
    this.labels.forEach((l) => l.element.remove());
    this.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        ms.forEach((m) => m.dispose());
      }
    });
    this.removeFromParent();
  }
}
