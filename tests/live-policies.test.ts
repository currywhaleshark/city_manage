import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { LiveCitySimulation } from "../src/simulation/live";
import {
  policyAvailability,
  policyListMarkup,
  updatePolicyAvailability,
} from "../src/ui/live-policies";

test("policy preview uses the real budget, separates global policies, and detects already applied policies", () => {
  const city = new LiveCitySimulation();
  const before = city.save();
  assert.equal(policyAvailability(city, "extraTruck").available, true);
  assert.equal(
    policyAvailability(city, "extraTruck").label,
    "도시 전체에 적용",
  );
  assert.deepEqual(
    city.save(),
    before,
    "preview must not spend or reserve anything",
  );
  city.apply("extraTruck");
  assert.equal(city.budget, 55);
  assert.equal(
    policyAvailability(city, "parkingLot").available,
    true,
    "exact budget is enough",
  );
  city.apply("signal", city.targets("signal")[0].id);
  assert.equal(policyAvailability(city, "parkingLot").label, "예산 15 부족");
  assert.equal(policyAvailability(city, "extraTruck").label, "시행 중");
});

test("policy preview respects plot size and sewer connections, including repeatable buildings", () => {
  const city = new LiveCitySimulation();
  city.budget = 1000; // Fund a city whose four large plots have already been used.
  for (const target of [...city.targets("park")]) city.apply("park", target.id);
  assert.equal(
    policyAvailability(city, "park").label,
    "지을 수 있는 공터 없음",
  );
  assert.equal(
    policyAvailability(city, "sewer").label,
    "지을 수 있는 공터 없음",
  );
  assert.equal(policyAvailability(city, "library").targets.length, 2);
  city.apply("library", city.targets("library")[0].id);
  assert.equal(
    policyAvailability(city, "library").available,
    true,
    "a second library remains possible",
  );
  city.apply("library", city.targets("library")[0].id);
  city.budget = 20;
  assert.equal(
    policyAvailability(city, "library").label,
    "예산 35 부족 · 지을 수 있는 공터 없음",
  );
});

test("budget grants update the policy list without losing focus or expanded tradeoffs", () => {
  const city = new LiveCitySimulation(2404, 0, 0, 0, 0, 0, 0, Infinity); // five-minute grants
  city.apply("extraTruck");
  city.apply("signal", city.targets("signal")[0].id);
  const dom = new JSDOM(
    `<main><b id="policy-budget">40</b>${policyListMarkup(city, "access")}</main>`,
  );
  try {
    const root = dom.window.document.querySelector("main")!;
    const button = root.querySelector<HTMLButtonElement>(
      '[data-live-policy="library"]',
    )!;
    const details = root.querySelector<HTMLDetailsElement>("details")!;
    assert.equal(button.getAttribute("aria-disabled"), "true");
    assert.equal(
      button.disabled,
      false,
      "the reason stays reachable with keyboard focus",
    );
    assert.equal(details.open, false);
    details.open = true;
    button.focus();
    const body = details.querySelector("p");
    assert.match(body!.textContent!, /거리가 먼 주민/);
    city.runUntil(300);
    updatePolicyAvailability(root, city);
    assert.equal(root.querySelector("#policy-budget")!.textContent, "60");
    assert.equal(button.getAttribute("aria-disabled"), "false");
    assert.equal(dom.window.document.activeElement, button);
    assert.equal(details.open, true);
    assert.equal(details.querySelector("p"), body);
  } finally {
    dom.window.close();
  }
});
