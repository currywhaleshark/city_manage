import * as THREE from "three";
import type { Vec2 } from "../types";

export interface PlacementTarget {
  id: string;
  name: string;
  detail: string;
  position: Vec2;
  width: number;
  depth: number;
}
type Rect = { x: number; y: number; w: number; h: number };
const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const clamp = (n: number, low: number, high: number) =>
  Math.max(low, Math.min(high, n));

/** Temporary planning layer. It never changes the running simulation. */
export class PlacementRenderer extends THREE.Group {
  readonly selectable: THREE.Object3D[] = [];
  private root = document.createElement("section");
  private banner = document.createElement("div");
  private pins: {
    button: HTMLButtonElement;
    position: THREE.Vector3;
    line: SVGLineElement;
    corners: THREE.Vector3[];
  }[] = [];
  constructor(
    container: HTMLElement,
    title: string,
    targets: readonly PlacementTarget[],
    selectedId: string | undefined,
    onChoose: (id: string) => void,
    onCancel: () => void,
  ) {
    super();
    this.root.id = "placement-map";
    this.root.setAttribute("aria-label", "정책 적용 위치 선택");
    this.banner.className = "placement-banner";
    const text = document.createElement("div"),
      heading = document.createElement("h2"),
      hint = document.createElement("p"),
      cancel = document.createElement("button");
    heading.id = "placement-title";
    heading.tabIndex = -1;
    heading.textContent = title;
    hint.textContent = "빛나는 곳이나 이름표를 누르면 계획에 담겨요.";
    text.append(heading, hint);
    cancel.textContent = "취소";
    cancel.className = "secondary";
    cancel.id = "cancel-placement";
    cancel.addEventListener("click", onCancel);
    this.banner.append(text, cancel);
    this.root.append(this.banner);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("aria-hidden", "true");
    this.root.append(svg);
    for (const target of targets) {
      const chosen = target.id === selectedId,
        color = chosen ? 0xedbc67 : 0x5fafa4;
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(target.width, target.depth),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.38,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(target.position.x, 0.83, target.position.z);
      mesh.userData.placementId = target.id;
      this.add(mesh);
      this.selectable.push(mesh);
      const { x, z } = target.position,
        w = target.width / 2,
        d = target.depth / 2;
      this.add(
        new THREE.LineLoop(
          new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(x - w, 0.88, z - d),
            new THREE.Vector3(x + w, 0.88, z - d),
            new THREE.Vector3(x + w, 0.88, z + d),
            new THREE.Vector3(x - w, 0.88, z + d),
          ]),
          new THREE.LineBasicMaterial({ color }),
        ),
      );
      const button = document.createElement("button");
      button.className = "placement-pin";
      button.dataset.placementTarget = target.id;
      button.setAttribute("aria-pressed", String(chosen));
      const name = document.createElement("strong"),
        detail = document.createElement("small");
      name.textContent = target.name;
      detail.textContent = target.detail;
      button.append(name, detail);
      button.addEventListener("click", () => onChoose(target.id));
      const line = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "line",
      );
      svg.append(line);
      this.root.append(button);
      this.pins.push({
        button,
        position: new THREE.Vector3(x, 1, z),
        line,
        corners: [
          [-w, -d],
          [w, -d],
          [w, d],
          [-w, d],
        ].map(([dx, dz]) => new THREE.Vector3(x + dx, 1, z + dz)),
      });
    }
    container.append(this.root);
    heading.focus({ preventScroll: true });
  }
  update(camera: THREE.Camera, width: number, height: number) {
    const root = this.root.getBoundingClientRect();
    const obstacles: Rect[] = [
      this.banner,
      ...document.querySelectorAll<HTMLElement>(
        ".map-controls,.compass,.topbar",
      ),
    ].map((el) => {
      const r = el.getBoundingClientRect();
      return {
        x: r.x - root.x - 6,
        y: r.y - root.y - 6,
        w: r.width + 12,
        h: r.height + 12,
      };
    });
    // Keep every highlighted ground target clear, including targets whose label comes later.
    for (const pin of this.pins) {
      const points = pin.corners.map((point) => point.clone().project(camera));
      const xs = points.map((p) => ((p.x + 1) * width) / 2),
        ys = points.map((p) => ((1 - p.y) * height) / 2);
      const x = Math.min(...xs),
        y = Math.min(...ys);
      obstacles.push({
        x: x - 6,
        y: y - 6,
        w: Math.max(...xs) - x + 12,
        h: Math.max(...ys) - y + 12,
      });
    }
    for (const pin of this.pins) {
      const p = pin.position.clone().project(camera),
        x = ((p.x + 1) * width) / 2,
        y = ((1 - p.y) * height) / 2;
      pin.button.hidden =
        p.z < -1 || p.z > 1 || x < 0 || x > width || y < 0 || y > height;
      pin.line.style.display = pin.button.hidden ? "none" : "";
      if (pin.button.hidden) continue;
      const w = pin.button.offsetWidth,
        h = pin.button.offsetHeight;
      const fit = (px: number, py: number): Rect => ({
        x: clamp(px, 8, width - w - 8),
        y: clamp(py, 80, height - h - 12),
        w,
        h,
      });
      const cost = (r: Rect) =>
        Math.hypot(r.x + w / 2 - x, r.y + h / 2 - y) +
        obstacles.reduce((n, o) => n + overlap(r, o) * 1000, 0);
      const candidates: Rect[] = [];
      for (const dy of [-h - 15, 15, -h - 80, 80, -h - 145, 145])
        for (const dx of [-w / 2, -w - 15, 15])
          candidates.push(fit(x + dx, y + dy));
      let best = candidates.reduce((a, b) => (cost(a) < cost(b) ? a : b));
      if (obstacles.some((o) => overlap(best, o) > 0))
        for (let py = 90; py < height - h - 12; py += h + 10)
          for (let px = 8; px <= width - w - 8; px += w + 10) {
            const r = fit(px, py);
            if (cost(r) < cost(best)) best = r;
          }
      pin.button.style.left = `${best.x}px`;
      pin.button.style.top = `${best.y}px`;
      pin.line.setAttribute("x1", String(x));
      pin.line.setAttribute("y1", String(y));
      pin.line.setAttribute(
        "x2",
        String(clamp(x, best.x + 10, best.x + w - 10)),
      );
      pin.line.setAttribute(
        "y2",
        String(clamp(y, best.y + 10, best.y + h - 10)),
      );
      obstacles.push({ x: best.x - 5, y: best.y - 5, w: w + 10, h: h + 10 });
    }
  }
  dispose() {
    this.root.remove();
    this.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
        obj.geometry.dispose();
        const materials = Array.isArray(obj.material)
          ? obj.material
          : [obj.material];
        materials.forEach((m) => m.dispose());
      }
    });
    this.removeFromParent();
  }
}
