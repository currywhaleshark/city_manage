import { LabelClock } from "./label-clock";
import * as THREE from "three";
import {
  WaterSimulation,
  WATER_SITES,
  WATER_SOURCES,
  WATER_BANKS,
  WATER_CELL_LENGTH,
  waterColor,
  waterLevel,
} from "../simulation/water";
import { WORLD, RIVER, BUILDABLE_PLOTS } from "../city/world";

export class WaterRenderer extends THREE.Group {
  private labelClock = new LabelClock();
  readonly selectable: THREE.Object3D[] = [];
  private root = document.createElement("div");
  private surfaces: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] =
    [];
  private markers: {
    button: HTMLButtonElement;
    line: SVGLineElement;
    point: THREE.Vector3;
  }[] = [];
  private floating: THREE.InstancedMesh;
  private banks: THREE.Mesh[] = [];
  constructor(
    private sim: WaterSimulation,
    container: HTMLElement,
    choose: (id: string) => void,
  ) {
    super();
    this.root.className = "water-map parking-map";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("aria-hidden", "true");
    this.root.append(svg);
    container.append(this.root);
    const box = (
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
      color: number,
    ) => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshStandardMaterial({ color }),
      );
      mesh.position.set(x, y, z);
      this.add(mesh);
      return mesh;
    };
    for (let i = 0; i < 9; i++) {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(RIVER.width - 0.2, WATER_CELL_LENGTH),
        new THREE.MeshBasicMaterial({ color: 0x72b8c5 }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(
        RIVER.x,
        0.181,
        WORLD.min + WATER_CELL_LENGTH * (i + 0.5),
      );
      this.surfaces.push(mesh);
      this.add(mesh);
    }
    for (const site of WATER_SITES) {
      const marker = box(
        RIVER.x - 8,
        1.5,
        site.position.z,
        1.8,
        3,
        1.8,
        0xf7efce,
      );
      marker.userData.selection = {
        kind: "water",
        id: site.id,
        title: site.name,
        description: "상류와 하류의 자료를 비교해요.",
      };
      this.selectable.push(marker);
      const button = document.createElement("button");
      button.className = "parking-label water-label";
      button.dataset.waterLabel = site.id;
      button.addEventListener("click", () => choose(site.id));
      const line = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "line",
      );
      svg.append(line);
      this.root.append(button);
      this.markers.push({
        button,
        line,
        point: new THREE.Vector3(RIVER.x - 8, 3, site.position.z),
      });
    }
    for (const source of WATER_SOURCES.filter((s) => s.kind !== "background")) {
      box(
        source.x,
        0.7,
        source.z,
        10,
        1.1,
        2.5,
        source.kind === "factory" ? 0x7b827f : 0x9b937e,
      );
      if (sim.configuration.outlet && sim.plan.outlet === source.id)
        box(source.x + 4, 2, source.z, 6, 4, 8, 0x75a69f);
    }
    WATER_BANKS.forEach((b) =>
      this.banks.push(box(b.position.x, 1.5, b.z, 3, 2.5, 5, 0x76543a)),
    );
    if (sim.configuration.sewer) {
      const plot = BUILDABLE_PLOTS.find((p) => p.id === sim.plan.sewer)!;
      const facility = box(
        plot.position.x,
        2.3,
        plot.position.z,
        12,
        4,
        12,
        0xb9c9c2,
      );
      facility.userData.selection = {
        kind: "plot",
        id: plot.id,
        title: plot.name,
        description: "생활하수 처리 시설 · 144㎡",
      };
      this.selectable.push(facility);
      box(plot.position.x, 4.5, plot.position.z, 10, 0.6, 10, 0x568f9a);
    }
    if (sim.configuration.riverCleanup) {
      const bank = WATER_BANKS.find((b) => b.id === sim.plan.riverCleanup)!;
      box(RIVER.x, 0.6, bank.z + 18, 22, 0.6, 1.1, 0xe1b765);
      box(bank.position.x - 3, 1, bank.z, 3, 2, 3, 0x5c8874);
    }
    this.floating = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.75, 0),
      new THREE.MeshStandardMaterial({ color: 0xd3bd93 }),
      72,
    );
    this.floating.frustumCulled = false;
    this.add(this.floating);
  }
  update(
    camera: THREE.Camera,
    width: number,
    height: number,
    showColor: boolean,
    showLabels = true,
  ) {
    const stats = this.sim.waterStats;
    this.surfaces.forEach((mesh, i) => {
      mesh.visible = showColor;
      mesh.material.color.setHex(waterColor(stats.cells[i].level));
    });
    this.banks.forEach((m, i) => {
      m.visible = stats.banks[i].remaining > 0.05;
      m.scale.y = Math.max(0.05, stats.banks[i].remaining / 36);
    });
    // Each mesh represents part of an actual advecting packet; labels carry exact quantities.
    const packets = this.sim.packets.filter(
      (p) =>
        p.kind === "litter" &&
        !RIVER.bridges.some((row) => Math.abs(p.z - (row - 2) * 48) < 7),
    );
    const count = Math.min(72, Math.ceil(stats.floating * 2), packets.length),
      dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const p = packets[Math.floor((i * packets.length) / count)];
      dummy.position.set(RIVER.x + ((i * 7) % 15) - 7, 0.65, p.z);
      dummy.updateMatrix();
      this.floating.setMatrixAt(i, dummy.matrix);
    }
    this.floating.count = count;
    this.floating.instanceMatrix.needsUpdate = true;
    this.root.hidden = !showLabels;
    if (!showLabels || !this.labelClock.due(camera, width, height)) return;
    const root = this.root.getBoundingClientRect();
    const occupied = [
      ...document.querySelectorAll<HTMLElement>(
        ".applied-policy-pin,.mission-peek,.map-tools,.map-controls,#overlay-legend",
      ),
    ]
      .filter((e) => !e.hidden && e.offsetWidth)
      .map((e) => {
        const r = e.getBoundingClientRect();
        return { x: r.x - root.x, y: r.y - root.y, w: r.width, h: r.height };
      });
    this.markers.forEach((m, i) => {
      const s = stats.sites[i],
        p = m.point.clone().project(camera),
        sx = ((p.x + 1) * width) / 2,
        sy = ((1 - p.y) * height) / 2;
      m.button.textContent = `${s.name} · ${s.level.toFixed(1)} ${waterLevel(s.level)}`;
      m.button.hidden =
        Math.abs(p.x) > 1 || Math.abs(p.y) > 1 || Math.abs(p.z) > 1;
      const w = m.button.offsetWidth || 180,
        h = m.button.offsetHeight || 34;
      const clampX = (v: number) => Math.max(8, Math.min(width - w - 8, v));
      const baseX = clampX(sx - w / 2),
        baseY = Math.max(130, Math.min(height - h - 8, sy - 44));
      let x = baseX,
        y = baseY,
        best = Infinity;
      const xs = [
        baseX,
        clampX(baseX - 30),
        clampX(baseX + 30),
        clampX(sx - w - 12),
        clampX(sx + 12),
        8,
        width - w - 8,
      ];
      const ys = [
        baseY,
        ...Array.from(
          { length: Math.ceil(height / 18) },
          (_, n) => 130 + n * 18,
        ),
      ].filter((v) => v < height - h - 8);
      for (const px of xs)
        for (const py of ys) {
          const cost = (px - baseX) ** 2 + (py - baseY) ** 2;
          if (
            cost >= best ||
            occupied.some(
              (o) =>
                Math.min(px + w, o.x + o.w) > Math.max(px, o.x) - 5 &&
                Math.min(py + h, o.y + o.h) > Math.max(py, o.y) - 5,
            )
          )
            continue;
          x = px;
          y = py;
          best = cost;
        }
      m.button.style.left = `${x + w / 2}px`;
      m.button.style.top = `${y + h}px`;
      if (!m.button.hidden) occupied.push({ x, y, w, h });
      m.line.style.display = m.button.hidden ? "none" : "";
      for (const [key, value] of Object.entries({
        x1: sx,
        y1: sy,
        x2: x + w / 2,
        y2: y + h - 2,
      }))
        m.line.setAttribute(key, String(value));
    });
  }
  dispose() {
    this.root.remove();
    this.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        if (o instanceof THREE.InstancedMesh) o.dispose();
        o.geometry.dispose();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) =>
          m.dispose(),
        );
      }
    });
    this.removeFromParent();
  }
}
