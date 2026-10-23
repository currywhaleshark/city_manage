import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import ts from "typescript";
import { JSDOM } from "jsdom";

// No browser or server: run the real UI handlers and resident DOM with an inert
// rendering adapter. This checks interaction state, not layout or WebGL output.
test("live UI keeps a read story, carries its context into policy selection, and compares recorded results", async () => {
  const dom = new JSDOM('<div id="app"></div>', {
    url: "https://city.test",
    pretendToBeVisual: true,
  });
  const document = dom.window.document;
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  const globals = [
    "window",
    "document",
    "HTMLElement",
    "HTMLButtonElement",
    "HTMLInputElement",
    "HTMLTextAreaElement",
    "localStorage",
    "requestAnimationFrame",
    "Audio",
    "setTimeout",
  ];
  const previous = new Map(
    globals.map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  let frame: FrameRequestCallback;
  for (const key of globals.slice(0, 7))
    Object.defineProperty(globalThis, key, {
      value: (dom.window as any)[key],
      configurable: true,
    });
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    value: (callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    },
    configurable: true,
  });
  Object.defineProperty(globalThis, "Audio", {
    value: class {
      volume = 0;
      play() {
        return Promise.resolve();
      }
    },
    configurable: true,
  });
  Object.defineProperty(globalThis, "setTimeout", {
    value: () => 1,
    configurable: true,
  });
  const liveURL = new URL("../src/live.ts", import.meta.url).href;
  const residentURL = new URL("../src/renderer/residents.ts", import.meta.url)
    .href;
  const placementURL = new URL("../src/renderer/placement.ts", import.meta.url)
    .href;
  const adapterURL = new URL(
    "../src/renderer/__dom_test_adapter.js",
    import.meta.url,
  ).href;
  const storageURL = new URL(
    "../src/storage/__dom_test_storage.js",
    import.meta.url,
  ).href;
  const hook = registerHooks({
    resolve(specifier, context, next) {
      if (context.parentURL === liveURL && specifier === "./renderer/city")
        return { url: adapterURL, shortCircuit: true };
      if (
        context.parentURL === liveURL &&
        specifier === "./storage/live-checkpoint"
      )
        return { url: storageURL, shortCircuit: true };
      return next(specifier, context);
    },
    load(url, context, next) {
      if (url === liveURL)
        return {
          format: "module",
          shortCircuit: true,
          source: ts.transpileModule(
            readFileSync(new URL(url), "utf8").replaceAll(
              "import.meta.env",
              '({ DEV: true, BASE_URL: "/" })',
            ),
            {
              compilerOptions: {
                target: ts.ScriptTarget.ES2022,
                module: ts.ModuleKind.ESNext,
              },
            },
          ).outputText,
        };
      if (url.endsWith(".css"))
        return { format: "module", source: "export {};", shortCircuit: true };
      if (url === storageURL)
        return {
          format: "module",
          source:
            "export async function writeCheckpoint() {} export async function clearCheckpoint() {}",
          shortCircuit: true,
        };
      if (url === adapterURL)
        return {
          format: "module",
          shortCircuit: true,
          source: `
        import { Vector3 } from 'three';
        import { ResidentRenderer } from ${JSON.stringify(residentURL)};
        import { PlacementRenderer } from ${JSON.stringify(placementURL)};
        export class CityRenderer {
          constructor(canvas, labels) {
            this.container = labels.parentElement;
            this.residents = new ResidentRenderer(this.container);
            this.residents.onChoose = (...args) => this.onResidentSelect?.(...args);
            this.controls = { enabled: true, target: new Vector3(), update() {} };
            window.__testCameraControls = this.controls;
            this.camera = { position: new Vector3(), zoom: 1, updateProjectionMatrix() {} };
          }
          setSimulation() {} setMapLayer() {} render() {} screenPoint() { return { x: 0, y: 0, visible: false }; } resetCamera() {} focusPosition() {} zoom() {} setQuality() {}
          setTutorialSpotlight() {}
          beginInspection() {} endInspection() {} recenterInspection() {}
          setResidentVoices(voices) { this.residents.setVoices(voices); }
          setResidentMode(open) { this.residents.setOpen(open); }
          showPlacement(title, targets, selected, choose, cancel) {
            this.clearPlacement();
            this.placement = new PlacementRenderer(this.container, title, targets, selected, choose, cancel);
          }
          clearPlacement() { this.placement?.dispose(); this.placement = undefined; }
        }
      `,
        };
      return next(url, context);
    },
  });
  try {
    await import(liveURL);
    let now = performance.now();
    const tick = (count = 6) => {
      for (let i = 0; i < count; i++) frame!((now += 100));
    };
    const state = () => (dom.window as any).__liveCity;
    const el = <T extends HTMLElement = HTMLElement>(selector: string) => {
      const found = document.querySelector<T>(selector);
      assert.ok(found, selector);
      return found;
    };
    const click = (selector: string) => el(selector).click();
    const change = (selector: string, value: string) => {
      el<HTMLSelectElement>(selector).value = value;
      el(selector).dispatchEvent(
        new dom.window.Event("change", { bubbles: true }),
      );
    };
    assert.equal(document.body.dataset.tutorial, "observe");
    assert.match(el("#tutorial-copy").textContent!, /조금 뒤/);
    const cameraEnabled = () => (dom.window as any).__testCameraControls.enabled;
    assert.equal(cameraEnabled(), true, "initial observation lets the learner explore the city");
    assert.equal(!!el("#city-canvas").inert, false);
    for (const selector of ["#zoom-in", "#zoom-out", "#camera-reset"])
      assert.equal(el<HTMLButtonElement>(selector).disabled, false);
    for (const selector of ['#help', '[data-panel-open="policy"]', '[data-panel-open="news"]', '#layer-waste', '#city-options-toggle', '#pause']) {
      assert.equal(el<HTMLButtonElement>(selector).disabled, true, selector);
      click(selector);
    }
    assert.equal(el("#live-panel").hidden, true);
    assert.equal(state().paused, false);
    change("#speed", "8");
    assert.equal(el<HTMLSelectElement>("#speed").value, "4");
    document.body.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true, cancelable: true }));
    assert.equal(state().paused, false, "the pause shortcut cannot bypass the lesson");
    click('#city-tutorial [data-tutorial="skip"]');
    assert.equal(el("#city-tutorial").hidden, true);
    assert.equal(cameraEnabled(), true);
    assert.equal(el("#help").inert, false);
    // Compact controls use the same speed and save handlers as desktop.
    const options = el("#city-options-toggle");
    click("#city-options-toggle");
    assert.equal(options.getAttribute("aria-expanded"), "true");
    change("#speed", "8");
    assert.equal(el("#current-speed").textContent, "8×");
    assert.equal(options.getAttribute("aria-expanded"), "false");
    assert.equal(document.activeElement, options);
    click("#city-options-toggle");
    click("#save-city");
    assert.equal(options.getAttribute("aria-expanded"), "false");
    assert.equal(document.activeElement, options);
    assert.equal(JSON.parse(dom.window.localStorage.getItem("mayor-living-city-v1")!).time, state().time);
    click('[data-panel-open="news"]');
    click("#city-options-toggle");
    options.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal(options.getAttribute("aria-expanded"), "false");
    assert.equal(document.body.dataset.livePanel, "news", "Escape dismisses only the controls, keeping the current work open");
    click("#city-options-toggle");
    click("#city-canvas");
    assert.equal(options.getAttribute("aria-expanded"), "false", "tapping the map dismisses extra controls");
    click("#city-options-toggle");
    el('[data-panel-open="notebook"]').focus();
    assert.equal(options.getAttribute("aria-expanded"), "false", "tabbing out dismisses extra controls");
    click("#close-panel");
    while (state().time < 121) tick(1);
    tick();
    const original = el("#resident-fact").textContent;
    const firstId = el("#resident-bubble").dataset.resident;
    el<HTMLButtonElement>(".resident-pin").focus();
    while (state().time < 330) tick(1);
    assert.equal(el("#resident-bubble").dataset.resident, firstId);
    assert.equal(el("#resident-fact").textContent, original);
    assert.ok(state().time >= 330, "reading never freezes the living city");

    assert.equal(document.querySelector(".live-resident-nav"), null);
    assert.equal(el("#resident-evidence").hidden, true);
    assert.equal(el("#resident-bubble").querySelector(".live-story-actions"), null);
    assert.equal(el("#read-story").tagName, "BUTTON", "the whole preview supports native keyboard activation");
    el("#read-story").focus();
    click("#read-story");
    assert.equal(document.body.dataset.livePanel, "story");
    assert.ok(el(".live-story-detail").textContent!.includes(original!));
    assert.equal(document.activeElement, el("#live-panel-title"));
    const heldStory = el(".live-story-detail").textContent;
    tick(30);
    assert.equal(el(".live-story-detail").textContent, heldStory, "new events do not replace an open story");
    click("#close-panel");
    click("#close-story");
    assert.equal(document.body.dataset.livePanel, "", "the X closes without opening the content panel");
    assert.equal(document.activeElement, el("#city-canvas"));
    assert.notEqual(el("#resident-bubble").dataset.resident === firstId && !el("#resident-bubble").hidden, true);
    while (state().time < 630) tick(1);
    click('[data-panel-open="news"]');
    const news = state().news.find(
      (n: any) => n.topic === "waste" && n.type === "problem",
    );
    assert.ok(news, "a waste problem is available to inspect");
    click(`[data-news="${news.id}"]`);
    assert.equal(document.body.dataset.livePanel, "story", "history opens the full story directly");
    assert.match(
      el(".live-story-detail").textContent!,
      new RegExp(news.evidence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
    const canvas = el("#city-canvas");
    const inspectionEvidence = el(".live-story-detail").textContent;
    click("#inspect-story");
    assert.equal(el<HTMLDialogElement>("#place-inspector").open, true);
    assert.ok(el("#inspection-title").textContent!.includes(news.title));
    assert.equal(el(".inspection-viewport #city-canvas"), canvas);
    const inspectionTime = state().time;
    tick(6);
    assert.ok(state().time > inspectionTime, "the enlarged scene keeps the live simulation running");
    click("#inspection-pause");
    const pausedTime = state().time;
    tick(6);
    assert.equal(state().time, pausedTime);
    click("#inspection-pause");
    click("#close-inspection");
    assert.equal(el(".workspace .city-view #city-canvas"), canvas);
    assert.equal(document.body.dataset.livePanel, "story");
    assert.equal(el(".live-story-detail").textContent, inspectionEvidence);
    click("#investigate-story");
    assert.equal(el<HTMLSelectElement>("#policy-topic").value, "waste");
    assert.equal(document.body.dataset.liveLayer, "waste");
    assert.ok(el(".study-context").textContent!.includes(news.title));
    const policyPanel = el("#live-panel-body");
    el("#return-to-story").focus();
    click("#return-to-story");
    assert.equal(el<HTMLDialogElement>("#place-inspector").open, true);
    el("#place-inspector").dispatchEvent(new dom.window.Event("cancel", { cancelable: true }));
    assert.equal(document.body.dataset.livePanel, "policy");
    assert.equal(el("#live-panel-body"), policyPanel);
    assert.equal(document.activeElement, el("#return-to-story"));
    click('[data-live-policy="cleanup"]');
    assert.ok(el("#placement-title").textContent!.includes(news.title));
    assert.equal(state().paused, true);
    click('[data-placement-target="river"]');
    const beforeTime = state().time;
    click("#apply-live-policy");
    assert.equal(state().actions.at(-1).target, "river");
    assert.equal(state().time, beforeTime);
    tick(60);
    click('[data-panel-open="notebook"]');
    assert.ok(
      el(".policy-comparison summary").textContent!.includes("이곳 먼저 수거"),
    );
    assert.match(el(".study-comparison").textContent!, /시행 전.*관찰 때/);
    assert.ok(el(".study-remaining").textContent!.length);
    click("[data-review-policy]");
    assert.equal(el<HTMLDialogElement>("#place-inspector").open, true);
    click("#close-inspection");
    assert.equal(document.body.dataset.livePanel, "notebook");
    click("#capture-observation");
    const comparison = el<HTMLDetailsElement>("details.observation-comparison");
    assert.equal(
      comparison.open,
      false,
      "citywide detail is available without crowding the policy result",
    );
    click(".observation-comparison summary");
    assert.equal(comparison.open, true);
    assert.equal(el(".study-table").querySelectorAll("tbody tr").length, 5);
    el("#compare-to").focus();
    change("#compare-to", "0");
    assert.match(
      el("#observation-comparison-result").textContent!,
      /서로 다른 두 시점/,
    );
    assert.equal(document.activeElement, el("#compare-to"));
    change("#compare-to", "1");
    assert.equal(el(".study-table").querySelectorAll("tbody tr").length, 5);
    assert.equal(
      JSON.parse(dom.window.localStorage.getItem("mayor-living-city-v1")!)
        .observations.length,
      1,
    );
    click("#close-panel");

    // New stories must not replace the currently focused history row.
    click('[data-panel-open="news"]');
    const row = el<HTMLButtonElement>("[data-news]");
    row.focus();
    tick(180);
    assert.equal(document.activeElement, row);
    assert.ok(row.isConnected);
    click("#close-panel");

    // The mayor convenes a problem, hears residents' proposals and counts a
    // real ballot. No activity/method can be preselected from the old UI.
    click('[data-panel-open="news"]');
    click('[data-panel-open="community"]');
    assert.match(el('[data-community-project="sorting"]').textContent!, /쓰레기/);
    click('[data-community-project="sorting"]');
    click('[data-placement-target="alley"]');
    const meetingTime = state().time, meetingBudget = state().budget;
    assert.equal(document.querySelector("#start-community"), null);
    assert.match(el(".community-voice").textContent!, /함께 모여 배출 방법/);
    tick(20);
    assert.equal(state().time, meetingTime, "residents can deliberate without time pressure");
    click("#community-next");
    assert.match(el(".community-voice").textContent!, /번갈아 배출 안내/);
    click("#community-next");
    assert.match(el(".community-voice").textContent!, /집마다 배출 안내/);
    click("#community-next");
    assert.equal(document.querySelectorAll(".community-proposal").length, 3);
    assert.equal(document.querySelector("[data-community-method]"), null);
    assert.equal(document.querySelector("#start-community"), null);
    click("#community-vote");
    assert.match(el("#live-panel-body").textContent!, /가상 주민 11명/);
    assert.equal(state().council.length, 0);
    click("#community-count");
    assert.match(el(".community-status").textContent!, /동점/);
    assert.equal(document.querySelector("#start-community"), null, "a tied vote cannot be enacted before the runoff");
    click("#community-runoff");
    assert.match(el(".community-status").textContent!, /함께 모여 배출 방법/);
    assert.equal(state().budget, meetingBudget);
    el<HTMLTextAreaElement>("#community-concern").value = "늦게 돌아오는 이웃에게도 안내해요";
    el("#community-concern").dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    click("#start-community");
    assert.equal(state().council.length, 1);
    assert.equal(state().council[0].method, "together");
    assert.equal(state().council[0].vote.rounds.length, 2);
    assert.equal(state().budget, meetingBudget - 5);
    assert.equal(state().paused, false);
    const savedMeeting = JSON.parse(dom.window.localStorage.getItem("mayor-living-city-v1")!).council[0];
    assert.equal(savedMeeting.concern, "늦게 돌아오는 이웃에게도 안내해요");
    assert.equal(savedMeeting.vote.winner, "together");
    click('[data-panel-open="news"]');
    click('[data-panel-open="community"]');
    click('[data-community-record="0"]');
    assert.match(el("#live-panel-body").textContent!, /주민투표 기록.*결선/s);
    click("#close-panel");

    // A reset must not keep reading an event from the old city.
    click('[data-panel-open="news"]');
    click("[data-news]");
    click("#help");
    click("#new-city");
    click("#confirm-new");
    await new Promise((resolve) => setImmediate(resolve));
    tick();
    assert.equal(state().actions.length, 0);
    assert.equal(el("#resident-bubble").hidden, true);

    // Unavailable policies explain why before selection. A grant updates the
    // open list in place, and the same button then leads to a real placement.
    click('#city-tutorial [data-tutorial="skip"]');
    click('[data-panel-open="policy"]');
    change("#policy-topic", "parking");
    click('[data-live-policy="signal"]');
    click("[data-placement-target]");
    click("#apply-live-policy");
    click('[data-panel-open="policy"]');
    change("#policy-topic", "waste");
    click('[data-live-policy="extraTruck"]');
    click("#apply-live-policy");
    assert.equal(state().budget, 40);
    click('[data-panel-open="policy"]');
    change("#policy-topic", "access");
    const library = el<HTMLButtonElement>('[data-live-policy="library"]');
    const caveat = el<HTMLDetailsElement>(".live-policy-details");
    assert.equal(caveat.open, false);
    click(".live-policy-details summary");
    library.focus();
    assert.equal(library.getAttribute("aria-disabled"), "true");
    assert.equal(el("#policy-status-library").textContent, "예산 15 부족");
    library.click();
    assert.equal(document.querySelector("#placement-title"), null);
    assert.equal(document.body.dataset.livePanel, "policy");
    assert.equal(state().paused, false);
    while (state().time < 300) tick(1);
    tick();
    assert.equal(el("#policy-budget").textContent, "60");
    assert.equal(library.getAttribute("aria-disabled"), "false");
    assert.equal(document.activeElement, library);
    assert.equal(caveat.open, true);
    library.click();
    click('[data-placement-target="north"]');
    assert.match(
      el(".tradeoff").textContent!,
      /공터는 다른 시설에 쓸 수 없어요/,
    );
    click("#apply-live-policy");
    assert.equal(state().actions.at(-1).id, "library");
    assert.equal(state().budget, 5);
    click('[data-panel-open="news"]');
    click('[data-panel-open="community"]');
    click('[data-community-project="waterCare"]');
    click('[data-placement-target="homes"]');
    click("#community-next"); click("#community-next"); click("#community-next");
    assert.equal(el<HTMLButtonElement>("#community-vote").disabled, true);
    assert.match(el("#live-panel-body").textContent!, /예산 8이 필요/);
    click("#cancel-meeting");
    assert.equal(state().budget, 5);
    assert.equal(state().paused, false);
    assert.equal(state().council.length, 0, "deferring a meeting spends nothing and creates no activity");

    // A new city walks through actual discovery, speech, placement and results.
    click("#help"); click("#new-city"); click("#confirm-new");
    await new Promise((resolve) => setImmediate(resolve));
    tick();
    assert.equal(document.body.dataset.tutorial, "observe");
    while (state().time < 120) tick(1);
    tick();
    assert.equal(document.body.dataset.tutorial, "spotlight");
    assert.equal(cameraEnabled(), true, "the learner can explore the highlighted problem");
    assert.equal(el<HTMLButtonElement>("#zoom-in").disabled, false);
    assert.equal(el("#resident-bubble").hidden, true, "the place is highlighted before a speech bubble appears");
    tick(45);
    assert.equal(document.body.dataset.tutorial, "story");
    assert.equal(el("#resident-bubble").hidden, false);
    click("#close-story");
    click('[data-panel-open="policy"]');
    assert.equal(el("#resident-bubble").hidden, false);
    assert.equal(el("#live-panel").hidden, true, "policy selection waits for the resident's story");
    click("#read-story");
    assert.match(el(".tutorial-inline").textContent!, /이 문제 살펴보기/);
    assert.equal(el("#city-tutorial").hidden, true, "only one instruction surface is shown at a time");
    click("#close-panel");
    click("#inspect-story");
    document.body.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    assert.equal(document.body.dataset.livePanel, "story");
    assert.equal(el<HTMLDialogElement>("#place-inspector").open, false);
    click("#investigate-story");
    assert.equal(document.body.dataset.tutorial, "policy");
    change("#policy-topic", "water");
    assert.equal(el<HTMLSelectElement>("#policy-topic").value, "parking");
    click('[data-panel-open="community"]');
    assert.equal(document.body.dataset.livePanel, "policy");
    click('[data-live-policy="signal"]');
    assert.equal(cameraEnabled(), true, "placement permits moving around the map");
    click("[data-placement-target]");
    assert.equal(cameraEnabled(), true, "map exploration remains available during confirmation");
    click("#cancel-policy"); tick();
    assert.equal(document.body.dataset.tutorial, "policy", "cancelled placement keeps the lesson reachable");
    click("#tutorial-next");
    change("#policy-topic", "parking");
    click('[data-live-policy="signal"]'); click("[data-placement-target]");
    click("#apply-live-policy"); tick();
    assert.equal(document.body.dataset.tutorial, "watch");
    click("#pause"); tick();
    const waitingTime = state().time;
    click('[data-panel-open="policy"]');
    assert.equal(el("#live-panel").hidden, true);
    tick(30);
    assert.ok(state().time > waitingTime, "random pause clicks cannot stop the observation");
    const policyTime = state().actions[0].time;
    while (state().time < policyTime + 121) tick(1);
    tick();
    assert.equal(document.body.dataset.tutorial, "result");
    click("#tutorial-next");
    assert.equal(document.body.dataset.livePanel, "tutorial-result");
    assert.match(el(".tutorial-result").textContent!, /시행 전.*관찰 때/s);
    const resultText = el(".tutorial-result").textContent;
    tick(30);
    assert.equal(el(".tutorial-result").textContent, resultText);
    click(".tutorial-result [data-review-policy]");
    assert.equal(el<HTMLDialogElement>("#place-inspector").open, true);
    assert.equal(cameraEnabled(), true);
    click("#close-inspection");
    assert.equal(document.body.dataset.livePanel, "tutorial-result");
    assert.equal(el(".tutorial-result").textContent, resultText);
    click('[data-tutorial="read-result"]');
    assert.equal(document.body.dataset.tutorial, "free");
    assert.match(el("#tutorial-copy").textContent!, /주민 회의/);
    click("#tutorial-next");
    assert.equal(document.body.dataset.tutorial, undefined);
    assert.equal(el("#city-tutorial").hidden, true);
    assert.equal(JSON.parse(dom.window.localStorage.getItem("mayor-living-city-v1")!).tutorial.stage, "done");
    assert.equal(cameraEnabled(), true);
    assert.equal(document.querySelectorAll("[data-tutorial-locked]").length, 0);
    click("#pause");
    assert.equal(state().paused, true);
    click("#help"); click('[data-tutorial="start"]');
    assert.equal(document.body.dataset.tutorial, "observe");
    assert.equal(el("#tutorial-next").textContent, "계속 관찰하기");
    click("#tutorial-next");
    assert.equal(state().paused, false, "a restarted lesson can resume a paused city using its guide");
    click('#city-tutorial [data-tutorial="skip"]');
    click('[data-panel-open="policy"]');
    assert.equal(!!el<HTMLSelectElement>("#policy-topic").inert, false);
  } finally {
    hook.deregister();
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
