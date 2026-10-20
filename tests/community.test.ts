import test from "node:test";
import assert from "node:assert/strict";
import {
  LiveCitySimulation,
  restoreLiveCity,
  validateLiveSave,
} from "../src/simulation/live";
import {
  communityProject,
  type CommunityProjectId,
} from "../src/simulation/community";
const heard = (id: CommunityProjectId) =>
  communityProject(id).voices.map((v) => v.id);

test("meetings need different voices, a real location and budget; only one voluntary project at a time", () => {
  const s = new LiveCitySimulation();
  assert.throws(() =>
    s.council.start("walking", "school", "together", ["child"]),
  );
  assert.throws(() =>
    s.council.start(
      "waterCare",
      "factoryNorth",
      "together",
      heard("waterCare"),
    ),
  );
  assert.equal(s.budget, 100);
  assert.equal(s.council.records.length, 0);
  const poor = new LiveCitySimulation();
  poor.budget = 4;
  assert.throws(() =>
    poor.council.start("walking", "school", "together", heard("walking")),
  );
  assert.equal(poor.budget, 4);
  const parkedBefore = s.parking.parkingStats.illegal;
  const incomingBefore = s.parking.episodes.filter(e => e.phase === "approaching").length;
  const record = s.council.start(
    "walking",
    "school",
    "together",
    heard("walking"),
    "함께 걷기",
    "차가 필요한 주민도 있어요.",
  );
  assert.equal(s.budget, 95);
  assert.equal(
    s.parking.parkingStats.illegal,
    parkedBefore,
    "the meeting does not erase existing parked cars",
  );
  assert.equal(s.parking.episodes.filter(e => e.phase === "approaching").length, incomingBefore,
    "a meeting preserves the journeys already on their way");
  assert.throws(() =>
    s.council.start("sorting", "alley", "flexible", heard("sorting")),
  );
  assert.equal(s.budget, 95);
  assert.ok(
    s.policyMap.places.some((p) => p.id === "community-walking-school"),
  );
  s.runUntil(481);
  assert.ok(
    record.walkingTrips > 0,
    "the next parking wave includes voluntary walkers",
  );
  assert.ok(s.pedestrians.demand.some((p) => p.id >= 2000000));
  assert.ok(
    s.parking.episodes.some(
      (e) => e.request.id >= 300000 && e.request.siteId !== "school",
    ),
  );
  s.runUntil(631);
  assert.ok(record.result);
  const savedResult = { ...record.result };
  assert.equal(s.council.current, undefined);
  assert.ok(!s.policyMap.places.some((p) => p.id.startsWith("community-")));
  s.council.start("sorting", "alley", "flexible", heard("sorting"));
  s.runUntil(632);
  assert.deepEqual(
    record.result,
    savedResult,
    "past results are immutable observations",
  );
});

test("a waste agreement changes new disposal locally without deleting litter or ignoring a full bin", () => {
  const base = new LiveCitySimulation(),
    active = new LiveCitySimulation();
  for (const s of [base, active]) s.apply("dropoff", "alley");
  active.council.start("sorting", "alley", "flexible", heard("sorting"));
  assert.equal(active.council.awarenessBoost("alley"), 0);
  for (const s of [base, active]) {
    s.scheduleDisposals([
      {
        id: 9999,
        siteId: "alley",
        time: 61,
        amount: 1,
        awareness: 0.6,
        effort: 1,
      },
    ]);
    s.runUntil(62);
  }
  assert.equal(
    base.disposalEvents.find((e) => e.request === 9999)!.kind,
    "illegal",
  );
  assert.equal(
    active.disposalEvents.find((e) => e.request === 9999)!.kind,
    "designated",
  );
  assert.equal(active.council.awarenessBoost("river"), 0);
  assert.ok(active.council.records[0].guidedBags >= 1);
  const participated = active.wasteStats;
  assert.ok(
    Math.abs(
      participated.initial +
        participated.generated -
        participated.remaining -
        participated.collected -
        active.transferredToRiver,
    ) < 1e-7,
  );
  active.bin("alley").remaining = 16;
  active.scheduleDisposals([
    {
      id: 10000,
      siteId: "alley",
      time: 62.1,
      amount: 1,
      awareness: 0.6,
      effort: 1,
    },
  ]);
  active.runUntil(62.2);
  assert.equal(
    active.disposalEvents.find((e) => e.request === 10000)!.kind,
    "illegal",
  );
  // Keep the untouched world's physical ledger balanced after participation changes the destination.
  const w = base.wasteStats;
  assert.ok(
    Math.abs(
      w.initial +
        w.generated -
        w.remaining -
        w.collected -
        base.transferredToRiver,
    ) < 1e-7,
  );
});

test("household participation is delayed, local, capacity-limited and expires; dissolved pollution is conserved", () => {
  const base = new LiveCitySimulation(),
    active = new LiveCitySimulation();
  const record = active.council.start(
    "waterCare",
    "homes",
    "flexible",
    heard("waterCare"),
  );
  base.runUntil(59);
  active.runUntil(59);
  assert.deepEqual(active.water.sources, base.water.sources);
  base.runUntil(120);
  active.runUntil(120);
  assert.ok(
    active.water.sources.find((s) => s.id === "homes")!.raw <
      base.water.sources.find((s) => s.id === "homes")!.raw,
  );
  assert.ok(
    Math.abs(
      record.preventedPollution -
        (base.water.sources.find((s) => s.id === "homes")!.raw -
          active.water.sources.find((s) => s.id === "homes")!.raw),
    ) < 1e-7,
  );
  for (const id of ["shops", "factoryNorth", "factorySouth", "upstream"])
    assert.deepEqual(
      active.water.sources.find((s) => s.id === id),
      base.water.sources.find((s) => s.id === id),
    );
  assert.ok(active.water.sources.find((s) => s.id === "homes")!.raw > 0);
  active.runUntil(661);
  assert.equal(active.council.waterFactor("homes"), 1);
  assert.ok(record.result);
  const w = active.water.waterStats;
  assert.ok(
    Math.abs(
      active.water.initial + w.generated - w.treated - w.remaining - w.outflow,
    ) < 1e-7,
  );
});

test("save replay preserves interleaved meetings, policy order and notes, and accepts pre-meeting city saves", async () => {
  const s = new LiveCitySimulation();
  s.runUntil(17.4);
  s.apply("handling");
  const r = s.council.start(
    "waterCare",
    "homes",
    "flexible",
    heard("waterCare"),
    "일하는 이웃의 의견",
    "작업장도 살펴봐요.",
  );
  s.apply("reduce");
  r.reflection = "아직 시설이 필요한 곳이 있어요.";
  s.runUntil(90);
  const restored = await restoreLiveCity(s.save());
  assert.deepEqual(restored.council.records, s.council.records);
  assert.deepEqual(restored.water.sources, s.water.sources);
  assert.deepEqual(restored.news, s.news);
  assert.equal(restored.budget, s.budget);
  assert.deepEqual(restored.actions, s.actions);
  const legacy = new LiveCitySimulation().save();
  delete legacy.council;
  assert.equal((await restoreLiveCity(legacy)).council.records.length, 0);
  for (const change of [
    { time: -1 },
    { method: "unknown" },
    { target: "factoryNorth" },
    { heard: [] },
    { policyCount: -1 },
    { reason: null },
  ]) {
    assert.throws(() =>
      validateLiveSave({
        ...s.save(),
        council: [{ ...s.save().council![0], ...change }],
      }),
    );
  }
});
