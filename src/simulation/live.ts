import {
  DumpingSimulation,
  DUMPING_SITES,
  createDisposalDemand,
  type DumpingSiteId,
  type DisposalRequest,
} from "./services/dumping";
import {
  ParkingSimulation,
  PARKING_SITES,
  createParkingDemand,
} from "./parking";
import { LogisticsSimulation } from "./economy";
import { WaterSimulation, WATER_SOURCES, waterTargets } from "./water";
import { FacilitySimulation, type PlannedFacility } from "./facilities";
import { BUILDABLE_PLOTS } from "../city/world";
import { validateParcelUses, type ParcelUse } from "../city/parcels";
import { createDemand, SCHOOL_NODE } from "../scenario";
import {
  createCityDemand,
  CITY_TRAFFIC_INTERVAL,
  CITY_TRAFFIC_COUNT,
} from "./city-demand";
import { createPedestrianDemand } from "./pedestrians";
import type { ResidentVoice } from "./residents";
import type { PlacementTarget } from "../renderer/placement";
import type { AppliedPolicyMap } from "../policies/map";
import { cityChangeText } from "./change-messages";
import {
  ResidentsCouncil,
  COMMUNITY_PROJECTS,
  COMMUNITY_METHODS,
  communityTargets,
  type CommunityDecision,
} from "./community";

export type Topic = "parking" | "waste" | "water" | "supply" | "access";
// Simulation seconds: at the default 4× speed, watch for 30s before the first story.
export const CITY_PACING = {
  observe: 120,
  persistent: 40,
  interval: 100,
  speaking: 80,
} as const;
export const TOPICS: Record<Topic, string> = {
  parking: "길과 주차",
  waste: "쓰레기",
  water: "하천",
  supply: "상점과 물자",
  access: "생활 시설",
};
export const LIVE_POLICIES = [
  {
    id: "signal",
    topic: "parking",
    title: "초록불 시간 조절",
    cost: 15,
    description: "학교 앞 동서 방향 초록불을 7초에서 26초로 늘려요.",
    tradeoff:
      "남북 방향 초록불은 25초에서 10초로 줄어요. 다른 방향의 대기도 살펴봐요.",
  },
  {
    id: "patrol",
    topic: "parking",
    title: "순찰 구역 지정",
    cost: 30,
    description:
      "선택한 곳의 불법주차에 안내·단속을 해요. 지금 있는 차도 40초 뒤부터 떠나요.",
    tradeoff: "주차 자리는 늘지 않아요. 새로 오는 차도 계속 살펴야 해요.",
  },
  {
    id: "parkingLot",
    topic: "parking",
    title: "공동주차장",
    cost: 55,
    description:
      "공터에 주차장을 지어요. 이후 도착하는 차가 거리와 빈자리를 보고 이용해요.",
    tradeoff: "같은 공터에 공원이나 도서관을 지을 수 없어요.",
  },
  {
    id: "loadingBay",
    topic: "parking",
    title: "잠깐 정차 공간",
    cost: 25,
    description: "학교나 시장 옆에 150초 이내 정차할 자리 한 곳을 마련해요.",
    tradeoff: "오래 머무는 차와 이미 자리를 잡은 차에는 도움이 되지 않아요.",
  },
  {
    id: "cleanup",
    topic: "waste",
    title: "이곳 먼저 수거",
    cost: 15,
    description: "운행 중인 수거차가 다음 방문 때 이 현장으로 가요.",
    tradeoff: "다른 수거장은 더 기다릴 수 있어요. 새로 버리는 원인은 남아요.",
  },
  {
    id: "dropoff",
    topic: "waste",
    title: "지정 배출 장소",
    cost: 45,
    description: "16봉투를 담을 배출함을 만들고 수거 경로에 넣어요.",
    tradeoff:
      "가득 차면 새 배출이 다른 곳으로 향할 수 있어요. 수거도 함께 살펴요.",
  },
  {
    id: "outreach",
    topic: "waste",
    title: "배출 안내 활동",
    cost: 30,
    description:
      "선택한 동네에 배출 방법을 알려요. 60초 뒤부터 일부 주민이 참여해요.",
    tradeoff: "이미 쌓인 봉투는 남고, 배출 장소가 멀면 안내만으로 부족해요.",
  },
  {
    id: "extraTruck",
    topic: "waste",
    title: "수거차 한 대 추가",
    cost: 45,
    description: "수거차가 가장 많이 쌓인 곳부터 새로운 순회를 시작해요.",
    tradeoff: "추가 차량도 같은 도로를 이용하므로 막힌 길에서는 기다려요.",
  },
  {
    id: "reduce",
    topic: "waste",
    title: "쓰레기 줄이기",
    cost: 35,
    description: "도시 전체에서 참여하는 주민의 새 생활 쓰레기가 줄어요.",
    tradeoff: "이미 쌓인 쓰레기는 수거해야 해요.",
  },
  {
    id: "outlet",
    topic: "water",
    title: "배출구 정화 장치",
    cost: 45,
    description: "선택한 작업장 배출구에서 60초 뒤부터 오염 물질을 걸러요.",
    tradeoff: "처리량에는 한계가 있어요. 물이 하류까지 흐르는 시간도 필요해요.",
  },
  {
    id: "sewer",
    topic: "water",
    title: "생활하수 처리 시설",
    cost: 55,
    description:
      "공터에 처리 시설을 지어요. 120초 뒤 연결된 생활하수를 처리해요.",
    tradeoff: "공터를 차지하며 다른 배출구의 오염은 남아요.",
  },
  {
    id: "riverCleanup",
    topic: "water",
    title: "하천 쓰레기 수거망",
    cost: 30,
    description: "60초 뒤부터 떠내려오는 쓰레기를 잡고 주기적으로 비워요.",
    tradeoff:
      "물에 녹아 있는 오염은 처리하지 못해요. 길가의 투기물도 따로 치워야 해요.",
  },
  {
    id: "handling",
    topic: "supply",
    title: "상점 하역 개선",
    cost: 20,
    description: "도시 전체 상점에서 물건을 내리는 속도를 높여요.",
    tradeoff: "배송차가 도착하기 전에는 효과가 없어요.",
  },
  {
    id: "production",
    topic: "supply",
    title: "작업장 생산 늘리기",
    cost: 30,
    description:
      "지역 물자 생산을 50% 늘리고 다음 주기부터 출퇴근 차량도 늘어요.",
    tradeoff:
      "작업장 오염 배출도 50% 늘어요. 정화 시설의 처리량을 함께 살펴요.",
  },
  {
    id: "library",
    topic: "access",
    title: "작은도서관",
    cost: 55,
    description: "400㎡ 이상 공터에 도서관을 지어 이용 자리를 늘려요.",
    tradeoff:
      "거리가 먼 주민에게는 도움이 적고, 공터는 다른 시설에 쓸 수 없어요.",
  },
  {
    id: "park",
    topic: "access",
    title: "동네 공원",
    cost: 35,
    description: "900㎡ 이상 공터에 쉴 수 있는 공원을 만들어요.",
    tradeoff: "주차장이나 하수 처리 시설을 지을 공간은 줄어요.",
  },
] as const;
export type LivePolicyId = (typeof LIVE_POLICIES)[number]["id"];
export interface CityAction {
  time: number;
  id: LivePolicyId;
  target: string;
  reason: string;
}
export interface CityEvent {
  id: number;
  time: number;
  topic: Topic;
  type:
    | "problem"
    | "improved"
    | "policy"
    | "reaction"
    | "connection"
    | "participation";
  title: string;
  text: string;
  facilityId: string;
  position?: { x: number; z: number };
  evidence?: string;
}
export interface LiveSave {
  version: "living-city-v1";
  seed: number;
  time: number;
  actions: CityAction[];
  notes: string;
  observations: { time: number; values: Record<Topic, number> }[];
  council?: CommunityDecision[];
  /** First city-wide traffic cycle; absent in saves from the school-heavy model. */
  cityTrafficFrom?: number;
  /** First tick using building exits; older cities retain their already driven history. */
  vehicleAccessFrom?: number;
  /** First tick assigning building arrivals; existing journeys keep their original route. */
  vehicleArrivalFrom?: number;
}

