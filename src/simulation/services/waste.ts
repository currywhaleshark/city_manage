import { TrafficSimulation } from "../../simulation";
import {
  CONFIG,
  createDemand,
  DEFAULT_POLICY,
  seededRandom,
} from "../../scenario";
import { createPedestrianDemand } from "../pedestrians";
import { CITY_FACILITIES } from "../../city/data";
import type { PolicyDefinition } from "../../policies/definition";
import { applyPolicies } from "../../policies/definition";
import type { Network } from "../../types";
import { WASTE_DEPOT } from "../../city/world";

export const WASTE_MODEL_VERSION = "waste-services-v2";
export const WASTE_SITES = [
  {
    id: "north",
    name: "북쪽 주택가",
    facilityId: "b0",
    roadId: "n0-1_n1-1",
    from: "n0-1",
  },
  {
    id: "west",
    name: "학교 가는 길 주택가",
    facilityId: "b4",
    roadId: "n0-2_n1-2",
    from: "n0-2",
  },
  {
    id: "outer",
    name: "서쪽 끝 주택가",
    facilityId: "b8",
    roadId: "n0-3_n1-3",
    from: "n0-3",
  },
  {
    id: "south",
    name: "남쪽 주택가",
    facilityId: "b12",
    roadId: "n0-4_n1-4",
    from: "n0-4",
  },
  {
    id: "market",
    name: "동쪽 상점가",
    facilityId: "b7",
    roadId: "n4-1_n4-2",
    from: "n4-2",
  },
  {
    id: "school",
    name: "학교 앞 수거장",
    facilityId: "b6",
    roadId: "n2-2_n3-2",
    from: "n2-2",
  },
] as const;
const DEPOT = WASTE_DEPOT;
export const wasteLaneId = (site: { roadId: string; from: string }) =>
  `${site.roadId}:${site.from}:0`;
