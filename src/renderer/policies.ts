import { LabelClock } from "./label-clock";
import * as THREE from "three";
import type { TrafficSimulation } from "../simulation";
import {
  appliedPolicyMap,
  type AppliedPolicyMap,
  type PolicyPlace,
} from "../policies/map";
import { icon } from "../ui/icons";

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const clamp = (n: number, low: number, high: number) =>
  Math.max(low, Math.min(n, high));
const svg = <K extends keyof SVGElementTagNameMap>(tag: K) =>
  document.createElementNS("http://www.w3.org/2000/svg", tag);

export class PolicyRenderer extends THREE.Group {
  private labelClock = new LabelClock();
  data: AppliedPolicyMap = { places: [], shared: [] };
  private root = document.createElement("section");
  private shared = document.createElement("section");
  private connectors = svg("svg");
  private toolbarTop = 0;
  private material = new THREE.LineBasicMaterial({
    color: 0x287a86,
    depthWrite: false,
  });
  private pins: {
    place: PolicyPlace;
    button: HTMLButtonElement;
    position: THREE.Vector3;
    line: SVGLineElement;
    dot: SVGCircleElement;
  }[] = [];
  onSelect: (place: PolicyPlace) => void = () => {};

  constructor(container: HTMLElement) {
    super();
    this.root.id = "applied-policy-map";
    this.root.setAttribute("aria-label", "위치별 시행 정책");
    this.root.hidden = true;
    this.connectors.classList.add("policy-connectors");
    this.connectors.setAttribute("aria-hidden", "true");
    this.root.append(this.connectors);
    container.append(this.root);
    this.shared.id = "applied-shared";
    this.shared.hidden = true;
    this.shared.setAttribute("aria-label", "공통으로 시행한 정책");
    container.parentElement!.append(this.shared);
  }

  setSimulation(sim: TrafficSimulation) {
    this.data = appliedPolicyMap(sim);
    this.pins.forEach((p) => p.button.remove());
    this.pins = [];
    this.connectors.replaceChildren();
    for (const object of this.children)
      (object as THREE.LineLoop).geometry.dispose();
    this.clear();
    for (const place of this.data.places) {
      const button = this.button(place);
      button.className = "applied-policy-pin";
      button.dataset.policyPlace = place.id;
      button.dataset.worldX = String(place.position!.x);
      button.dataset.worldZ = String(place.position!.z);
      const line = svg("line"),
        dot = svg("circle");
      dot.setAttribute("r", "3");
      this.connectors.append(line, dot);
      this.root.append(button);
      this.pins.push({
        place,
        button,
        position: new THREE.Vector3(place.position!.x, 12, place.position!.z),
        line,
        dot,
      });
      for (const outline of place.outlines) {
        const geometry = new THREE.BufferGeometry().setFromPoints(
          outline.map((p) => new THREE.Vector3(p.x, 0.78, p.z)),
        );
        this.add(new THREE.LineLoop(geometry, this.material));
      }
    }
    this.shared.replaceChildren();
    this.shared.hidden = !this.data.shared.length;
    document.body.toggleAttribute(
      "data-wide-policies",
      this.data.shared.length > 0,
    );
    if (this.data.shared.length) {
      const heading = document.createElement("p");
      heading.className = "shared-policy-heading";
      heading.textContent = `${this.data.shared[0].scope} · 시행 중`;
      const list = document.createElement("div");
      list.className = "shared-policy-list";
      list.style.setProperty("--shared-count", String(this.data.shared.length));
      for (const place of this.data.shared) {
        const button = this.button(place);
        button.dataset.sharedPolicy = place.policies[0].id;
        list.append(button);
      }
      this.shared.append(heading, list);
    }
  }