/** One transport engine and one clock. Domain services never advance their own traffic. */
export class LiveCitySimulation extends DumpingSimulation {
  override readonly scenarioId = "live";
  readonly parking: ParkingSimulation;
  readonly logistics: LogisticsSimulation;
  readonly water: WaterSimulation;
  facilities: FacilitySimulation;
  readonly parcels: ParcelUse[] = [];
  readonly actions: CityAction[] = [];
  readonly news: CityEvent[] = [];
  readonly observations: LiveSave["observations"] = [];
  readonly council = new ResidentsCouncil(this);
  notes = "";
  budget = 100;
  transferredToRiver = 0;
  removedFromBoom = 0;
  revision = 0;
  private second = 0;
  private eventId = 0;
  private trafficWave = 1;
  private parkingWave = 1;
  private disposalWave = 1;
  private issues = new Map<string, CityEvent>();
  private pendingIssues = new Map<string, number>();
  private nextIssueAt: number = CITY_PACING.observe;
  private nextStoryAt: number = CITY_PACING.observe;
  private storyId = 0;
  private storyUntil = 0;
  private lastStoryId = 0;
  private checked = new Set<number>();
  private feedback: {
    action: CityAction;
    before: number;
    at: number;
    done?: boolean;
  }[] = [];
  constructor(readonly seed = 2404, public cityTrafficFrom = 0, public vehicleAccessFrom = 0,
    public vehicleArrivalFrom = 0) {
    super(seed, [], undefined, undefined, CITY_TRAFFIC_COUNT);
    if (cityTrafficFrom === 0) this.demand = createCityDemand(seed);
    this.parking = new ParkingSimulation(seed, [], undefined, [], [], this);
    this.logistics = new LogisticsSimulation(seed, [], undefined, 0, this);
    this.water = new WaterSimulation(seed, [], undefined, 0, this);
    this.water.householdFactor = (source) => this.council.waterFactor(source);
    this.water.householdPrevented = (source, amount) =>
      this.council.recordPrevention(source, amount);
    // The integrated river receives real roadside litter, not a duplicate bank stock.
    for (const bank of this.water.banks) bank.initial = bank.remaining = 0;
    this.facilities = new FacilitySimulation(seed);
  }
  override get usesVehicleAccess() { return this.time + 1e-8 >= this.vehicleAccessFrom; }
  override get usesVehicleArrivals() {
    return this.usesVehicleAccess && this.time + 1e-8 >= this.vehicleArrivalFrom;
  }
  protected override communityAwareness(siteId: DumpingSiteId) {
    return this.council.awarenessBoost(siteId);
  }
  protected override communityDisposal(request: DisposalRequest) {
    this.council.recordDisposal(request.siteId, request.amount);
  }
  communityNews(
    topic: Topic,
    title: string,
    text: string,
    position: { x: number; z: number },
    evidence: string,
  ) {
    const event = this.emit(
      "participation",
      topic,
      title,
      text,
      this.place(topic).facilityId,
      position,
    );
    event.evidence = evidence;
  }
  override nearestDropoff(id: DumpingSiteId) {
    const nearest = super.nearestDropoff(id);
    const site = this.sites.find((s) => s.id === nearest.id)!;
    // A full legal container stays legal waste. Only NEW disposal decisions change.
    return {
      ...nearest,
      distance:
        site.remaining >= (site.capacity ?? Infinity)
          ? Infinity
          : nearest.distance,
    };
  }
  override get wasteStats() {
    const s = super.wasteStats;
    return {
      ...s,
      remaining: this.sites.reduce((n, s) => n + s.remaining, 0),
      transferredToRiver: this.transferredToRiver ?? 0,
    };
  }
  override step() {
    this.parking.step();
    super.step();
    this.logistics.step();
    this.water.step();
    this.council.tick();
    for (const truck of this.trucks)
      if (truck.phase === "finished") {
        truck.nextIndex = 0;
        this.dispatch(truck, truck.itinerary[0]);
      }
    const second = Math.floor(this.time + 1e-7);
    if (second === this.second) return;
    this.second = second;
    const river = this.illegal("river"),
      moved = Math.min(river.remaining, 0.035);
    river.remaining -= moved;
    this.transferredToRiver += moved;
    this.water.externalLitter += moved;
    if (moved)
      this.water.packets.push({
        z: 163,
        amount: moved,
        kind: "litter",
        source: "dumping-river",
      });
    if (
      this.time >= 240 &&
      this.transferredToRiver >= 1 &&
      !this.checked.has(-1)
    ) {
      this.checked.add(-1);
      this.emit(
        "connection",
        "water",
        "산책길 쓰레기가 하천으로",
        "길가의 투기물 1봉투 이상이 물로 흘러들었어요. 떠내려간 만큼 길가의 양은 줄었지만 수거된 것은 아니에요.",
        "b7",
        { x: 104, z: 163 },
      );
    }
    if (second % 180 === 0 && this.water.configuration.riverCleanup) {
      this.removedFromBoom += this.water.captured;
      this.water.captured = 0;
    }
    if (second % CITY_TRAFFIC_INTERVAL === 0) {
      this.budget += 20;
      const w = this.trafficWave++,
        production = this.has("production"),
        demand =
          this.time >= this.cityTrafficFrom
            ? createCityDemand(this.seed + w, production)
            : createDemand(
                this.seed + w,
                CITY_TRAFFIC_COUNT + (production ? 20 : 0),
              );
      this.scheduleDemand(
        demand.map((t) => ({
          ...t,
          id: 1000000 + w * 1000 + t.id,
          departAt: this.time + t.departAt,
        })),
      );
      this.pedestrians.scheduleDemand(
        createPedestrianDemand(this.seed + w).map((t) => ({
          ...t,
          id: 1000000 + w * 1000 + t.id,
          departAt: this.time + t.departAt,
        })),
      );
    }
    if (second % 240 === 0) {
      const w = this.parkingWave++;
      this.parking.addRequests(
        createParkingDemand(this.seed + w)
          .map((t) => ({
            ...t,
            id: 300000 + w * 10 + t.id - 30000,
          }))
          .filter((t) => !this.council.chooseWalking(t)),
      );
      this.revision++;
    }
    if (second % 900 === 0) {
      const w = this.disposalWave++;
      this.scheduleDisposals(
        createDisposalDemand(this.seed + w).map((t) => ({
          ...t,
          id: w * 100 + t.id,
          time: this.time + t.time,
        })),
      );
    }
    if (second % 20 === 0) this.detectIssues();
    for (const f of this.feedback)
      if (second >= f.at && !f.done) {
        f.done = true;
        const p = LIVE_POLICIES.find((p) => p.id === f.action.id)!;
        const after = this.measure(p.topic, f.action.target),
          delta = after - f.before;
        const text = cityChangeText(
          f.action.id === "signal" ? "traffic" : p.topic,
          Math.abs(delta) < 0.5 ? "same" : delta < 0 ? "less" : "more",
        );
        const target = this.targetsForHistory(f.action);
        const measurement =
          f.action.id === "signal"
            ? "교차로 주변 정차 차량 수"
            : this.unit(p.topic);
        const event = this.emit(
          "reaction",
          p.topic,
          `${p.title} 이후 주민 이야기`,
          text,
          this.place(p.topic).facilityId,
          target?.position ?? this.place(p.topic).position,
        );
        event.evidence = `${target?.name ?? "도시 전체"} · ${measurement}: 시행 전 ${f.before.toFixed(1)} → 지금 ${after.toFixed(1)}. 다른 정책과 생활 변화도 함께 반영돼요.`;
      }
    this.presentStory();
    if (second % 60 === 0) {
      // Keep recent transport diagnostics bounded in a city with no finish time.
      for (const list of [
        this.events,
        this.history,
        this.laneChangeEvents,
        this.completed,
        this.pedestrians.events,
        this.pedestrians.completed,
        this.serviceEvents,
        this.logistics.goodsEvents,
        this.disposalEvents,
      ])
        if (list.length > 1500) list.splice(0, list.length - 1500);
      if (this.parking.episodes.length > 100) {
        for (let i = this.parking.episodes.length - 1; i >= 0; i--)
          if (this.parking.episodes[i].phase === "finished")
            this.parking.episodes.splice(i, 1);
      }
    }
  }
  has(id: LivePolicyId) {
    return this.actions.some((a) => a.id === id);
  }
  targets(id: LivePolicyId): PlacementTarget[] {
    const make = (
      s: { id: string; name: string; position: { x: number; z: number } },
      detail = "이 위치에 적용",
    ) => ({ ...s, width: 18, depth: 18, detail });
    if (id === "signal")
      return [
        {
          id: SCHOOL_NODE,
          name: "학교 앞 교차로",
          position: { x: 48, z: 0 },
          width: 20,
          depth: 20,
          detail: "동서 26초 · 남북 10초",
        },
      ];
    if (id === "patrol" || id === "loadingBay")
      return PARKING_SITES.filter(
        (s) => id === "patrol" || s.id !== "homes",
      ).map((s) => make(s));
    if (["cleanup", "dropoff", "outreach"].includes(id))
      return DUMPING_SITES.map((s) => make(s));
    if (id === "outlet" || id === "riverCleanup") return waterTargets(id);
    if (["parkingLot", "library", "park", "sewer"].includes(id))
      return BUILDABLE_PLOTS.filter(
        (p) =>
          !this.parcels.some((u) => u.siteId === p.id) &&
          p.width * p.depth >=
            (id === "park" ? 900 : id === "sewer" ? 144 : 400) &&
          (id !== "sewer" || ["south", "riverside"].includes(p.id)),
      ).map((p) => ({
        ...p,
        detail: `${p.width * p.depth}㎡ · 비어 있는 공터`,
      }));
    if (id === "production")
      return [
        {
          id: "factory",
          name: "새봄 작업장",
          position: { x: 224, z: 184 },
          width: 32,
          depth: 24,
          detail: "생산량·출퇴근·오염 배출이 함께 늘어요",
        },
      ];
    return [];
  }
  apply(id: LivePolicyId, target = "", reason = "") {
    const p = LIVE_POLICIES.find((p) => p.id === id);
    if (!p) throw new Error("정책을 확인해 주세요.");
    if (this.has(id) && !["cleanup", "library", "park"].includes(id))
      throw new Error("이미 시행 중인 정책이에요.");
    if (this.budget < p.cost)
      throw new Error(
        "예산이 부족해요. 다음 운영 예산을 기다리거나 다른 방법을 살펴봐요.",
      );
    const targets = this.targets(id),
      global = ["extraTruck", "reduce", "handling"].includes(id);
    if (!global && !targets.some((t) => t.id === target))
      throw new Error("지도에서 적용할 수 있는 위치를 골라 주세요.");
    const before = this.measure(p.topic, target);
    let facility: FacilitySimulation | undefined;
    let parcel: ParcelUse | undefined;
    if (["parkingLot", "library", "park", "sewer"].includes(id)) {
      parcel = {
        siteId: target,
        kind:
          id === "parkingLot"
            ? "parking"
            : id === "sewer"
              ? "water"
              : (id as "library" | "park"),
      };
      validateParcelUses([...this.parcels, parcel]);
      if (id === "library" || id === "park") {
        const buildings = [
          ...this.parcels.filter(
            (u): u is PlannedFacility =>
              u.kind === "library" || u.kind === "park",
          ),
          { siteId: target, kind: id },
        ];
        facility = new FacilitySimulation(
          this.seed,
          [...new Set(buildings.map((b) => b.kind))],
          { siteId: target, buildings },
          Infinity,
        );
      }
    }
    if (id === "signal") {
      Object.assign(this.network.nodes.get(SCHOOL_NODE)!.signal, {
        ns: 10,
        ew: 26,
        offset: -this.time,
      });
    } else if (id === "patrol") {
      this.parking.plan = { ...this.parking.plan, patrolSite: target };
      this.parking.configuration.patrol = true;
      for (const e of this.parking.episodes)
        if (
          e.phase === "parked" &&
          e.destination === "illegal" &&
          e.request.siteId === target
        )
          e.releaseAt = Math.min(e.releaseAt, this.time + 40);
    } else if (id === "parkingLot") {
      this.parking.plan = { ...this.parking.plan, siteId: target };
      this.parking.configuration.parkingLot = true;
      const plot = BUILDABLE_PLOTS.find((p) => p.id === target)!;
      this.parking.lotCapacity = Math.floor((plot.width * plot.depth) / 240);
    } else if (id === "loadingBay") {
      this.parking.plan = { ...this.parking.plan, loadingSite: target };
      this.parking.configuration.loadingBay = true;
    } else if (id === "cleanup" || id === "dropoff") {
      if (id === "dropoff") {
        this.plan = { ...this.plan, dropoff: target as DumpingSiteId };
        this.dumpingConfiguration.dropoff = true;
      }
      const siteId = `${id === "cleanup" ? "illegal" : "designated"}-${target}`;
      const truck =
        this.trucks.find((t) => t.itinerary.includes(siteId)) ??
        this.trucks.reduce((a, b) =>
          a.itinerary.length < b.itinerary.length ? a : b,
        );
      if (
        truck.target === siteId &&
        ["driving", "collecting"].includes(truck.phase)
      )
        throw new Error("수거차가 이미 이곳을 방문하고 있어요.");
      const old = truck.itinerary.indexOf(siteId);
      if (old >= 0) {
        truck.itinerary.splice(old, 1);
        if (old <= truck.nextIndex) truck.nextIndex--;
      }
      truck.itinerary.splice(truck.nextIndex + 1, 0, siteId);
    } else if (id === "outreach") {
      this.plan = { ...this.plan, outreach: target as DumpingSiteId };
      this.dumpingConfiguration.outreach = true;
      this.outreachStarts = this.time + 60;
    } else if (id === "reduce") this.configuration.reduction = true;
    else if (id === "extraTruck") {
      const truck = {
        id: 10002,
        name: "3호 수거차",
        capacity: 55,
        load: 0,
        collected: 0,
        itinerary: this.sites
          .filter(
            (s) =>
              s.kind !== "designated" ||
              (s.id === `designated-${this.plan.dropoff}` &&
                this.dumpingConfiguration.dropoff),
          )
          .sort((a, b) => b.remaining - a.remaining)
          .map((s) => s.id),
        nextIndex: 0,
        target: "",
        phase: "driving" as const,
        departedAt: this.time,
        serviceStarted: 0,
        journeys: [],
      };
      this.trucks.push(truck);
      this.dispatch(truck, truck.itinerary[0]);
    } else if (id === "outlet" || id === "sewer" || id === "riverCleanup") {
      this.water.plan = { ...this.water.plan, [id]: target };
      this.water.configuration[id] = true;
      this.water.activation[id] = this.time + (id === "sewer" ? 120 : 60);
    } else if (id === "handling") this.logistics.configuration.handling = true;
    else if (id === "production") {
      this.logistics.sources.find((s) => s.id === "factory")!.rate *= 1.5;
      this.water.sourceMultiplier = 1.5;
    }
    if (parcel) this.parcels.push(parcel);
    if (facility) this.facilities = facility;
    this.budget -= p.cost;
    const action = {
      time: this.time,
      id,
      target,
      reason: reason.slice(0, 400),
    };
    this.actions.push(action);
    this.feedback.push({ action, before, at: this.time + 120 });
    this.emit(
      "policy",
      p.topic,
      `${p.title} 시행`,
      `${targets.find((t) => t.id === target)?.name ?? "도시 전체"} · 예산 ${p.cost}. ${p.tradeoff}`,
      this.place(p.topic).facilityId,
      targets.find((t) => t.id === target)?.position,
    );
    if (id === "production")
      this.emit(
        "connection",
        "water",
        "생산과 오염이 함께 늘어요",
        "작업장의 물자 생산과 오염 배출이 모두 50% 늘었어요. 정화 용량과 하류의 변화를 살펴봐요.",
        "b7",
        { x: 136, z: 164 },
      );
    this.revision++;
  }
  private measure(topic: Topic, target: string) {
    if (topic === "parking" && target === SCHOOL_NODE)
      return this.stats.roads
        .filter((r) =>
          this.network.nodes.get(SCHOOL_NODE)!.connectedRoadIds.includes(r.id),
        )
        .reduce((n, r) => n + r.stopped, 0);
    if (topic === "parking" && PARKING_SITES.some((s) => s.id === target))
      return this.parking.parkingStats.sites.find((s) => s.id === target)!
        .illegal;
    if (topic === "waste" && DUMPING_SITES.some((s) => s.id === target))
      return this.illegal(target).remaining;
    return this.values[topic];
  }
  get policyComparisons() {
    // These baselines already belong to the saved engine state. No historical value is invented.
    return this.feedback.map(({ action, before }) => {
      const policy = LIVE_POLICIES.find((p) => p.id === action.id)!;
      const local =
        (policy.topic === "parking" &&
          (action.target === SCHOOL_NODE ||
            PARKING_SITES.some((s) => s.id === action.target))) ||
        (policy.topic === "waste" &&
          DUMPING_SITES.some((s) => s.id === action.target));
      const place = this.targetsForHistory(action);
      return {
        action,
        title: policy.title,
        topic: policy.topic,
        place: place?.name ?? "도시 전체",
        position: place?.position,
        scope: local ? place!.name : "도시 전체",
        measurement:
          action.id === "signal"
            ? "교차로 주변 정차 차량 수"
            : this.unit(policy.topic),
        before,
        now: this.measure(policy.topic, action.target),
        time: this.time,
        tradeoff: policy.tradeoff,
      };
    });
  }
  unit(topic: Topic) {
    return {
      parking: "현재 불법주차 대수",
      waste: "길가 투기물 봉투 수",
      water: "하류의 가상 오염도",
      supply: "현재 재고가 부족한 상점 수",
      access: "시설을 이용하기 어려운 주민 수",
    }[topic];
  }
  get values(): Record<Topic, number> {
    return {
      parking: this.parking.parkingStats.illegal,
      waste: this.dumpingStats.illegalRemaining,
      water: this.water.cells[8].level,
      supply: this.logistics.shops.filter((s) => s.stock < 3).length,
      access: this.facilities.access.reduce((n, s) => n + s.unserved, 0),
    };
  }
  private place(topic: Topic) {
    return {
      parking: { facilityId: "b6", position: { x: 33, z: 4 } },
      waste: { facilityId: "b7", position: { x: 104, z: 163 } },
      water: { facilityId: "b7", position: { x: 104, z: 304 } },
      supply: { facilityId: "b7", position: { x: 72, z: -24 } },
      access: { facilityId: "b12", position: { x: -72, z: 120 } },
    }[topic];
  }
  private emit(
    type: CityEvent["type"],
    topic: Topic,
    title: string,
    text: string,
    facilityId: string,
    position?: { x: number; z: number },
  ) {
    const event: CityEvent = {
      id: ++this.eventId,
      time: this.time,
      type,
      topic,
      title,
      text,
      facilityId,
      position,
    };
    this.news.push(event);
    if (this.news.length > 120) this.news.shift();
    return event;
  }
  private detectIssues() {
    const conditions = [
      ...PARKING_SITES.map((s) => ({
        key: `parking-${s.id}`,
        topic: "parking" as const,
        value: this.parking.parkingStats.sites.find((p) => p.id === s.id)!
          .illegal,
        high: 1,
        low: 0,
        title: s.name,
        text: s.opinion,
        facilityId: s.facilityId,
        position: s.position,
      })),
      ...DUMPING_SITES.map((s) => ({
        key: `dumping-${s.id}`,
        topic: "waste" as const,
        value: this.illegal(s.id).remaining,
        high: 12,
        low: 4,
        title: s.name,
        text: "길가에 봉투가 쌓였어요. 치우는 일과 새로 버리지 않게 하는 일을 함께 살펴봐 주세요.",
        facilityId: s.facilityId,
        position: s.position,
      })),
      ...this.sites
        .filter((s) => !s.kind)
        .map((s) => ({
          key: `collection-${s.id}`,
          topic: "waste" as const,
          value: s.remaining,
          high: 45,
          low: 20,
          title: s.name + " 수거장",
          text: "집 앞 수거장에 쓰레기가 쌓였어요. 수거차가 어디서 기다리는지, 다른 곳을 먼저 도는지도 살펴봐 주세요.",
          facilityId: s.facilityId,
          position: this.lanePose(this.network.lanes.get(s.laneId)!, 20),
        })),
      {
        key: "traffic",
        topic: "parking" as const,
        value: this.stats.stopped,
        high: 15,
        low: 6,
        title: "막히는 등굣길",
        text: "길에서 기다리는 차가 많아졌어요. 불법주차와 신호를 함께 살펴봐 주세요.",
        facilityId: "b6",
        position: { x: 48, z: 0 },
      },
      {
        key: "water",
        topic: "water" as const,
        value: this.water.cells[8].level,
        high: 12,
        low: 8,
        title: "새봄천 하류",
        text: "하류 물의 오염도가 높아졌어요. 위쪽의 배출구와 산책길도 살펴봐 주세요.",
        ...this.place("water"),
      },
      {
        key: "supply",
        topic: "supply" as const,
        value: this.logistics.shops.filter((s) => s.stock < 3).length,
        high: 1,
        low: 0,
        title: "동네 상점",
        text: "물건이 모자라요. 작업장 물자와 배송차가 오는 길을 함께 확인해 주세요.",
        ...this.place("supply"),
      },
      {
        key: "access",
        topic: "access" as const,
        value: this.values.access,
        high: 100,
        low: 50,
        title: "생활 시설",
        text: "걸어서 이용할 수 있는 도서관과 공원이 필요해요. 남은 공터를 함께 살펴봐요.",
        ...this.place("access"),
      },
    ];
    const measurement = (c: (typeof conditions)[number]) =>
      c.key === "traffic"
        ? "도로 위 정차 차량"
        : c.key.startsWith("collection-")
          ? "수거장에 남은 봉투"
          : this.unit(c.topic);
    for (const c of conditions) {
      if (!this.issues.has(c.key) && c.value >= c.high) {
        if (!this.pendingIssues.has(c.key))
          this.pendingIssues.set(c.key, this.time);
      } else this.pendingIssues.delete(c.key);
      if (c.value <= c.low && this.issues.has(c.key)) {
        this.issues.delete(c.key);
        const event = this.emit(
          "improved",
          c.topic,
          `${c.title}의 변화`,
          cityChangeText(
            c.key === "traffic"
              ? "traffic"
              : c.key.startsWith("collection-")
                ? "collection"
                : c.topic,
            "less",
          ),
          c.facilityId,
          c.position,
        );
        event.evidence = `변화 확인 시점 ${event.time.toFixed(0)}초 · ${c.title} · ${measurement(c)} ${c.value.toFixed(1)}`;
      }
    }
    if (this.time < this.nextIssueAt) return;
    // Recheck the actual condition before announcing: temporary queues need no alert.
    const c = conditions
      .filter(
        (c) =>
          this.pendingIssues.has(c.key) &&
          this.time - this.pendingIssues.get(c.key)! >= CITY_PACING.persistent,
      )
      .sort(
        (a, b) =>
          this.pendingIssues.get(a.key)! - this.pendingIssues.get(b.key)!,
      )[0];
    if (!c) return;
    const issue = this.emit(
      "problem",
      c.topic,
      c.title,
      c.text,
      c.facilityId,
      c.position,
    );
    issue.evidence = `발견 시점 ${issue.time.toFixed(0)}초 · ${c.title} · ${measurement(c)} ${c.value.toFixed(1)}`;
    this.issues.set(c.key, issue);
    this.pendingIssues.delete(c.key);
    this.nextIssueAt = this.time + CITY_PACING.interval;
  }
  private storyRelevant(event: CityEvent) {
    return (
      event.type !== "problem" ||
      [...this.issues.values()].some((issue) => issue.id === event.id)
    );
  }
  private presentStory() {
    if (this.time < this.nextStoryAt) return;
    const event = this.news.find(
      (n) =>
        n.id > this.lastStoryId &&
        n.type !== "policy" &&
        this.time - n.time <= 300 &&
        this.storyRelevant(n),
    );
    if (!event) return;
    this.storyId = this.lastStoryId = event.id;
    this.storyUntil = this.time + CITY_PACING.speaking;
    this.nextStoryAt = this.time + CITY_PACING.interval;
  }
  get currentStory() {
    const event = this.news.find((n) => n.id === this.storyId);
    return event && this.time < this.storyUntil && this.storyRelevant(event)
      ? event
      : undefined;
  }
  get voices(): ResidentVoice[] {
    const story = this.currentStory;
    return (story ? [story] : []).map((e) => ({
      id: `live-${e.id}`,
      group:
        e.type === "problem" ? e.title + " 주민" : TOPICS[e.topic] + " 주민",
      place: e.title,
      facilityId: e.facilityId,
      position: e.position,
      summary: e.text,
      opinion: e.text,
      fact:
        e.evidence ??
        `현재 도시 전체 ${this.unit(e.topic)}: ${this.values[e.topic].toFixed(1)}`,
      change:
        e.type === "problem"
          ? undefined
          : "여러 생활 변화가 함께 반영된 실제 도시의 변화예요.",
    }));
  }
  get activeIssues() {
    return [...this.issues.values()];
  }
  get policyMap(): AppliedPolicyMap {
    const map: AppliedPolicyMap = { places: [], shared: [] };
    for (const a of this.actions) {
      const p = LIVE_POLICIES.find((p) => p.id === a.id)!;
      const t = this.targetsForHistory(a);
      const entry = {
        id: `live-${a.id}-${a.target}`,
        name: t?.name ?? "도시 전체",
        scope: t ? "이 장소에 적용" : "도시 전체에 적용",
        position: t?.position,
        outlines: [],
        policies: [
          {
            id: a.id,
            title: p.title,
            detail: p.description,
            tradeoff: p.tradeoff,
          },
        ],
      };
      const list = t ? map.places : map.shared;
      if (!list.some((e) => e.id === entry.id)) list.push(entry);
    }
    this.council.addMapMarkers(map);
    return map;
  }
  private targetsForHistory(a: CityAction) {
    if (a.id === "patrol" || a.id === "loadingBay")
      return PARKING_SITES.find((s) => s.id === a.target);
    if (["cleanup", "dropoff", "outreach"].includes(a.id))
      return DUMPING_SITES.find((s) => s.id === a.target);
    if (["parkingLot", "library", "park", "sewer"].includes(a.id))
      return BUILDABLE_PLOTS.find((s) => s.id === a.target);
    if (a.id === "outlet" || a.id === "riverCleanup")
      return waterTargets(a.id).find((s) => s.id === a.target);
    if (a.id === "signal")
      return {
        id: SCHOOL_NODE,
        name: "학교 앞 교차로",
        position: { x: 48, z: 0 },
      };
    if (a.id === "production")
      return {
        id: "factory",
        name: "새봄 작업장",
        position: { x: 224, z: 184 },
      };
    return undefined;
  }
  observe() {
    this.observations.push({ time: this.time, values: { ...this.values } });
    if (this.observations.length > 100) this.observations.shift();
  }
  save(): LiveSave {
    return {
      version: "living-city-v1",
      seed: this.seed,
      time: this.time,
      actions: this.actions.map((a) => ({ ...a })),
      notes: this.notes,
      observations: structuredClone(this.observations),
      council: this.council.save(),
      ...(Number.isFinite(this.cityTrafficFrom)
        ? { cityTrafficFrom: this.cityTrafficFrom }
        : {}),
      ...(Number.isFinite(this.vehicleAccessFrom)
        ? { vehicleAccessFrom: this.vehicleAccessFrom }
        : {}),
      ...(Number.isFinite(this.vehicleArrivalFrom)
        ? { vehicleArrivalFrom: this.vehicleArrivalFrom }
        : {}),
    };
  }
}

