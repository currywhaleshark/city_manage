import { TrafficSimulation } from "../../simulation";
import {
  CONFIG,
  DEFAULT_POLICY,
  createDemand,
  seededRandom,
} from "../../scenario";
import { createPedestrianDemand } from "../pedestrians";
import {
  applyPolicies,
  type PolicyDefinition,
} from "../../policies/definition";
import type { Network } from "../../types";
import { externalGatewayPosition } from "../../city/world";

export const LOGISTICS_MODEL_VERSION = "goods-delivery-v2";
export const SHOP_SITES = [
  {
    id: "north",
    name: "북쪽 골목 가게",
    facilityId: "b2",
    laneId: "n3-0_n3-1:n3-0:0",
  },
  {
    id: "east",
    name: "동쪽 다함께 시장",
    facilityId: "b7",
    laneId: "n4-1_n4-2:n4-1:0",
  },
  {
    id: "park",
    name: "공원 옆 가게",
    facilityId: "b11",
    laneId: "n4-2_n4-3:n4-2:0",
  },
  {
    id: "south",
    name: "남쪽 생활 가게",
    facilityId: "b14",
    laneId: "n2-4_n3-4:n2-4:0",
  },
] as const;
export const SUPPLY_SITES = [
  {
    id: "factory",
    name: "새봄 생활용품 공장",
    origin: "n6-6",
    laneId: "n6-6_n7-6:n6-6:0",
    position: { x: 224, z: 184 },
    external: false,
  },
  {
    id: "east-region",
    name: "이웃 들녘마을 · 동쪽 입구",
    origin: "outside-east-0",
    laneId: "external-east-supply:outside-east-0:0",
    position: externalGatewayPosition("east-region"),
    external: true,
  },
  {
    id: "west-region",
    name: "이웃 강빛마을 · 서쪽 입구",
    origin: "outside-west-0",
    laneId: "external-west-supply:outside-west-0:0",
    position: externalGatewayPosition("west-region"),
    external: true,
  },
] as const;
interface LogisticsConfiguration {
  shortcut: boolean;
  trucks: number;
  handling: boolean;
  diversify: boolean;
}
export const LOGISTICS_POLICIES: readonly PolicyDefinition<LogisticsConfiguration>[] =
  [
    {
      id: "shortcut",
      scenarioId: "logistics",
      title: "물류 지름길 연결",
      cost: 35,
      target: "학교 북쪽 끊긴 도로",
      description:
        "끊긴 구간을 이어 화물차와 일반 차량이 새 길을 이용하게 해요.",
      tradeoff:
        "가까워지는 목적지가 있지만 차량이 다른 길로 몰릴 수도 있어요. 물자를 더 생산하지는 않아요.",
      metrics: ["delivered", "averageTravelTime"],
      available: () => true,
      apply: (s) => {
        s.shortcut = true;
      },
    },
    {
      id: "cargoTruck",
      scenarioId: "logistics",
      title: "화물차 추가 투입",
      cost: 35,
      target: "화물차 2대 → 3대",
      description: "한 대를 더 보내 네 상점을 나누어 배송해요.",
      tradeoff:
        "같은 공장의 물자를 나누어 실어요. 생산량은 그대로이고 도로 위 차량은 늘어요.",
      metrics: ["delivered", "traffic"],
      available: () => true,
      apply: (s) => {
        s.trucks = 3;
      },
    },
    {
      id: "handling",
      scenarioId: "logistics",
      title: "시장 하역 인력 지원",
      cost: 20,
      target: "상점 네 곳",
      description:
        "상점에 도착한 물자를 더 빨리 내려놓도록 돕는 인력을 지원해요.",
      tradeoff:
        "생산량과 길은 그대로예요. 차가 도착하지 못하면 하역 지원만으로는 재고가 늘지 않아요.",
      metrics: ["delivered", "unmet"],
      available: () => true,
      apply: (s) => {
        s.handling = true;
      },
    },
    {
      id: "diversify",
      scenarioId: "logistics",
      title: "외부 공급처 다양화",
      cost: 30,
      target: "서쪽 강빛마을 입구",
      description:
        "서쪽 이웃 마을과도 교류해요. 외부 담당 차량이 두 입구를 번갈아 방문해요.",
      tradeoff:
        "공급받을 물자는 늘지만 먼 상점까지 배송 시간이 더 걸릴 수 있어요. 외부 이동은 도시 입구부터 관찰해요.",
      metrics: ["externalDelivered", "unmet"],
      available: () => true,
      apply: (s) => {
        s.diversify = true;
      },
    },
  ];