  private button(place: PolicyPlace) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.appliedPolicy = place.id;
    button.setAttribute(
      "aria-label",
      `${place.name} · 시행한 정책: ${place.policies.map((p) => p.title).join(", ")}`,
    );
    button.title = `${place.scope} · ${place.policies.map((p) => p.title).join(" · ")}`;
    const glyph = document.createElement("span");
    glyph.className = "applied-policy-glyph";
    glyph.innerHTML = icon(
      (
        { extraTruck: "car", route: "bypass", reduce: "layers" } as Record<
          string,
          string
        >
      )[place.policies[0].id] ?? place.policies[0].id,
      20,
    );
    const content = document.createElement("span");
    content.className = "applied-policy-names";
    const status = document.createElement("small");
    status.textContent = "✓ 시행 중";
    content.append(status);
    for (const policy of place.policies) {
      const name = document.createElement("strong");
      name.textContent = policy.title;
      content.append(name);
    }
    if (place.note) {
      const note = document.createElement("small");
      note.className = "applied-policy-note";
      note.textContent = place.note;
      content.append(note);
    }
    button.append(glyph, content);
    if (place.policies.length > 1) {
      const count = document.createElement("b");
      count.className = "applied-policy-count";
      count.textContent = String(place.policies.length);
      button.append(count);
    }
    button.addEventListener("click", () => this.onSelect(place));
    return button;
  }

  update(camera: THREE.Camera, width: number, height: number) {
    if (!this.labelClock.due(camera, width, height)) return;
    if (width <= 600 && !this.shared.hidden) {
      const top = this.shared.offsetTop + this.shared.offsetHeight + 8;
      if (top !== this.toolbarTop) {
        this.toolbarTop = top;
        this.shared.parentElement!.style.setProperty(
          "--map-tools-top",
          `${top}px`,
        );
      }
    }
    const panel = document.body.dataset.activePanel;
    this.root.hidden =
      !this.pins.length ||
      (!!panel && panel !== "residents" && panel !== "selection");
    if (this.root.hidden) return;
    const obstacles: Rect[] = [];
    for (const element of document.querySelectorAll<HTMLElement>(
      ".topbar, .mode-badge, .mission-peek, .map-tools, #overlay-legend, .compass, .map-controls, #applied-shared, #panel-residents, #panel-selection, .resident-pin, #resident-bubble, .stock-label, .supply-label",
    )) {
      if (
        !element.getClientRects().length ||
        getComputedStyle(element).visibility === "hidden"
      )
        continue;
      const r = element.getBoundingClientRect();
      obstacles.push({
        x: r.x - 6,
        y: r.y - 6,
        w: r.width + 12,
        h: r.height + 12,
      });
    }
    const sizes = this.pins.map((p) => ({
      w: p.button.offsetWidth,
      h: p.button.offsetHeight,
    }));
    for (const [i, pin] of this.pins.entries()) {
      const p = pin.position.clone().project(camera);
      const x = ((p.x + 1) * width) / 2,
        y = ((1 - p.y) * height) / 2;
      const hidden =
        p.z < -1 || p.z > 1 || x < 0 || x > width || y < 0 || y > height;
      pin.button.hidden = hidden;
      pin.line.style.display = pin.dot.style.display = hidden ? "none" : "";
      if (hidden) continue;
      // A hidden pin has no measured size on the first frame it comes back on screen.
      const w = sizes[i].w || pin.button.offsetWidth,
        h = sizes[i].h || pin.button.offsetHeight;
      const fit = (px: number, py: number): Rect => ({
        x: clamp(px, 8, width - w - 8),
        y: clamp(py, 76, height - h - 10),
        w,
        h,
      });
      const candidates: Rect[] = [];
      for (const dy of [-h - 18, 16, -h - 78, 76, -h - 138, 136])
        for (const dx of [-w / 2, -w - 14, 14])
          candidates.push(fit(x + dx, y + dy));
      const cost = (r: Rect) =>
        Math.hypot(r.x + w / 2 - x, r.y + h / 2 - y) +
        obstacles.reduce((sum, o) => sum + overlap(r, o) * 1000, 0);
      let best = candidates.reduce((a, b) => (cost(a) < cost(b) ? a : b));
      if (obstacles.some((o) => overlap(best, o) > 0)) {
        for (let py = 76; py < height - h - 10; py += h + 12)
          for (let px = 8; px < width - w - 8; px += w + 12) {
            const candidate = fit(px, py);
            if (cost(candidate) < cost(best)) best = candidate;
          }
      }
      pin.button.style.left = `${best.x}px`;
      pin.button.style.top = `${best.y}px`;
      pin.button.dataset.anchorX = x.toFixed(2);
      pin.button.dataset.anchorY = y.toFixed(2);
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
      pin.dot.setAttribute("cx", String(x));
      pin.dot.setAttribute("cy", String(y));
      obstacles.push({
        x: best.x - 5,
        y: best.y - 5,
        w: best.w + 10,
        h: best.h + 10,
      });
    }
  }
}
