import test from "node:test";
import assert from "node:assert/strict";
import { LiveCitySimulation, restoreLiveCity } from "../src/simulation/live";
import { communityProject, COMMUNITY_HABIT_DURATION } from "../src/simulation/community";
import { captureLiveCheckpoint, restoreLiveCheckpoint } from "../src/simulation/checkpoint";
import { RESPONSIVE_SIGNAL_NODES } from "../src/simulation/responsive-signals";
import { communityRecord, communityStatus } from "../src/ui/community";
import { overlaps } from "./geometry-helper";

const heard = (project: "walking" | "sorting" | "waterCare") => communityProject(project).voices.map(v => v.id);
const waterBalance = (city: LiveCitySimulation) => {
  const w = city.water.waterStats;
  assert.ok(Math.abs(w.initial + w.generated - w.treated - w.remaining - w.outflow) < 1e-6);
};

test("a full disposal bin falls back to a reachable empty site; all-full sites still leave a real problem", () => {
  const city = new LiveCitySimulation();
  city.apply("dropoff", "alley");
  const bin = city.bin("alley");
  bin.remaining += 16; bin.generated += 16;
  const before = bin.remaining;
  city.scheduleDisposals([{ id: 9000, siteId: "alley", time: 0.1, amount: 2, awareness: 0.1, effort: 0 }]);
  city.runUntil(0.2);
  const event = city.disposalEvents.find(e => e.request === 9000)!;
  assert.equal(event.kind, "designated");
  assert.notEqual(event.destination, bin.id);
  assert.equal(bin.remaining, before, "existing waste is not erased or reclassified");
  for (const s of city.sites.filter(s => s.kind !== "illegal")) {
    const amount = Math.max(0, (s.capacity ?? Infinity) - s.remaining);
    assert.ok(Number.isFinite(amount));
    s.remaining += amount; s.generated += amount;
  }
  city.scheduleDisposals([{ id: 9001, siteId: "alley", time: 0.3, amount: 2, awareness: 0.1, effort: 1 }]);
  city.runUntil(0.4);
  assert.equal(city.disposalEvents.find(e => e.request === 9001)!.kind, "illegal");
  const w = city.wasteStats;
  assert.ok(Math.abs(w.initial + w.generated - w.remaining - w.collected - city.transferredToRiver) < 1e-6);
});

test("placing a bin schedules actual litter collection without teleporting a truck or deleting a pile", () => {
  const base = new LiveCitySimulation(2405), city = new LiveCitySimulation(2405);
  for (const s of [base, city]) s.runUntil(120);
  const beforePile = city.illegal("alley").remaining;
  const beforeTrucks = city.trucks.map(t => ({ id: t.id, target: t.target, phase: t.phase, load: t.load }));
  const beforeVehicles = structuredClone([...city.vehicles]);
  city.apply("dropoff", "alley");
  assert.equal(city.illegal("alley").remaining, beforePile);
  assert.deepEqual(city.trucks.map(t => ({ id: t.id, target: t.target, phase: t.phase, load: t.load })), beforeTrucks);
  assert.deepEqual([...city.vehicles], beforeVehicles);
  const route = city.trucks.find(t => t.itinerary.includes("designated-alley"))!.itinerary;
  assert.ok(route.includes("illegal-alley"));
  for (const s of [base, city]) s.runUntil(720);
  assert.ok(city.illegal("alley").collected > 0);
  assert.ok(city.illegal("alley").remaining < base.illegal("alley").remaining);
  assert.ok(city.serviceEvents.some(e => e.site === "illegal-alley" && e.type === "collect" && e.amount > 0));
});

test("learned habits decay, remain local, refresh without stacking, and survive replay and cached continuation", async () => {
  const city = new LiveCitySimulation();
  const first = city.council.start("waterCare", "homes", "together", heard("waterCare"));
  assert.equal(city.council.waterFactor("homes"), 1, "preparation has no early effect");
  city.runUntil(first.endsAt + 1);
  const completed = structuredClone(first.result);
  const continuing = city.council.waterFactor("homes");
  assert.ok(continuing > 0.88 && continuing < 0.89);
  assert.equal(city.council.waterFactor("shops"), 1);
  assert.equal(city.council.current, undefined, "habit does not prevent holding a new meeting");
  assert.match(communityStatus(city), /습관/);
  assert.match(communityRecord(city, 0), /습관.*기여/);
  city.runUntil(first.endsAt + 300);
  assert.ok(city.council.waterFactor("homes") > continuing, "effect fades with time");
  const second = city.council.start("waterCare", "homes", "together", heard("waterCare"));
  city.runUntil(second.startsAt + 1);
  assert.equal(city.council.waterFactor("homes"), 0.88, "renewal restores one effect instead of adding bonuses");
  assert.deepEqual(first.result, completed);
  const cached = restoreLiveCheckpoint(captureLiveCheckpoint(city), city.save());
  const replay = await restoreLiveCity(city.save());
  const past = structuredClone(first.result);
  for (const s of [city, cached, replay]) {
    s.runUntil(1500);
    waterBalance(s);
  }
  for (const s of [cached, replay]) {
    assert.deepEqual(s.water.sources, city.water.sources);
    assert.deepEqual(s.council.records, city.council.records);
  }
  assert.deepEqual(first.result, past, "recorded end-of-activity observation stays fixed");
  city.runUntil(second.endsAt + COMMUNITY_HABIT_DURATION + 0.1);
  assert.equal(city.council.waterFactor("homes"), 1);
});

