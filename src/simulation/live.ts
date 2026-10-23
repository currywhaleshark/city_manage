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
  EAST_PARKING_SITES,
  createParkingDemand,
  createEastParkingDemand,
  type ParkingSite,
} from "./parking";
import { wasteLaneId, type WasteSite } from "./services/waste";
import { LogisticsSimulation, type Shop } from "./economy";
import { WaterSimulation, WATER_SOURCES, waterTargets } from "./water";
import { FacilitySimulation, type PlannedFacility } from "./facilities";
import { BUILDABLE_PLOTS } from "../city/world";
import { validateParcelUses, type ParcelUse } from "../city/parcels";
import { createDemand, SCHOOL_NODE, seededRandom } from "../scenario";
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
  updateResponsiveSignals,
  RESPONSIVE_SIGNAL_NODES,
  RESPONSIVE_SIGNAL_OUTLINE,
  EAST_SIGNAL_TARGET,
  EAST_SIGNAL_OUTLINE,
} from "./responsive-signals";
import {
  ResidentsCouncil,
  COMMUNITY_PROJECTS,
  COMMUNITY_METHODS,
  communityTargets,
  validateCommunityVote,
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
/** Parking sites in the living city, including the commercial street across the river. */
export const LIVE_PARKING_SITES: readonly ParkingSite[] = [
  ...PARKING_SITES,
  ...EAST_PARKING_SITES,
];
export const EAST_WASTE_SITE = {
  id: "east-shops",
  name: "강너머 상점가",
  facilityId: "block-7-1",
  roadId: "n7-1_n7-2",
  from: "n7-1",
} as const;
/** A shop in the commercial district across the river, near the workshop. */
export const EAST_SHOP_SITE = {
  id: "east-bank",
  name: "강너머 상가 가게",
  facilityId: "block-5-1",
  laneId: "n5-2_n6-2:n5-2:0",
} as const;
export const STAGGER_TARGET = "industry-commute";
const isEastRoad = (id: string) =>
  id.split("_").every((n) => Number(/^n(\d+)-/.exec(n)?.[1] ?? -1) >= 5);
class LiveParkingSimulation extends ParkingSimulation {
  override get siteList() {
    return LIVE_PARKING_SITES;
  }
}
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
    description: "고른 생활권의 교차로에서 기다리는 차를 보고 초록불 시간을 나눠요.",
    tradeoff:
      "다음 신호 주기부터 조절해요. 보행 시간은 지키며, 고르지 않은 생활권의 정체는 남을 수 있어요.",
  },
  {
    id: "stagger",
    topic: "parking",
    title: "출근 시간 나누기",
    cost: 20,
    description:
      "강너머 산업지구로 출근하는 차가 한꺼번에 몰리지 않게 출발 시간을 나눠요. 다음 교통 주기부터 적용해요.",
    tradeoff: "차량 수는 그대로예요. 일찍 또는 늦게 출근하는 작업자가 생겨요.",
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
    description: "학교, 시장, 강너머 상가 옆에 150초 이내 정차할 자리 한 곳을 마련해요.",
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
    description: "16봉투 배출함을 놓고, 주변 투기물과 배출함을 수거 경로에 넣어요.",
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
  /** Start of directed arrival planning and congestion-aware detours. */
  trafficRoutingFrom?: number;
  /** Start of the commercial/industrial problems across the river and the industrial rush. */
  eastBankFrom?: number;
  /** First tick of the shop across the river and its deliveries. */
  eastShopFrom?: number;
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
  /** East-bank queue checks over the last traffic cycle (one every 20 seconds). */
  private eastQueue: number[] = [];
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
    public vehicleArrivalFrom = 0, public trafficRoutingFrom = 0, public eastBankFrom = 0,
    public eastShopFrom = 0) {
    super(seed, [], undefined, undefined, CITY_TRAFFIC_COUNT);
    if (cityTrafficFrom === 0)
      this.demand = createCityDemand(seed, false, eastBankFrom === 0);
    this.parking = new LiveParkingSimulation(seed, [], undefined, [], [], this);
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
  override get usesAdaptiveRouting() {
    return this.usesVehicleArrivals && this.time + 1e-8 >= this.trafficRoutingFrom;
  }
  get usesEastBank() { return this.time + 1e-8 >= this.eastBankFrom; }
  get usesEastShop() { return this.time + 1e-8 >= this.eastShopFrom; }
  /** Older cities gain the shop collection point only once the east bank starts. */
  private openEastBank() {
    if (this.usesEastShop && !this.logistics.shops.some((s) => s.id === EAST_SHOP_SITE.id))
      this.openEastShop();
    if (!this.usesEastBank || this.sites.some((s) => s.id === EAST_WASTE_SITE.id))
      return;
    const random = seededRandom(this.seed ^ 0x65617374);
    const site: WasteSite = {
      ...EAST_WASTE_SITE,
      laneId: wasteLaneId(EAST_WASTE_SITE),
      initial: 24,
      generated: 0,
      collected: 0,
      remaining: 24,
      rate: (2.4 + random() * 0.6) / 60,
      participation: 0.3 + random() * 0.3,
      // Same overflow limit as the other collection points in the dumping model.
      capacity: 40,
      lastCollectedAt: null,
      completedAt: null,
    };
    this.sites.push(site);
    // Join a recurring round at its end, so the current journey stays intact.
    const truck =
      this.trucks.find((t) => t.itinerary.includes("market")) ?? this.trucks[0];
    truck.itinerary.push(site.id);
    this.revision++;
  }
  /** The shop opens with a little stock; the workshop truck adds it to its round. */
  private openEastShop() {
    const random = seededRandom(this.seed ^ 0x73686f70);
    const initial = 8 + Math.floor(random() * 5);
    const shop: Shop = {
      ...EAST_SHOP_SITE,
      initial,
      stock: initial,
      capacity: 60,
      demandRate: (4 + random() * 2) / 60,
      requested: 0,
      sold: 0,
      unmet: 0,
      delivered: 0,
      stockoutSeconds: 0,
      bySource: {},
    };
    this.logistics.shops.push(shop);
    const truck =
      this.logistics.trucks.find((t) => t.sourceId === "factory") ??
      this.logistics.trucks[0];
    // Keep the current stop; the new shop joins right after it. The index is
    // normalized first so a longer round does not change which shop is next.
    const current = truck.nextIndex % truck.itinerary.length;
    truck.nextIndex = current;
    truck.itinerary.splice(current + 1, 0, shop.id);
    this.revision++;
  }
  /** Stopped vehicles on roads entirely across the river. */
  /**
   * Rush-hour queue across the river: the mean of the three highest checks in
   * the last cycle. A queue that only clears between rushes is not "better".
   */
  get eastRushPeak() {
    const top = [...this.eastQueue].sort((a, b) => b - a).slice(0, 3);
    return top.length
      ? top.reduce((n, v) => n + v, 0) / top.length
      : this.eastStopped;
  }
  get eastStopped() {
    return this.stats.roads
      .filter((r) => isEastRoad(r.id))
      .reduce((n, r) => n + r.stopped, 0);
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
    const candidates = this.dropoffCandidates(id);
    // A full legal container stays legal waste. Only NEW disposal decisions change.
    return candidates.find(candidate => {
      const site = this.sites.find(s => s.id === candidate.id)!;
      return site.remaining < (site.capacity ?? Infinity);
    }) ?? { ...candidates[0], distance: Infinity };
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
    this.openEastBank();
    updateResponsiveSignals(this);
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
        rush = this.usesEastBank && !this.has("stagger"),
        demand =
          this.time >= this.cityTrafficFrom
            ? createCityDemand(this.seed + w, production, rush)
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
      const toWave = (t: { id: number }) => 300000 + w * 10 + t.id - 30000;
      this.parking.addRequests([
        ...createParkingDemand(this.seed + w)
          .map((t) => ({ ...t, id: toWave(t) }))
          .filter((t) => !this.council.chooseWalking(t)),
        // No walking routes cross the river, so these drivers always drive.
        ...(this.usesEastBank
          ? createEastParkingDemand(this.seed + w, w).map((t) => ({
              ...t,
              id: toWave(t),
            }))
          : []),
      ]);
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
    if (second % 20 === 0) {
      if (this.usesEastBank) {
        this.eastQueue.push(this.eastStopped);
        if (this.eastQueue.length > CITY_TRAFFIC_INTERVAL / 20)
          this.eastQueue.shift();
      }
      this.detectIssues();
    }
    for (const f of this.feedback)
      if (second >= f.at && !f.done) {
        f.done = true;
        const p = LIVE_POLICIES.find((p) => p.id === f.action.id)!;
        const after = this.measure(p.topic, f.action.target),
          delta = after - f.before;
        const traffic = ["signal", "stagger"].includes(f.action.id);
        const text = cityChangeText(
          traffic ? "traffic" : p.topic,
          Math.abs(delta) < 0.5 ? "same" : delta < 0 ? "less" : "more",
        );
        const target = this.targetsForHistory(f.action);
        const measurement = traffic
          ? this.trafficMeasurement(f.action)
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
          name: "학교·주거지 연결 교차로",
          position: { x: 0, z: 0 },
          width: 212,
          depth: 212,
          detail: "표시한 생활권의 25개 교차로 · 기다리는 차에 맞춰 조절",
        },
        {
          id: EAST_SIGNAL_TARGET,
          name: "강너머 상업·산업지구 교차로",
          position: { x: 216, z: 96 },
          width: 164,
          depth: 404,
          detail: "강 건너 36개 교차로 · 기다리는 차에 맞춰 조절",
        },
      ].filter(
        (t) => !this.actions.some((a) => a.id === "signal" && a.target === t.id),
      );
    if (id === "stagger")
      return [
        {
          id: STAGGER_TARGET,
          name: "강너머 산업지구 출근길",
          position: { x: 216, z: 168 },
          width: 138,
          depth: 234,
          detail: "산업지구로 출근하는 차의 출발 시간을 고르게 나눠요",
        },
      ];
    if (id === "patrol" || id === "loadingBay")
      return LIVE_PARKING_SITES.filter(
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
    if (
      this.has(id) &&
      !["cleanup", "library", "park", "signal"].includes(id)
    )
      throw new Error("이미 시행 중인 정책이에요.");
    if (this.budget < p.cost)
      throw new Error(
        "예산이 부족해요. 다음 운영 예산을 기다리거나 다른 방법을 살펴봐요.",
      );
    const targets = this.targets(id),
      global = ["extraTruck", "reduce", "handling"].includes(id);
    if (!global && !targets.some((t) => t.id === target))
      throw new Error(
        id === "signal" && this.has(id)
          ? "이미 시행 중인 정책이에요."
          : "지도에서 적용할 수 있는 위치를 골라 주세요.",
      );
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
      // The current cycle completes safely; step() chooses the next timing.
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
      const siteId = `illegal-${target}`;
      const truck =
        this.trucks.find((t) => t.itinerary.includes(siteId)) ??
        this.trucks.reduce((a, b) =>
          a.itinerary.length < b.itinerary.length ? a : b,
        );
      if (id === "cleanup" &&
        truck.target === siteId &&
        ["driving", "collecting"].includes(truck.phase)
      )
        throw new Error("수거차가 이미 이곳을 방문하고 있어요.");
      // Keep a truck's current journey intact. Clear existing litter first,
      // then collect the new bin on the same recurring route.
      const visits = id === "dropoff" ? [siteId, `designated-${target}`] : [siteId];
      let insertAt = truck.nextIndex + 1;
      for (const visit of visits) {
        if (truck.target === visit && ["driving", "collecting"].includes(truck.phase)) continue;
        const old = truck.itinerary.indexOf(visit);
        if (old >= 0) {
          truck.itinerary.splice(old, 1);
          if (old <= truck.nextIndex) truck.nextIndex--;
          if (old < insertAt) insertAt--;
        }
        truck.itinerary.splice(insertAt++, 0, visit);
      }
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
  private trafficMeasurement(action: CityAction) {
    return action.id === "signal" && action.target === SCHOOL_NODE
      ? "교차로 주변 정차 차량 수"
      : "강 건너 출근길 정차 차량 수(최근 5분 중 많던 때)";
  }
  private measure(topic: Topic, target: string) {
    if (target === EAST_SIGNAL_TARGET || target === STAGGER_TARGET)
      return this.eastRushPeak;
    if (topic === "parking" && target === SCHOOL_NODE)
      return this.stats.roads
        .filter((r) =>
          [...RESPONSIVE_SIGNAL_NODES].some(id =>
            this.network.nodes.get(id)!.connectedRoadIds.includes(r.id)),
        )
        .reduce((n, r) => n + r.stopped, 0);
    if (topic === "parking" && LIVE_PARKING_SITES.some((s) => s.id === target))
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
            action.target === EAST_SIGNAL_TARGET ||
            action.target === STAGGER_TARGET ||
            LIVE_PARKING_SITES.some((s) => s.id === action.target))) ||
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
        measurement: ["signal", "stagger"].includes(action.id)
          ? this.trafficMeasurement(action)
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
    const east = this.usesEastBank;
    const conditions = [
      ...(east ? LIVE_PARKING_SITES : PARKING_SITES).map((s) => ({
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
        // Once the east bank has its own alert, the school route counts only its bank.
        value: east ? this.stats.stopped - this.eastStopped : this.stats.stopped,
        high: 15,
        low: 6,
        title: "막히는 등굣길",
        text: "길에서 기다리는 차가 많아졌어요. 불법주차와 신호를 함께 살펴봐 주세요.",
        facilityId: "b6",
        position: { x: 48, z: 0 },
      },
      ...(east
        ? [
            {
              key: "traffic-east",
              topic: "parking" as const,
              value: this.eastRushPeak,
              high: 12,
              low: 9,
              title: "강너머 출근길",
              text: "산업지구로 출근하는 차가 한꺼번에 몰려 길이 막혀요. 출근 시간과 신호를 함께 살펴봐 주세요.",
              facilityId: "b15",
              position: { x: 192, z: 120 },
            },
            {
              key: "water-outlet",
              topic: "water" as const,
              value: this.water.cells[4].level,
              high: 12,
              low: 8,
              title: "작업장 배출구 아래",
              text: "작업장 배출구 아래 물이 탁해졌어요. 어느 배출구에서 얼마나 들어오는지 살펴봐 주세요.",
              facilityId: "b15",
              position: { x: 136, z: 116 },
            },
          ]
        : []),
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
        : c.key === "traffic-east"
          ? "강 건너 출근길 정차 차량(최근 5분 중 많던 때)"
          : c.key === "water-outlet"
            ? "배출구 아래의 가상 오염도"
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
            c.key.startsWith("traffic")
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
    const ready = conditions
      .filter(
        (c) =>
          this.pendingIssues.has(c.key) &&
          this.time - this.pendingIssues.get(c.key)! >= CITY_PACING.persistent,
      )
      .sort(
        (a, b) =>
          this.pendingIssues.get(a.key)! - this.pendingIssues.get(b.key)!,
      );
    // Take turns between the banks so problems across the river are not
    // always queued behind the many western ones.
    const acrossRiver = (p: { x: number }) => p.x >= 128;
    const last = east
      ? [...this.news].reverse().find((n) => n.type === "problem")?.position
      : undefined;
    const c =
      (last && ready.find((c) => acrossRiver(c.position) !== acrossRiver(last))) ??
      ready[0];
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
        scope:
          a.id === "signal"
            ? a.target === EAST_SIGNAL_TARGET
              ? "표시한 강너머 상업·산업지구에 적용"
              : "표시한 학교·주거 생활권에 적용"
            : t
              ? "이 장소에 적용"
              : "도시 전체에 적용",
        position: t?.position,
        outlines:
          a.id === "signal"
            ? [
                a.target === EAST_SIGNAL_TARGET
                  ? EAST_SIGNAL_OUTLINE
                  : RESPONSIVE_SIGNAL_OUTLINE,
              ]
            : [],
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
      return LIVE_PARKING_SITES.find((s) => s.id === a.target);
    if (["cleanup", "dropoff", "outreach"].includes(a.id))
      return DUMPING_SITES.find((s) => s.id === a.target);
    if (["parkingLot", "library", "park", "sewer"].includes(a.id))
      return BUILDABLE_PLOTS.find((s) => s.id === a.target);
    if (a.id === "outlet" || a.id === "riverCleanup")
      return waterTargets(a.id).find((s) => s.id === a.target);
    if (a.id === "signal")
      return a.target === EAST_SIGNAL_TARGET
        ? {
            id: EAST_SIGNAL_TARGET,
            name: "강너머 상업·산업지구 교차로",
            position: { x: 216, z: 96 },
          }
        : {
            id: SCHOOL_NODE,
            name: "학교·주거지 연결 교차로",
            position: { x: 0, z: 0 },
          };
    if (a.id === "stagger")
      return {
        id: STAGGER_TARGET,
        name: "강너머 산업지구 출근길",
        position: { x: 216, z: 168 },
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
      ...(Number.isFinite(this.trafficRoutingFrom)
        ? { trafficRoutingFrom: this.trafficRoutingFrom }
        : {}),
      ...(Number.isFinite(this.eastBankFrom)
        ? { eastBankFrom: this.eastBankFrom }
        : {}),
      ...(Number.isFinite(this.eastShopFrom)
        ? { eastShopFrom: this.eastShopFrom }
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
  if (s.trafficRoutingFrom !== undefined &&
    (!Number.isFinite(s.trafficRoutingFrom) || s.trafficRoutingFrom < 0 ||
      Math.abs(s.trafficRoutingFrom * 10 - Math.round(s.trafficRoutingFrom * 10)) > 1e-5 ||
      s.trafficRoutingFrom > s.time + 0.1 + 1e-7))
    throw new Error("차량 경로 기록을 확인할 수 없어요.");
  if (s.eastBankFrom !== undefined &&
    (!Number.isFinite(s.eastBankFrom) || s.eastBankFrom < 0 ||
      Math.abs(s.eastBankFrom * 10 - Math.round(s.eastBankFrom * 10)) > 1e-5 ||
      s.eastBankFrom > s.time + 0.1 + 1e-7))
    throw new Error("강너머 지구 기록을 확인할 수 없어요.");
  if (s.eastShopFrom !== undefined &&
    (!Number.isFinite(s.eastShopFrom) || s.eastShopFrom < 0 ||
      Math.abs(s.eastShopFrom * 10 - Math.round(s.eastShopFrom * 10)) > 1e-5 ||
      s.eastShopFrom > s.time + 0.1 + 1e-7))
    throw new Error("강너머 상점 기록을 확인할 수 없어요.");
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
      if (c.vote !== undefined) validateCommunityVote(c.vote, s.seed, c.project, c.target, c.method);
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
    trafficRoutingFrom: save.trafficRoutingFrom ?? (Math.round(save.time * 10) + 1) / 10,
    eastBankFrom: save.eastBankFrom ?? (Math.round(save.time * 10) + 1) / 10,
    eastShopFrom: save.eastShopFrom ?? (Math.round(save.time * 10) + 1) / 10,
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
        save.vehicleArrivalFrom, save.trafficRoutingFrom, save.eastBankFrom,
        save.eastShopFrom);
  if (
    city.seed !== save.seed ||
    Math.round(city.time * 10) > Math.round(save.time * 10) ||
    (city.cityTrafficFrom !== save.cityTrafficFrom &&
      !(city.cityTrafficFrom === Infinity && save.cityTrafficFrom! > city.time)) ||
    (city.vehicleAccessFrom !== save.vehicleAccessFrom &&
      !(city.vehicleAccessFrom === Infinity && save.vehicleAccessFrom! > city.time)) ||
    (city.vehicleArrivalFrom !== save.vehicleArrivalFrom &&
      !(city.vehicleArrivalFrom === Infinity && save.vehicleArrivalFrom! > city.time)) ||
    (city.trafficRoutingFrom !== save.trafficRoutingFrom &&
      !(city.trafficRoutingFrom === Infinity && save.trafficRoutingFrom! > city.time)) ||
    (city.eastBankFrom !== save.eastBankFrom &&
      !(city.eastBankFrom === Infinity && save.eastBankFrom! > city.time)) ||
    (city.eastShopFrom !== save.eastShopFrom &&
      !(city.eastShopFrom === Infinity && save.eastShopFrom! > city.time))
  )
    throw new Error("이어 불러올 도시가 맞지 않아요.");
  city.cityTrafficFrom = save.cityTrafficFrom!;
  city.vehicleAccessFrom = save.vehicleAccessFrom!;
  city.vehicleArrivalFrom = save.vehicleArrivalFrom!;
  city.trafficRoutingFrom = save.trafficRoutingFrom!;
  city.eastBankFrom = save.eastBankFrom!;
  city.eastShopFrom = save.eastShopFrom!;
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
            c.vote,
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