export interface Shop {
  id: string;
  name: string;
  facilityId: string;
  laneId: string;
  initial: number;
  stock: number;
  capacity: number;
  demandRate: number;
  requested: number;
  sold: number;
  unmet: number;
  delivered: number;
  stockoutSeconds: number;
  bySource: Record<string, number>;
}
export interface SupplySource {
  id: string;
  name: string;
  origin: string;
  laneId: string;
  position: { x: number; z: number };
  external: boolean;
  initial: number;
  stock: number;
  rate: number;
  generated: number;
  loaded: number;
}
export interface CargoTruck {
  id: number;
  name: string;
  capacity: number;
  load: number;
  cargoSource: string;
  itinerary: string[];
  nextIndex: number;
  sourceVisits: number;
  sourceId: string;
  target: string;
  phase: "driving" | "loading" | "unloading" | "blocked";
  departedAt: number;
  serviceStarted: number;
  delivered: number;
  journeys: { target: string; seconds: number }[];
  /** Taken out of service: finish the current delivery, then park. */
  retired?: boolean;
}
export class LogisticsSimulation extends TrafficSimulation {
  readonly scenarioId = "logistics";
  readonly configuration: LogisticsConfiguration;
  readonly policyIds: readonly string[];
  readonly cost: number;
  readonly shops: Shop[];
  readonly sources: SupplySource[];
  readonly trucks: CargoTruck[] = [];
  readonly goodsEvents: {
    time: number;
    truck: number;
    place: string;
    source: string;
    type: "arrival" | "load" | "deliver";
    amount: number;
  }[] = [];
  constructor(
    readonly seed = 2404,
    policyIds: readonly string[] = [],
    network?: Network,
    backgroundCount = 140,
    transport?: TrafficSimulation,
  ) {
    const applied = applyPolicies(
      LOGISTICS_POLICIES,
      policyIds,
      { shortcut: false, trucks: 2, handling: false, diversify: false },
      100,
    );
    super(
      { ...DEFAULT_POLICY, bypass: applied.state.shortcut },
      transport ? [] : createDemand(seed, backgroundCount),
      network,
      createPedestrianDemand(seed),
      transport,
    );
    this.configuration = applied.state;
    this.policyIds = Object.freeze([...policyIds]);
    this.cost = applied.cost;
    const random = seededRandom(seed ^ 0x676f6f64);
    this.shops = SHOP_SITES.map((s) => {
      const initial = 8 + Math.floor(random() * 5);
      return {
        ...s,
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
    });
    // Draw all potential source conditions first so opening a route never changes existing supply.
    this.sources = SUPPLY_SITES.map((s) => {
      const initial = (s.external ? 24 : 30) + Math.floor(random() * 5);
      return {
        ...s,
        initial,
        stock: initial,
        rate: (s.external ? 6 : 9) / 60,
        generated: 0,
        loaded: 0,
      };
    }).filter((s) => s.id !== "west-region" || this.configuration.diversify);
    const order = ["south", "park", "east", "north"];
    for (let i = 0; i < this.configuration.trucks; i++) {
      const sourceId =
        i === 1
          ? this.configuration.diversify
            ? "west-region"
            : "east-region"
          : "factory";
      const truck: CargoTruck = {
        id: 20000 + i,
        name: `${i + 1}호 화물차`,
        capacity: 36,
        load: 0,
        cargoSource: sourceId,
        sourceId,
        sourceVisits: 0,
        itinerary: order.filter((_, j) => j % this.configuration.trucks === i),
        nextIndex: 0,
        target: sourceId,
        phase: "driving",
        departedAt: 0,
        serviceStarted: 0,
        delivered: 0,
        journeys: [],
      };
      this.trucks.push(truck);
      this.dispatch(truck, sourceId);
    }
  }
  private dispatch(truck: CargoTruck, target: string) {
    const destination =
      this.sources.find((s) => s.id === target) ??
      this.shops.find((s) => s.id === target)!;
    truck.target = target;
    truck.departedAt = this.time;
    const origin = this.sources.find((s) => s.id === truck.sourceId)!.origin;
    truck.phase = this.dispatchService(
      truck.id,
      origin,
      destination.laneId,
      truck.id === 20001 ? 0x558fac : 0xbe9145,
    )
      ? "driving"
      : "blocked";
  }
  /** The stop on a truck's round whose shop has the least stock (ties: round order). */
  private emptiestShop(t: CargoTruck) {
    let best = t.nextIndex % t.itinerary.length, low = Infinity;
    for (let k = 0; k < t.itinerary.length; k++) {
      const index = (t.nextIndex + k) % t.itinerary.length;
      const stock = this.shops.find((s) => s.id === t.itinerary[index])?.stock ?? Infinity;
      if (stock < low - 1e-9) [best, low] = [index, stock];
    }
    return best;
  }
  /** The next stop on a truck's round, after the current one, whose shop has room. */
  private nextShopWithSpace(t: CargoTruck) {
    const n = t.itinerary.length;
    for (let k = 1; k < n; k++) {
      const index = (t.nextIndex + k) % n;
      const shop = this.shops.find((s) => s.id === t.itinerary[index]);
      if (shop && shop.stock < shop.capacity - 1) return index;
    }
    return -1;
  }
  /** The supplier with the most goods waiting (ties: the first listed). */
  private fullestSource() {
    return this.sources.reduce((a, b) => (b.stock > a.stock ? b : a)).id;
  }
  /** A truck added by the living city: loads where most goods wait, then serves every shop in turn. */
  addTruck() {
    const i = this.trucks.length;
    const source = this.fullestSource();
    const truck: CargoTruck = {
      id: 20000 + i,
      name: `${i + 1}호 화물차`,
      capacity: 36,
      load: 0,
      cargoSource: source,
      sourceId: source,
      sourceVisits: 0,
      itinerary: this.shops.map((s) => s.id),
      nextIndex: 0,
      target: source,
      phase: "driving",
      departedAt: this.time,
      serviceStarted: 0,
      delivered: 0,
      journeys: [],
    };
    this.trucks.push(truck);
    this.dispatch(truck, source);
    return truck;
  }
  /** Share of the usual sales right now (shops close at night in the living city). */
  salesFactor: () => number = () => 1;
  /** Living city: a truck that finds a shop full takes the rest to the next shop with space. */
  moveOnWhenFull: () => boolean = () => false;
  override step() {
    super.step();
    const sales = this.salesFactor();
    for (const s of this.sources) {
      const amount = s.rate * CONFIG.dt;
      s.stock += amount;
      s.generated += amount;
    }
    for (const s of this.shops) {
      const wanted = s.demandRate * CONFIG.dt * sales,
        sold = Math.min(s.stock, wanted);
      s.requested += wanted;
      s.stock -= sold;
      s.sold += sold;
      s.unmet += wanted - sold;
      if (wanted - sold > 1e-8) s.stockoutSeconds += CONFIG.dt;
    }
    for (const t of this.trucks) {
      if (t.phase === "blocked" || !this.serviceJourneys.get(t.id)?.arrived)
        continue;
      const source = this.sources.find((s) => s.id === t.target);
      if (t.phase === "driving") {
        t.journeys.push({
          target: t.target,
          seconds: this.time - t.departedAt,
        });
        t.phase = source ? "loading" : "unloading";
        t.serviceStarted = this.time;
        this.goodsEvents.push({
          time: this.time,
          truck: t.id,
          place: t.target,
          source: t.cargoSource,
          type: "arrival",
          amount: 0,
        });
        continue;
      }
      if (t.phase === "loading" && source) {
        const amount = Math.min(
          source.stock,
          t.capacity - t.load,
          1.2 * CONFIG.dt,
        );
        source.stock -= amount;
        source.loaded += amount;
        t.load += amount;
        t.cargoSource = source.id;
        if (amount > 0)
          this.goodsEvents.push({
            time: this.time,
            truck: t.id,
            place: source.id,
            source: source.id,
            type: "load",
            amount,
          });
        if (
          t.load >= t.capacity - 1e-8 ||
          (this.time - t.serviceStarted >= 30 && t.load >= 6)
        ) {
          // Living city: the driver heads for the emptiest shop on the round.
          if (this.moveOnWhenFull()) t.nextIndex = this.emptiestShop(t);
          this.dispatch(t, t.itinerary[t.nextIndex % t.itinerary.length]);
        }
      } else if (t.phase === "unloading") {
        const shop = this.shops.find((s) => s.id === t.target)!;
        const amount = Math.min(
          t.load,
          shop.capacity - shop.stock,
          (this.configuration.handling ? 1.4 : 0.8) * CONFIG.dt,
        );
        t.load -= amount;
        t.delivered += amount;
        shop.stock += amount;
        shop.delivered += amount;
        shop.bySource[t.cargoSource] =
          (shop.bySource[t.cargoSource] ?? 0) + amount;
        if (amount > 0)
          this.goodsEvents.push({
            time: this.time,
            truck: t.id,
            place: shop.id,
            source: t.cargoSource,
            type: "deliver",
            amount,
          });
        const next = amount <= 0 && t.load > 1e-8 &&
          shop.stock >= shop.capacity - 1e-8 && this.moveOnWhenFull()
          ? this.nextShopWithSpace(t)
          : -1;
        if (next >= 0) {
          t.nextIndex = next;
          this.dispatch(t, t.itinerary[next]);
        } else if (t.load < 1e-8 && t.retired) {
          // A withdrawn truck parks after its last delivery.
          this.retireService(t.id);
          t.phase = "blocked";
        } else if (t.load < 1e-8) {
          t.nextIndex++;
          t.sourceVisits++;
          t.sourceId =
            t.id >= 20002
              ? this.fullestSource()
              : t.id === 20001
                ? this.configuration.diversify && t.sourceVisits % 2 === 0
                  ? "west-region"
                  : "east-region"
                : "factory";
          this.dispatch(t, t.sourceId);
        }
      }
    }
  }
  get logisticsStats() {
    const sum = (key: "stock" | "sold" | "unmet" | "requested" | "delivered") =>
      this.shops.reduce((n, s) => n + s[key], 0);
    const journeys = this.trucks.flatMap((t) => t.journeys);
    const delivered = sum("delivered"),
      requested = sum("requested");
    const localDelivered = this.shops.reduce(
      (n, s) => n + (s.bySource.factory ?? 0),
      0,
    );
    return {
      time: this.time,
      delivered,
      stock: sum("stock"),
      sold: sum("sold"),
      unmet: sum("unmet"),
      requested,
      fulfillment: requested ? (sum("sold") / requested) * 100 : null,
      stockoutShops: this.shops.filter((s) => s.unmet > 1e-8).length,
      emptyShops: this.shops.filter((s) => s.stock < 0.05).length,
      localDelivered,
      externalDelivered: delivered - localDelivered,
      produced: this.sources.find((s) => s.id === "factory")!.generated,
      externalReceived: this.sources
        .filter((s) => s.external)
        .reduce((n, s) => n + s.generated, 0),
      inTrucks: this.trucks.reduce((n, t) => n + t.load, 0),
      trucks: this.trucks.length,
      averageTravelTime: journeys.length
        ? journeys.reduce((n, j) => n + j.seconds, 0) / journeys.length
        : null,
      unfinishedJourneys: this.trucks.filter(
        (t) => t.phase === "driving" || t.phase === "blocked",
      ).length,
      backgroundArrived: this.stats.arrived,
      cost: this.cost,
      remainingBudget: 100 - this.cost,
      shops: this.shops.map((s) => ({ ...s, bySource: { ...s.bySource } })),
      sources: this.sources.map((s) => ({ ...s, position: { ...s.position } })),
    };
  }
}
