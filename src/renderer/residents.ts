import { LabelClock } from "./label-clock";
import * as THREE from "three";
import { CITY_FACILITIES } from "../city/data";
import type { ResidentVoice } from "../simulation/residents";
import { icon } from "../ui/icons";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Point {
  x: number;
  y: number;
}
interface Placement {
  box: Box;
  anchor: Point;
}
const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const clamp = (n: number, low: number, high: number) =>
  Math.max(low, Math.min(n, high));
// Keep an established position unless a new one is meaningfully better.
// Camera damping can change nearly equal scores by floating-point roundoff;
// reselecting the winner every frame used to flip labels across their anchor.
function stablePlacement(
  best: Box,
  previous: Placement | undefined,
  anchor: Point,
  keepInside: (x: number, y: number, w: number, h: number) => Box,
  score: (box: Box) => number,
): Placement {
  if (previous) {
    const dx = anchor.x - previous.anchor.x,
      dy = anchor.y - previous.anchor.y;
    const moved = Math.hypot(dx, dy) > 1;
    const retained = keepInside(
      previous.box.x + (moved ? dx : 0),
      previous.box.y + (moved ? dy : 0),
      best.w,
      best.h,
    );
    // Scores heavily penalize collisions, so real obstructions still win
    // immediately. Otherwise require at least 40px of distance improvement.
    if (score(retained) <= score(best) + 40)
      return { box: retained, anchor: moved ? { ...anchor } : previous.anchor };
  }
  return { box: best, anchor: { ...anchor } };
}
const svgElement = <K extends keyof SVGElementTagNameMap>(tag: K) =>
  document.createElementNS("http://www.w3.org/2000/svg", tag);

