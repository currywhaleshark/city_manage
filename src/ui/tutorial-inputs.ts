import type { TutorialStage } from "./city-tutorial";

export interface TutorialInputState {
  stage: TutorialStage;
  panel: string;
  placement: boolean;
  inspection: boolean;
}

const controls = "button,input,select,textarea,summary,a[href],canvas";

export function tutorialCameraAllowed(s: TutorialInputState) {
  return s.stage === "done" || s.inspection || (s.stage === "policy" && s.placement);
}

export function tutorialControlAllowed(el: HTMLElement, s: TutorialInputState) {
  if (s.stage === "done") return true;
  if (s.inspection)
    return el.id === "city-canvas" || !!el.closest("#place-inspector .inspection-controls, #place-inspector .inspection-heading");
  if (el.dataset.tutorial === "skip") return true;
  if (el.dataset.tutorial === "next") return !s.panel && !s.placement;
  if (el.dataset.tutorial === "read-result") return s.stage === "result" && s.panel === "tutorial-result";
  if (s.stage === "story")
    return s.panel === "story" ? el.id === "investigate-story" : !s.panel && el.id === "read-story";
  if (s.stage === "policy") {
    if (s.placement)
      return !!el.closest("#placement-map") || ["city-canvas", "zoom-in", "zoom-out", "camera-reset"].includes(el.id);
    if (s.panel === "review") return ["apply-live-policy", "cancel-policy", "close-panel", "live-reason"].includes(el.id);
    if (s.panel === "policy")
      return el.id === "close-panel" || !!el.closest(".live-policy-list");
    return !s.panel && el.dataset.panelOpen === "policy";
  }
  if (s.stage === "result" && s.panel === "tutorial-result")
    return el.id === "close-panel" || el.dataset.reviewPolicy !== undefined;
  return false;
}

/** Native locks handle touch/tab navigation; capture guards cover local handlers and shortcuts. */
export class TutorialInputs {
  private locked = new Map<HTMLElement, { inert: boolean; disabled?: boolean; value?: string }>();

  constructor(private document: Document, private state: () => TutorialInputState) {
    for (const type of ["click", "dblclick", "pointerdown", "pointerup", "touchstart", "wheel", "keydown", "input", "change", "focusin"])
      document.addEventListener(type, (event) => this.guard(event), { capture: true, passive: false });
  }

  refresh() {
    const s = this.state();
    for (const el of this.locked.keys()) if (!el.isConnected) this.locked.delete(el);
    for (const el of this.document.querySelectorAll<HTMLElement>(controls)) {
      const previous = this.locked.get(el);
      const button = el.tagName === "BUTTON" ? el as HTMLButtonElement : undefined;
      if (!tutorialControlAllowed(el, s)) {
        if (!previous) this.locked.set(el, {
          inert: !!el.inert,
          disabled: button?.disabled,
          value: "value" in el ? String(el.value) : undefined,
        });
        // Inert removes a button from hit testing, letting taps reach controls
        // underneath (for example the story preview under its close button).
        if (button) button.disabled = true;
        else el.inert = true;
        el.dataset.tutorialLocked = "";
      } else if (previous) {
        el.inert = previous.inert;
        if (button && previous.disabled !== undefined) button.disabled = previous.disabled;
        delete el.dataset.tutorialLocked;
        this.locked.delete(el);
      }
    }
  }

  private guard(event: Event) {
    const s = this.state();
    if (s.stage === "done") return;
    const target = event.target as HTMLElement | null;
    const el = target?.closest?.<HTMLElement>(controls);
    let blocked = !!el && !tutorialControlAllowed(el, s);
    if (event.type === "keydown") {
      const key = event as KeyboardEvent;
      if (key.key === "Escape")
        blocked = !(s.inspection || s.stage === "policy" || (s.stage === "result" && !!s.panel));
      if (key.code === "Space" && (!el || el.tagName === "CANVAS")) blocked = true;
    }
    if (!blocked) return;
    if ((event.type === "input" || event.type === "change") && el && "value" in el) {
      const previous = this.locked.get(el);
      if (previous?.value !== undefined) el.value = previous.value;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === "focusin") {
      const fallback = this.document.querySelector<HTMLElement>(
        '#city-tutorial:not([hidden]) #tutorial-next:not([hidden]), #city-tutorial:not([hidden]) [data-tutorial="skip"], #live-panel:not([hidden]) #live-panel-title',
      );
      fallback?.focus({ preventScroll: true });
    }
  }
}
