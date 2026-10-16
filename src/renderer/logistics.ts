import { LabelClock } from "./label-clock";
import * as THREE from "three";
import { inCityBounds } from "../city/world";
import { LogisticsSimulation } from "../simulation/economy";
import { CITY_FACILITIES } from "../city/data";
import type { Selection } from "./city";
import type { MapLayer } from "../scenarios";
import { stockBand } from "./map-data";

export class LogisticsRenderer extends THREE.Group {
  private labelClock = new LabelClock();
  readonly selectable: THREE.Object3D[] = [];
  private owned: THREE.Material[] = [];
  private trucks = new Map<number, { group: THREE.Group; cargo: THREE.Mesh }>();
  private piles: { shopId: string; mesh: THREE.Mesh }[] = [];
  private labels: {
    element: HTMLElement;
    position: THREE.Vector3;
    shopId?: string;
    sourceId?: string;
  }[] = [];
  constructor(
    private simulation: LogisticsSimulation,
    root: HTMLElement,
  ) {
    super();
    const material = (color: number) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
      this.owned.push(m);
      return m;
    };
    const gold = material(0xbe9145),
      blue = material(0x558fac),
      cream = material(0xeee4cc),
      glass = material(0x3e6373),
      dark = material(0x394b4a),
      crate = material(0xd3ad72);
    const box = (
      g: THREE.Group,
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
      mesh.castShadow = mesh.receiveShadow = true;
      g.add(mesh);
      if (selection) {
        mesh.userData.selection = selection;
        this.selectable.push(mesh);
      }
      return mesh;
    };
    for (const s of simulation.sources) {
      const selection: Selection = {
        kind: "supply",
        id: s.id,
        title: s.name,
        description: "상점으로 보내기 전에 물자를 준비하는 곳이에요.",
      };
      const { x, z } = s.position;
      box(this, x, 1.7, z, 5.2, 3, 4.2, s.external ? blue : gold, selection);
      box(this, x, 3.4, z, 5.8, 0.4, 4.8, cream, selection);
      box(this, x - 1, 1.5, z + 2.15, 1.7, 2.4, 0.15, dark, selection);
      const element = document.createElement("span");
      element.className = "map-label supply-label";
      root.append(element);
      this.labels.push({
        element,
        position: new THREE.Vector3(x, 8, z),
        sourceId: s.id,
      });
    }
    for (const shop of simulation.shops) {
      const b = CITY_FACILITIES.find((f) => f.id === shop.facilityId)!;
      const selection: Selection = {
        kind: "building",
        id: shop.facilityId,
        title: shop.name,
        description: "배송받은 물자가 판매되고 남은 재고를 살펴봐요.",
      };
      const pile = box(
        this,
        b.position.x,
        0.8,
        b.position.z + 2,
        3,
        1,
        3,
        crate,
        selection,
      );
      this.piles.push({ shopId: shop.id, mesh: pile });
      const element = document.createElement("span");
      element.className = "map-label stock-label";
      element.dataset.shop = shop.id;
      root.append(element);
      this.labels.push({
        element,
        position: new THREE.Vector3(b.position.x, 27, b.position.z),
        shopId: shop.id,
      });
    }
    for (const t of simulation.trucks) {
      const g = new THREE.Group();
      this.add(g);
      const selection: Selection = {
        kind: "service",
        id: String(t.id),
        title: t.name,
        description: "물자를 싣고 실제 도로·신호를 따라 움직이는 화물차예요.",
      };
      box(g, 0, 0.95, -0.4, 1.8, 0.4, 2.7, dark, selection);
      box(
        g,
        0,
        1.4,
        1.15,
        1.8,
        1.3,
        1.4,
        t.id === 20001 ? blue : gold,
        selection,
      );
      box(g, 0, 1.7, 1.86, 1.5, 0.65, 0.07, glass);
      const cargo = box(g, 0, 1.6, -0.65, 1.65, 1.1, 2.2, crate, selection);
      box(g, 0, 2.2, -0.65, 0.15, 0.1, 2.3, cream);
      for (const z of [-1.2, 1.2]) box(g, 0, 0.65, z, 1.8, 0.5, 0.5, dark);
      this.trucks.set(t.id, { group: g, cargo });
    }
  }
  update(
    camera: THREE.Camera,
    width: number,
    height: number,
    layer: MapLayer,
    alpha: number,
  ) {
    for (const t of this.simulation.trucks) {
      const { group, cargo } = this.trucks.get(t.id)!;
      const v = this.simulation.vehicles.get(t.id);
      group.visible = !!v && inCityBounds(v.pose);
      if (!v) continue;
      group.position.set(
        v.previousPose.x + (v.pose.x - v.previousPose.x) * alpha,
        0,
        v.previousPose.z + (v.pose.z - v.previousPose.z) * alpha,
      );
      group.rotation.y =
        v.previousPose.angle +
        Math.atan2(
          Math.sin(v.pose.angle - v.previousPose.angle),
          Math.cos(v.pose.angle - v.previousPose.angle),
        ) *
          alpha;
      cargo.visible = t.load > 0.01;
      cargo.scale.y = Math.max(0.12, t.load / t.capacity);
      cargo.position.y = 1.15 + cargo.scale.y * 0.55;
    }
    for (const { shopId, mesh } of this.piles) {
      const amount = this.simulation.shops.find((s) => s.id === shopId)!.stock;
      mesh.visible = amount > 0.05;
      mesh.scale.y = Math.max(0.1, amount / 15);
      mesh.position.y = 0.3 + mesh.scale.y * 0.5;
    }
    if (layer !== "stock") {
      for (const label of this.labels) label.element.hidden = true;
      return;
    }
    if (!this.labelClock.due(camera, width, height)) return;
    const occupied: {
      left: number;
      right: number;
      top: number;
      bottom: number;
    }[] = [];
    if (width <= 600 || document.body.classList.contains("living-city")) {
      for (const tools of document.querySelectorAll(
        ".map-tools,#overlay-legend",
      ))
        if (tools.getClientRects().length)
          occupied.push(tools.getBoundingClientRect());
    }
    // Keep stock numbers next to their buildings; fit supply labels around them.
    for (const l of [...this.labels].sort(
      (a, b) => Number(!!b.shopId) - Number(!!a.shopId),
    )) {
      const p = l.position.clone().project(camera);
      l.element.hidden = layer !== "stock" || p.z < -1 || p.z > 1;
      if (l.shopId) {
        const shop = this.simulation.shops.find((s) => s.id === l.shopId)!;
        l.element.textContent = `${width > 600 ? shop.name + " · " : ""}${shop.stock < 0.05 ? "품절" : shop.stock.toFixed(1) + "상자"}`;
        l.element.dataset.level = stockBand(shop.stock).id;
      } else {
        const source = this.simulation.sources.find(
          (s) => s.id === l.sourceId,
        )!;
        const name =
          source.id === "factory"
            ? "우리 공장"
            : source.id === "east-region"
              ? "들녘 입구"
              : "강빛 입구";
        l.element.textContent = `${name} · ${source.stock.toFixed(1)}${width > 600 ? "상자 대기" : ""}`;
      }
      const half = l.element.offsetWidth / 2;
      const x = Math.max(
        half + 8,
        Math.min(width - half - 8, ((p.x + 1) / 2) * width),
      );
      let y = ((1 - p.y) / 2) * height;
      const h = l.element.offsetHeight;
      const overlaps = (bottom: number) =>
        occupied.some(
          (r) =>
            x + half + 4 > r.left &&
            x - half - 4 < r.right &&
            bottom + 4 > r.top &&
            bottom - h - 4 < r.bottom,
        );
      const offset = [0, h + 6, -h - 6, 2 * (h + 6), -2 * (h + 6)].find(
        (dy) => !overlaps(y + dy),
      );
      y += offset ?? 0;
      l.element.style.left = `${x}px`;
      l.element.style.top = `${y}px`;
      if (!l.element.hidden)
        occupied.push({
          left: x - half,
          right: x + half,
          top: y - h,
          bottom: y,
        });
    }
  }
  dispose() {
    this.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.owned.forEach((m) => m.dispose());
    this.labels.forEach((l) => l.element.remove());
    this.removeFromParent();
  }
}