test("responsive signals change only at full cycle boundaries and retain pedestrian protection", () => {
  const city = new LiveCitySimulation(2405);
  city.runUntil(120);
  const untouched = [...city.network.nodes.values()].filter(n => !RESPONSIVE_SIGNAL_NODES.has(n.id))
    .map(n => [n.id, { ...n.signal }] as const);
  city.apply("signal", "n3-2");
  assert.equal(city.policyMap.places.find(p => p.id === "live-signal-n3-2")!.outlines.length, 1);
  let updates = 0;
  for (let tick = 0; tick < 3600; tick++) {
    const beforeTime = city.time;
    const before = [...RESPONSIVE_SIGNAL_NODES].map(id => [id, { ...city.network.nodes.get(id)!.signal }] as const);
    city.step();
    for (const [id, old] of before) {
      const next = city.network.nodes.get(id)!.signal;
      if (old.ns === next.ns && old.ew === next.ew && old.offset === next.offset) continue;
      updates++;
      const cycle = old.ns + old.ew + 2 * (old.yellow + old.clearance) + (old.walk ?? 0) + (old.walkClearance ?? 0);
      const position = ((beforeTime + old.offset) % cycle + cycle) % cycle;
      assert.ok(position < 1e-6 || cycle - position < 1e-6, `mid-cycle change at ${id}, ${beforeTime}`);
      assert.equal(next.yellow, old.yellow); assert.equal(next.clearance, old.clearance);
      assert.equal(next.walk, old.walk); assert.equal(next.walkClearance, old.walkClearance);
      assert.ok(next.ns >= 4 && next.ew >= 4 && next.ns + next.ew <= 36);
    }
    for (const p of city.pedestrians.active.values()) if (p.crossing) {
      const route = city.pedestrians.routes.get(p.trip.routeId)!;
      assert.equal(city.nodeLocks.get(route.nodeId)?.size ?? 0, 0, "a walking crossing cannot be reserved by a vehicle");
    }
    const cars = [...city.vehicles.values()];
    for (let a = 0; a < cars.length; a++) for (let b = a + 1; b < cars.length; b++) {
      if (Math.abs(cars[a].pose.x - cars[b].pose.x) > 6 || Math.abs(cars[a].pose.z - cars[b].pose.z) > 6) continue;
      assert.ok(!overlaps(cars[a].pose, cars[b].pose), `overlap at ${city.time}: ${cars[a].id}/${cars[b].id}`);
    }
  }
  assert.ok(updates > 100);
  for (const [id, signal] of untouched) assert.deepEqual(city.network.nodes.get(id)!.signal, signal);
  assert.ok(city.pedestrians.events.filter(e => e.type === "enter").every(e => e.phase === "pedestrian-green"));
});

test("signal plans and ongoing habits resume exactly; v6 cache migration preserves the existing physical city", () => {
  const city = new LiveCitySimulation();
  city.apply("signal", "n3-2");
  city.council.start("waterCare", "homes", "together", heard("waterCare"));
  city.runUntil(720);
  const checkpoint = captureLiveCheckpoint(city);
  (checkpoint as { version: string }).version = "living-state-6";
  const restored = restoreLiveCheckpoint(checkpoint, city.save());
  assert.deepEqual([...restored.vehicles], [...city.vehicles]);
  assert.deepEqual(restored.water.sources, city.water.sources);
  for (const s of [city, restored]) s.runUntil(900);
  assert.deepEqual([...restored.vehicles], [...city.vehicles]);
  assert.deepEqual([...restored.network.nodes], [...city.network.nodes]);
  assert.deepEqual(restored.water.sources, city.water.sources);
});
