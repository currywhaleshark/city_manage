import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  LiveCitySimulation,
  restoreLiveCity,
  type CityEvent,
} from "../src/simulation/live";
import {
  captureLiveCheckpoint,
  restoreLiveCheckpoint,
} from "../src/simulation/checkpoint";
import {
  StoryReader,
  bindStoryReading,
  storyVoice,
  updateNewsList,
  newsEventFor,
} from "../src/ui/live-study";
import {
  ObservationComparison,
  policyComparisonMarkup,
} from "../src/ui/live-notebook";

const event = (id: number): CityEvent => ({
  id,
  time: id * 100,
  topic: "water",
  type: "problem",
  title: "하천 아래",
  text: "물의 변화를 살펴봐요.",
  facilityId: "b7",
  position: { x: 104, z: 304 },
  evidence: "발견 때의 가상 오염도 12.3",
});

test("intentional pointer, keyboard and assistive reading outlasts automatic stories and reset releases it", () => {
  const dom = new JSDOM(
    "<section><button>주민 의견</button><details><summary>자세히</summary></details></section>",
  );
  const root = dom.window.document.querySelector("section")!;
  const reader = new StoryReader();
  let changes = 0;
  bindStoryReading(root, reader, () => changes++);
  for (const type of ["pointerdown", "focusin", "click"]) {
    reader.reset();
    const source = event(1);
    reader.sync(source);
    root
      .querySelector("button")!
      .dispatchEvent(new dom.window.Event(type, { bubbles: true }));
    source.evidence = "later mutation";
    assert.equal(reader.sync(event(9))!.id, 1);
    assert.equal(
      reader.sync(undefined)!.evidence,
      "발견 때의 가상 오염도 12.3",
    );
    reader.finish();
    assert.equal(reader.sync(event(1)), undefined);
    assert.equal(reader.sync(event(9))!.id, 9);
  }
  assert.equal(changes, 3);
  reader.reset();
  assert.equal(reader.current, undefined);
  dom.window.close();
});

test("old news retains its evidence and missing historical measurements are never replaced with today's values", () => {
  const old = event(1);
  assert.match(storyVoice(old).fact, /12.3/);
  assert.match(storyVoice(old).fact, /1:40/);
  delete old.evidence;
  assert.match(storyVoice(old).fact, /당시 수치가 따로 기록되지/);
});

test("news refresh preserves focused buttons, selected text and older rows while adding new events", () => {
  const dom = new JSDOM('<div class="panel-body"><div id="news"></div></div>');
  const doc = dom.window.document,
    box = doc.querySelector<HTMLElement>("#news")!;
  const events = Array.from({ length: 18 }, (_, i) => event(i + 1));
  updateNewsList(box, events);
  const first = box.querySelector<HTMLButtonElement>('[data-news="1"]')!;
  const text = first.querySelector("span")!.firstChild!;
  first.focus();
  const range = doc.createRange();
  range.selectNodeContents(text);
  doc.getSelection()!.removeAllRanges();
  doc.getSelection()!.addRange(range);
  updateNewsList(box, events);
  assert.equal(doc.activeElement, first);
  updateNewsList(box, [...events.slice(1), event(19)]);
  assert.equal(doc.activeElement, first);
  assert.ok(first.isConnected);
  assert.equal(doc.getSelection()!.anchorNode, text);
  assert.equal(
    newsEventFor(first)!.id,
    1,
    "an evicted model record is still available while reading",
  );
  assert.equal(box.firstElementChild!.getAttribute("data-news"), "19");
  assert.equal(box.querySelectorAll('[data-news="1"]').length, 1);
  dom.window.close();
});

test("policy comparison uses the original local baseline and survives checkpoints and portable replay", async () => {
  const city = new LiveCitySimulation();
  city.runUntil(25);
  const before = city.parking.parkingStats.sites.find(
    (s) => s.id === "school",
  )!.illegal;
  city.apply("patrol", "school", "학생이 다니는 길을 비워요.");
  city.runUntil(100);
  const row = city.policyComparisons[0];
  assert.equal(row.before, before);
  assert.equal(
    row.now,
    city.parking.parkingStats.sites.find((s) => s.id === "school")!.illegal,
  );
  assert.equal(row.scope, "학교 앞");
  assert.equal(row.place, "학교 앞");
  assert.deepEqual(
    restoreLiveCheckpoint(captureLiveCheckpoint(city), city.save())
      .policyComparisons,
    city.policyComparisons,
  );
  assert.deepEqual(
    (await restoreLiveCity(city.save())).policyComparisons,
    city.policyComparisons,
  );
  assert.match(policyComparisonMarkup(city), /학교 앞.*순찰 구역 지정/);
  assert.match(policyComparisonMarkup(city), /정책 하나의 효과로 단정하지/);
  city.apply("park", "north");
  const building = city.policyComparisons[1];
  assert.equal(
    building.scope,
    "도시 전체",
    "a building's location is not the scope of the citywide access measure",
  );
});

test("observation comparison freezes two labelled snapshots, rejects reversed dates and escapes user text", () => {
  const city = new LiveCitySimulation();
  city.observe();
  city.runUntil(20);
  city.observe();
  city.runUntil(30);
  const comparison = new ObservationComparison(city);
  const markup = comparison.result();
  city.runUntil(60);
  assert.equal(comparison.result(), markup);
  assert.match(markup, /0:20 → 0:30/);
  assert.match(markup, /가상 오염도/);
  comparison.from = 2;
  comparison.to = 0;
  assert.match(comparison.result(), /먼저 관찰한 시점을 왼쪽/);
  city.apply("patrol", "school", '<img src=x onerror="bad()">');
  assert.ok(!policyComparisonMarkup(city).includes("<img"));
  assert.match(policyComparisonMarkup(city), /&lt;img/);
});
