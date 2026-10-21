import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { OrthographicCamera } from "three";
import { ResidentRenderer } from "../src/renderer/residents";
import type { ResidentVoice } from "../src/simulation/residents";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
const intersects = (a: Box, b: Box) =>
  Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x) + 0.1 &&
  Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y) + 0.1;

// Exercise the real renderer's placement with controlled DOM measurements.
// JSDOM does not perform CSS layout or render a browser screenshot.
function fixture(t: TestContext) {
  const dom = new JSDOM(
    '<body class="living-city"><header class="topbar"></header><div id="map"></div></body>',
  );
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    value: dom.window.document,
    configurable: true,
  });
  let time = 0;
  t.mock.method(performance, "now", () => (time += 101));
  const document = dom.window.document;
  const rect = (box: Box) => new dom.window.DOMRect(box.x, box.y, box.w, box.h);
  document.querySelector(".topbar")!.getBoundingClientRect = () =>
    rect({ x: 0, y: 0, w: 1200, h: 76 });
  const renderer = new ResidentRenderer(
    document.querySelector<HTMLElement>("#map")!,
  );
  const bubble = document.querySelector<HTMLElement>("#resident-bubble")!;
  let bw = 302,
    bh = 278,
    width = 1200,
    height = 900;
  Object.defineProperties(bubble, {
    offsetWidth: { get: () => bw },
    offsetHeight: {
      get: () => Math.min(bh, parseFloat(bubble.style.maxHeight) || bh),
    },
  });
  const voice = (id = "first", x = 0): ResidentVoice => ({
    id,
    facilityId: "b0",
    position: { x, z: 0 },
    group: "주민",
    place: "골목",
    summary: "길을 살펴봐요",
    fact: "관찰한 내용",
    opinion: "길을 비워 주세요",
  });
  renderer.setVoices([voice()]);
  renderer.setOpen(true);
  const camera = new OrthographicCamera(-600, 600, 450, -450, 1, 2000);
  const readBox = (element: HTMLElement, w: number, h: number): Box => ({
    x: parseFloat(element.style.left),
    y: parseFloat(element.style.top),
    w,
    h,
  });
  const update = (x = 583.16, y = 450.12) => {
    camera.left = -width / 2;
    camera.right = width / 2;
    camera.top = height / 2;
    camera.bottom = -height / 2;
    camera.position.set(width / 2 - x, 20 + y - height / 2, 1000);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    renderer.update(camera, width, height);
    return readBox(bubble, bw, bubble.offsetHeight);
  };
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else Reflect.deleteProperty(globalThis, "document");
    dom.window.close();
  });
  return {
    renderer,
    bubble,
    document,
    voice,
    update,
    pin: () =>
      readBox(
        document.querySelector<HTMLElement>(
          '.resident-pin[aria-pressed="true"]',
        )!,
        width <= 600 ? 44 : 146,
        44,
      ),
    resize: (w: number, h: number) => {
      width = w;
      height = h;
      bw = w <= 700 ? 250 : 302;
    },
    bubbleSize: (w: number, h: number) => { bw = w; bh = h; },
    expand: (h: number) => {
      bh = h;
      bubble.querySelector<HTMLDetailsElement>("details")!.open = true;
    },
    obstacle: (box: Box) => {
      const element = document.createElement("div");
      element.className = "map-controls";
      element.getBoundingClientRect = () => rect(box);
      document.body.append(element);
      return element;
    },
  };
}

test("a mobile tutorial card leaves a separate readable place for the resident bubble", (t) => {
  const f = fixture(t);
  f.resize(390, 780);
  const guideBox = { x: 12, y: 70, w: 366, h: 200 };
  const guide = f.obstacle(guideBox);
  guide.className = "tutorial-card";
  guide.id = "city-tutorial";
  guide.getClientRects = () => [guide.getBoundingClientRect()] as unknown as DOMRectList;
  const bubble = f.update(190, 235);
  assert.equal(intersects(bubble, guideBox), false);
  assert.equal(intersects(f.pin(), guideBox), false);
});