export interface WasteConfiguration {
  trucks: number;
  reordered: boolean;
  reduction: boolean;
}
export const WASTE_POLICIES: readonly PolicyDefinition<WasteConfiguration>[] = [
  {
    id: "extraTruck",
    scenarioId: "waste",
    title: "쓰레기차 추가 투입",
    cost: 45,
    target: "수거차 2대 → 3대",
    description: "한 대를 더 보내 수거 구역을 나누어 맡아요.",
    tradeoff: "도로를 함께 쓰는 차가 늘고 운행 비용도 들어요.",
    metrics: ["collected", "travelTime", "traffic"],
    available: () => true,
    apply: (s) => {
      s.trucks++;
    },
  },
  {
    id: "route",
    scenarioId: "waste",
    title: "수거 순서 조정",
    cost: 20,
    target: "외곽과 남쪽을 먼저",
    description: "학교·상가부터 돌던 차가 남쪽·서쪽부터 방문해요.",
    tradeoff: "먼저 수거하던 학교와 상점가는 더 기다릴 수 있어요.",
    metrics: ["remainingBySite", "travelTime"],
    available: () => true,
    apply: (s) => {
      s.reordered = true;
    },
  },
  {
    id: "reduce",
    scenarioId: "waste",
    title: "분리배출·쓰레기 줄이기",
    cost: 35,
    target: "여섯 수거 지역",
    description: "주민이 참여한 만큼 새로 나오는 일반 쓰레기를 줄여요.",
    tradeoff: "이미 쌓인 쓰레기는 그대로예요. 지역마다 참여 정도도 달라요.",
    metrics: ["generated", "remainingBySite"],
    available: () => true,
    apply: (s) => {
      s.reduction = true;
    },
  },
];
export interface WasteSite {
  kind?: "illegal" | "designated";
  capacity?: number;
  id: string;
  name: string;
  facilityId: string;
  laneId: string;
  initial: number;
  generated: number;
  collected: number;
  remaining: number;
  rate: number;
  participation: number;
  lastCollectedAt: number | null;
  completedAt: number | null;
}
export interface WasteTruck {
  id: number;
  name: string;
  capacity: number;
  load: number;
  collected: number;
  itinerary: string[];
  nextIndex: number;
  target: string;
  phase: "driving" | "collecting" | "unloading" | "finished" | "blocked";
  departedAt: number;
  serviceStarted: number;
  journeys: { target: string; seconds: number }[];
  /** Taken out of service: return to the depot, unload and stay there. */
  retired?: boolean;
}
export class WasteSimulation extends TrafficSimulation {
  readonly scenarioId: string = "waste";
  readonly sites: WasteSite[];
  readonly trucks: WasteTruck[] = [];
  readonly configuration: WasteConfiguration;
  /** Share of the usual waste made right now (the living city's quiet nights). */
  generationFactor: () => number = () => 1;
  readonly policyIds: readonly string[];
  readonly cost: number;
  disposed = 0;
  readonly serviceEvents: {
    time: number;
    truck: number;
    site: string;
    type: "arrival" | "collect" | "unload";
    amount: number;
    load: number;
  }[] = [];
  constructor(
    readonly seed = 2404,
    policyIds: readonly string[] = [],
    network?: Network,
    backgroundCount = 140,
    setup?: { sites: WasteSite[]; order: string[]; cost: number },
  ) {
    super(
      DEFAULT_POLICY,
      createDemand(seed, backgroundCount),
      network,
      createPedestrianDemand(seed),
    );
    const applied = setup
      ? {
          state: { trucks: 2, reordered: false, reduction: false },
          cost: setup.cost,
        }
      : applyPolicies(
          WASTE_POLICIES,
          policyIds,
          { trucks: 2, reordered: false, reduction: false },
          100,
        );
    this.configuration = applied.state;
    this.cost = applied.cost;
    this.policyIds = Object.freeze([...policyIds]);
    const random = seededRandom(seed ^ 0x77617374);
    this.sites = WASTE_SITES.map((site) => {
      const initial = 26 + Math.floor(random() * 14);
      return {
        ...site,
        laneId: wasteLaneId(site),
        initial,
        generated: 0,
        collected: 0,
        remaining: initial,
        rate: (0.8 + random() * 0.8) / 60,
        participation: 0.25 + random() * 0.5,
        lastCollectedAt: null,
        completedAt: null,
      };
    });
    if (setup) this.sites.push(...setup.sites);
    const order =
      setup?.order ??
      (this.configuration.reordered
        ? ["south", "outer", "west", "north", "market", "school"]
        : ["school", "market", "north", "west", "outer", "south"]);
    for (let i = 0; i < this.configuration.trucks; i++) {
      const truck: WasteTruck = {
        id: 10000 + i,
        name: `${i + 1}호 수거차`,
        capacity: 55,
        load: 0,
        collected: 0,
        itinerary: order.filter(
          (_, index) => index % this.configuration.trucks === i,
        ),
        nextIndex: 0,
        target: "",
        phase: "driving",
        departedAt: 0,
        serviceStarted: 0,
        journeys: [],
      };
      this.trucks.push(truck);
      this.dispatch(truck, truck.itinerary[0]);
    }
  }
  protected dispatch(truck: WasteTruck, target: string) {
    const laneId =
      target === "depot"
        ? wasteLaneId(DEPOT)
        : this.sites.find((s) => s.id === target)!.laneId;
    truck.target = target;
    truck.departedAt = this.time;
    const sent = this.dispatchService(truck.id, WASTE_DEPOT.origin, laneId);
    truck.phase = sent ? "driving" : "blocked";
  }
  override step() {
    super.step();
    const factor = this.generationFactor();
    for (const site of this.sites) {
      const amount =
        site.rate *
        CONFIG.dt *
        factor *
        (this.configuration.reduction ? 1 - 0.6 * site.participation : 1);
      site.generated += amount;
      site.remaining += amount;
    }
    for (const truck of this.trucks) {
      if (truck.phase === "blocked" || truck.phase === "finished") continue;
      const stop = this.serviceJourneys.get(truck.id);
      if (!stop?.arrived) continue;
      if (truck.phase === "driving") {
        truck.journeys.push({
          target: truck.target,
          seconds: this.time - truck.departedAt,
        });
        truck.phase = truck.target === "depot" ? "unloading" : "collecting";
        truck.serviceStarted = this.time;
        this.serviceEvents.push({
          time: this.time,
          truck: truck.id,
          site: truck.target,
          type: "arrival",
          amount: 0,
          load: truck.load,
        });
        continue;
      }
      if (truck.phase === "collecting") {
        const site = this.sites.find((s) => s.id === truck.target)!;
        const amount = Math.min(
          site.remaining,
          truck.capacity - truck.load,
          0.9 * CONFIG.dt,
        );
        if (amount > 0) {
          site.remaining -= amount;
          site.collected += amount;
          truck.load += amount;
          truck.collected += amount;
          site.lastCollectedAt = this.time;
          this.serviceEvents.push({
            time: this.time,
            truck: truck.id,
            site: site.id,
            type: "collect",
            amount,
            load: truck.load,
          });
        }
        if (site.remaining < 0.001 || truck.load >= truck.capacity - 1e-8) {
          if (site.remaining < 0.001) {
            site.completedAt = this.time;
            truck.nextIndex++;
          }
          this.dispatch(
            truck,
            truck.retired ||
              truck.load >= truck.capacity - 1e-8 ||
              truck.nextIndex >= truck.itinerary.length
              ? "depot"
              : truck.itinerary[truck.nextIndex],
          );
        }
      } else if (this.time - truck.serviceStarted >= 18) {
        this.disposed += truck.load;
        this.serviceEvents.push({
          time: this.time,
          truck: truck.id,
          site: "depot",
          type: "unload",
          amount: truck.load,
          load: 0,
        });
        truck.load = 0;
        if (truck.retired || truck.nextIndex >= truck.itinerary.length) {
          truck.phase = "finished";
          this.retireService(truck.id);
        } else this.dispatch(truck, truck.itinerary[truck.nextIndex]);
      }
    }
  }
  get wasteStats() {
    const initial = this.sites.reduce((n, s) => n + s.initial, 0),
      generated = this.sites.reduce((n, s) => n + s.generated, 0),
      collected = this.sites.reduce((n, s) => n + s.collected, 0);
    const journeys = this.trucks.flatMap((t) => t.journeys);
    return {
      time: this.time,
      initial,
      generated,
      collected,
      remaining: initial + generated - collected,
      collectionRate: (collected / (initial + generated)) * 100,
      clearedSites: this.sites.filter((s) => s.remaining < 1).length,
      visitedSites: this.sites.filter((s) => s.lastCollectedAt !== null).length,
      completedSites: this.sites.filter((s) => s.completedAt !== null).length,
      disposed: this.disposed,
      inTrucks: this.trucks.reduce((n, t) => n + t.load, 0),
      trucks: this.trucks.length,
      averageTravelTime: journeys.length
        ? journeys.reduce((n, j) => n + j.seconds, 0) / journeys.length
        : null,
      unfinishedJourneys: this.trucks.filter(
        (t) => t.phase === "driving" || t.phase === "blocked",
      ).length,
      cost: this.cost,
      sites: this.sites.map((s) => ({
        id: s.id,
        name: s.name,
        facilityId: s.facilityId,
        districtId: CITY_FACILITIES.find((f) => f.id === s.facilityId)!
          .districtId,
        initial: s.initial,
        generated: s.generated,
        collected: s.collected,
        remaining: s.remaining,
        participation: s.participation,
        lastCollectedAt: s.lastCollectedAt,
        completedAt: s.completedAt,
      })),
    };
  }
}
