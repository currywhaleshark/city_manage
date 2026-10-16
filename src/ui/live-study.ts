import { TOPICS, type CityEvent, type Topic } from "../simulation/live";
import type { ResidentVoice } from "../simulation/residents";
import type { MapLayer } from "../scenarios";

export const topicLayer: Record<Topic, MapLayer> = {
  parking: "traffic",
  waste: "waste",
  water: "water",
  supply: "stock",
  access: "access",
};
export const cityStamp = (time: number) =>
  `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, "0")}`;

// Reading is a UI state: it must not stop the city or change its news history.
export class StoryReader {
  current?: CityEvent;
  private held?: CityEvent;
  private dismissed?: number;
  get reading() {
    return !!this.held;
  }
  sync(automatic?: CityEvent) {
    this.current =
      this.held ?? (automatic?.id !== this.dismissed ? automatic : undefined);
    return this.current;
  }
  hold(event = this.current) {
    if (!event) return;
    this.held = structuredClone(event);
    this.current = this.held;
  }
  finish() {
    this.dismissed = this.current?.id;
    this.held = this.current = undefined;
  }
  reset() {
    this.held = this.current = this.dismissed = undefined;
  }
}

export function bindStoryReading(
  root: HTMLElement,
  reader: StoryReader,
  changed: () => void,
) {
  const hold = () => {
    if (!reader.reading && reader.current) {
      reader.hold();
      changed();
    }
  };
  root.addEventListener("pointerdown", hold);
  root.addEventListener("focusin", hold);
  // Also covers keyboard activation and assistive technology's synthesized clicks.
  root.addEventListener("click", hold);
}

export function storyVoice(event: CityEvent): ResidentVoice {
  return {
    id: `live-${event.id}`,
    group:
      event.type === "problem"
        ? event.title + " 주민"
        : TOPICS[event.topic] + " 주민",
    place: event.title,
    facilityId: event.facilityId,
    position: event.position,
    summary: event.text,
    opinion: event.text,
    fact: `도시 시간 ${cityStamp(event.time)}에 남긴 기록. ${event.evidence ?? "당시 수치가 따로 기록되지 않은 소식이에요."}`,
    change:
      event.type === "problem"
        ? undefined
        : "다른 정책과 생활 변화도 함께 반영된 기록이에요.",
  };
}

const eventNames: Record<CityEvent["type"], string> = {
  problem: "주민의 부탁",
  improved: "달라진 동네",
  policy: "정책 시행",
  reaction: "주민 반응",
  connection: "이어진 변화",
  participation: "주민이 함께 하는 일",
};
const newsSignatures = new WeakMap<HTMLElement, string>();
const newsEvents = new WeakMap<HTMLElement, CityEvent>();
export const newsEventFor = (button: HTMLElement) => newsEvents.get(button);

// Keep existing buttons and text nodes alive, including the one a student is reading.
export function updateNewsList(box: HTMLElement, events: readonly CityEvent[]) {
  const recent = [...events].reverse().slice(0, 18);
  const signature = JSON.stringify(recent);
  if (newsSignatures.get(box) === signature) return;
  newsSignatures.set(box, signature);
  const doc = box.ownerDocument;
  const focused = doc.activeElement;
  const selection = doc.getSelection();
  const protectedRows = [
    ...box.querySelectorAll<HTMLButtonElement>("[data-news]"),
  ].filter(
    (el) =>
      el.contains(focused) ||
      (!!selection?.anchorNode &&
        !selection.isCollapsed &&
        el.contains(selection.anchorNode)),
  );
  const reading =
    protectedRows.find((el) => el.contains(focused)) ?? protectedRows[0];
  const scroller = box.closest<HTMLElement>(".panel-body");
  const anchor =
    scroller && (scroller.scrollTop > 0 || reading)
      ? (reading ??
        [...box.children].find(
          (el) =>
            el.getBoundingClientRect().bottom >
            scroller.getBoundingClientRect().top,
        ))
      : undefined;
  const before = anchor?.getBoundingClientRect().top;
  const ids = new Set(recent.map((n) => String(n.id)));
  for (const child of [...box.children]) {
    if (
      !protectedRows.includes(child as HTMLButtonElement) &&
      !ids.has((child as HTMLElement).dataset.news ?? "")
    )
      child.remove();
  }
  let next: Element | null = null;
  // Insert only new rows. Existing rows stay in the DOM, preserving focus and selection.
  for (const event of [...recent].reverse()) {
    const id = String(event.id);
    let button = box.querySelector<HTMLButtonElement>(`[data-news="${id}"]`);
    if (!button) {
      button = doc.createElement("button");
      button.className = "live-news";
      button.dataset.news = id;
      for (const tag of ["small", "strong", "span", "small"])
        button.append(doc.createElement(tag));
      box.insertBefore(button, next);
    }
    const values = [
      `${cityStamp(event.time)} · ${eventNames[event.type]}`,
      event.title,
      event.text,
      event.evidence ?? "",
    ];
    newsEvents.set(button, event);
    [...button.children].forEach((child, index) => {
      if (child.textContent !== values[index])
        child.textContent = values[index];
    });
    (button.lastElementChild as HTMLElement).hidden = !event.evidence;
    next = button;
  }
  if (!recent.length) {
    const empty = doc.createElement("p");
    empty.className = "intro";
    empty.textContent =
      "아직 새 소식이 없어요. 길을 오가는 사람들과 우리 동네를 천천히 살펴봐요.";
    box.append(empty);
  }
  if (scroller && anchor?.isConnected && before !== undefined)
    scroller.scrollTop += anchor.getBoundingClientRect().top - before;
}