test("a narrow phone keeps the tutorial bubble and pin clear of both map control columns", (t) => {
  const f = fixture(t);
  f.resize(320, 504);
  f.bubbleSize(184, 152);
  const boxes = [
    { x: 12, y: 70, w: 296, h: 186 },
    { x: 12, y: 268, w: 48, h: 220 },
    { x: 264, y: 348, w: 40, h: 116 },
  ];
  boxes.forEach((box, i) => {
    const obstacle = f.obstacle(box);
    if (i === 0) { obstacle.className = "tutorial-card"; obstacle.id = "city-tutorial"; }
    if (i === 1) obstacle.className = "map-tools";
    obstacle.getClientRects = () => [obstacle.getBoundingClientRect()] as unknown as DOMRectList;
  });
  const bubble = f.update(160, 226.63);
  for (const box of boxes) {
    assert.equal(intersects(bubble, box), false, "the story must not cover a control");
    assert.equal(intersects(f.pin(), box), false, "the location pin must not cover a control");
  }
  assert.equal(intersects(bubble, f.pin()), false, JSON.stringify({ bubble, pin: f.pin() }));
});

test("resident bubble and pin stay put across tiny camera changes and repeated story refreshes", (t) => {
  const f = fixture(t);
  const first = f.update(),
    pin = f.pin();
  for (let i = 1; i <= 60; i++) {
    f.renderer.setVoices([f.voice()]);
    const next = f.update(583.16 + i * 0.00001, 450.12 + i * 0.00003);
    assert.ok(
      Math.hypot(next.x - first.x, next.y - first.y) < 1,
      `story jumped: ${JSON.stringify({ first, next })}`,
    );
    assert.ok(
      Math.hypot(f.pin().x - pin.x, f.pin().y - pin.y) < 1,
      "resident pin jumped",
    );
  }
});

test("resident layout still avoids a new obstruction and follows a deliberate camera move", (t) => {
  const f = fixture(t);
  const first = f.update();
  f.obstacle(first);
  const next = f.update();
  assert.ok(!intersects(next, first), "new UI obstruction must move the story");
  assert.ok(
    !intersects(f.pin(), next),
    "pin must avoid story after repositioning",
  );
  const moved = f.update(850, 600);
  assert.ok(
    Math.hypot(moved.x - next.x, moved.y - next.y) > 20,
    "camera pan must still move the story",
  );
  assert.ok(!intersects(moved, first));
  assert.ok(!intersects(f.pin(), moved));
});

test("expanded stories and a narrower viewport remain within bounds without covering the pin", (t) => {
  const f = fixture(t);
  f.update();
  f.expand(330);
  const expanded = f.update();
  assert.ok(!intersects(expanded, f.pin()));
  f.resize(390, 600);
  const narrow = f.update(195, 320);
  for (const box of [narrow, f.pin()]) {
    assert.ok(box.x >= 8 && box.x + box.w <= 382);
    assert.ok(box.y >= 86 && box.y + box.h <= 590);
  }
  assert.ok(!intersects(narrow, f.pin()));
});

test("small camera movements accumulate, while a removed obstruction does not flip the story back", (t) => {
  const f = fixture(t);
  const first = f.update();
  let moved = first;
  for (let i = 1; i <= 12; i++) moved = f.update(583.16 + i / 4, 450.12);
  assert.ok(
    moved.x - first.x >= 2,
    "a slow pan must not be mistaken for stationary jitter",
  );
  const obstacle = f.obstacle(moved);
  const relocated = f.update(586.16, 450.12);
  assert.ok(!intersects(relocated, moved));
  obstacle.remove();
  assert.deepEqual(f.update(586.16, 450.12), relocated);
});

