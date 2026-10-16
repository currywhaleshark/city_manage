import { writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import {
  FacilitySimulation,
  FACILITY_MODEL_VERSION,
  FACILITY_SITES,
} from "../src/simulation/facilities";
const observations = [];
for (const seed of [2404, 2405, 2406]) {
  const plans = [
    { policies: [] as string[], siteId: "west" },
    ...FACILITY_SITES.flatMap((site) =>
      ["library", "park"]
        .filter((policy) => policy !== "park" || site.width * site.depth >= 900)
        .map((policy) => ({
          policies: [policy],
          siteId: site.id,
        })),
    ),
    ...[
      ["expand"],
      ["gate"],
      ["expand", "gate"],
      ["library", "expand"],
      ["park", "expand"],
    ].map((policies) => ({ policies, siteId: "north" })),
  ];
  for (const plan of plans) {
    const sim = new FacilitySimulation(seed, plan.policies, {
        siteId: plan.siteId,
      }),
      stats = sim.facilityStats;
    assert.equal(stats.served + stats.unserved, stats.population);
    assert.ok(stats.facilities.every((f) => f.used <= f.capacity));
    observations.push({
      seed,
      ...plan,
      cost: sim.cost,
      population: stats.population,
      served: stats.served,
      reachable: stats.reachable,
      capacity: stats.capacity,
      capacityShortfall: stats.capacityShortfall,
      averageNearestSeconds: stats.averageNearestSeconds,
      neighborhoods: stats.neighborhoods.map((r) => ({
        id: r.id,
        name: r.name,
        served: r.served,
        unserved: r.unserved,
        librarySeconds: r.services.library.nearest?.route.seconds,
        parkSeconds: r.services.park.nearest?.route.seconds,
      })),
      facilities: stats.facilities,
    });
  }
}
await writeFile(
  "output/facility-experiments.json",
  JSON.stringify(
    {
      modelVersion: FACILITY_MODEL_VERSION,
      timeUnit: "planning-round",
      rules: new FacilitySimulation().facilityStats.rules,
      observations,
    },
    null,
    2,
  ),
);
console.log(
  `Verified ${observations.length} facility plans. Results are calculated access and capacity, not animated arrivals.`,
);