export function validateLiveSave(value: unknown): LiveSave {
  const s = value as LiveSave;
  if (
    !s ||
    s.version !== "living-city-v1" ||
    !Number.isSafeInteger(s.seed) ||
    !Number.isFinite(s.time) ||
    s.time < 0 ||
    s.time > 86400 ||
    Math.abs(s.time * 10 - Math.round(s.time * 10)) > 1e-5 ||
    !Array.isArray(s.actions) ||
    s.actions.length > 500 ||
    typeof s.notes !== "string" ||
    s.notes.length > 4000 ||
    !Array.isArray(s.observations) ||
    s.observations.length > 100
  )
    throw new Error("도시 저장 내용을 확인할 수 없어요.");
  if (
    s.cityTrafficFrom !== undefined &&
    (!Number.isSafeInteger(s.cityTrafficFrom) ||
      s.cityTrafficFrom < 0 ||
      s.cityTrafficFrom % CITY_TRAFFIC_INTERVAL !== 0 ||
      s.cityTrafficFrom > nextCityTrafficCycle(s.time))
  )
    throw new Error("도시 교통 기록을 확인할 수 없어요.");
  if (s.vehicleAccessFrom !== undefined &&
    (!Number.isFinite(s.vehicleAccessFrom) || s.vehicleAccessFrom < 0 ||
      Math.abs(s.vehicleAccessFrom * 10 - Math.round(s.vehicleAccessFrom * 10)) > 1e-5 ||
      s.vehicleAccessFrom > s.time + 0.1 + 1e-7))
    throw new Error("차량 출발 기록을 확인할 수 없어요.");
  if (s.vehicleArrivalFrom !== undefined &&
    (!Number.isFinite(s.vehicleArrivalFrom) || s.vehicleArrivalFrom < 0 ||
      Math.abs(s.vehicleArrivalFrom * 10 - Math.round(s.vehicleArrivalFrom * 10)) > 1e-5 ||
      s.vehicleArrivalFrom > s.time + 0.1 + 1e-7))
    throw new Error("차량 도착 기록을 확인할 수 없어요.");
  let previous = 0;
  for (const a of s.actions) {
    if (
      !a ||
      !LIVE_POLICIES.some((p) => p.id === a.id) ||
      !Number.isFinite(a.time) ||
      a.time < previous ||
      a.time > s.time ||
      Math.abs(a.time * 10 - Math.round(a.time * 10)) > 1e-5 ||
      typeof a.target !== "string" ||
      typeof a.reason !== "string" ||
      a.reason.length > 400
    )
      throw new Error("시행 기록이 올바르지 않아요.");
    previous = a.time;
  }
  for (const o of s.observations)
    if (
      !o ||
      !Number.isFinite(o.time) ||
      o.time < 0 ||
      o.time > s.time ||
      Object.keys(TOPICS).some((k) => !Number.isFinite(o.values?.[k as Topic]))
    )
      throw new Error("관찰 기록이 올바르지 않아요.");
  if (s.council !== undefined) {
    if (!Array.isArray(s.council) || s.council.length > 100)
      throw new Error("주민 회의 기록을 확인해 주세요.");
    let lastTime = 0,
      lastPolicies = 0;
    for (const c of s.council) {
      const project = c && COMMUNITY_PROJECTS.find((p) => p.id === c.project);
      if (
        !c ||
        !project ||
        !COMMUNITY_METHODS.some((m) => m.id === c.method) ||
        !Number.isFinite(c.time) ||
        c.time < lastTime ||
        c.time > s.time ||
        Math.abs(c.time * 10 - Math.round(c.time * 10)) > 1e-5 ||
        !Number.isInteger(c.policyCount) ||
        c.policyCount < lastPolicies ||
        c.policyCount > s.actions.length ||
        (c.policyCount > 0 && s.actions[c.policyCount - 1].time > c.time) ||
        (c.policyCount < s.actions.length &&
          s.actions[c.policyCount].time < c.time) ||
        !communityTargets(c.project).some((t) => t.id === c.target) ||
        !Array.isArray(c.heard) ||
        c.heard.length !== project.voices.length ||
        !project.voices.every((v) => c.heard.includes(v.id)) ||
        [c.reason, c.concern, c.reflection].some(
          (t) => typeof t !== "string" || t.length > 400,
        )
      )
        throw new Error("주민 회의의 위치·의견·시행 순서를 확인해 주세요.");
      lastTime = c.time;
      lastPolicies = c.policyCount;
    }
  }
  return s;
}
const nextCityTrafficCycle = (time: number) =>
  (Math.floor(time / CITY_TRAFFIC_INTERVAL) + 1) * CITY_TRAFFIC_INTERVAL;

