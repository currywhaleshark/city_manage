import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { TutorialInputs, tutorialCameraAllowed, type TutorialInputState } from "../src/ui/tutorial-inputs";

function fixture() {
  const dom = new JSDOM(`<body><canvas id="city-canvas" tabindex="0"></canvas>
    <button id="help">도움말</button><button id="pause">멈춤</button>
    <button id="zoom-in">확대</button><button id="zoom-out">축소</button><button id="camera-reset">전체 도시</button>
    <aside id="city-tutorial"><button data-tutorial="skip">안내 그만 보기</button><button id="tutorial-next" data-tutorial="next">계속</button></aside>
    <section id="placement-map"><button data-placement-target="school">학교</button></section>
    <section id="live-panel"><h2 id="live-panel-title" tabindex="-1">정책</h2>
    <select id="policy-topic"><option value="parking">길</option><option value="water">하천</option></select>
    <div class="live-policy-list"><button id="affordable">순찰</button><button id="unavailable" disabled aria-disabled="true">주차장</button><details><summary>주의할 점</summary></details></div></section></body>`, { pretendToBeVisual: true });
  let state: TutorialInputState = { stage: "observe", panel: "", placement: false, inspection: false };
  const doc = dom.window.document;
  const inputs = new TutorialInputs(doc, () => state);
  const el = (id: string) => doc.querySelector<HTMLElement>(id)!;
  inputs.refresh();
  return { dom, doc, inputs, el, state: () => state, set: (next: Partial<TutorialInputState>) => { state = { ...state, ...next }; inputs.refresh(); } };
}

test("observation allows exploring the map, then spotlight locks it until guided placement", () => {
  const f = fixture();
  let moves = 0, placements = 0;
  const canvas = f.el("#city-canvas"), target = f.el("[data-placement-target]");
  for (const type of ["pointerdown", "pointerup", "wheel", "touchstart"])
    canvas.addEventListener(type, () => moves++);
  target.addEventListener("click", () => placements++);
  for (const type of ["pointerdown", "pointerup", "wheel", "touchstart"])
    assert.equal(canvas.dispatchEvent(new f.dom.window.Event(type, { bubbles: true, cancelable: true })), true);
  assert.equal(moves, 4, "mouse and touch gestures reach the map during initial observation");
  assert.equal(tutorialCameraAllowed(f.state()), true);
  let cameraActions = 0;
  for (const id of ["#zoom-in", "#zoom-out", "#camera-reset"]) {
    f.el(id).addEventListener("click", () => cameraActions++);
    f.el(id).click();
  }
  assert.equal(cameraActions, 3);
  target.click();
  assert.equal(placements, 0, "free map movement does not enable policy placement");
  assert.equal((f.el("#help") as HTMLButtonElement).disabled, true);
  assert.equal((f.el("#pause") as HTMLButtonElement).disabled, true);
  f.set({ stage: "spotlight" });
  f.el("#zoom-in").click();
  assert.equal(cameraActions, 3, "the highlighted problem stays in view");
  for (const type of ["pointerdown", "pointerup", "wheel", "touchstart"])
    assert.equal(canvas.dispatchEvent(new f.dom.window.Event(type, { bubbles: true, cancelable: true })), false);
  target.click();
  assert.equal(moves, 4);
  assert.equal(placements, 0);
  assert.equal(tutorialCameraAllowed(f.state()), false);
  f.set({ stage: "policy", placement: true });
  canvas.dispatchEvent(new f.dom.window.Event("pointerdown", { bubbles: true }));
  target.click();
  assert.equal(moves, 5);
  assert.equal(placements, 1);
  assert.equal(canvas.inert, false);
  assert.equal(tutorialCameraAllowed(f.state()), true);
  f.set({ stage: "watch", placement: false });
  target.click();
  assert.equal(placements, 1);
  f.dom.window.close();
});

test("locks preserve policy availability, block field changes, and restore normal focusability", () => {
  const f = fixture();
  assert.equal((f.el("#help") as HTMLButtonElement).disabled, true);
  assert.equal(!!f.el("#help").inert, false, "locked buttons still intercept taps over underlying controls");
  f.set({ stage: "policy", panel: "policy" });
  assert.equal(f.el("#affordable").inert, false);
  assert.equal((f.el("#unavailable") as HTMLButtonElement).disabled, true);
  assert.equal(f.el("summary").inert, false);
  const topic = f.el("#policy-topic") as HTMLSelectElement;
  topic.value = "water";
  topic.dispatchEvent(new f.dom.window.Event("change", { bubbles: true, cancelable: true }));
  assert.equal(topic.value, "parking");
  f.el("#help").focus();
  assert.notEqual(f.doc.activeElement, f.el("#help"));
  f.set({ stage: "done" });
  assert.equal(f.doc.querySelectorAll("[data-tutorial-locked]").length, 0);
  assert.equal(topic.inert, false);
  assert.equal((f.el("#help") as HTMLButtonElement).disabled, false);
  assert.equal((f.el("#unavailable") as HTMLButtonElement).disabled, true);
  assert.equal(f.el("#unavailable").getAttribute("aria-disabled"), "true");
  f.el("#help").focus();
  assert.equal(f.doc.activeElement, f.el("#help"));
  f.dom.window.close();
});

test("restored stages also guard new controls before repaint and reserve Escape for guided exits", () => {
  const f = fixture();
  f.set({ stage: "story", panel: "story" });
  let actions = 0;
  const random = f.doc.createElement("button");
  random.addEventListener("click", () => actions++);
  f.doc.body.append(random);
  random.click();
  assert.equal(actions, 0, "a freshly rendered off-path control cannot bypass capture");
  const escape = () => f.doc.body.dispatchEvent(new f.dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  assert.equal(escape(), false);
  f.set({ stage: "policy", panel: "", placement: true });
  assert.equal(escape(), true, "the learner can cancel choosing a place");
  f.set({ stage: "result", placement: false, inspection: true });
  assert.equal(escape(), true, "the learner can return from looking at the result's location");
  assert.equal(tutorialCameraAllowed(f.state()), true);
  f.set({ stage: "done", inspection: false });
  random.click();
  assert.equal(actions, 1);
  f.dom.window.close();
});
