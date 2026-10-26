import { TrafficSimulation } from "../../simulation";
import { DEFAULT_POLICY, seededRandom } from "../../scenario";
import { CITY_FACILITIES, type DistrictId } from "../../city/data";
import { BUILDABLE_PLOTS } from "../../city/world";
import {
  applyPolicies,
  type PolicyDefinition,
} from "../../policies/definition";
import {
  connectBlock,
  corner,
  createWalkingNetwork,
  type WalkPoint,
  type WalkRoute,
} from "./walking";

export const FACILITY_MODEL_VERSION = "facility-access-v2";
export const WALK_LIMIT_SECONDS = 300;
/** A fee at parks the city built: fewer residents visit, each pays per day. */
export const PARK_FEE_USE = 0.6;
export const PARK_FEE_PER_VISITOR = 0.2;
export type ServiceKind = "library" | "park";
export const SERVICE_NAMES = { library: "도서관", park: "공원" };
export const FACILITY_SITES = BUILDABLE_PLOTS;
export const FACILITY_FOOTPRINT = { library: 400, park: 900 } as const;
export interface PlannedFacility {
  siteId: string;
  kind: ServiceKind;
}
export interface FacilityPlan {
  siteId: string;
  buildings?: readonly PlannedFacility[];
}
export const DEFAULT_FACILITY_PLAN: FacilityPlan = { siteId: "north" };
export function plannedFacilities(
  ids: readonly string[],
  plan: FacilityPlan,
): readonly PlannedFacility[] {
  return (
    plan.buildings ??
    ids
      .filter((id): id is ServiceKind => id === "library" || id === "park")
      .map((kind) => ({ siteId: plan.siteId, kind }))
  );
}
export function facilityPlanCost(ids: readonly string[], plan: FacilityPlan) {
  return (
    plannedFacilities(ids, plan).reduce(
      (n, b) => n + (b.kind === "library" ? 55 : 35),
      0,
    ) +
    (ids.includes("expand") ? 35 : 0) +
    (ids.includes("gate") ? 20 : 0)
  );
}
export interface FacilityConfiguration {
  library: boolean;
  park: boolean;
  expand: boolean;
  gate: boolean;
}
export const FACILITY_POLICIES: readonly PolicyDefinition<FacilityConfiguration>[] =
  [
    {
      id: "library",
      scenarioId: "facilities",
      title: "작은도서관 신설",
      cost: 55,
      target: "선택한 공터 · 400㎡ 필요",
      description:
        "책을 읽는 시설을 새로 만들고 하루 이용 자리를 140명분 늘려요.",
      tradeoff:
        "이 공터는 다른 시설에 쓸 수 없어요. 멀리 사는 주민은 여전히 걸어가기 어려울 수 있어요.",
      metrics: ["served", "nearestMinutes"],
      available: () => true,
      apply: (s) => {
        s.library = true;
      },
    },
    {
      id: "park",
      scenarioId: "facilities",
      title: "동네 공원 조성",
      cost: 35,
      target: "선택한 공터 · 900㎡ 필요",
      description:
        "쉬거나 가볍게 운동할 수 있는 공원을 만들어요. 하루 160명분의 이용 자리가 생겨요.",
      tradeoff:
        "900㎡ 이상의 넓은 공터가 필요해요. 도서관이 필요한 주민에게는 직접적인 도움이 되지 않아요.",
      metrics: ["served", "unserved"],
      available: () => true,
      apply: (s) => {
        s.park = true;
      },
    },
    {
      id: "expand",
      scenarioId: "facilities",
      title: "기존 도서관 확장",
      cost: 35,
      target: "남쪽 작은도서관",
      description: "기존 건물에 이용 공간을 더해 하루 100명분의 자리를 늘려요.",
      tradeoff: "자리가 늘어도 도서관까지 걷는 거리는 그대로예요.",
      metrics: ["capacity", "capacityShortfall"],
      available: () => true,
      apply: (s) => {
        s.expand = true;
      },
    },
    {
      id: "gate",
      scenarioId: "facilities",
      title: "서쪽 출입로 개방",
      cost: 20,
      target: "남쪽 작은도서관",
      description: "도서관의 서쪽 보도와 출입구를 연결해 돌아가는 길을 줄여요.",
      tradeoff:
        "이용 자리는 늘지 않아요. 길이 가까워져도 정원이 모자랄 수 있어요.",
      metrics: ["nearestMinutes", "reachable", "capacityShortfall"],
      available: () => true,
      apply: (s) => {
        s.gate = true;
      },
    },
  ];
