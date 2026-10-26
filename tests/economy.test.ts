import test from "node:test";
import assert from "node:assert/strict";
import {
  LiveCitySimulation,
  CROSSWALKS,
  EXTRA_TRUCKS,
  STARTING_BUDGET,
  prepareLiveSave,
  restoreLiveCity,
  validateLiveSave,
} from "../src/simulation/live";
import { captureLiveCheckpoint, restoreLiveCheckpoint } from "../src/simulation/checkpoint";
import { LOT_FEE, PARKING_FINE } from "../src/simulation/parking";
import { PARK_FEE_PER_VISITOR } from "../src/simulation/facilities";
import { DAILY_BUDGET, DAY_SECONDS, HOUR_SECONDS } from "../src/simulation/day-clock";
import { daylight, NOON } from "../src/renderer/daylight";
import { createNetwork, SCHOOL_NODE } from "../src/scenario";

const FIVE_MINUTES = [0, 0, 0, 0, 0, 0, Infinity] as const;
/** Simulation time of a clock hour (new cities start at 07:00). */
const at = (day: number, hour: number) => (day - 1) * DAY_SECONDS + (hour - 7) * HOUR_SECONDS;

test("new cities start with a generous budget; older saves keep 100", () => {
  const city = new LiveCitySimulation();
  assert.equal(city.budget, STARTING_BUDGET);
  assert.equal(city.save().startingBudget, STARTING_BUDGET);
  const old = new LiveCitySimulation(2404, ...FIVE_MINUTES, 100);
  assert.equal(old.save().startingBudget, undefined);
  assert.equal(prepareLiveSave(old.save()).startingBudget, 100);
  for (const startingBudget of [-1, 1001, 1.5, NaN])
    assert.throws(() => validateLiveSave({ ...city.save(), startingBudget }));
});

test("a paid lot earns per car and pushes some drivers back to the kerb", () => {
  const run = (fee: boolean) => {
    const city = new LiveCitySimulation();
    city.apply("parkingLot", "north");
    if (fee) city.apply("parkingFee");
    const budget = city.budget;
    city.runUntil(1800);
    const lotCars = city.parking.episodes.filter((e) => e.destination === "lot").length;
    return { city, budget, lotCars, illegal: city.parking.parkingStats.illegalSeconds };
  };
  const free = run(false), paid = run(true);
  assert.ok(paid.lotCars < free.lotCars, `${paid.lotCars} < ${free.lotCars}`);
  assert.ok(paid.illegal > free.illegal, "some drivers park on the street instead");
  const earned = paid.city.parking.earnings.lot;
  assert.ok(earned > 0 && earned % LOT_FEE === 0);
  assert.equal(paid.city.todayIncome.lot, earned);
  assert.equal(free.city.parking.earnings.lot, 0);
  assert.equal(paid.city.budget - paid.budget, earned, "fees go straight into the budget");
});

test("fines charge tickets at the patrolled site and keep some drivers away", () => {
  const run = (fines: boolean) => {
    const city = new LiveCitySimulation();
    city.apply("patrol", "homes");
    if (fines) city.apply("fines");
    city.runUntil(2400);
    const site = city.parking.episodes.filter(
      (e) => e.request.siteId === "homes" && e.destination === "illegal",
    ).length;
    return { city, site };
  };
  const patrol = run(false), fined = run(true);
  assert.ok(fined.site < patrol.site, `${fined.site} < ${patrol.site}`);
  const earned = fined.city.parking.earnings.fines;
  assert.ok(earned > 0 && earned % PARKING_FINE === 0);
  assert.equal(fined.city.todayIncome.fines, earned);
  assert.equal(patrol.city.parking.earnings.fines, 0);
  assert.throws(() => new LiveCitySimulation().apply("fines"), /순찰 구역이 먼저/);
});

test("a park fee lowers park use and is collected with the 06:00 budget", () => {
  const free = new LiveCitySimulation(), paid = new LiveCitySimulation();
  for (const city of [free, paid]) city.apply("park", "north");
  paid.apply("parkFee");
  assert.ok(paid.values.access > free.values.access, "fewer residents can use a park");
  const visitors = paid.facilities.paidParkVisitors;
  assert.ok(visitors > 0);
  assert.equal(free.facilities.paidParkVisitors, 0);
  const before = paid.budget;
  paid.runUntil(at(2, 6) + 1);
  const park = Math.round(visitors * PARK_FEE_PER_VISITOR);
  assert.equal(paid.yesterdayIncome.park, park);
  assert.equal(paid.budget, before + DAILY_BUDGET + park + paid.yesterdayIncome.lot + paid.yesterdayIncome.fines);
});