test("a different story gets its own placement and nearby resident pins still avoid each other", (t) => {
  const f = fixture(t);
  const first = f.update();
  f.renderer.setVoices([f.voice("second", 300), f.voice("third", 310)]);
  const next = f.update();
  const anchorX = 583.16 + 300;
  assert.ok(
    Math.hypot(next.x + next.w / 2 - anchorX, next.y + next.h / 2 - 450.12) <
      240,
  );
  assert.notDeepEqual(first, next);
  f.renderer.choose("third");
  const selected = f.update();
  const pins = [
    ...f.document.querySelectorAll<HTMLElement>(".resident-pin"),
  ].map((el) => ({
    x: parseFloat(el.style.left),
    y: parseFloat(el.style.top),
    w: 146,
    h: 44,
  }));
  assert.equal(f.bubble.dataset.resident, "third");
  assert.ok(!intersects(pins[0], pins[1]));
  for (const pin of pins) assert.ok(!intersects(pin, selected));
});

test("ending a story immediately hides its connector, and the next story gets fresh endpoints", (t) => {
  const f = fixture(t);
  const line = f.document.querySelector<SVGLineElement>(
    ".resident-bubble-line",
  )!;
  const endpoints = () =>
    ["x1", "y1", "x2", "y2"].map((key) => line.getAttribute(key));
  f.update();
  assert.notEqual(line.style.display, "none");
  const before = endpoints();

  // Reading finish and automatic expiry both clear the voice list, without
  // closing resident mode. update() then returns early because there are no pins.
  f.renderer.setVoices([]);
  assert.equal(f.bubble.hidden, true);
  assert.equal(f.document.querySelectorAll(".resident-pin").length, 0);
  assert.equal(
    line.style.display,
    "none",
    "the connector must hide before the next frame",
  );
  f.update();
  assert.equal(line.style.display, "none");

  f.renderer.setVoices([f.voice("next", 200)]);
  assert.equal(
    line.style.display,
    "none",
    "old endpoints must not flash when a new story arrives",
  );
  f.update();
  assert.notEqual(line.style.display, "none");
  assert.notDeepEqual(endpoints(), before);
});

test("closing and reopening resident mode hides the old connector until it is placed again", (t) => {
  const f = fixture(t);
  const line = f.document.querySelector<SVGLineElement>(
    ".resident-bubble-line",
  )!;
  const root = f.document.querySelector<HTMLElement>("#resident-map")!;
  f.update();
  f.renderer.setOpen(false);
  assert.equal(root.hidden, true);
  assert.equal(line.style.display, "none");
  f.renderer.setOpen(true);
  assert.equal(root.hidden, false);
  assert.equal(line.style.display, "none");
  f.update(750, 500);
  assert.notEqual(line.style.display, "none");
});

test("resident evidence omits a repeated quote but preserves a distinct opinion and change", (t) => {
  const f = fixture(t);
  const voice = {
    ...f.voice(),
    summary: "길을 비워 주세요",
    opinion: "길을 비워 주세요",
    change: "정차 차량이 줄었어요",
  };
  f.renderer.setVoices([voice]);
  const opinion = f.document.querySelector<HTMLElement>(
    "#resident-opinion-section",
  )!;
  const label = f.document.querySelector("#resident-evidence-label")!;
  const details = f.bubble.querySelector<HTMLDetailsElement>("details")!;
  assert.equal(opinion.hidden, true);
  assert.equal(label.textContent, "관찰한 사실과 변화");
  assert.equal(
    f.document.querySelector<HTMLElement>("#resident-change")!.hidden,
    false,
  );
  details.open = true;
  f.renderer.setVoices([
    { ...voice, opinion: "대신 물건 내릴 자리를 정해 주세요" },
  ]);
  assert.equal(opinion.hidden, false);
  assert.match(opinion.textContent!, /물건 내릴 자리/);
  assert.equal(label.textContent, "관찰한 사실과 자세한 의견");
  assert.equal(
    details.open,
    true,
    "evidence remains open when the content updates",
  );
});
