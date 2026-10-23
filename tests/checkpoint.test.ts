import test from "node:test";
import assert from "node:assert/strict";
import {
  LiveCitySimulation,
  restoreLiveCity,
  LIVE_POLICIES,
} from "../src/simulation/live";
import {
  captureLiveCheckpoint,
  restoreLiveCheckpoint,
} from "../src/simulation/checkpoint";

test("checkpoints preserve live transport identities and continue to the same exact future", () => {
  const s = new LiveCitySimulation();
  s.apply("signal", "n3-2");
  s.apply("park", "north");
  s.council.start("waterCare", "homes", "flexible", [
    "walker",
    "merchant",
    "worker",
  ]);
  s.runUntil(325.4);
  s.apply("outlet", "factoryNorth");
  s.observe();
  s.notes = "도시 상태 그대로 이어가기";
  const checkpoint = captureLiveCheckpoint(s);
  const copy = restoreLiveCheckpoint(checkpoint, s.save());
  assert.equal(copy.vehicles, copy.parking.vehicles);
  assert.equal(copy.network, copy.water.network);
  assert.equal(copy.pedestrians, copy.logistics.pedestrians);
  assert.deepEqual(copy.facilities.access, s.facilities.access);
  assert.deepEqual(copy.values, s.values);
  assert.deepEqual(copy.council.records, s.council.records);
  assert.deepEqual([...copy.vehicles], [...s.vehicles]);
  s.runUntil(720);
  copy.runUntil(720);
  assert.deepEqual(copy.values, s.values);
  assert.deepEqual(copy.news, s.news);
  assert.deepEqual(copy.water.waterStats, s.water.waterStats);
  assert.deepEqual(copy.council.records, s.council.records);
  assert.deepEqual([...copy.vehicles], [...s.vehicles]);
  assert.ok(
    Math.abs(checkpoint.save.time - 325.4) < 1e-7,
    "a checkpoint is detached from subsequent mutations",
  );
});

test("a stale checkpoint replays only its unsaved tail, including commands at the same tick", async () => {
  const s = new LiveCitySimulation();
  s.runUntil(40);
  s.apply("handling");
  const checkpoint = captureLiveCheckpoint(s);
  s.council.start("sorting", "river", "together", [
    "neighbor",
    "collector",
    "worker",
  ]);
  s.apply("outreach", "river");
  s.runUntil(110);
  s.council.records[0].reflection = "나중에 고친 메모";
  s.observe();
  const copy = await restoreLiveCity(s.save(), undefined, {
    initialCity: restoreLiveCheckpoint(checkpoint, s.save()),
  });
  assert.deepEqual(copy.values, s.values);
  assert.deepEqual(copy.council.records, s.council.records);
  assert.deepEqual(copy.observations, s.observations);
  assert.deepEqual(copy.news, s.news);
  assert.deepEqual(copy.save(), s.save());
});

test("v1 checkpoints migrate presentation state without replaying or changing the physical city", () => {
  const city = new LiveCitySimulation();
  city.runUntil(240);
  city.observe();
  city.notes = "이전 도시 기록";
  const legacy = captureLiveCheckpoint(city);
  (legacy as any).version = "living-state-1";
  for (const key of [
    "pendingIssues",
    "nextIssueAt",
    "nextStoryAt",
    "storyId",
    "storyUntil",
    "lastStoryId",
  ])
    delete legacy.state.world[key];
  const copy = restoreLiveCheckpoint(legacy, city.save());
  assert.equal(copy.time, city.time);
  assert.deepEqual(copy.values, city.values);
  assert.deepEqual([...copy.vehicles], [...city.vehicles]);
  assert.deepEqual(copy.save(), city.save());
  assert.equal(
    copy.voices.length,
    0,
    "do not replay the old backlog of bubbles",
  );
  copy.runUntil(245);
  assert.equal(copy.voices.length, 0);
  assert.equal(captureLiveCheckpoint(copy).version, "living-state-8");
});

test("incompatible, different-city or damaged caches are rejected without touching the portable save", () => {
  const s = new LiveCitySimulation(),
    checkpoint = captureLiveCheckpoint(s),
    original = JSON.stringify(s.save());
  assert.throws(() =>
    restoreLiveCheckpoint({ ...checkpoint, version: "old" } as any, s.save()),
  );
  assert.throws(() =>
    restoreLiveCheckpoint(checkpoint, { ...s.save(), seed: 25 }),
  );
  checkpoint.state.world.ticks = 100;
  assert.throws(() => restoreLiveCheckpoint(checkpoint, s.save()));
  assert.equal(JSON.stringify(s.save()), original);
});

test("portable restore can be interrupted promptly without mutating its source", async () => {
  const save = { ...new LiveCitySimulation().save(), time: 3600 },
    controller = new AbortController();
  setTimeout(() => controller.abort(), 10);
  const start = performance.now();
  await assert.rejects(
    restoreLiveCity(save, undefined, { signal: controller.signal }),
    { name: "AbortError" },
  );
  assert.ok(performance.now() - start < 1000);
  assert.equal(save.time, 3600);
});

test("rounded JSON times and floating point engine ticks describe the same saved instant", async () => {
  const save = { ...new LiveCitySimulation().save(), time: 0.3 };
  const replayed = await restoreLiveCity(save);
  const cached = restoreLiveCheckpoint(captureLiveCheckpoint(replayed), save);
  const copy = await restoreLiveCity(save, undefined, { initialCity: cached });
  assert.deepEqual(copy.values, replayed.values);
});

test("an imported log with new commands before the cached point cannot reuse that future", () => {
  const early = new LiveCitySimulation();
  early.apply("handling");
  early.runUntil(40);
  const other = new LiveCitySimulation();
  other.runUntil(20);
  assert.throws(() =>
    restoreLiveCheckpoint(captureLiveCheckpoint(other), early.save()),
  );

  const ordered = new LiveCitySimulation();
  ordered.runUntil(5);
  ordered.apply("handling");
  const checkpoint = captureLiveCheckpoint(ordered);
  ordered.council.start("sorting", "river", "together", [
    "neighbor",
    "collector",
    "worker",
  ]);
  const reordered = ordered.save();
  reordered.council![0].policyCount = 0;
  assert.throws(() => restoreLiveCheckpoint(checkpoint, reordered));
});

test("every policy's changed state survives checkpoints and continues identically", () => {
  for (const policy of LIVE_POLICIES) {
    const city = new LiveCitySimulation();
    city.runUntil(12);
    city.apply(policy.id, city.targets(policy.id)[0]?.id ?? "");
    city.runUntil(65);
    const copy = restoreLiveCheckpoint(
      captureLiveCheckpoint(city),
      city.save(),
    );
    city.runUntil(135);
    copy.runUntil(135);
    assert.deepEqual(copy.values, city.values, policy.id);
    assert.deepEqual(copy.water.waterStats, city.water.waterStats, policy.id);
    assert.deepEqual(copy.news, city.news, policy.id);
    assert.deepEqual([...copy.vehicles], [...city.vehicles], policy.id);
  }
});
