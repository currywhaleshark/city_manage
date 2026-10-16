import { TrafficSimulation } from "../simulation";
import {
  CONFIG,
  createDemand,
  DEFAULT_POLICY,
  seededRandom,
} from "../scenario";
import { BUILDABLE_PLOTS } from "../city/world";
import { validateParcelUses, type ParcelUse } from "../city/parcels";
import type { Pose, Trip, Vehicle } from "../types";
import {
  createPedestrianDemand,
  sidewalkDetour,
  walkingPose,
  walkingRoutes,
  type PedestrianTrip,
} from "./pedestrians";
import { applyPolicies, type PolicyDefinition } from "../policies/definition";

export const PARKING_MODEL_VERSION = "parking-v1";
export const PARKING_SITES = [
  {
    id: "school",
    name: "학교 앞",
    facilityId: "b6",
    routeId: "school-front",
    laneId: "n2-2_n3-2:n2-2:0",
    position: { x: 33, z: 4 },
    reason: "아이를 내려 주려는 짧은 정차가 겹쳐요.",
    durations: [90, 140],
    group: "등교하는 학생",
    opinion: "차를 피해 돌아가지 않고 학교에 가고 싶어요.",
  },
  {
    id: "market",
    name: "시장 옆 골목",
    facilityId: "b7",
    routeId: "school-side",
    laneId: "n3-1_n3-2:n3-2:0",
    position: { x: 52, z: -33 },
    reason: "장시간 주차와 잠깐 물건을 내리는 차가 함께 있어요.",
    durations: [320, 80],
    group: "시장 상인",
    opinion:
      "물건을 내릴 곳이 필요해요. 오래 세워 두는 차와 구분하면 좋겠어요.",
  },
  {
    id: "homes",
    name: "주거지 골목",
    facilityId: "b4",
    routeId: "homes",
    laneId: "n1-1_n1-2:n1-1:0",
    position: { x: -52, z: -15 },
    reason: "오래 머물 차량을 받아 줄 가까운 주차 자리가 부족해요.",
    durations: [420, 360],
    group: "주거지 주민",
    opinion: "주차할 곳도 필요하지만 공터에 공원이나 도서관도 생겼으면 해요.",
  },
] as const;
export interface ParkingPlan {
  siteId: string;
  patrolSite: string;
  loadingSite: string;
  reservedPlots?: readonly ParcelUse[];
}
export const DEFAULT_PARKING_PLAN: ParkingPlan = {
  siteId: "riverside",
  patrolSite: "school",
  loadingSite: "market",
};
interface Configuration {
  patrol: boolean;
  parkingLot: boolean;
  loadingBay: boolean;
}
export const PARKING_POLICIES: readonly PolicyDefinition<Configuration>[] = [
  {
    id: "patrol",
    scenarioId: "parking",
    title: "순찰 구역 지정",
    cost: 30,
    target: "선택한 현장 한 곳",
    description: "선택한 곳의 불법주차를 안내·단속해 40초 뒤부터 해소해요.",
    tradeoff: "다른 골목에는 적용되지 않고, 주차 자리는 늘지 않아요.",
    metrics: ["illegalSeconds"],
    available: () => true,
    apply: (s) => {
      s.patrol = true;
    },
  },
  {
    id: "parkingLot",
    scenarioId: "parking",
    title: "공동주차장 만들기",
    cost: 55,
    target: "선택한 공터 · 최소 400㎡",
    description:
      "공터 크기에 맞는 주차면을 만들어요. 목적지까지 걸을 수 있는 차량이 이용해요.",
    tradeoff:
      "같은 공터에 도서관·공원을 지을 수 없어요. 너무 멀면 빈자리가 있어도 이용하지 않아요.",
    metrics: ["legal", "walkDistance"],
    available: () => true,
    apply: (s) => {
      s.parkingLot = true;
    },
  },
  {
    id: "loadingBay",
    scenarioId: "parking",
    title: "잠깐 정차 공간 마련",
    cost: 25,
    target: "학교 앞 또는 시장 옆 · 1대",
    description:
      "기존 길 밖의 공간 한 곳을 승하차·하역용으로 정해 짧은 정차 차량을 받아요.",
    tradeoff:
      "150초 이내 정차만 가능하고 한 대가 이용하면 다른 차는 기다릴 자리가 필요해요.",
    metrics: ["legal"],
    available: () => true,
    apply: (s) => {
      s.loadingBay = true;
    },
  },
];
export interface ParkingRequest {
  id: number;
  siteId: string;
  surface: "road" | "sidewalk";
  duration: number;
  maxWalk: number;
  color: number;
}
export interface ParkingEpisode {
  request: ParkingRequest;
  destination: "illegal" | "lot" | "bay";
  phase: "parked" | "leaving" | "finished";
  pose: Pose;
  releaseAt: number;
  walkDistance: number;
  illegalSeconds: number;
  slot?: number;
}
export function createParkingDemand(seed: number): readonly ParkingRequest[] {
  const random = seededRandom(seed ^ 0x7061726b);
  return Object.freeze(
    PARKING_SITES.flatMap((site) =>
      site.durations.map((d, i) =>
        Object.freeze({
          id: 30000 + PARKING_SITES.indexOf(site) * 2 + i,
          siteId: site.id,
          surface: i ? ("sidewalk" as const) : ("road" as const),
          duration: d + Math.floor(random() * 20),
          maxWalk: d <= 150 ? 115 : 185,
          color: i ? 0xd99c55 : 0xc27462,
        }),
      ),
    ),
  );
}
export class ParkingSimulation extends TrafficSimulation {
  readonly scenarioId = "parking";
  plan: ParkingPlan;
  readonly policyIds: readonly string[];
  readonly cost: number;
  readonly configuration: Configuration;
  readonly parkingDemand: readonly ParkingRequest[];
  readonly episodes: ParkingEpisode[] = [];
  readonly parcelUses: readonly ParcelUse[];
  lotCapacity: number;
  constructor(
    readonly seed = 2404,
    ids: readonly string[] = [],
    plan: ParkingPlan = DEFAULT_PARKING_PLAN,
    demand: readonly Trip[] = createDemand(seed),
    walkers: readonly PedestrianTrip[] = createPedestrianDemand(seed),
    transport?: TrafficSimulation,
  ) {
    super(
      DEFAULT_POLICY,
      transport ? [] : demand,
      undefined,
      walkers,
      transport,
    );
    if (
      !BUILDABLE_PLOTS.some((p) => p.id === plan.siteId) ||
      !PARKING_SITES.some((p) => p.id === plan.patrolSite) ||
      !["school", "market"].includes(plan.loadingSite)
    )
      throw new Error("주차 정책의 적용 위치를 확인해 주세요.");
    const applied = applyPolicies(
      PARKING_POLICIES,
      ids,
      { patrol: false, parkingLot: false, loadingBay: false },
      100,
    );
    this.configuration = applied.state;
    this.cost = applied.cost;
    this.policyIds = Object.freeze([...ids]);
    this.plan = Object.freeze({
      ...plan,
      reservedPlots: Object.freeze(
        (plan.reservedPlots ?? []).map((p) => Object.freeze({ ...p })),
      ),
    });
    this.parcelUses = Object.freeze([
      ...this.plan.reservedPlots!,
      ...(applied.state.parkingLot
        ? [{ siteId: plan.siteId, kind: "parking" as const }]
        : []),
    ]);
    validateParcelUses(this.parcelUses);
    const plot = BUILDABLE_PLOTS.find((p) => p.id === plan.siteId)!;
    this.lotCapacity = applied.state.parkingLot
      ? Math.floor((plot.width * plot.depth) / 240)
      : 0;
    this.parkingDemand = createParkingDemand(seed);
    this.addRequests(this.parkingDemand);
  }
  addRequests(requests: readonly ParkingRequest[]) {
    const plan = this.plan,
      applied = { state: this.configuration };
    const plot = BUILDABLE_PLOTS.find((p) => p.id === plan.siteId)!;
    const occupiedSlots = new Set(
      this.episodes
        .filter((e) => e.destination === "lot" && e.phase === "parked")
        .map((e) => e.slot),
    );
    let slots = 0;
    while (occupiedSlots.has(slots)) slots++;
    let bayUsed = this.episodes.some(
      (e) => e.destination === "bay" && e.phase === "parked",
    );
    for (const request of requests) {
      if (
        this.episodes.some(
          (e) =>
            e.phase !== "finished" &&
            e.request.siteId === request.siteId &&
            e.request.surface === request.surface,
        )
      )
        continue;
      const site = PARKING_SITES.find((s) => s.id === request.siteId)!;
      const route =
        this.pedestrians.routes.get(site.routeId) ??
        walkingRoutes(this.network).find((r) => r.id === site.routeId)!;
      const lane = this.network.lanes.get(site.laneId)!;
      const walkDistance =
        Math.abs(plot.position.x - site.position.x) +
        Math.abs(plot.position.z - site.position.z);
      const bay =
        applied.state.loadingBay &&
        request.siteId === plan.loadingSite &&
        request.duration <= 150 &&
        !bayUsed;
      const lot =
        !bay && slots < this.lotCapacity && walkDistance <= request.maxWalk;
      const destination = bay ? "bay" : lot ? "lot" : "illegal";
      // New parked vehicles cannot materialize on top of a passing vehicle.
      if (
        this.transport &&
        destination === "illegal" &&
        request.surface === "road" &&
        [...this.vehicles.values()].some(
          (v) =>
            v.laneId === lane.id &&
            Math.abs(v.s - (lane.length - 7)) <
              CONFIG.carLength + CONFIG.minimumGap,
        )
      )
        continue;
      const sidewalk = walkingPose(route, 9);
      const pose = bay
        ? this.bayPose(site.id)
        : lot
          ? { x: plot.position.x - 8 + slots * 5, z: plot.position.z, angle: 0 }
          : request.surface === "road"
            ? this.lanePose(lane, lane.length - 7)
            : sidewalk;
      const episode: ParkingEpisode = {
        request,
        destination,
        phase: "parked",
        pose,
        releaseAt:
          this.time +
          (destination === "illegal" &&
          applied.state.patrol &&
          plan.patrolSite === site.id
            ? Math.min(request.duration, 40 + (request.id % 2) * 8)
            : request.duration),
        walkDistance: lot ? walkDistance : bay ? 12 : 0,
        illegalSeconds: 0,
        slot: lot ? slots : undefined,
      };
      if (lot) {
        occupiedSlots.add(slots);
        do {
          slots++;
        } while (occupiedSlots.has(slots));
      }
      if (bay) bayUsed = true;
      this.episodes.push(episode);
      if (destination === "illegal" && request.surface === "road") {
        const trip: Trip = {
          id: request.id,
          departAt: 0,
          origin: lane.from,
          destination: lane.to,
          purpose: "work",
          targetSpeed: 6.5,
          color: request.color,
        };
        const vehicle: Vehicle = {
          id: request.id,
          trip,
          laneId: lane.id,
          route: [lane.roadId],
          routeIndex: 0,
          s: lane.length - 7,
          speed: 0,
          acceleration: 0,
          maxAccel: 1.8,
          comfortBrake: 2.8,
          safetyGap: CONFIG.minimumGap,
          headway: 1.1,
          waitingTime: 0,
          enteredAt: 0,
          pose: { ...pose },
          previousPose: { ...pose },
        };
        this.vehicles.set(vehicle.id, vehicle);
        this.serviceJourneys.set(vehicle.id, {
          stopLaneId: lane.id,
          route: [lane.roadId],
          arrived: true,
        });
      }
      if (destination === "illegal" && request.surface === "sidewalk")
        this.pedestrians.detours.set(
          site.routeId,
          sidewalkDetour(route, this.network),
        );
    }
  }
  bayPose(siteId: string): Pose {
    const site = PARKING_SITES.find((s) => s.id === siteId)!;
    const route =
      this.pedestrians.routes.get(site.routeId) ??
      walkingRoutes(this.network).find((r) => r.id === site.routeId)!;
    const p = this.network.nodes.get(route.nodeId)!.position;
    return { x: p.x + 12, z: p.z + 13, angle: 0 };
  }
  override step() {
    for (const episode of this.episodes) {
      if (episode.phase !== "parked") continue;
      if (this.time + 1e-8 < episode.releaseAt) {
        if (episode.destination === "illegal")
          episode.illegalSeconds += CONFIG.dt;
        continue;
      }
      const site = PARKING_SITES.find((s) => s.id === episode.request.siteId)!;
      if (
        episode.destination === "illegal" &&
        episode.request.surface === "sidewalk"
      )
        this.pedestrians.detours.delete(site.routeId);
      if (this.vehicles.has(episode.request.id)) {
        const exit = [...this.network.lanes.values()].find(
          (l) => l.from === "boundary-west-0" && l.to === "outside-west-0",
        )!;
        if (
          this.dispatchService(
            episode.request.id,
            "",
            exit.id,
            episode.request.color,
          )
        )
          episode.phase = "leaving";
      } else episode.phase = "finished";
    }
    super.step();
    for (const episode of this.episodes)
      if (
        episode.phase === "leaving" &&
        this.serviceJourneys.get(episode.request.id)?.arrived
      ) {
        this.retireService(episode.request.id);
        episode.phase = "finished";
      }
  }
  get parkingStats() {
    const sites = PARKING_SITES.map((site) => {
      const cars = this.episodes.filter((e) => e.request.siteId === site.id);
      return {
        id: site.id,
        name: site.name,
        illegal: cars.filter(
          (e) => e.destination === "illegal" && e.phase === "parked",
        ).length,
        illegalSeconds: cars.reduce((n, e) => n + e.illegalSeconds, 0),
        legal: cars.filter((e) => e.destination !== "illegal").length,
        sidewalkBlocked: cars.some(
          (e) =>
            e.destination === "illegal" &&
            e.request.surface === "sidewalk" &&
            e.phase === "parked",
        ),
      };
    });
    return {
      time: this.time,
      cost: this.cost,
      total: this.episodes.length,
      parked: this.episodes.filter((e) => e.phase === "parked").length,
      leaving: this.episodes.filter((e) => e.phase === "leaving").length,
      finished: this.episodes.filter((e) => e.phase === "finished").length,
      illegal: sites.reduce((n, s) => n + s.illegal, 0),
      illegalSeconds: sites.reduce((n, s) => n + s.illegalSeconds, 0),
      legal: sites.reduce((n, s) => n + s.legal, 0),
      detouredPeople: this.pedestrians.detouredCount,
      extraWalkingDistance: this.pedestrians.extraWalkingDistance,
      parkingWalkDistance: this.episodes.reduce(
        (n, e) => n + e.walkDistance,
        0,
      ),
      lotCapacity: this.lotCapacity,
      lotUsed: this.episodes.filter((e) => e.destination === "lot").length,
      sites,
    };
  }
}
