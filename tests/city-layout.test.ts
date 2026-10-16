import test from "node:test";
import assert from "node:assert/strict";
import { BUILDINGS, createNetwork } from "../src/scenario";
import {
  BUILDABLE_PLOTS,
  EXTERNAL_CONNECTIONS,
  RIVER,
  WORLD,
  WASTE_DEPOT,
} from "../src/city/world";
import {
  FacilitySimulation,
  type PlannedFacility,
} from "../src/simulation/facilities";
import { findRoute } from "../src/simulation/network";
import { LogisticsSimulation } from "../src/simulation/economy";
import { WalkingNetwork } from "../src/simulation/facilities/walking";
import { appliedPolicyMap } from "../src/policies/map";

test("expanded city has four times the land, empty buildable lots, an industrial depot and three river crossings", () => {
  assert.equal(WORLD.size ** 2, 4 * 234 ** 2);
  const net = createNetwork();
  assert.equal(net.nodes.size, 89);
  const bridges = [...net.roads.values()].filter((r) => {
    const a = net.nodes.get(r.startNodeId)!.position,
      b = net.nodes.get(r.endNodeId)!.position;
    return Math.min(a.x, b.x) < RIVER.x && Math.max(a.x, b.x) > RIVER.x;
  });
  assert.equal(bridges.length, 3);
  for (const plot of BUILDABLE_PLOTS) {
    assert.ok(
      Math.abs(plot.position.x - RIVER.x) > (plot.width + RIVER.width) / 2,
    );
    for (const b of BUILDINGS)
      assert.ok(
        Math.abs(plot.position.x - b.x) > plot.width / 2 + 18 ||
          Math.abs(plot.position.z - b.z) > plot.depth / 2 + 18,
        `${plot.id} overlaps ${b.id}`,
      );
  }
  assert.equal(BUILDINGS.find((b) => b.id === WASTE_DEPOT.id)?.kind, "waste");
  assert.ok(
    BUILDINGS.filter((b) => b.kind === "factory").every((b) => b.x > RIVER.x),
  );
});

test("external loading points are beyond the map and have complete road routes to shops and back", () => {
  const sim = new LogisticsSimulation(2404, ["diversify"]);
  for (const side of EXTERNAL_CONNECTIONS) {
    assert.ok(side.x < WORLD.min || side.x > WORLD.max);
    const source = sim.sources.find((s) => s.id === `${side.id}-region`)!;
    for (const shop of sim.shops) {
      const sourceLane = sim.network.lanes.get(source.laneId)!,
        shopLane = sim.network.lanes.get(shop.laneId)!;
      assert.ok(findRoute(sim.network, sourceLane.to, shopLane.from));
      assert.ok(findRoute(sim.network, shopLane.to, sourceLane.from));
    }
  }
});

test("plots compete for both money and land, and applied locations retain their own immutable parcels", () => {
  const buildings: PlannedFacility[] = [
    { siteId: "west", kind: "library" },
    { siteId: "north", kind: "park" },
  ];
  const sim = new FacilitySimulation(2404, ["library", "park"], {
    siteId: "market",
    buildings,
  });
  assert.equal(sim.cost, 90);
  assert.equal(sim.facilityStats.usedPlots, 2);
  assert.equal(sim.facilityStats.freePlots, 4);
  assert.equal(sim.facilityStats.usedLand, 1384);
  buildings[0].siteId = "market";
  assert.equal(sim.plan.buildings![0].siteId, "west");
  const map = appliedPolicyMap(sim);
  assert.deepEqual(
    map.places.map((p) => p.position),
    [BUILDABLE_PLOTS[1].position, BUILDABLE_PLOTS[0].position],
  );
  assert.equal(
    new FacilitySimulation(2404, ["park"], {
      siteId: "north",
      buildings: [
        { siteId: "north", kind: "park" },
        { siteId: "south", kind: "park" },
      ],
    }).cost,
    70,
  );
  assert.throws(
    () =>
      new FacilitySimulation(2404, ["library"], {
        siteId: "north",
        buildings: [
          { siteId: "north", kind: "library" },
          { siteId: "west", kind: "library" },
        ],
      }),
    /예산/,
  );
  assert.throws(
    () =>
      new FacilitySimulation(2404, ["library", "park"], {
        siteId: "north",
        buildings: [
          { siteId: "north", kind: "library" },
          { siteId: "north", kind: "park" },
        ],
      }),
    /한 부지/,
  );
  assert.throws(
    () => new FacilitySimulation(2404, ["park"], { siteId: "west" }),
    /면적/,
  );
});

test("walking route cache is invalidated when a new entrance opens", () => {
  const w = new WalkingNetwork();
  w.addPoint("a", { x: 0, z: 0 });
  w.addPoint("b", { x: 10, z: 0 });
  w.addPoint("c", { x: 20, z: 0 });
  w.connect("a", "b");
  assert.equal(w.route("a", "c"), null);
  w.connect("b", "c");
  assert.equal(w.route("a", "c")!.meters, 20);
});
