import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { LiveCitySimulation, type CityEvent } from "../src/simulation/live";
import { SatisfactionTracker } from "../src/ui/satisfaction";
import {
  CHIP_SECONDS,
  MapFeedback,
  feedbackChip,
  pendingText,
} from "../src/ui/map-feedback";

test("bought policies report the delay the engine really applies, then stop waiting", () => {
  const city = new LiveCitySimulation(2404, 0, 0, 0, 0, 0, 0, Infinity); // five-minute model
  city.budget = 1000;
  city.runUntil(10);
  city.apply("outreach", "river");
  city.apply("stagger", "industry-commute");
  city.apply("parkingLot", "north");
  city.apply("reduce");
  const ready = Object.fromEntries(
    city.pendingEffects.map((p) => [p.id, p.readyAt]),
  );
  assert.deepEqual(ready, { outreach: 70, stagger: 300, parkingLot: 240 });
  assert.equal((city as unknown as { outreachStarts: number }).outreachStarts, 70);
  assert.ok(city.pendingEffects.every((p) => p.position));
  city.runUntil(71);
  assert.deepEqual(city.pendingEffects.map((p) => p.id).sort(), ["parkingLot", "stagger"]);
  city.runUntil(300);
  assert.equal(city.pendingEffects.length, 0);
  assert.equal(pendingText("배출 안내 활동", 42), "⏳ 배출 안내 활동 · 0:42 뒤 시작");
});

test("a chip compares a reaction with the policy's start and an improvement with a minute ago", () => {
  const tracker = new SatisfactionTracker();
  const sample = (time: number, parking: number) => ({
    time,
    overall: 50,
    topics: { parking, waste: 50, water: 50, supply: 50, access: 50 },
  });
  tracker.restore([sample(100, 40), sample(160, 45), sample(220, 52)], 220);
  const event = (type: CityEvent["type"], time: number): CityEvent => ({
    id: 1, time, topic: "parking", type, title: "", text: "", facilityId: "b6",
    position: { x: 1, z: 2 },
  });
  assert.deepEqual(feedbackChip(event("reaction", 220), tracker), {
    id: "event-1", position: { x: 1, z: 2 }, text: "😊 길과 주차 +12", mood: "up",
  });
  assert.equal(feedbackChip(event("improved", 220), tracker)!.text, "✓ 😊 길과 주차 +7");
  tracker.restore([sample(100, 60), sample(220, 52)], 220);
  assert.equal(feedbackChip(event("reaction", 220), tracker)!.mood, "down");
  assert.equal(feedbackChip(event("problem", 220), tracker), undefined);
  assert.equal(feedbackChip(event("policy", 220), tracker), undefined);
  const empty = new SatisfactionTracker();
  assert.equal(feedbackChip(event("reaction", 220), empty), undefined);
  assert.equal(feedbackChip(event("improved", 220), empty)!.text, "✓ 길과 주차 나아졌어요");
});

test("the map layer skips old stories, shows a countdown, marks the start and lets chips expire", () => {
  const dom = new JSDOM("<div class=city-view></div>");
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    const city = new LiveCitySimulation();
    city.runUntil(130);
    const tracker = new SatisfactionTracker();
    tracker.update(city);
    const feedback = new MapFeedback(
      dom.window.document.querySelector<HTMLElement>(".city-view")!,
      (p) => ({ x: p.x, y: p.z, visible: true }),
    );
    city.news.push({
      id: 999, time: 120, topic: "water", type: "improved", title: "", text: "",
      facilityId: "b7", position: { x: 5, z: 6 },
    });
    feedback.reset(city);
    feedback.update(city, tracker, 0);
    const layer = dom.window.document.querySelector("#map-feedback")!;
    assert.equal(layer.querySelectorAll(".map-chip").length, 0, "loaded stories are not replayed");

    city.apply("outreach", "river");
    feedback.update(city, tracker, 0);
    feedback.position();
    const badge = layer.querySelector<HTMLElement>(".map-pending")!;
    assert.match(badge.textContent!, /배출 안내 활동 · 1:00 뒤 시작/);
    assert.equal(badge.style.left, "104px");

    city.runUntil(191);
    feedback.update(city, tracker, 1000);
    assert.equal(layer.querySelectorAll(".map-pending").length, 0);
    const start = layer.querySelector<HTMLElement>('.map-chip[data-mood="start"]')!;
    assert.equal(start.textContent, "▶ 효과가 시작됐어요");
    feedback.update(city, tracker, 1000 + CHIP_SECONDS * 1000);
    assert.equal(layer.querySelectorAll(".map-chip").length, 0);
  } finally {
    globalThis.document = previous;
  }
});
