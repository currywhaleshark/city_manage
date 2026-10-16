import {
  createDisposalDemand,
  DUMPING_DURATION,
  DUMPING_MODEL_VERSION,
  DUMPING_POLICIES,
  DUMPING_SITES,
} from "../simulation/services/dumping";
import { WASTE_SITES } from "../simulation/services/waste";
function fail(): never {
  throw new Error("무단투기 기록의 수량·위치·관찰 회차를 확인해 주세요.");
}
const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fail();
const close = (a: number, b: number) => Math.abs(a - b) < 1e-5;
const sum = (rows: any[], key: string) =>
  rows.reduce((n, r) => n + num(r[key]), 0);
export function readDumpingData(data: Record<string, any>) {
  if (
    data.schemaVersion !== 6 ||
    data.dumpingModelVersion !== DUMPING_MODEL_VERSION ||
    data.duration !== DUMPING_DURATION ||
    data.timeUnit !== "seconds" ||
    !data.dumpingPlan ||
    !Array.isArray(data.policyIds)
  )
    fail();
  for (const id of ["cleanup", "dropoff", "outreach"])
    if (!DUMPING_SITES.some((s) => s.id === data.dumpingPlan[id])) fail();
  const cost = data.policyIds.reduce(
    (n: number, id: string) =>
      n + (DUMPING_POLICIES.find((p) => p.id === id)?.cost ?? fail()),
    0,
  );
  if (
    cost > 100 ||
    new Set(data.policyIds).size !== data.policyIds.length ||
    data.budget !== 100 - cost
  )
    fail();
  const demand = createDisposalDemand(data.seed);
  if (JSON.stringify(demand) !== JSON.stringify(data.disposalDemand)) fail();
  const a = data.dumpingBefore,
    b = data.dumpingAfter;
  for (const [s, w, rounds, index] of [
    [a, data.wasteBefore, data.dumpingRoundsBefore, 0],
    [b, data.wasteAfter, data.dumpingRoundsAfter, 1],
  ] as const) {
    if (
      !s ||
      !w ||
      s.time !== data.duration ||
      s.cost !== (index ? cost : 0) ||
      !Array.isArray(s.sites) ||
      s.sites.length !== 3 ||
      !Array.isArray(s.normalSites) ||
      s.normalSites.length !== 6 ||
      !Array.isArray(w.sites) ||
      w.sites.length !== 12
    )
      fail();
    if (
      !close(
        num(s.initial) + num(s.generated),
        num(s.remaining) + num(s.collected),
      ) ||
      !close(s.collected, num(s.disposed) + num(s.inTrucks)) ||
      !close(
        s.remaining,
        num(s.illegalRemaining) + num(s.designatedStored) + num(s.overflow),
      )
    )
      fail();
    for (const key of ["initial", "generated", "collected", "remaining"])
      if (!close(sum(w.sites, key), num(s[key]))) fail();
    const ids = new Set(w.sites.map((r: any) => r.id));
    if (ids.size !== 12) fail();
    for (const r of w.sites)
      if (
        !close(
          num(r.initial) + num(r.generated),
          num(r.remaining) + num(r.collected),
        )
      )
        fail();
    for (const site of DUMPING_SITES) {
      const r = s.sites.find((r: any) => r.id === site.id),
        pile = w.sites.find((r: any) => r.id === `illegal-${site.id}`),
        bin = w.sites.find((r: any) => r.id === `designated-${site.id}`);
      if (
        !r ||
        !pile ||
        !bin ||
        !close(
          num(r.initial) + num(r.newDumped),
          num(r.remaining) + num(r.collected),
        ) ||
        num(r.repeatDumped) > r.newDumped ||
        num(r.nearestDistance) > 2000 ||
        (r.firstClearedAt !== null && num(r.firstClearedAt) > data.duration)
      )
        fail();
      if (
        !close(r.remaining, pile.remaining) ||
        !close(r.collected, pile.collected) ||
        !close(r.newDumped, pile.generated) ||
        !close(num(r.binRemaining), bin.remaining) ||
        !close(num(r.binOverflow), Math.max(0, bin.remaining - 16))
      )
        fail();
      if (
        (!index ||
          !data.policyIds.includes("dropoff") ||
          data.dumpingPlan.dropoff !== site.id) &&
        bin.remaining !== 0
      )
        fail();
    }
    for (const site of WASTE_SITES) {
      const r = s.normalSites.find((r: any) => r.id === site.id),
        pool = w.sites.find((r: any) => r.id === site.id);
      if (
        !r ||
        !pool ||
        !close(num(r.remaining), pool.remaining) ||
        !close(num(r.collected), pool.collected)
      )
        fail();
    }
    const legal = w.sites.filter((r: any) => !r.id.startsWith("illegal-"));
    if (
      !close(sum(s.sites, "remaining"), s.illegalRemaining) ||
      !close(sum(s.sites, "newDumped"), num(s.newDumped)) ||
      !close(sum(s.sites, "repeatDumped"), num(s.repeatDumped)) ||
      !close(sum(s.normalSites, "remaining"), num(s.normalRemaining)) ||
      !close(
        legal.reduce(
          (n: number, r: any) =>
            n + Math.min(r.remaining, r.id.startsWith("designated-") ? 16 : 40),
          0,
        ),
        s.designatedStored,
      )
    )
      fail();
    if (!Array.isArray(rounds) || rounds.length !== 3) fail();
    rounds.forEach((r: any, i: number) => {
      if (r.round !== i + 1 || r.time !== (i + 1) * 300) fail();
      for (const key of [
        "illegalRemaining",
        "newDumped",
        "repeatDumped",
        "overflow",
        "normalRemaining",
      ]) {
        num(r[key]);
        if (i === 2 && !close(r[key], s[key])) fail();
      }
    });
  }
  if (!close(a.initial, b.initial) || !close(a.generated, b.generated)) fail();
  if (
    !Array.isArray(data.disposalEvents) ||
    data.disposalEvents.length !== demand.length
  )
    fail();
  const used = new Set<number>();
  let dumped = 0,
    repeated = 0;
  for (const event of data.disposalEvents) {
    const request = demand.find((d) => d.id === event.request);
    if (
      !request ||
      used.has(request.id) ||
      event.source !== request.siteId ||
      event.amount !== request.amount ||
      !close(event.time, request.time) ||
      event.round !== Math.min(3, Math.floor(event.time / 300) + 1) ||
      !["illegal", "designated"].includes(event.kind) ||
      !["rules", "distance", "proper"].includes(event.reason) ||
      (event.reason === "proper") !== (event.kind === "designated") ||
      typeof event.repeat !== "boolean"
    )
      fail();
    used.add(request.id);
    if (event.kind === "illegal") {
      if (event.destination !== `illegal-${event.source}`) fail();
      dumped += event.amount;
      if (event.repeat) repeated += event.amount;
    } else if (
      event.repeat ||
      (!WASTE_SITES.some((s) => s.id === event.destination) &&
        !(
          data.policyIds.includes("dropoff") &&
          event.destination === `designated-${data.dumpingPlan.dropoff}`
        ))
    )
      fail();
  }
  if (!close(dumped, b.newDumped) || !close(repeated, b.repeatDumped)) fail();
  const rows = (
    [
      ["illegalRemaining", "남은 무단투기"],
      ["newDumped", "새로 버린 투기물"],
      ["repeatDumped", "청소 뒤 다시 버린 양"],
      ["overflow", "지정 장소에서 넘친 양"],
      ["normalRemaining", "기존 수거장에 남은 양"],
      ["remaining", "도시 전체에 남은 양"],
      ["collected", "수거차가 치운 양"],
    ] as const
  ).map(([key, label]) => ({
    label,
    before: `${a[key].toFixed(1)}봉투`,
    after: `${b[key].toFixed(1)}봉투`,
  }));
  const regions = [
    ...DUMPING_SITES.map((site) => ({
      label: site.name,
      before: `${a.sites.find((s: any) => s.id === site.id).remaining.toFixed(1)}봉투`,
      after: `${b.sites.find((s: any) => s.id === site.id).remaining.toFixed(1)}봉투`,
    })),
    ...WASTE_SITES.map((site) => ({
      label: `기존 수거장 · ${site.name}`,
      before: `${a.normalSites.find((s: any) => s.id === site.id).remaining.toFixed(1)}봉투`,
      after: `${b.normalSites.find((s: any) => s.id === site.id).remaining.toFixed(1)}봉투`,
    })),
    ...data.dumpingRoundsAfter.map((r: any, i: number) => ({
      label: `관찰 ${i + 1}차 · 남은 투기`,
      before: `${data.dumpingRoundsBefore[i].illegalRemaining.toFixed(1)}봉투`,
      after: `${r.illegalRemaining.toFixed(1)}봉투`,
    })),
  ];
  return { rows, regions };
}
