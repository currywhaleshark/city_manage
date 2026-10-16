import { test } from "node:test";
import assert from "node:assert/strict";
import { appliedPolicyMap } from "../src/policies/map";
import { TrafficSimulation } from "../src/simulation";
import { DEFAULT_POLICY, SCHOOL_NODE } from "../src/scenario";
import { WasteSimulation } from "../src/simulation/services/waste";
import {
  FacilitySimulation,
  FACILITY_SITES,
} from "../src/simulation/facilities";
import { EnvironmentSimulation } from "../src/simulation/environment";

test("applied map reads real road geometry and the committed facility site without changing a run", () => {
  for (const sim of [
    new TrafficSimulation(),
    new WasteSimulation(),
    new FacilitySimulation(),
    new EnvironmentSimulation(),
  ])
    assert.deepEqual(appliedPolicyMap(sim), { places: [], shared: [] });
  const traffic = new TrafficSimulation({
    ...DEFAULT_POLICY,
    signal: true,
    bypass: true,
    oneWay: true,
    ewGreen: 34,
  });
  const before = traffic.stats;
  const view = appliedPolicyMap(traffic);
  assert.deepEqual(
    view.places.find((p) => p.id === "signal")!.position,
    traffic.network.nodes.get(SCHOOL_NODE)!.position,
  );
  assert.match(
    view.places.find((p) => p.id === "signal")!.policies[0].detail,
    /34초/,
  );
  assert.deepEqual(view.places.find((p) => p.id === "bypass")!.position, {
    x: 24,
    z: -48,
  });
  assert.deepEqual(view.places.find((p) => p.id === "oneWay")!.position, {
    x: -24,
    z: 0,
  });
  assert.deepEqual(traffic.stats, before);
  for (const site of FACILITY_SITES) {
    const sim = new FacilitySimulation(2404, ["library", "expand"], {
      siteId: site.id,
    });
    const map = appliedPolicyMap(sim);
    assert.equal(map.places.length, 2);
    assert.deepEqual(
      map.places.find((p) => p.policies.some((p) => p.id === "library"))!
        .position,
      site.position,
    );
  }
  const expanded = appliedPolicyMap(
    new FacilitySimulation(2404, ["expand", "gate"]),
  );
  assert.equal(expanded.places.length, 1);
  assert.deepEqual(
    expanded.places[0].policies.map((p) => p.id),
    ["expand", "gate"],
  );
});

test("local conservation and buffer areas stay separate from shared rules and city-wide waste operations", () => {
  const map = appliedPolicyMap(
    new EnvironmentSimulation(2404, [
      "industry",
      "housing",
      "conserve",
      "small",
    ]),
  );
  assert.equal(map.places.length, 2);
  for (const p of map.places) {
    assert.equal(p.policies.length, 2);
    const areas = p.outlines.map((o) =>
      Math.abs((o[1].x - o[0].x) * (o[2].z - o[1].z)),
    );
    assert.deepEqual(areas, [96, 192]);
  }
  assert.equal(map.shared[0].scope, "개발 부지 공통");
  const buffer = appliedPolicyMap(new EnvironmentSimulation(2404, ["buffer"]))
    .places[0];
  assert.equal(buffer.outlines.length, 2);
  assert.ok(buffer.outlines[0].every((p) => p.z <= 186));
  assert.ok(buffer.outlines[1].every((p) => p.z >= 212));
  const noDevelopment = appliedPolicyMap(
    new EnvironmentSimulation(2404, ["small"]),
  );
  assert.equal(noDevelopment.places.length, 0);
  assert.match(noDevelopment.shared[0].note!, /변화 없음/);
  const waste = appliedPolicyMap(
    new WasteSimulation(2404, ["extraTruck", "route", "reduce"]),
  );
  assert.equal(waste.places.length, 0);
  assert.equal(waste.shared.length, 3);
  assert.ok(waste.shared.every((p) => p.scope === "동네 전체"));
});

