import { TrafficSimulation } from "../simulation";
import { createDemand, DEFAULT_POLICY, seededRandom } from "../scenario";
import { createPedestrianDemand } from "./pedestrians";
import { RIVER, WORLD, BUILDABLE_PLOTS } from "../city/world";
import { validateParcelUses } from "../city/parcels";
import { applyPolicies, type PolicyDefinition } from "../policies/definition";

export const WATER_MODEL_VERSION = "river-water-v1";
export const WATER_DURATION = 900;
export const WATER_SPEED = WORLD.size / 720;
export const WATER_CELL_LENGTH = WORLD.size / 9;
export const WATER_SITES = [
  {
    id: "upstream",
    name: "상류 관찰소",
    cell: 0,
    position: { x: RIVER.x, z: -112 },
    facilityId: "b1",
    group: "상류 주민",
    opinion: "우리 집 앞뿐 아니라 물이 흘러가는 아래 동네도 살펴봐 주세요.",
  },
  {
    id: "middle",
    name: "배출구 아래 관찰소",
    cell: 4,
    position: { x: RIVER.x, z: 116 },
    facilityId: "b6",
    group: "공장 작업자",
    opinion:
      "어느 배출구에서 얼마나 들어오는지 확인하고 필요한 곳부터 고쳐 주세요.",
  },
  {
    id: "downstream",
    name: "하류 관찰소",
    cell: 8,
    position: { x: RIVER.x, z: 304 },
    facilityId: "b7",
    group: "하류 산책길 주민",
    opinion:
      "떠 있는 쓰레기를 치워도 물에 섞인 오염이 남는지 계속 조사해 주세요.",
  },
] as const;
export const WATER_SOURCES = [
  {
    id: "upstream",
    name: "지도 밖 상류 유입",
    kind: "background",
    z: WORLD.min,
    x: RIVER.x,
    rate: 0.03,
  },
  {
    id: "factoryNorth",
    name: "북쪽 작업장 배출구",
    kind: "factory",
    z: 18,
    x: 136,
    rate: 0.24,
  },
  {
    id: "factorySouth",
    name: "남쪽 작업장 배출구",
    kind: "factory",
    z: 164,
    x: 136,
    rate: 0.18,
  },
  {
    id: "homes",
    name: "주거·상가 하수 유입구",
    kind: "sewer",
    z: -22,
    x: 104,
    rate: 0.22,
  },
  {
    id: "shops",
    name: "남쪽 생활하수 유입구",
    kind: "sewer",
    z: 220,
    x: 104,
    rate: 0.14,
  },
] as const;
export const WATER_BANKS = [
  { id: "walk", name: "중간 산책길", position: { x: 104, z: 32 }, z: 32 },
  { id: "lower", name: "하류 둔치", position: { x: 104, z: 176 }, z: 176 },
] as const;
export type WaterPolicyId = "outlet" | "sewer" | "riverCleanup";
export interface WaterPlan {
  outlet: "factoryNorth" | "factorySouth";
  sewer: "riverside" | "south";
  riverCleanup: "walk" | "lower";
}
export const DEFAULT_WATER_PLAN: WaterPlan = {
  outlet: "factoryNorth",
  sewer: "riverside",
  riverCleanup: "lower",
};
export const sewerSource = (plot: WaterPlan["sewer"]) =>
  plot === "riverside" ? "homes" : "shops";
export const WATER_POLICIES: readonly PolicyDefinition<
  Record<WaterPolicyId, boolean>