test("extra trucks are limited by the recycling centre, which can expand; withdrawn trucks retire", () => {
  const city = new LiveCitySimulation();
  city.budget = 1000;
  city.apply("extraTruck");
  assert.equal(city.extraTrucks, EXTRA_TRUCKS.base);
  assert.throws(() => city.apply("extraTruck"), /자원순환센터를 넓혀야/);
  city.apply("depot", "industry");
  assert.ok(city.parcels.some((p) => p.siteId === "industry" && p.kind === "depot"));
  city.apply("extraTruck");
  city.apply("extraTruck");
  assert.equal(city.extraTrucks, EXTRA_TRUCKS.expanded);
  assert.equal(city.policyBlocked("extraTruck"), "수거차 자리 없음");
  assert.deepEqual(city.trucks.map((t) => t.name).slice(-3), ["3호 수거차", "4호 수거차", "5호 수거차"]);
  const depot = city.actions.findIndex((a) => a.id === "depot");
  assert.match(city.withdrawBlocked(depot)!, /수거차를 1대까지/);
  city.runUntil(300);
  const last = city.actions.length - 1;
  city.withdraw(last);
  const retired = city.trucks.find((t) => t.name === "5호 수거차")!;
  assert.equal(retired.retired, true);
  assert.equal(city.extraTrucks, 2);
  city.runUntil(1500);
  assert.equal(retired.phase, "finished", "it finishes at the centre and stays");
  assert.equal(city.serviceJourneys.has(retired.id), false);
  const wasteStats = city.wasteStats;
  assert.ok(Math.abs(wasteStats.initial + wasteStats.generated - wasteStats.remaining -
    wasteStats.collected - wasteStats.transferredToRiver) < 1e-6, "no waste disappears");
  city.apply("extraTruck");
  assert.equal(city.trucks[city.trucks.length - 1].name, "6호 수거차", "a new truck gets a new number");
});

test("every lasting policy can be withdrawn: rules stop, land frees up, money stays spent", () => {
  const requires: Partial<Record<string, string>> = {
    fines: "patrol", parkingFee: "parkingLot", parkFee: "park",
  };
  for (const policy of ["signal", "stagger", "footbridge", "patrol", "fines", "parkingLot",
    "parkingFee", "loadingBay", "dropoff", "extraTruck", "reduce", "depot", "outlet", "sewer",
    "riverCleanup", "handling", "production", "library", "park", "parkFee"] as const) {
    const city = new LiveCitySimulation();
    city.budget = 1000;
    const first = requires[policy];
    if (first) city.apply(first as never, city.targets(first as never)[0]?.id ?? "");
    city.apply(policy, city.targets(policy)[0]?.id ?? "");
    const index = city.actions.length - 1;
    const budget = city.budget, parcels = city.parcels.length;
    city.runUntil(30);
    city.withdraw(index, "다시 생각했어요");
    assert.equal(city.has(policy), false, policy);
    assert.equal(city.budget, budget, `${policy}: nothing is refunded`);
    assert.ok(city.parcels.length <= parcels, policy);
    assert.equal(city.withdrawable.some((w) => w.index === index), false, policy);
    assert.ok(city.news.some((n) => n.type === "policy" && n.title.endsWith("철회")), policy);
    if (["parkingLot", "library", "park", "sewer", "depot"].includes(policy))
      assert.equal(city.parcels.some((p) => p.siteId === city.actions[index].target), false, policy);
    // The policy can be bought again where it was.
    if (policy !== "fines" && policy !== "parkingFee" && policy !== "parkFee")
      assert.equal(city.policyBlocked(policy), undefined, policy);
    city.runUntil(120);
  }
  const city = new LiveCitySimulation();
  city.apply("cleanup", "alley");
  assert.throws(() => city.withdraw(0), /끝난 일/);
  city.apply("parkingLot", "north");
  city.apply("parkingFee");
  assert.match(city.withdrawBlocked(1)!, /이용료를 먼저/);
  assert.throws(() => city.withdraw(1));
  city.withdraw(2);
  city.withdraw(1);
  assert.throws(() => city.withdraw(1), /철회할 정책/);
});

test("withdrawn signal timing returns to the original splits one cycle at a time", () => {
  const city = new LiveCitySimulation();
  const original = createNetwork();
  city.apply("signal", SCHOOL_NODE);
  city.runUntil(at(1, 9));
  const changed = [...original.nodes.keys()].filter((id) => {
    const s = city.network.nodes.get(id)!.signal, o = original.nodes.get(id)!.signal;
    return s.ns !== o.ns || s.ew !== o.ew;
  });
  assert.ok(changed.length > 0, "the responsive plan adapted some junctions");
  city.withdraw(0);
  city.runUntil(at(1, 9) + 200);
  for (const id of changed) {
    const s = city.network.nodes.get(id)!.signal, o = original.nodes.get(id)!.signal;
    assert.deepEqual([s.ns, s.ew], [o.ns, o.ew], id);
  }
});

