import {
  WasteSimulation,
  WASTE_SITES,
  wasteLaneId,
  type WasteSite,
} from "./waste";
import { seededRandom } from "../../scenario";
import {
  applyPolicies,
  type PolicyDefinition,
} from "../../policies/definition";
import type { Network, Vec2 } from "../../types";

export const DUMPING_MODEL_VERSION = "illegal-dumping-v1";
export const OBSERVATION_ROUND_SECONDS = 300;
export const DUMPING_DURATION = 900;
export const DUMPING_SITES = [
  {
    id: "alley",
    name: "주택가 뒷골목",
    facilityId: "b4",
    position: { x: -85, z: 8 },
    binPosition: { x: -77, z: 8 },
    roadId: "n0-2_n1-2",
    from: "n0-2",
    awareness: 0.45,
    group: "골목 주민",
    opinion:
      "길가에 놓인 봉투를 치워 주세요. 어디에 내놓아야 하는지도 쉽게 알려 주세요.",
  },
  {
    id: "vacant",
    name: "공터 옆 길",
    facilityId: "b12",
    position: { x: -75, z: 105 },
    binPosition: { x: -69, z: 111 },
    roadId: "n0-4_n1-4",
    from: "n0-4",
    awareness: 0.7,
    group: "공터 옆 주민",
    opinion:
      "가까운 배출 장소가 필요해요. 새 장소에 쓰레기가 넘치지 않도록 수거도 함께 해 주세요.",
  },
  {
    id: "river",
    name: "새봄천 산책길",
    facilityId: "b7",
    position: { x: 104, z: 163 },
    binPosition: { x: 104, z: 180 },
    roadId: "n4-5_n4-6",
    from: "n4-5",
    awareness: 0.65,
    group: "환경미화원",
    opinion:
      "산책길도 치우고 집 앞 수거장도 돌아야 해요. 치운 곳에 또 버리지 않도록 함께 도와주세요.",
  },
] as const;
export type DumpingSiteId = (typeof DUMPING_SITES)[number]["id"];
export type DumpingPolicyId = "cleanup" | "dropoff" | "outreach";
export interface DumpingPlan {
  cleanup: DumpingSiteId;
  dropoff: DumpingSiteId;
  outreach: DumpingSiteId;
}
export const DEFAULT_DUMPING_PLAN: DumpingPlan = {
  cleanup: "river",
  dropoff: "river",
  outreach: "alley",
};
export const DUMPING_POLICIES: readonly PolicyDefinition<
  Record<DumpingPolicyId, boolean>
>[] = [
  {
    id: "cleanup",
    scenarioId: "dumping",
    title: "현장 먼저 청소",
    cost: 35,
    target: "선택한 투기 현장 한 곳",
    description: "기존 수거차가 이곳부터 방문해 이미 쌓인 봉투를 치워요.",
    tradeoff: "투기 원인은 남아요. 원래 방문하던 수거장은 더 기다릴 수 있어요.",
    metrics: ["illegalRemaining", "repeatDumped", "normalRemaining"],
    available: () => true,
    apply: (s) => {
      s.cleanup = true;
    },
  },
  {
    id: "dropoff",
    scenarioId: "dumping",
    title: "지정 배출 장소",
    cost: 45,
    target: "선택한 현장 옆 12㎡",
    description:
      "가까운 길가 공간에 16봉투를 담는 배출함을 놓고 수거 경로에 넣어요.",
    tradeoff:
      "모이면 넘칠 수 있고 방문할 곳도 늘어요. 넘친 정상 배출은 무단투기와 따로 세어요.",
    metrics: ["newDumped", "overflow"],
    available: () => true,
    apply: (s) => {
      s.dropoff = true;
    },
  },
  {
    id: "outreach",
    scenarioId: "dumping",
    title: "배출 안내 활동",
    cost: 30,
    target: "선택한 현장 주변 주민",
    description:
      "주민과 배출 방법을 알리고 함께 실천해요. 두 번째 관찰부터 일부 주민이 참여해요.",
    tradeoff:
      "이미 버린 봉투는 남아요. 배출 장소가 멀면 안내만으로 해결되지 않아요.",
    metrics: ["newDumped"],
    available: () => true,
    apply: (s) => {
      s.outreach = true;
    },
  },
];
export interface DisposalRequest {
  id: number;
  siteId: DumpingSiteId;
  time: number;
  amount: number;
  awareness: number;
  effort: number;
}
export function createDisposalDemand(seed: number): readonly DisposalRequest[] {
  const random = seededRandom(seed ^ 0x64756d70),
    requests: DisposalRequest[] = [];
  for (const site of DUMPING_SITES)
    for (let i = 0; i < 12; i++)
      requests.push(
        Object.freeze({
          id: requests.length,
          siteId: site.id,
          time: 20 + i * 72 + Math.floor(random() * 10),
          amount: 2 + Math.floor(random() * 4),
          awareness: random(),
          effort: random(),
        }),
      );
  return Object.freeze(requests.sort((a, b) => a.time - b.time || a.id - b.id));
}
export const dumpingBinPosition = (id: DumpingSiteId): Vec2 =>
  DUMPING_SITES.find((s) => s.id === id)!.binPosition;