export function prepareLiveSave(value: unknown): LiveSave {
  const save = validateLiveSave(value);
  // Replay the old city exactly, then change only future departures. Existing
  // vehicles, policies and observations are retained without resetting a city.
  return {
    ...save,
    cityTrafficFrom: save.cityTrafficFrom ?? nextCityTrafficCycle(save.time),
    vehicleAccessFrom: save.vehicleAccessFrom ?? (Math.round(save.time * 10) + 1) / 10,
    vehicleArrivalFrom: save.vehicleArrivalFrom ?? (Math.round(save.time * 10) + 1) / 10,
  };
}
export async function restoreLiveCity(
  value: unknown,
  onProgress: (n: number) => void = () => {},
  options: {
    initialCity?: LiveCitySimulation;
    chunkMs?: number;
    signal?: AbortSignal;
  } = {},
) {
  const save = prepareLiveSave(value),
    city = options.initialCity ??
      new LiveCitySimulation(save.seed, save.cityTrafficFrom, save.vehicleAccessFrom,
        save.vehicleArrivalFrom);
  if (
    city.seed !== save.seed ||
    Math.round(city.time * 10) > Math.round(save.time * 10) ||
    (city.cityTrafficFrom !== save.cityTrafficFrom &&
      !(city.cityTrafficFrom === Infinity && save.cityTrafficFrom! > city.time)) ||
    (city.vehicleAccessFrom !== save.vehicleAccessFrom &&
      !(city.vehicleAccessFrom === Infinity && save.vehicleAccessFrom! > city.time)) ||
    (city.vehicleArrivalFrom !== save.vehicleArrivalFrom &&
      !(city.vehicleArrivalFrom === Infinity && save.vehicleArrivalFrom! > city.time))
  )
    throw new Error("이어 불러올 도시가 맞지 않아요.");
  city.cityTrafficFrom = save.cityTrafficFrom!;
  city.vehicleAccessFrom = save.vehicleAccessFrom!;
  city.vehicleArrivalFrom = save.vehicleArrivalFrom!;
  const previousActions = city.actions.length,
    previousMeetings = city.council.records.length;
  const commands = [
    ...save.actions
      .map((a, index) => ({
        time: a.time,
        order: index * 2 + 1,
        run: () => city.apply(a.id, a.target, a.reason),
      }))
      .slice(previousActions),
    ...(save.council ?? [])
      .map((c) => ({
        time: c.time,
        order: c.policyCount * 2,
        run: () => {
          const record = city.council.start(
            c.project,
            c.target,
            c.method,
            c.heard,
            c.reason,
            c.concern,
          );
          record.reflection = c.reflection;
        },
      }))
      .slice(previousMeetings),
  ].sort((a, b) => a.time - b.time || a.order - b.order);
  let i = 0;
  while (city.time + 1e-7 < save.time) {
    if (options.signal?.aborted)
      throw new DOMException("불러오기를 중단했어요.", "AbortError");
    while (i < commands.length && commands[i].time <= city.time + 1e-7) {
      commands[i++].run();
    }
    const until = Math.min(save.time, commands[i]?.time ?? Infinity);
    const deadline = performance.now() + (options.chunkMs ?? 12);
    let steps = 0;
    while (city.time + 1e-7 < until) {
      city.step();
      if (++steps % 32 === 0 && performance.now() >= deadline) break;
    }
    onProgress(city.time / save.time);
    await new Promise((r) => setTimeout(r, 0));
  }
  while (i < commands.length) {
    commands[i++].run();
  }
  city.notes = save.notes;
  city.observations.splice(0, city.observations.length, ...save.observations);
  city.council.records.forEach(
    (r, index) => (r.reflection = save.council![index].reflection),
  );
  return city;
}
