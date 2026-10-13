import test from "node:test";
import assert from "node:assert/strict";
import { compareExperiments } from "../src/metrics/comparison";
import { createDemand, createNetwork } from "../src/scenario";
type Observation = Parameters<typeof compareExperiments>[0];

function fixture() {
  const seed = createDemand()[0];
  const demand = [
    {
      ...seed,
      id: 0,
      origin: "n0-2",
      destination: "n3-2",
      departAt: 0,
      purpose: "school" as const,
    },
    {
      ...seed,
      id: 1,
      origin: "n0-1",
      destination: "n3-2",
      departAt: 0,
      purpose: "school" as const,
    },
    {
      ...seed,
      id: 2,
      origin: "n0-2",
      destination: "n4-2",
      departAt: 50,
      purpose: "work" as const,
    },
    {
      ...seed,
      id: 3,
      origin: "n4-2",
      destination: "n0-2",
      departAt: 120,
      purpose: "home" as const,
    },
  ];
  const base = {
    time: 100,
    demand,
    network: createNetwork(),
    vehicles: new Map(),
  };
  const before: Observation = {
    ...base,
    completed: [{ id: 0, travelTime: 80, waitingTime: 30, purpose: "school" }],
    pending: [demand[1], demand[2]],
  };
  const after: Observation = {
    ...base,
    completed: [
      { id: 0, travelTime: 60, waitingTime: 10, purpose: "school" },
      { id: 1, travelTime: 70, waitingTime: 20, purpose: "school" },
    ],
    pending: [demand[2]],
  };
  return { before, after };
}

test("matched comparison uses identical IDs, while group wait includes pending trips", () => {
  const { before, after } = fixture();
  const analysis = compareExperiments(before, after);
  assert.deepEqual(analysis.matched, {
    count: 1,
    total: 4,
    beforeTravel: 80,
    afterTravel: 60,
    beforeWait: 30,
    afterWait: 10,
  });
  assert.deepEqual(analysis.byPurpose[0], {
    id: "school",
    label: "등교하는 차",
    total: 2,
    released: 2,
    before: { arrived: 1, averageWait: 65 },
    after: { arrived: 2, averageWait: 15 },
  });
  assert.equal(analysis.byPurpose[1].after.averageWait, 50);
  assert.equal(analysis.byPurpose[2].released, 0);
  assert.equal(analysis.byPurpose[2].after.averageWait, null);
  assert.equal(analysis.byDirection.find((g) => g.id === "east")!.total, 3);
  assert.equal(analysis.byDirection.find((g) => g.id === "west")!.total, 1);
});

test("mismatched windows or any changed departure conditions cannot be compared", () => {
  const { before, after } = fixture();
  assert.throws(() => compareExperiments(before, { ...after, time: 101 }));
  const demand = after.demand.map((t) => ({ ...t }));
  demand[0].departAt = 1;
  assert.throws(() => compareExperiments(before, { ...after, demand }));
});

test("an empty matched cohort reports unaggregated data, never zero travel time", () => {
  const { before, after } = fixture();
  after.completed = after.completed.filter((t) => t.id === 1);
  const analysis = compareExperiments(before, after);
  assert.equal(analysis.matched.count, 0);
  assert.equal(analysis.matched.beforeTravel, null);
  assert.equal(analysis.matched.afterWait, null);
});
