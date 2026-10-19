import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import * as THREE from "three";
import { PolicyRenderer, groupPolicyPlaces } from "../src/renderer/policies";
import { LiveCitySimulation } from "../src/simulation/live";

test("compact policy markers group one place and keep city-wide policies in a closed disclosure", () => {
  const dom = new JSDOM('<main><div class="city-view"></div></main>');
  const previous = new Map(["document", "getComputedStyle"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of previous.keys()) Object.defineProperty(globalThis, key, {
    value: (dom.window as any)[key], configurable: true,
  });
  const document = dom.window.document;
  try {
    const city = new LiveCitySimulation();
    city.budget = 200;
    city.apply("patrol", "school");
    city.apply("loadingBay", "school");
    city.apply("extraTruck");
    city.apply("reduce");
    city.apply("handling");
    const raw = city.policyMap, original = structuredClone(raw);
    assert.equal(groupPolicyPlaces(raw.places).length, 1);
    assert.deepEqual(raw, original, "grouping presentation never edits policy records");
    const renderer = new PolicyRenderer(document.querySelector(".city-view")!, true);
    renderer.setSimulation(city);
    const pin = document.querySelector<HTMLButtonElement>(".applied-policy-pin")!;
    assert.equal(document.querySelectorAll(".applied-policy-pin").length, 1);
    assert.equal(pin.querySelector(".applied-policy-mini")!.textContent, "정책 2");
    assert.match(pin.getAttribute("aria-label")!, /순찰 구역 지정.*잠깐 정차 공간/);
    assert.equal(renderer.data.places[0].policies.length, 2);
    assert.equal(document.body.hasAttribute("data-wide-policies"), false);
    let details = document.querySelector<HTMLDetailsElement>("#applied-shared details")!;
    assert.equal(details.open, false);
    assert.equal(details.querySelector("summary")!.textContent, "도시 전체 정책 3개");
    assert.equal(details.querySelectorAll("button").length, 3);
    details.querySelector("summary")!.click();
    assert.equal(details.open, true);
    renderer.setSimulation(city);
    details = document.querySelector<HTMLDetailsElement>("#applied-shared details")!;
    assert.equal(details.open, true, "an update preserves a deliberately opened list");
    const selected: string[] = [];
    renderer.onSelect = place => selected.push(place.id);
    details.querySelector<HTMLButtonElement>('[data-shared-policy="reduce"]')!.click();
    assert.equal(details.open, false);
    assert.deepEqual(selected, [city.policyMap.shared.find(p => p.policies[0].id === "reduce")!.id]);
    details.open = true;
    details.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal(details.open, false);
    assert.equal(document.activeElement, details.querySelector("summary"));
    details.open = true;
    document.body.dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true }));
    assert.equal(details.open, false);
    const groupedPin = document.querySelector<HTMLButtonElement>(".applied-policy-pin")!;
    groupedPin.click();
    assert.equal(selected.at(-1), renderer.data.places[0].id);
    // Real projection with controlled marker sizes; stationary pins must not flip.
    Object.defineProperties(groupedPin, { offsetWidth: { value: 52 }, offsetHeight: { value: 44 } });
    const camera = new THREE.PerspectiveCamera(42, 390 / 600, 1, 12000);
    camera.position.set(33, 240, 250);
    camera.lookAt(33, 0, 4);
    camera.updateMatrixWorld();
    renderer.update(camera, 390, 600);
    const root = document.querySelector<HTMLElement>("#applied-policy-map")!;
    assert.equal(root.hidden, false);
    const start = [parseFloat(groupedPin.style.left), parseFloat(groupedPin.style.top)];
    assert.ok(start.every(Number.isFinite));
    for (let n = 1; n <= 20; n++) {
      camera.position.x += 1e-9;
      camera.lookAt(33, 0, 4);
      camera.updateMatrixWorld();
      renderer.update(camera, 390, 600);
      assert.ok(Math.abs(parseFloat(groupedPin.style.left) - start[0]) < 0.01);
      assert.ok(Math.abs(parseFloat(groupedPin.style.top) - start[1]) < 0.01);
    }
    document.body.setAttribute("data-inspecting-place", "");
    renderer.update(camera, 390, 600);
    assert.equal(root.hidden, true);
    document.body.removeAttribute("data-inspecting-place");
    camera.position.x += 1;
    camera.updateMatrixWorld();
    renderer.update(camera, 390, 600);
    assert.equal(root.hidden, false);
    renderer.setSimulation(new LiveCitySimulation());
    assert.equal(document.querySelectorAll(".applied-policy-pin").length, 0);
    assert.equal(document.querySelector<HTMLElement>("#applied-shared")!.hidden, true);
  } finally {
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