const initialWaste = (seed: number, index: number) =>
  8 + Math.floor(seededRandom((seed ^ 0x70696c65) + index)() * 5);
function extraSites(seed: number): WasteSite[] {
  return DUMPING_SITES.flatMap((s, i) =>
    ["illegal", "designated"].map((kind) => ({
      id: `${kind}-${s.id}`,
      name: s.name + (kind === "illegal" ? " · 투기물" : " · 배출함"),
      facilityId: s.facilityId,
      laneId: wasteLaneId(s),
      kind: kind as "illegal" | "designated",
      capacity: kind === "designated" ? 16 : undefined,
      initial: kind === "illegal" ? initialWaste(seed, i) : 0,
      remaining: kind === "illegal" ? initialWaste(seed, i) : 0,
      generated: 0,
      collected: 0,
      rate: 0,
      participation: 0,
      lastCollectedAt: null,
      completedAt: null,
    })),
  );
}
export class DumpingSimulation extends WasteSimulation {
  override readonly scenarioId: string = "dumping";
  plan: Readonly<DumpingPlan>;
  readonly dumpingConfiguration: Record<DumpingPolicyId, boolean>;
  disposalDemand: readonly DisposalRequest[];
  readonly disposalEvents: {
    time: number;
    round: number;
    request: number;
    source: DumpingSiteId;
    destination: string;
    kind: "illegal" | "designated";
    reason: "rules" | "distance" | "proper";
    amount: number;
    repeat: boolean;
  }[] = [];
  readonly rounds: {
    round: number;
    time: number;
    illegalRemaining: number;
    newDumped: number;
    repeatDumped: number;
    overflow: number;
    normalRemaining: number;
  }[] = [];
  outreachStarts = OBSERVATION_ROUND_SECONDS;
  protected releasedDisposals = 0;
  private repeated = new Map<DumpingSiteId, number>();
  constructor(
    seed = 2404,
    ids: readonly string[] = [],
    plan: DumpingPlan = DEFAULT_DUMPING_PLAN,
    network?: Network,
    backgroundCount = 140,
  ) {
    const applied = applyPolicies(
      DUMPING_POLICIES,
      ids,
      { cleanup: false, dropoff: false, outreach: false },
      100,
    );
    if (
      ![plan.cleanup, plan.dropoff, plan.outreach].every((id) =>
        DUMPING_SITES.some((s) => s.id === id),
      )
    )
      throw new Error("지도에서 적용할 현장을 골라 주세요.");
    const order: string[] = [
      "school",
      "market",
      "north",
      "west",
      "outer",
      "south",
      ...DUMPING_SITES.map((s) => `illegal-${s.id}`),
    ];
    if (applied.state.cleanup) {
      order.splice(order.indexOf(`illegal-${plan.cleanup}`), 1);
      order.unshift(`illegal-${plan.cleanup}`);
    }
    if (applied.state.dropoff) order.splice(1, 0, `designated-${plan.dropoff}`);
    super(seed, ids, network, backgroundCount, {
      sites: extraSites(seed),
      order,
      cost: applied.cost,
    });
    this.plan = Object.freeze({ ...plan });
    this.dumpingConfiguration = applied.state;
    this.disposalDemand = createDisposalDemand(seed);
    for (const site of this.sites.filter((s) => !s.kind)) site.capacity = 40;
  }
  scheduleDisposals(requests: readonly DisposalRequest[]) {
    this.disposalDemand = [
      ...this.disposalDemand.slice(this.releasedDisposals),
      ...requests,
    ].sort((a, b) => a.time - b.time);
    this.releasedDisposals = 0;
  }
  get round() {
    return Math.min(
      3,
      Math.max(1, Math.ceil((this.time - 1e-7) / OBSERVATION_ROUND_SECONDS)),
    );
  }
  illegal(id: string) {
    return this.sites.find((s) => s.id === `illegal-${id}`)!;
  }
  bin(id: string) {
    return this.sites.find((s) => s.id === `designated-${id}`)!;
  }
  private normalPosition(site: WasteSite): Vec2 {
    const lane = this.network.lanes.get(site.laneId)!,
      p = this.lanePose(lane, lane.length - 7);
    return {
      x: p.x - Math.cos(p.angle) * 6.9,
      z: p.z + Math.sin(p.angle) * 6.9,
    };
  }
  protected dropoffCandidates(id: DumpingSiteId) {
    const site = DUMPING_SITES.find((s) => s.id === id)!;
    const targets = this.sites
      .filter((s) => !s.kind)
      .map((s) => ({ id: s.id, position: this.normalPosition(s) }));
    if (this.dumpingConfiguration.dropoff)
      targets.push({
        id: `designated-${this.plan.dropoff}`,
        position: dumpingBinPosition(this.plan.dropoff),
      });
    return targets
      .map((t) => ({
        id: t.id,
        distance:
          Math.abs(t.position.x - site.position.x) +
          Math.abs(t.position.z - site.position.z),
      }))
      .sort((a, b) => a.distance - b.distance);
  }
  nearestDropoff(id: DumpingSiteId) {
    return this.dropoffCandidates(id)[0];
  }
  protected communityAwareness(_siteId: DumpingSiteId) {
    return 0;
  }
  protected communityDisposal(_request: DisposalRequest) {}
  override step() {
    super.step();
    while (
      this.releasedDisposals < this.disposalDemand.length &&
      this.disposalDemand[this.releasedDisposals].time <= this.time + 1e-7
    ) {
      const request = this.disposalDemand[this.releasedDisposals++],
        site = DUMPING_SITES.find((s) => s.id === request.siteId)!,
        nearest = this.nearestDropoff(site.id);
      const baseAwareness = Math.min(
        0.95,
        site.awareness +
          (this.dumpingConfiguration.outreach &&
          this.plan.outreach === site.id &&
          this.time >= this.outreachStarts
            ? 0.3
            : 0),
      );
      const awareness = Math.min(
        0.95,
        baseAwareness + this.communityAwareness(site.id),
      );
      const proper =
        request.awareness < awareness &&
        nearest.distance <= 35 + request.effort * 115;
      const bucket = proper
        ? this.sites.find((s) => s.id === nearest.id)!
        : this.illegal(site.id);
      if (proper && request.awareness >= baseAwareness)
        this.communityDisposal(request);
      const repeat = !proper && bucket.completedAt !== null;
      bucket.generated += request.amount;
      bucket.remaining += request.amount;
      if (repeat)
        this.repeated.set(
          site.id,
          (this.repeated.get(site.id) ?? 0) + request.amount,
        );
      this.disposalEvents.push({
        time: this.time,
        round: this.round,
        request: request.id,
        source: site.id,
        destination: bucket.id,
        kind: proper ? "designated" : "illegal",
        reason: proper
          ? "proper"
          : request.awareness >= awareness
            ? "rules"
            : "distance",
        amount: request.amount,
        repeat,
      });
    }
    if (
      this.rounds.length < 3 &&
      this.time + 1e-7 >= (this.rounds.length + 1) * OBSERVATION_ROUND_SECONDS
    ) {
      const s = this.dumpingStats;
      this.rounds.push({
        round: this.rounds.length + 1,
        time: this.time,
        illegalRemaining: s.illegalRemaining,
        newDumped: s.newDumped,
        repeatDumped: s.repeatDumped,
        overflow: s.overflow,
        normalRemaining: s.normalRemaining,
      });
    }
  }
  get dumpingStats() {
    const all = this.wasteStats,
      normal = this.sites.filter((s) => !s.kind),
      legal = this.sites.filter((s) => s.kind !== "illegal"),
      illegal = this.sites.filter((s) => s.kind === "illegal");
    return {
      time: this.time,
      initial: all.initial,
      generated: all.generated,
      collected: all.collected,
      remaining: all.remaining,
      disposed: all.disposed,
      inTrucks: all.inTrucks,
      cost: this.cost,
      illegalRemaining: illegal.reduce((n, s) => n + s.remaining, 0),
      newDumped: illegal.reduce((n, s) => n + s.generated, 0),
      repeatDumped: [...this.repeated.values()].reduce((n, v) => n + v, 0),
      normalRemaining: normal.reduce((n, s) => n + s.remaining, 0),
      designatedStored: legal.reduce(
        (n, s) => n + Math.min(s.remaining, s.capacity!),
        0,
      ),
      overflow: legal.reduce(
        (n, s) => n + Math.max(0, s.remaining - s.capacity!),
        0,
      ),
      sites: DUMPING_SITES.map((s) => {
        const pile = this.illegal(s.id),
          bin = this.bin(s.id);
        return {
          id: s.id,
          name: s.name,
          initial: pile.initial,
          newDumped: pile.generated,
          remaining: pile.remaining,
          collected: pile.collected,
          repeatDumped: this.repeated.get(s.id) ?? 0,
          firstClearedAt: pile.completedAt,
          nearestDistance: this.nearestDropoff(s.id).distance,
          binRemaining: bin.remaining,
          binOverflow: Math.max(0, bin.remaining - 16),
        };
      }),
      normalSites: normal.map((s) => ({
        id: s.id,
        name: s.name,
        remaining: s.remaining,
        collected: s.collected,
        lastCollectedAt: s.lastCollectedAt,
      })),
    };
  }
}
