import type { Vec2 } from "../types";

interface InspectionRenderer {
  beginInspection(position: Vec2): void;
  endInspection(): void;
  recenterInspection(): void;
  zoom(factor: number): void;
}

/** Reuses the live city canvas: one scene, one renderer and no second simulation. */
export class PlaceInspector {
  readonly dialog = document.createElement("dialog");
  private viewport: HTMLElement;
  private anchor = document.createComment("city-view-home");
  private returnFocus?: HTMLElement;
  private title: HTMLElement;
  private status: HTMLElement;
  private pause: HTMLButtonElement;
  onClose = () => {};

  constructor(
    private map: HTMLElement,
    private renderer: InspectionRenderer,
    togglePause: () => void,
  ) {
    this.dialog.id = "place-inspector";
    this.dialog.setAttribute("aria-labelledby", "inspection-title");
    this.dialog.setAttribute("aria-describedby", "inspection-help");
    this.dialog.innerHTML = `<header class="inspection-heading"><div><small>현장 확대</small><h2 id="inspection-title"></h2></div><button type="button" id="close-inspection">돌아가기</button></header><div class="inspection-viewport"></div><footer class="inspection-footer"><p id="inspection-help">드래그로 돌리고 확대해 살펴봐요. 노란 원이 살펴보는 장소예요.</p><div class="inspection-controls"><span id="inspection-status" role="timer"></span><button type="button" id="inspection-pause"></button><button type="button" id="inspection-zoom-in" aria-label="현장 확대">＋</button><button type="button" id="inspection-zoom-out" aria-label="현장 축소">−</button><button type="button" id="inspection-center">장소 중심</button></div></footer>`;
    document.body.append(this.dialog);
    this.viewport = this.dialog.querySelector(".inspection-viewport")!;
    this.title = this.dialog.querySelector("#inspection-title")!;
    this.status = this.dialog.querySelector("#inspection-status")!;
    this.pause = this.dialog.querySelector("#inspection-pause")!;
    this.dialog.querySelector("#close-inspection")!.addEventListener("click", () => this.close());
    this.pause.addEventListener("click", togglePause);
    this.dialog.querySelector("#inspection-zoom-in")!.addEventListener("click", () => renderer.zoom(1.25));
    this.dialog.querySelector("#inspection-zoom-out")!.addEventListener("click", () => renderer.zoom(1 / 1.25));
    this.dialog.querySelector("#inspection-center")!.addEventListener("click", () => renderer.recenterInspection());
    this.dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      this.close();
    });
  }

  get isOpen() { return this.dialog.open; }

  open(title: string, position: Vec2) {
    if (this.isOpen) return;
    this.returnFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement : undefined;
    this.title.textContent = title;
    this.map.before(this.anchor);
    this.viewport.append(this.map);
    document.body.setAttribute("data-inspecting-place", "");
    this.dialog.showModal();
    this.renderer.beginInspection(position);
    this.dialog.querySelector<HTMLButtonElement>("#close-inspection")!.focus();
  }

  update(time: number, paused: boolean) {
    if (!this.isOpen) return;
    const clock = `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, "0")}`;
    this.status.textContent = `지금 모습 · ${clock}${paused ? " · 멈춤" : ""}`;
    this.pause.textContent = paused ? "계속 보기" : "잠깐 멈추기";
    this.pause.setAttribute("aria-pressed", String(paused));
  }

  close() {
    if (!this.isOpen) return;
    this.anchor.replaceWith(this.map);
    this.dialog.close();
    document.body.removeAttribute("data-inspecting-place");
    this.renderer.endInspection();
    this.onClose();
    if (this.returnFocus?.isConnected)
      this.returnFocus.focus({ preventScroll: true });
    else this.map.querySelector<HTMLCanvasElement>("canvas")?.focus();
    this.returnFocus = undefined;
  }
}