test("a footbridge removes the pedestrian phase: walkers stop waiting and cars get the time back", () => {
  const node = CROSSWALKS[0].id;
  const run = (bridge: boolean) => {
    const city = new LiveCitySimulation();
    if (bridge) city.apply("footbridge", node);
    let stopped = 0, blocked = 0;
    for (let t = 1; t <= 600; t++) {
      city.runUntil(t);
      if (city.pedestrians.blockedNodes.has(node)) blocked++;
      stopped += city.stats.roads
        .filter((r) => city.network.nodes.get(node)!.connectedRoadIds.includes(r.id))
        .reduce((n, r) => n + r.stopped, 0);
    }
    return { city, stopped, blocked };
  };
  const plain = run(false), bridged = run(true);
  const signal = bridged.city.network.nodes.get(node)!.signal;
  assert.deepEqual([signal.walk, signal.walkClearance], [0, 0]);
  assert.ok(bridged.city.pedestrians.bridges.has(node));
  assert.equal(bridged.blocked, 0, "walkers on the bridge never hold cars at the junction");
  assert.ok(plain.blocked > 0);
  assert.ok(bridged.stopped < plain.stopped, `${bridged.stopped} < ${plain.stopped}`);
  // Withdrawing waits for the cycle start and nobody on the bridge.
  bridged.city.withdraw(0);
  bridged.city.runUntil(700);
  assert.equal(bridged.city.pedestrians.bridges.has(node), false);
  assert.deepEqual([signal.walk, signal.walkClearance], [8, 16]);
});

test("withdrawals survive JSON and checkpoints, replay in order, and reject tampering", async () => {
  const city = new LiveCitySimulation();
  city.apply("parkingLot", "north");
  city.apply("parkingFee");
  city.apply("footbridge", SCHOOL_NODE);
  city.runUntil(200.3);
  city.withdraw(1, "요금이 부담돼요");
  city.withdraw(2);
  city.apply("park", "riverside");
  city.runUntil(400);
  const save = JSON.parse(JSON.stringify(city.save()));
  assert.equal(save.withdrawals.length, 2);
  const cached = restoreLiveCheckpoint(captureLiveCheckpoint(city), save);
  const replayed = await restoreLiveCity(save);
  for (const copy of [cached, replayed]) {
    assert.deepEqual(copy.withdrawals, city.withdrawals);
    assert.equal(copy.budget, city.budget);
    assert.deepEqual([...copy.vehicles], [...city.vehicles]);
  }
  for (const c of [city, cached, replayed]) c.runUntil(700);
  assert.deepEqual([...replayed.vehicles], [...city.vehicles]);
  assert.deepEqual(replayed.save(), city.save());
  const bad = (withdrawals: unknown) => () => validateLiveSave({ ...save, withdrawals });
  assert.throws(bad([{ time: 10, policyCount: 1, action: 1, reason: "" }]), "after its action");
  assert.throws(bad([...save.withdrawals, save.withdrawals[0]]), "twice");
  assert.throws(bad([{ time: 500, policyCount: 3, action: 0, reason: "" }]), "in the future");
  const cleanup = new LiveCitySimulation();
  cleanup.apply("cleanup", "alley");
  assert.throws(() => validateLiveSave({ ...cleanup.save(), withdrawals: [{ time: 0, policyCount: 1, action: 0, reason: "" }] }));
});

test("a living-state-10 cache gains empty income, withdrawals and footbridges", () => {
  // Version 10 caches come from daily-cycle cities that started at 100.
  const city = new LiveCitySimulation(2404, 0, 0, 0, 0, 0, 0, 0, 100);
  city.apply("patrol", "homes");
  city.runUntil(250);
  const checkpoint = captureLiveCheckpoint(city);
  (checkpoint as { version: string }).version = "living-state-10";
  for (const key of ["startingBudget", "withdrawals", "todayIncome", "yesterdayIncome", "credited"])
    delete checkpoint.state.world[key];
  for (const key of ["fees", "earnings"]) delete checkpoint.state.parking[key];
  delete checkpoint.state.pedestrians.bridges;
  delete checkpoint.state.pedestrians.closingBridges;
  const copy = restoreLiveCheckpoint(checkpoint, city.save());
  assert.equal(copy.startingBudget, 100);
  assert.deepEqual(copy.withdrawals, []);
  city.runUntil(500);
  copy.runUntil(500);
  assert.deepEqual([...copy.vehicles], [...city.vehicles]);
  assert.equal(captureLiveCheckpoint(copy).version, "living-state-11");
});

test("daylight follows the clock: warm sunrise in the east, white noon, sunset in the west, dark night", () => {
  const noon = daylight(12);
  assert.equal(noon.background, NOON.background);
  assert.equal(noon.sunIntensity, NOON.sunIntensity);
  const luminance = (c: number) => ((c >> 16) & 255) * 0.3 + ((c >> 8) & 255) * 0.59 + (c & 255) * 0.11;
  assert.ok(luminance(daylight(2).background) < luminance(noon.background) / 3);
  assert.ok(daylight(2).sunIntensity < noon.sunIntensity / 4);
  assert.ok(daylight(7).sun.x > 0 && daylight(17).sun.x < 0, "east in the morning, west in the evening");
  assert.ok(daylight(12).sun.y > daylight(7).sun.y, "the sun is highest around noon");
  for (let h = 0; h < 24; h += 0.25) {
    const a = daylight(h), b = daylight(h + 0.25);
    assert.ok(Math.abs(a.sunIntensity - b.sunIntensity) < 0.5, `smooth at ${h}`);
  }
  assert.deepEqual(daylight(24), daylight(0));
});