>[] = [
  {
    id: "outlet",
    scenarioId: "water",
    title: "배출구 처리 개선",
    cost: 45,
    target: "작업장 배출구 한 곳",
    description:
      "선택한 배출구의 처리 장치를 고쳐 물에 섞인 오염을 줄여요. 1분 뒤 작동해요.",
    tradeoff:
      "처리 용량을 넘는 양과 다른 배출구의 오염은 남아요. 이미 강에 들어간 오염도 흘러가요.",
    metrics: ["entered", "treated"],
    available: () => true,
    apply: (s) => {
      s.outlet = true;
    },
  },
  {
    id: "sewer",
    scenarioId: "water",
    title: "생활하수 처리 시설",
    cost: 55,
    target: "하수관에 연결된 공터 한 곳 · 144㎡",
    description:
      "공터에 작은 처리 시설을 지어요. 연결된 생활하수를 2차 관찰부터 처리해요.",
    tradeoff:
      "해당 공터와 예산을 사용해요. 공장 배출과 다른 하수관은 처리하지 않아요.",
    metrics: ["entered", "treated"],
    available: () => true,
    apply: (s) => {
      s.sewer = true;
    },
  },
  {
    id: "riverCleanup",
    scenarioId: "water",
    title: "하천변 청소·쓰레기 차단",
    cost: 30,
    target: "둔치 한 곳과 바로 아래 물길",
    description:
      "1분 뒤 작업자가 둔치를 치우고 떠오는 쓰레기를 차단막에 모아요. 최대 8봉투를 모아요.",
    tradeoff:
      "가득 차면 뒤에 오는 쓰레기는 지나가요. 물에 섞인 오염은 제거하지 않아요.",
    metrics: ["litterRemaining", "litterCollected"],
    available: () => true,
    apply: (s) => {
      s.riverCleanup = true;
    },
  },
];
export function waterTargets(kind: WaterPolicyId) {
  if (kind === "outlet")
    return WATER_SOURCES.filter((s) => s.kind === "factory").map((s) => ({
      id: s.id,
      name: s.name,
      position: { x: s.x, z: s.z },
      width: 6,
      depth: 8,
      detail: "이 배출구만 개선 · 예산 45",
    }));
  if (kind === "sewer")
    return BUILDABLE_PLOTS.filter(
      (p) => p.id === "riverside" || p.id === "south",
    ).map((p) => ({
      ...p,
      detail: `144㎡ 사용 · ${WATER_SOURCES.find((s) => s.id === sewerSource(p.id as WaterPlan["sewer"]))!.name} 연결`,
    }));
  return WATER_BANKS.map((s) => ({
    ...s,
    width: 8,
    depth: 12,
    detail: "둔치 청소 + 바로 아래 차단막 · 8봉투 용량",
  }));
}
export function validateWaterPlan(plan: WaterPlan) {
  if (
    !plan ||
    !WATER_POLICIES.every((p) =>
      waterTargets(p.id as WaterPolicyId).some(
        (t) => t.id === plan[p.id as WaterPolicyId],
      ),
    )
  )
    throw new Error("지도에서 수질 대책의 적용 위치를 골라 주세요.");
}
export function createWaterSchedule(seed: number) {
  const random = seededRandom(seed ^ 0x77617465);
  return WATER_SOURCES.map((s) => ({
    id: s.id,
    rates: [0, 1, 2].map(
      (i) =>
        s.rate *
        (s.kind === "background"
          ? 1
          : (i === 1 ? 1.65 : 0.85) + random() * 0.2),
    ),
  }));
}
export interface WaterPacket {
  z: number;
  amount: number;
  kind: "dissolved" | "litter";
  source: string;
}
export interface WaterCell {
  id: number;
  z: number;
  dissolved: number;
  litter: number;
  level: number;
}
export const waterLevel = (n: number) =>
  n < 5 ? "낮음" : n < 12 ? "보통" : "높음";
export const waterColor = (n: number) =>
  n < 5 ? 0x72b8c5 : n < 12 ? 0x9aa76b : 0x8d6853;
