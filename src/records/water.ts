import {
  WATER_MODEL_VERSION,
  WATER_DURATION,
  WATER_POLICIES,
  WATER_SOURCES,
  WATER_SITES,
  WATER_BANKS,
  WATER_CELL_LENGTH,
  createWaterSchedule,
  validateWaterPlan,
  sewerSource,
} from "../simulation/water";
import { WORLD } from "../city/world";
function fail(): never {
  throw new Error("수질 기록의 수량·유입 일정·위치·관찰 회차를 확인해 주세요.");
}
const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fail();
const near = (a: number, b: number) => Math.abs(a - b) < 1e-5;
const sum = (a: any[], key: string) => a.reduce((n, s) => n + num(s?.[key]), 0);
export function readWaterData(data: Record<string, any>) {
  if (
    data.schemaVersion !== 7 ||
    data.waterModelVersion !== WATER_MODEL_VERSION ||
    data.duration !== WATER_DURATION ||
    data.timeUnit !== "seconds" ||
    !Array.isArray(data.policyIds)
  )
    fail();
  validateWaterPlan(data.waterPlan);
  const ids: string[] = data.policyIds,
    cost = ids.reduce(
      (n, id) => n + (WATER_POLICIES.find((p) => p.id === id)?.cost ?? fail()),
      0,
    );
  if (
    cost > 100 ||
    new Set(ids).size !== ids.length ||
    data.budget !== 100 - cost
  )
    fail();
  const schedule = createWaterSchedule(data.seed);
  if (JSON.stringify(schedule) !== JSON.stringify(data.waterSchedule)) fail();
  const a = data.waterBefore,
    b = data.waterAfter;
  for (const [s, rounds, after] of [
    [a, data.waterRoundsBefore, false],
    [b, data.waterRoundsAfter, true],
  ] as const) {
    if (
      !s ||
      s.time !== WATER_DURATION ||
      s.cost !== (after ? cost : 0) ||
      s.initial !== 81 ||
      s.litterInitial !== 81 ||
      !Array.isArray(s.cells) ||
      s.cells.length !== 9 ||
      !Array.isArray(s.sources) ||
      s.sources.length !== 5 ||
      !Array.isArray(s.sites) ||
      s.sites.length !== 3 ||
      !Array.isArray(s.banks) ||
      s.banks.length !== 2 ||
      !Array.isArray(rounds) ||
      rounds.length !== 3
    )
      fail();
    for (const key of [
      "generated",
      "treated",
      "entered",
      "remaining",
      "outflow",
      "floating",
      "onBank",
      "litterRemaining",
      "litterCollected",
      "litterOutflow",
      "captured",
    ])
      num(s[key]);
    if (
      !near(s.initial + s.generated, s.remaining + s.treated + s.outflow) ||
      !near(s.generated, s.entered + s.treated) ||
      !near(
        s.litterInitial,
        s.litterRemaining + s.litterCollected + s.litterOutflow,
      ) ||
      !near(s.litterRemaining, s.onBank + s.floating) ||
      s.captured > 8
    )
      fail();
    if (
      !near(s.remaining, sum(s.cells, "dissolved")) ||
      !near(s.floating, sum(s.cells, "litter")) ||
      !near(s.onBank, sum(s.banks, "remaining")) ||
      !near(s.litterCollected, sum(s.banks, "cleaned") + s.captured)
    )
      fail();
    s.cells.forEach((c: any, i: number) => {
      if (
        !c ||
        c.id !== i ||
        c.z !== WORLD.min + WATER_CELL_LENGTH * (i + 0.5) ||
        !near(num(c.level), (num(c.dissolved) * 20) / WATER_CELL_LENGTH)
      )
        fail();
    });
    WATER_SITES.forEach((site, i) => {
      const saved = s.sites[i],
        cell = s.cells[site.cell];
      if (!saved || saved.id !== site.id) fail();
      for (const key of ["dissolved", "level", "litter"])
        if (!near(num(saved[key]), cell[key])) fail();
    });
    WATER_SOURCES.forEach((source, i) => {
      const saved = s.sources[i],
        raw = schedule[i].rates.reduce((n, r) => n + r * 300, 0);
      let expectedTreated = 0;
      if (
        after &&
        ids.includes("outlet") &&
        source.id === data.waterPlan.outlet
      )
        expectedTreated = schedule[i].rates.reduce(
          (n, r, round) =>
            n + Math.min(r * 0.85, 0.18) * (round === 0 ? 241 : 300),
          0,
        );
      if (
        after &&
        ids.includes("sewer") &&
        source.id === sewerSource(data.waterPlan.sewer)
      )
        expectedTreated = schedule[i].rates
          .slice(1)
          .reduce((n, r) => n + Math.min(r * 0.85, 0.16) * 300, 0);
      if (
        !saved ||
        saved.id !== source.id ||
        !near(num(saved.raw), raw) ||
        !near(num(saved.treated), expectedTreated) ||
        !near(num(saved.entered), raw - expectedTreated)
      )
        fail();
    });
    for (const key of ["treated", "entered"])
      if (!near(s[key], sum(s.sources, key))) fail();
    if (!near(s.generated, sum(s.sources, "raw"))) fail();
    WATER_BANKS.forEach((bank, i) => {
      const saved = s.banks[i];
      if (
        !saved ||
        saved.id !== bank.id ||
        saved.initial !== 36 ||
        !near(
          saved.initial,
          num(saved.remaining) + num(saved.cleaned) + num(saved.entered),
        )
      )
        fail();
      if (
        (!after ||
          !ids.includes("riverCleanup") ||
          data.waterPlan.riverCleanup !== bank.id) &&
        saved.cleaned !== 0
      )
        fail();
    });
    if ((!after || !ids.includes("riverCleanup")) && s.captured !== 0) fail();
    rounds.forEach((r: any, i: number) => {
      if (
        !r ||
        r.round !== i + 1 ||
        r.time !== (i + 1) * 300 ||
        !Array.isArray(r.levels) ||
        r.levels.length !== 3
      )
        fail();
      r.levels.forEach(num);
      for (const key of ["remaining", "outflow", "litterRemaining"])
        num(r[key]);
      if (i && r.outflow < rounds[i - 1].outflow) fail();
      if (i === 2) {
        for (const key of ["remaining", "outflow", "litterRemaining"])
          if (!near(r[key], s[key])) fail();
        if (
          !r.levels.every((v: number, j: number) => near(v, s.sites[j].level))
        )
          fail();
      }
    });
  }
  const rows = (
    [
      ["remaining", "하천에 남은 오염", "가상단위"],
      ["entered", "새로 유입한 오염", "가상단위"],
      ["treated", "유입 전에 처리한 양", "가상단위"],
      ["outflow", "지도 밖 하류로 나간 오염", "가상단위"],
      ["litterRemaining", "둔치·물 위에 남은 쓰레기", "봉투"],
      ["litterCollected", "모아 처리한 쓰레기", "봉투"],
      ["litterOutflow", "지도 밖으로 나간 쓰레기", "봉투"],
    ] as const
  ).map(([key, label, unit]) => ({
    label,
    before: `${a[key].toFixed(1)}${unit}`,
    after: `${b[key].toFixed(1)}${unit}`,
  }));
  const regions = [
    ...WATER_SITES.map((s, i) => ({
      label: `${s.name} · 가상 오염도`,
      before: a.sites[i].level.toFixed(1),
      after: b.sites[i].level.toFixed(1),
    })),
    ...WATER_SOURCES.map((s, i) => ({
      label: `${s.name} · 강에 들어간 양`,
      before: `${a.sources[i].entered.toFixed(1)}가상단위`,
      after: `${b.sources[i].entered.toFixed(1)}가상단위`,
    })),
    ...data.waterRoundsAfter.map((r: any, i: number) => ({
      label: `관찰 ${i + 1}차 · 하류 가상 오염도`,
      before: data.waterRoundsBefore[i].levels[2].toFixed(1),
      after: r.levels[2].toFixed(1),
    })),
  ];
  return { rows, regions };
}
