import {
  TOPICS,
  type CityEvent,
  type LiveCitySimulation,
} from "../simulation/live";
import type { SatisfactionTracker } from "./satisfaction";

export interface FeedbackChip {
  id: string;
  text: string;
  mood: "up" | "down" | "same" | "start";
  position: { x: number; z: number };
}
type Project = (position: { x: number; z: number }) => {
  x: number;
  y: number;
  visible: boolean;
};

// Real seconds a chip stays on the map; the CSS animation matches it.
export const CHIP_SECONDS = 6;
const POLICY_DELAY = 120;

const stamp = (time: number) =>
  `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, "0")}`;

/**
 * Satisfaction change shown where a reaction or improvement happened. A reaction
 * compares with the moment the policy began; an improvement with a minute ago.
 */
export function feedbackChip(
  event: CityEvent,
  tracker: SatisfactionTracker,
): FeedbackChip | undefined {
  if (!event.position || !["reaction", "improved"].includes(event.type))
    return undefined;
  const since = event.time - (event.type === "reaction" ? POLICY_DELAY : 60);
  const before = tracker.valueAt(since, event.topic);
  const now = tracker.current?.topics[event.topic];
  const check = event.type === "improved" ? "✓ " : "";
  const base = {
    id: `event-${event.id}`,
    position: event.position,
  };
  if (before === undefined || now === undefined)
    return event.type === "improved"
      ? { ...base, text: `✓ ${TOPICS[event.topic]} 나아졌어요`, mood: "up" }
      : undefined;
  const change = Math.round(now - before);
  if (change >= 1)
    return { ...base, text: `${check}😊 ${TOPICS[event.topic]} +${change}`, mood: "up" };
  if (change <= -1)
    return { ...base, text: `${check}😟 ${TOPICS[event.topic]} −${-change}`, mood: "down" };
  return { ...base, text: `${check}😐 ${TOPICS[event.topic]} 그대로`, mood: "same" };
}

/** Countdown text for a bought policy whose effect has not started. */
export function pendingText(title: string, wait: number) {
  return `⏳ ${title} · ${stamp(Math.max(0, wait))} 뒤 시작`;
}

interface Placed {
  element: HTMLElement;
  position: { x: number; z: number };
  until?: number;
}

/** Floating map chips and countdown badges; decorative, the gauge carries the score. */
export class MapFeedback {
  private chips = new Map<string, Placed>();
  private pending = new Map<number, Placed>();
  private seen = 0;
  private layer: HTMLElement;

  constructor(parent: HTMLElement, private project: Project) {
    this.layer = document.createElement("div");
    this.layer.id = "map-feedback";
    this.layer.setAttribute("aria-hidden", "true");
    parent.append(this.layer);
  }

  /** A loaded or new city starts quietly: earlier stories are not replayed. */
  reset(sim: LiveCitySimulation) {
    this.seen = sim.news.reduce((n, e) => Math.max(n, e.id), 0);
    for (const placed of [...this.chips.values(), ...this.pending.values()])
      placed.element.remove();
    this.chips.clear();
    this.pending.clear();
  }

  update(sim: LiveCitySimulation, tracker: SatisfactionTracker, now: number) {
    for (const event of sim.news) {
      if (event.id <= this.seen) continue;
      this.seen = event.id;
      const chip = feedbackChip(event, tracker);
      if (chip) this.show(chip, now);
    }
    const waiting = new Set<number>();
    for (const p of sim.pendingEffects) {
      if (!p.position) continue;
      waiting.add(p.index);
      let placed = this.pending.get(p.index);
      if (!placed) {
        const element = document.createElement("span");
        element.className = "map-pending";
        this.layer.append(element);
        placed = { element, position: p.position };
        this.pending.set(p.index, placed);
      }
      placed.element.textContent = pendingText(p.title, p.readyAt - sim.time);
    }
    for (const [index, placed] of this.pending) {
      if (waiting.has(index)) continue;
      placed.element.remove();
      this.pending.delete(index);
      const action = sim.actions[index];
      if (action)
        this.show({
          id: `start-${index}`,
          text: "▶ 효과가 시작됐어요",
          mood: "start",
          position: placed.position,
        }, now);
    }
    for (const [id, placed] of this.chips)
      if (placed.until! <= now) {
        placed.element.remove();
        this.chips.delete(id);
      }
  }

  /** Follow the camera every frame; only a handful of elements are placed. */
  position() {
    for (const placed of [...this.chips.values(), ...this.pending.values()]) {
      const p = this.project(placed.position);
      placed.element.hidden = !p.visible;
      placed.element.style.left = `${p.x}px`;
      placed.element.style.top = `${p.y}px`;
    }
  }

  private show(chip: FeedbackChip, now: number) {
    if (this.chips.has(chip.id)) return;
    const element = document.createElement("span");
    element.className = "map-chip";
    element.dataset.mood = chip.mood;
    element.textContent = chip.text;
    this.layer.append(element);
    this.chips.set(chip.id, {
      element,
      position: chip.position,
      until: now + CHIP_SECONDS * 1000,
    });
  }
}