export interface PublicFacility {
  id: string;
  name: string;
  kind: ServiceKind;
  position: WalkPoint;
  capacity: number;
  isNew: boolean;
  siteId?: string;
}
export interface FacilityNeighborhood {
  id: string;
  name: string;
  position: WalkPoint;
  districtId: DistrictId;
  population: number;
  needs: Record<ServiceKind, number>;
}
export interface AccessRow {
  id: string;
  name: string;
  districtId: DistrictId;
  population: number;
  reachable: number;
  served: number;
  unserved: number;
  capacityShortfall: number;
  averageNearestSeconds: number | null;
  services: Record<
    ServiceKind,
    {
      demand: number;
      served: number;
      nearest: { facilityId: string; route: WalkRoute } | null;
    }
  >;
}
export class FacilitySimulation extends TrafficSimulation {
  readonly scenarioId = "facilities";
  readonly policyIds: readonly string[];
  readonly configuration: FacilityConfiguration;
  readonly plan: Readonly<FacilityPlan>;
  readonly cost: number;
  readonly walking = createWalkingNetwork();
  readonly neighborhoods: readonly FacilityNeighborhood[];
  readonly facilities: PublicFacility[];
  readonly access: AccessRow[];
  readonly allocations: {
    neighborhoodId: string;
    facilityId: string;
    count: number;
    seconds: number;
  }[] = [];
  constructor(
    readonly seed = 2404,
    policyIds: readonly string[] = [],
    plan: FacilityPlan = DEFAULT_FACILITY_PLAN,
    budget = 100,
    readonly options: { parkFee?: boolean } = {},
  ) {
    // Planning has no elapsed travel simulation; whole-population access is calculated, never animated.
    super(DEFAULT_POLICY, [], undefined, []);
    if (!FACILITY_SITES.some((s) => s.id === plan.siteId))
      throw new Error("지정된 건설 부지를 골라 주세요.");
    const buildings = plannedFacilities(policyIds, plan);
    validateParcelUses(buildings);
    const used = new Set<string>();
    for (const building of buildings) {
      const site = FACILITY_SITES.find((s) => s.id === building.siteId);
      if (!site || !["library", "park"].includes(building.kind))
        throw new Error("지정된 공터와 시설을 골라 주세요.");
      if (used.has(site.id))
        throw new Error("한 부지에는 한 시설만 지을 수 있어요.");
      if (site.width * site.depth < FACILITY_FOOTPRINT[building.kind])
        throw new Error("이 공터는 시설을 짓기에 면적이 부족해요.");
      used.add(site.id);
    }
    for (const kind of ["library", "park"] as const)
      if (policyIds.includes(kind) !== buildings.some((b) => b.kind === kind))
        throw new Error("선택한 시설과 건설 계획이 일치하지 않아요.");
    this.plan = Object.freeze({
      ...plan,
      buildings: Object.freeze(buildings.map((b) => Object.freeze({ ...b }))),
    });
    this.policyIds = Object.freeze([...policyIds]);
    const applied = applyPolicies(
      FACILITY_POLICIES,
      policyIds,
      { library: false, park: false, expand: false, gate: false },
      budget,
    );
    this.configuration = applied.state;
    this.cost = facilityPlanCost(policyIds, this.plan);
    if (this.cost > budget)
      throw new Error("예산 100 안에서 건설 계획을 정해 주세요.");
    const random = seededRandom(seed ^ 0x666163);
    this.neighborhoods = CITY_FACILITIES.filter((f) => f.population > 0).map(
      (f, i) => {
        const population = f.population;
        const readers = Math.round(population * (0.35 + random() * 0.3));
        connectBlock(this.walking, f.id, f.position);
        return {
          id: f.id,
          name:
            [
              "북쪽 첫 마을",
              "학교 가는 길 서쪽",
              "학교 가는 길 안쪽",
              "서쪽 끝 마을",
              "공원 건너 마을",
              "남쪽 끝 마을",
              "남쪽 안쪽 마을",
            ][i] ?? f.name,
          position: f.position,
          districtId: f.districtId,
          population,
          needs: { library: readers, park: population - readers },
        };
      },
    );
    this.facilities = [
      {
        id: "library-existing",
        name: "남쪽 작은도서관",
        kind: "library",
        position: { x: 72, z: 108 },
        capacity: 80 + (this.configuration.expand ? 100 : 0),
        isNew: false,
      },
      {
        id: "park-north",
        name: "북쪽 초록 공원",
        kind: "park",
        position: { x: -24, z: -72 },
        capacity: 90,
        isNew: false,
      },
      {
        id: "park-east",
        name: "공원·일터 구역 공원",
        kind: "park",
        position: { x: 24, z: 24 },
        capacity: 100,
        isNew: false,
      },
    ];
    this.walking.addPoint("library-existing", { x: 72, z: 108 });
    this.walking.addPoint("library-east-gate", { x: 89.8, z: 108 });
    this.walking.connect("library-existing", "library-east-gate");
    this.walking.connect("library-east-gate", corner(4, 4, "sw"));
    if (this.configuration.gate) {
      this.walking.addPoint("library-west-gate", { x: 54.2, z: 108 });
      this.walking.connect("library-existing", "library-west-gate");
      this.walking.connect("library-west-gate", corner(3, 4, "se"));
    }
    for (const facility of this.facilities.filter((f) => f.kind === "park"))
      connectBlock(this.walking, facility.id, facility.position);
    for (const [i, building] of buildings.entries()) {
      const site = FACILITY_SITES.find((s) => s.id === building.siteId)!;
      const kind = building.kind;
      const facility: PublicFacility = {
        id: i === 0 ? "facility-new" : `facility-${site.id}`,
        siteId: site.id,
        name: `${site.name} ${SERVICE_NAMES[kind]}`,
        kind,
        position: { ...site.position },
        capacity: kind === "library"
          ? 140
          : Math.round(160 * (options.parkFee ? PARK_FEE_USE : 1)),
        isNew: true,
      };
      this.facilities.push(facility);
      connectBlock(this.walking, facility.id, facility.position);
    }
    const candidates: {
      neighborhoodId: string;
      facilityId: string;
      kind: ServiceKind;
      route: WalkRoute;
    }[] = [];
    this.access = this.neighborhoods.map((n) => {
      const services = {} as AccessRow["services"];
      let reachable = 0,
        totalSeconds = 0,
        timedDemand = 0;
      for (const kind of ["library", "park"] as const) {
        const routes = this.facilities
          .filter((f) => f.kind === kind)
          .map((f) => ({
            facilityId: f.id,
            route: this.walking.route(n.id, f.id),
          }))
          .filter((r) => r.route !== null)
          .sort(
            (a, b) =>
              a.route!.seconds - b.route!.seconds ||
              a.facilityId.localeCompare(b.facilityId),
          );
        const nearest = routes[0]
          ? { facilityId: routes[0].facilityId, route: routes[0].route! }
          : null;
        services[kind] = { demand: n.needs[kind], served: 0, nearest };
        if (nearest) {
          totalSeconds += nearest.route.seconds * n.needs[kind];
          timedDemand += n.needs[kind];
        }
        if (nearest && nearest.route.seconds <= WALK_LIMIT_SECONDS + 1e-8)
          reachable += n.needs[kind];
        for (const route of routes)
          if (route.route!.seconds <= WALK_LIMIT_SECONDS + 1e-8)
            candidates.push({
              neighborhoodId: n.id,
              facilityId: route.facilityId,
              kind,
              route: route.route!,
            });
      }
      return {
        id: n.id,
        name: n.name,
        districtId: n.districtId,
        population: n.population,
        reachable,
        served: 0,
        unserved: n.population,
        capacityShortfall: 0,
        averageNearestSeconds: timedDemand ? totalSeconds / timedDemand : null,
        services,
      };
    });
    // Transparent, deterministic nearest-path allocation. No global approval score or policy bonus.
    const remaining = new Map(this.facilities.map((f) => [f.id, f.capacity]));
    candidates.sort(
      (a, b) =>
        a.route.seconds - b.route.seconds ||
        a.neighborhoodId.localeCompare(b.neighborhoodId) ||
        a.facilityId.localeCompare(b.facilityId),
    );
    for (const candidate of candidates) {
      const row = this.access.find((n) => n.id === candidate.neighborhoodId)!;
      const service = row.services[candidate.kind];
      const count = Math.min(
        service.demand - service.served,
        remaining.get(candidate.facilityId)!,
      );
      if (count <= 0) continue;
      service.served += count;
      row.served += count;
      remaining.set(
        candidate.facilityId,
        remaining.get(candidate.facilityId)! - count,
      );
      this.allocations.push({
        neighborhoodId: row.id,
        facilityId: candidate.facilityId,
        count,
        seconds: candidate.route.seconds,
      });
    }
    for (const row of this.access) {
      row.unserved = row.population - row.served;
      row.capacityShortfall = row.reachable - row.served;
    }
  }
  /** Residents who visit fee-charging parks (new parks only). */
  get paidParkVisitors() {
    if (!this.options.parkFee) return 0;
    const paid = new Set(
      this.facilities.filter((f) => f.isNew && f.kind === "park").map((f) => f.id),
    );
    return this.allocations
      .filter((a) => paid.has(a.facilityId))
      .reduce((n, a) => n + a.count, 0);
  }
  get facilityStats() {
    const population = this.access.reduce((n, r) => n + r.population, 0);
    const served = this.access.reduce((n, r) => n + r.served, 0),
      reachable = this.access.reduce((n, r) => n + r.reachable, 0);
    return {
      round: 1,
      population,
      served,
      reachable,
      unserved: population - served,
      capacityShortfall: reachable - served,
      outsideRange: population - reachable,
      coverage: (served / population) * 100,
      capacity: this.facilities.reduce((n, f) => n + f.capacity, 0),
      averageNearestSeconds:
        this.access.reduce(
          (n, r) => n + (r.averageNearestSeconds ?? 0) * r.population,
          0,
        ) / population,
      cost: this.cost,
      remainingBudget: 100 - this.cost,
      plots: FACILITY_SITES.map((s) => ({
        id: s.id,
        name: s.name,
        area: s.width * s.depth,
        kind: this.plan.buildings?.find((b) => b.siteId === s.id)?.kind ?? null,
      })),
      usedPlots: this.plan.buildings!.length,
      freePlots: FACILITY_SITES.length - this.plan.buildings!.length,
      usedLand: this.plan.buildings!.reduce((n, b) => {
        const s = FACILITY_SITES.find((s) => s.id === b.siteId)!;
        return n + s.width * s.depth;
      }, 0),
      neighborhoods: this.access,
      facilities: this.facilities.map((f) => ({
        ...f,
        used: this.allocations
          .filter((a) => a.facilityId === f.id)
          .reduce((n, a) => n + a.count, 0),
      })),
      rules: {
        walkSpeedMetersPerSecond: 1.2,
        estimatedCrossingSeconds: 15,
        walkLimitSeconds: WALK_LIMIT_SECONDS,
        allocation: "shortest-path-first",
        dailyPrimaryActivity: true,
      },
    };
  }
}
import { validateParcelUses } from "../../city/parcels";