/** Accessible DOM speech bubbles linked to world positions. No simulation state is changed. */
export class ResidentRenderer extends THREE.Group {
  private labelClock = new LabelClock();
  private root = document.createElement("section");
  private svg = svgElement("svg");
  private bubbleLine = svgElement("line");
  private bubble = document.createElement("article");
  private cardPlacement?: Placement;
  private pins: {
    voice: ResidentVoice;
    button: HTMLButtonElement;
    position: THREE.Vector3;
    line: SVGLineElement;
    dot: SVGCircleElement;
    placement?: Placement;
  }[] = [];
  private activeId?: string;
  private ring = new THREE.Mesh(
    new THREE.RingGeometry(18, 19.5, 48),
    new THREE.MeshBasicMaterial({
      color: 0xd8a537,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  onChoose: (voice: ResidentVoice, index: number, count: number) => void =
    () => {};

  constructor(container: HTMLElement) {
    super();
    this.root.id = "resident-map";
    this.root.setAttribute("aria-label", "지역별 주민 말풍선");
    this.root.hidden = true;
    this.svg.classList.add("resident-connectors");
    this.svg.setAttribute("aria-hidden", "true");
    this.bubbleLine.classList.add("resident-bubble-line");
    this.bubbleLine.style.display = "none";
    this.svg.append(this.bubbleLine);
    this.bubble.id = "resident-bubble";
    this.bubble.className = "resident-bubble";
    this.bubble.setAttribute("aria-labelledby", "resident-speaker");
    this.bubble.innerHTML = `<div class="resident-speaker"><span class="resident-avatar">${icon("residents", 23)}</span><div><h3 id="resident-speaker"></h3><p id="resident-place"></p></div></div><blockquote id="resident-quote"></blockquote><details id="resident-evidence"><summary><span id="resident-evidence-label">관찰한 사실과 자세한 의견</span>${icon("plus", 16)}</summary><div class="resident-evidence-body"><h4>관찰한 사실</h4><p id="resident-fact"></p><div id="resident-opinion-section"><h4>바라는 점</h4><p id="resident-opinion"></p></div><p id="resident-change"></p></div></details>`;
    this.root.append(this.svg, this.bubble);
    // Separate from #map-labels, which is aria-hidden because its other labels are decorative.
    container.append(this.root);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.72;
    this.add(this.ring);
    this.visible = false;
  }

  setVoices(voices: ResidentVoice[]) {
    this.bubble.hidden = !voices.length;
    this.ring.visible = !!voices.length;
    if (!voices.length) this.resetPlacements();
    const changed =
      voices.map((v) => `${v.id}:${v.facilityId}`).join("|") !==
      this.pins.map((p) => `${p.voice.id}:${p.voice.facilityId}`).join("|");
    if (changed) {
      this.pins.forEach((p) => {
        p.button.remove();
        p.line.remove();
        p.dot.remove();
      });
      this.pins = voices.map((voice, index) => {
        const facility = CITY_FACILITIES.find(
          (f) => f.id === voice.facilityId,
        )!;
        const button = document.createElement("button");
        button.className = "resident-pin";
        button.dataset.resident = voice.id;
        button.dataset.facilityId = voice.facilityId;
        button.setAttribute("aria-controls", this.bubble.id);
        button.innerHTML = `<b>${index + 1}</b><span></span>`;
        button.addEventListener("click", () => this.choose(voice.id));
        const line = svgElement("line"),
          dot = svgElement("circle");
        line.classList.add("resident-pin-line");
        dot.setAttribute("r", "3");
        this.svg.prepend(line, dot);
        this.root.insertBefore(button, this.bubble);
        return {
          voice,
          button,
          position: new THREE.Vector3(
            (voice.position ?? facility.position).x,
            20,
            (voice.position ?? facility.position).z,
          ),
          line,
          dot,
        };
      });
      this.activeId = undefined;
    }
    this.pins.forEach((pin, index) => {
      pin.voice = voices[index];
      pin.button.querySelector("span")!.textContent = pin.voice.group;
      pin.button.setAttribute(
        "aria-label",
        `${index + 1}. ${pin.voice.group} · ${pin.voice.place} 의견 듣기`,
      );
      pin.button.title = `${pin.voice.group} · ${pin.voice.place}`;
    });
    if (!this.activeId && this.pins.length) this.choose(this.pins[0].voice.id);
    else this.updateContent();
  }

  setOpen(open: boolean) {
    if (open !== this.visible) this.resetPlacements();
    if (open && !this.visible) {
      this.bubble.querySelector<HTMLDetailsElement>("details")!.open = false;
      this.bubble.scrollTop = 0;
    }
    this.visible = open;
    this.root.hidden = !open;
  }

  choose(id: string) {
    const index = this.pins.findIndex((p) => p.voice.id === id);
    if (index < 0) return;
    if (this.activeId !== id) {
      this.resetPlacements();
      this.bubble.querySelector<HTMLDetailsElement>("details")!.open = false;
      this.bubble.scrollTop = 0;
    }
    this.activeId = id;
    this.pins.forEach((p) =>
      p.button.setAttribute("aria-pressed", String(p.voice.id === id)),
    );
    const p = this.pins[index];
    this.ring.position.set(p.position.x, 0.72, p.position.z);
    this.updateContent();
    this.onChoose(p.voice, index, this.pins.length);
  }

  step(direction: number) {
    if (!this.pins.length) return;
    const index = this.pins.findIndex((p) => p.voice.id === this.activeId);
    this.choose(
      this.pins[(index + direction + this.pins.length) % this.pins.length].voice
        .id,
    );
  }

  get activePosition() {
    return this.pins.find((p) => p.voice.id === this.activeId)?.position;
  }

  private resetPlacements() {
    this.cardPlacement = undefined;
    this.pins.forEach((pin) => (pin.placement = undefined));
    // Empty stories skip update(), so hide the old connector immediately.
    // Reopening/choosing a story must place it before showing the line again.
    this.bubbleLine.style.display = "none";
    this.labelClock = new LabelClock();
  }

  private updateContent() {
    const voice = this.pins.find((p) => p.voice.id === this.activeId)?.voice;
    if (!voice) return;
    this.bubble.dataset.resident = voice.id;
    const values: Record<string, string> = {
      "resident-speaker": voice.group,
      "resident-place": voice.place,
      "resident-quote": `“${voice.summary}”`,
      "resident-fact": voice.fact,
      "resident-opinion": voice.opinion,
      "resident-change": voice.change ?? "",
      "resident-evidence-label":
        voice.opinion.trim() && voice.opinion.trim() !== voice.summary.trim()
          ? "관찰한 사실과 자세한 의견"
          : voice.change
            ? "관찰한 사실과 변화"
            : "관찰한 사실",
    };
    for (const [id, value] of Object.entries(values)) {
      const element = this.bubble.querySelector<HTMLElement>(`#${id}`)!;
      if (element.textContent !== value) element.textContent = value;
    }
    this.bubble.querySelector<HTMLElement>("#resident-change")!.hidden =
      !voice.change;
    this.bubble.querySelector<HTMLElement>(
      "#resident-opinion-section",
    )!.hidden =
      !voice.opinion.trim() || voice.opinion.trim() === voice.summary.trim();
  }

  update(camera: THREE.Camera, width: number, height: number) {
    if (!this.visible || !this.pins.length) return;
    if (
      document.body.dataset.livePanel ||
      !this.labelClock.due(camera, width, height)
    )
      return;
    const points = this.pins.map((p) => {
      const projected = p.position.clone().project(camera);
      return {
        x: ((projected.x + 1) * width) / 2,
        y: ((1 - projected.y) * height) / 2,
        z: projected.z,
      };
    });
    const selected = this.pins.findIndex((p) => p.voice.id === this.activeId);
    const anchor = points[selected];
    const guide = document
      .querySelector("#panel-residents")
      ?.getBoundingClientRect();
    const shared = document.querySelector<HTMLElement>("#applied-shared");
    const living = document.body.classList.contains("living-city");
    const top =
      Math.max(
        (living
          ? document.querySelector(".topbar")?.getBoundingClientRect().bottom
          : guide?.bottom) ??
          document.querySelector(".map-tools")?.getBoundingClientRect()
            .bottom ??
          76,
        width <= 600 && shared && !shared.hidden
          ? shared.getBoundingClientRect().bottom
          : 0,
      ) + 10;
    const bottom = height - 10;
    // The compact live preview needs no reserved row for the removed footer.
    this.bubble.style.maxHeight = `${Math.max(100, Math.min(living ? 180 : 330, bottom - top - (living ? 0 : 52)))}px`;
    const bw = this.bubble.offsetWidth,
      bh = this.bubble.offsetHeight;
    const keepInside = (x: number, y: number, w: number, h: number): Box => ({
      x: clamp(x, 8, width - w - 8),
      y: clamp(y, top, bottom - h),
      w,
      h,
    });
    const candidates = [
      [anchor.x + 46, anchor.y - bh / 2],
      [anchor.x - bw - 46, anchor.y - bh / 2],
      [anchor.x - bw / 2, anchor.y - bh - 58],
      [anchor.x - bw / 2, anchor.y + 58],
      [8, top],
      [width - bw - 8, top],
      [8, bottom - bh],
      [width - bw - 8, bottom - bh],
    ].map(([x, y]) => keepInside(x, y, bw, bh));
    const controls = document
      .querySelector(".map-controls")
      ?.getBoundingClientRect();
    const obstacles: Box[] = controls
      ? [
          {
            x: controls.x - 6,
            y: controls.y - 6,
            w: controls.width + 12,
            h: controls.height + 12,
          },
        ]
      : [];
    if (shared && !shared.hidden) {
      const r = shared.getBoundingClientRect();
      obstacles.push({
        x: r.x - 6,
        y: r.y - 6,
        w: r.width + 12,
        h: r.height + 12,
      });
    }
    for (const el of document.querySelectorAll<HTMLElement>(
      ".living-city .map-tools, .living-city .mission-peek, .living-city #overlay-legend",
    )) {
      if (el.hidden || !el.getClientRects().length) continue;
      const r = el.getBoundingClientRect();
      obstacles.push({
        x: r.x - 6,
        y: r.y - 6,
        w: r.width + 12,
        h: r.height + 12,
      });
    }
    const score = (box: Box) => {
      const distance = Math.hypot(
        box.x + bw / 2 - anchor.x,
        box.y + bh / 2 - anchor.y,
      );
      return (
        distance +
        points.reduce(
          (sum, p, i) =>
            sum +
            overlap(box, { x: p.x - 28, y: p.y - 28, w: 56, h: 56 }) *
              (i === selected ? 100 : 2),
          0,
        ) +
        obstacles.reduce((sum, o) => sum + overlap(box, o) * 100, 0)
      );
    };
    const bestCard = candidates.reduce((best, box) =>
      score(box) < score(best) ? box : best,
    );
    this.cardPlacement = stablePlacement(
      bestCard,
      this.cardPlacement,
      anchor,
      keepInside,
      score,
    );
    const card = this.cardPlacement.box;
    this.bubble.style.left = `${card.x}px`;
    this.bubble.style.top = `${card.y}px`;
    const occupied = [card, ...obstacles];
    const pw = width <= 600 ? 44 : 146,
      ph = 44;
    const placed: Point[] = [];
    // Give the selected pin first choice; other labels move aside and keep a leader to their real location.
    const order = [
      selected,
      ...this.pins.map((_, i) => i).filter((i) => i !== selected),
    ];
    for (const i of order) {
      const pin = this.pins[i],
        p = points[i];
      const offscreen =
        p.z < -1 ||
        p.z > 1 ||
        p.x < 0 ||
        p.x > width ||
        p.y < 0 ||
        p.y > height;
      pin.button.hidden = offscreen;
      pin.line.style.display = pin.dot.style.display = offscreen ? "none" : "";
      if (offscreen) {
        pin.placement = undefined;
        continue;
      }
      const options: Box[] = [];
      for (const dy of [-48, 10, -102, 64, -156, 118])
        for (const dx of [-pw / 2, -pw - 16, 16])
          options.push(keepInside(p.x + dx, p.y + dy, pw, ph));
      const cost = (box: Box) =>
        Math.hypot(box.x + pw / 2 - p.x, box.y + ph / 2 - p.y) +
        occupied.reduce(
          (sum, o) =>
            sum +
            overlap(box, { x: o.x - 5, y: o.y - 5, w: o.w + 10, h: o.h + 10 }) *
              1000,
          0,
        );
      let box = options.reduce((best, b) => (cost(b) < cost(best) ? b : best));
      // When a narrow screen or expanded story uses the nearby space, search free rows too.
      if (occupied.some((o) => overlap(box, o) > 0)) {
        for (let y = top; y <= bottom - ph; y += ph + 12)
          for (let x = 8; x <= width - pw - 8; x += pw + 12) {
            const candidate = { x, y, w: pw, h: ph };
            if (cost(candidate) < cost(box)) box = candidate;
          }
      }
      pin.placement = stablePlacement(box, pin.placement, p, keepInside, cost);
      box = pin.placement.box;
      occupied.push(box);
      pin.button.style.left = `${box.x}px`;
      pin.button.style.top = `${box.y}px`;
      pin.button.dataset.anchorX = p.x.toFixed(2);
      pin.button.dataset.anchorY = p.y.toFixed(2);
      const end = {
        x: clamp(p.x, box.x + 10, box.x + pw - 10),
        y: clamp(p.y, box.y + 10, box.y + ph - 10),
      };
      this.line(pin.line, p, end);
      pin.dot.setAttribute("cx", String(p.x));
      pin.dot.setAttribute("cy", String(p.y));
      pin.dot.setAttribute("data-selected", String(i === selected));
      placed[i] = { x: box.x + pw / 2, y: box.y + ph / 2 };
    }
    const selectedPin = placed[selected];
    this.bubbleLine.style.display = selectedPin ? "" : "none";
    if (selectedPin)
      this.line(this.bubbleLine, selectedPin, {
        x: clamp(selectedPin.x, card.x + 14, card.x + bw - 14),
        y: clamp(selectedPin.y, card.y + 14, card.y + bh - 14),
      });
  }

  private line(line: SVGLineElement, start: Point, end: Point) {
    line.setAttribute("x1", String(start.x));
    line.setAttribute("y1", String(start.y));
    line.setAttribute("x2", String(end.x));
    line.setAttribute("y2", String(end.y));
  }
}