export class WaterSimulation extends TrafficSimulation {
  readonly scenarioId = "water";
  readonly policyIds: readonly string[];
  plan: Readonly<WaterPlan>;
  readonly cost: number;
  readonly configuration: Record<WaterPolicyId, boolean>;
  readonly schedule: ReturnType<typeof createWaterSchedule>;
  readonly sources = WATER_SOURCES.map((s) => ({
    id: s.id as string,
    raw: 0,
    treated: 0,
    entered: 0,
  }));
  readonly banks = WATER_BANKS.map((s) => ({
    id: s.id as string,
    initial: 36,
    remaining: 36,
    entered: 0,
    cleaned: 0,
  }));
  readonly packets: WaterPacket[] = [];
  readonly initial = 81;
  get litterInitial() {
    return 9 + this.banks.reduce((n, b) => n + b.initial, 0);
  }
  outflow = 0;
  litterOutflow = 0;
  captured = 0;
  readonly rounds: {
    round: number;
    time: number;
    levels: number[];
    remaining: number;
    outflow: number;
    litterRemaining: number;
  }[] = [];
  sourceMultiplier = 1;
  /** A local household agreement affects only its selected source's NEW discharge. */
  householdFactor: (sourceId: string) => number = () => 1;
  householdPrevented: (sourceId: string, amount: number) => void = () => {};
  externalLitter = 0;
  activation = { outlet: 60, sewer: 301, riverCleanup: 60 };
  private waterSeconds = 0;
  constructor(
    readonly seed = 2404,
    ids: readonly string[] = [],
    plan: WaterPlan = DEFAULT_WATER_PLAN,
    backgroundCount = 140,
    transport?: TrafficSimulation,
  ) {
    validateWaterPlan(plan);
    const applied = applyPolicies(
      WATER_POLICIES,
      ids,
      { outlet: false, sewer: false, riverCleanup: false },
      100,
    );
    if (applied.state.sewer)
      validateParcelUses([{ siteId: plan.sewer, kind: "water" }]);
    super(
      DEFAULT_POLICY,
      transport ? [] : createDemand(seed, backgroundCount),
      undefined,
      createPedestrianDemand(seed),
      transport,
    );
    this.policyIds = Object.freeze([...ids]);
    this.plan = Object.freeze({ ...plan });
    this.cost = applied.cost;
    this.configuration = applied.state;
    this.schedule = createWaterSchedule(seed);
    for (let i = 0; i < 9; i++) {
      const z = WORLD.min + WATER_CELL_LENGTH * (i + 0.5);
      this.packets.push(
        { z, amount: 9, kind: "dissolved", source: "initial" },
        { z, amount: 1, kind: "litter", source: "initial" },
      );
    }
  }
  get round() {
    return Math.min(3, Math.max(1, Math.ceil((this.time - 1e-7) / 300)));
  }
  override step() {
    super.step();
    while (this.waterSeconds + 1 <= this.time + 1e-7)
      this.flowSecond(++this.waterSeconds);
  }
  private flowSecond(t: number) {
    const bank = WATER_BANKS.find((b) => b.id === this.plan.riverCleanup)!;
    const boomZ = bank.z + 18;
    // Advect existing packets first. New discharges cannot skip their travel time.
    for (let i = this.packets.length - 1; i >= 0; i--) {
      const p = this.packets[i],
        previousZ = p.z;
      p.z += WATER_SPEED;
      if (
        p.kind === "litter" &&
        this.configuration.riverCleanup &&
        t >= this.activation.riverCleanup &&
        previousZ < boomZ &&
        p.z >= boomZ
      ) {
        const caught = Math.min(p.amount, 8 - this.captured);
        this.captured += caught;
        p.amount -= caught;
      }
      if (p.z >= WORLD.max) {
        if (p.kind === "litter") this.litterOutflow += p.amount;
        else this.outflow += p.amount;
        this.packets.splice(i, 1);
      } else if (p.amount < 1e-10) this.packets.splice(i, 1);
    }
    const roundIndex = Math.min(2, Math.floor((t - 1) / 300));
    WATER_SOURCES.forEach((source, i) => {
      const potential =
        this.schedule[i].rates[roundIndex] *
        (source.kind === "factory" ? this.sourceMultiplier : 1);
      const raw =
        potential *
        (source.kind === "sewer" ? this.householdFactor(source.id) : 1);
      if (raw < potential) this.householdPrevented(source.id, potential - raw);
      const active =
        source.id === this.plan.outlet &&
        this.configuration.outlet &&
        t >= this.activation.outlet
          ? 0.18
          : source.id === sewerSource(this.plan.sewer) &&
              this.configuration.sewer &&
              t >= this.activation.sewer
            ? 0.16
            : 0;
      const treated = Math.min(raw * 0.85, active);
      this.sources[i].raw += raw;
      this.sources[i].treated += treated;
      this.sources[i].entered += raw - treated;
      this.packets.push({
        z: source.z,
        amount: raw - treated,
        kind: "dissolved",
        source: source.id,
      });
    });
    this.banks.forEach((b, i) => {
      const cleaned =
        this.configuration.riverCleanup &&
        b.id === bank.id &&
        t >= this.activation.outlet
          ? Math.min(b.remaining, 0.5)
          : 0;
      b.remaining -= cleaned;
      b.cleaned += cleaned;
      const entered = Math.min(b.remaining, 0.055);
      b.remaining -= entered;
      b.entered += entered;
      if (entered)
        this.packets.push({
          z: WATER_BANKS[i].z,
          amount: entered,
          kind: "litter",
          source: b.id,
        });
    });
    if (t % 300 === 0 && t <= WATER_DURATION) {
      const s = this.waterStats;
      this.rounds.push({
        round: t / 300,
        time: t,
        levels: s.sites.map((s) => s.level),
        remaining: s.remaining,
        outflow: s.outflow,
        litterRemaining: s.litterRemaining,
      });
    }
  }
  get cells(): WaterCell[] {
    const cells = Array.from({ length: 9 }, (_, id) => ({
      id,
      z: WORLD.min + WATER_CELL_LENGTH * (id + 0.5),
      dissolved: 0,
      litter: 0,
      level: 0,
    }));
    for (const p of this.packets) {
      const c =
        cells[
          Math.min(
            8,
            Math.max(0, Math.floor((p.z - WORLD.min) / WATER_CELL_LENGTH)),
          )
        ];
      c[p.kind] += p.amount;
    }
    for (const c of cells) c.level = (c.dissolved * 20) / WATER_CELL_LENGTH;
    return cells;
  }
  get waterStats() {
    const cells = this.cells,
      sum = (key: "raw" | "treated" | "entered") =>
        this.sources.reduce((n, s) => n + s[key], 0);
    const floating = cells.reduce((n, c) => n + c.litter, 0),
      onBank = this.banks.reduce((n, b) => n + b.remaining, 0);
    return {
      time: this.time,
      initial: this.initial,
      generated: sum("raw"),
      entered: sum("entered"),
      treated: sum("treated"),
      remaining: cells.reduce((n, c) => n + c.dissolved, 0),
      outflow: this.outflow,
      litterInitial: this.litterInitial,
      externalLitter: this.externalLitter,
      floating,
      onBank,
      litterRemaining: floating + onBank,
      litterCollected:
        this.captured + this.banks.reduce((n, b) => n + b.cleaned, 0),
      litterOutflow: this.litterOutflow,
      captured: this.captured,
      cost: this.cost,
      cells,
      sites: WATER_SITES.map((s) => ({
        ...cells[s.cell],
        id: s.id,
        name: s.name,
      })),
      sources: this.sources.map((s) => ({ ...s })),
      banks: this.banks.map((b) => ({ ...b })),
    };
  }
}
