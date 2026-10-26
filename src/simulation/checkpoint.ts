import {
  LiveCitySimulation,
  prepareLiveSave,
  validateLiveSave,
  type LiveSave,
} from "./live";

// This is an internal structured-clone cache, never accepted from imported JSON.
// Bump when engine state/semantics change. The portable command log remains authoritative.
export const CHECKPOINT_VERSION = "living-state-12";
const shared = [
  "network",
  "pedestrians",
  "vehicles",
  "serviceJourneys",
  "servicePending",
  "nodeLocks",
  "laneReservations",
  "movementReservations",
];
const excluded = new Set([
  "transport",
  "routeCache",
  "movementCache",
  "laneCache",
  "departureCache",
  "arrivalCache",
  "routingDelays",
  "parking",
  "logistics",
  "water",
  "facilities",
  "council",
  "city",
  "network",
  "pedestrians",
]);
type Fields = Record<string, unknown>;
function fields(object: object, attached = false): Fields {
  return Object.fromEntries(
    Object.entries(object).filter(
      ([key, value]) =>
        !excluded.has(key) &&
        !(attached && shared.includes(key)) &&
        typeof value !== "function",
    ),
  );
}
function putFields(target: object, data: Fields, attached = false) {
  const schema = fields(target, attached);
  if (!data || Object.keys(data).length !== Object.keys(schema).length)
    throw new Error("저장한 도시 상태의 형식이 달라요.");
  for (const [key, value] of Object.entries(data)) {
    if (!Object.prototype.hasOwnProperty.call(schema, key))
      throw new Error("알 수 없는 도시 상태예요.");
    const sample = schema[key];
    if (
      typeof value !== typeof sample ||
      (Array.isArray(sample) && !Array.isArray(value)) ||
      (sample instanceof Map && !(value instanceof Map)) ||
      (sample instanceof Set && !(value instanceof Set))
    )
      throw new Error("저장 상태가 올바르지 않아요.");
    Object.defineProperty(target, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
}
export interface LiveCheckpoint {
  version: typeof CHECKPOINT_VERSION;
  save: LiveSave;
  state: {
    world: Fields;
    parking: Fields;
    logistics: Fields;
    water: Fields;
    pedestrians: Fields;
    council: Fields;
    signals: { id: string; signal: object }[];
  };
}
export function captureLiveCheckpoint(
  city: LiveCitySimulation,
): LiveCheckpoint {
  // Clone ONCE so crossing/vehicle reservations, news/issues and action references stay shared.
  return structuredClone({
    version: CHECKPOINT_VERSION,
    save: city.save(),
    state: {
      world: fields(city),
      parking: fields(city.parking, true),
      logistics: fields(city.logistics, true),
      water: fields(city.water, true),
      pedestrians: fields(city.pedestrians),
      council: fields(city.council),
      signals: [...city.network.nodes.values()].map((n) => ({
        id: n.id,
        signal: n.signal,
      })),
    },
  });
}
const councilCommands = (save: LiveSave) =>
  (save.council ?? []).map(({ reflection: _, ...c }) => c);
export function restoreLiveCheckpoint(
  checkpoint: LiveCheckpoint,
  requested: LiveSave,
): LiveCitySimulation {
  requested = prepareLiveSave(requested);
  const legacy = (checkpoint?.version as string) === "living-state-1";
  const previous = legacy || (checkpoint?.version as string) === "living-state-2";
  const beforeAccess = previous || (checkpoint?.version as string) === "living-state-3";
  const beforeArrival = beforeAccess || (checkpoint?.version as string) === "living-state-4";
  const beforeRouting = beforeArrival || (checkpoint?.version as string) === "living-state-5";
  const beforeRelief = beforeRouting || (checkpoint?.version as string) === "living-state-6";
  const beforeEast = beforeRelief || (checkpoint?.version as string) === "living-state-7";
  const beforeShop = beforeEast || (checkpoint?.version as string) === "living-state-8";
  const beforeDaily = beforeShop || (checkpoint?.version as string) === "living-state-9";
  const beforeEconomy = beforeDaily || (checkpoint?.version as string) === "living-state-10";
  const beforeServices = beforeEconomy || (checkpoint?.version as string) === "living-state-11";
  if (checkpoint?.version !== CHECKPOINT_VERSION && !beforeServices)
    throw new Error("도시 저장 형식이 바뀌었어요.");
  const saved = validateLiveSave(checkpoint.save);
  if (
    saved.seed !== requested.seed ||
    (saved.cityTrafficFrom !== requested.cityTrafficFrom &&
      !(saved.cityTrafficFrom === undefined &&
        requested.cityTrafficFrom! > saved.time)) ||
    (saved.vehicleAccessFrom !== requested.vehicleAccessFrom &&
      !(saved.vehicleAccessFrom === undefined && requested.vehicleAccessFrom! > saved.time)) ||
    (saved.vehicleArrivalFrom !== requested.vehicleArrivalFrom &&
      !(saved.vehicleArrivalFrom === undefined && requested.vehicleArrivalFrom! > saved.time)) ||
    (saved.trafficRoutingFrom !== requested.trafficRoutingFrom &&
      !(saved.trafficRoutingFrom === undefined && requested.trafficRoutingFrom! > saved.time)) ||
    (saved.eastBankFrom !== requested.eastBankFrom &&
      !(saved.eastBankFrom === undefined && requested.eastBankFrom! > saved.time)) ||
    (saved.eastShopFrom !== requested.eastShopFrom &&
      !(saved.eastShopFrom === undefined && requested.eastShopFrom! > saved.time)) ||
    (saved.dailyCycleFrom !== requested.dailyCycleFrom &&
      !(saved.dailyCycleFrom === undefined && requested.dailyCycleFrom! > saved.time)) ||
    (saved.startingBudget ?? 100) !== requested.startingBudget ||
    (saved.dailyServicesFrom !== requested.dailyServicesFrom &&
      !(saved.dailyServicesFrom === undefined && requested.dailyServicesFrom! > saved.time)) ||
    JSON.stringify(saved.withdrawals ?? []) !==
      JSON.stringify((requested.withdrawals ?? []).slice(0, saved.withdrawals?.length ?? 0)) ||
    (requested.withdrawals ?? [])
      .slice(saved.withdrawals?.length ?? 0)
      .some((w) => w.time < saved.time - 1e-7 || w.policyCount < saved.actions.length) ||
    Math.round(saved.time * 10) > Math.round(requested.time * 10) ||
    JSON.stringify(saved.actions) !==
      JSON.stringify(requested.actions.slice(0, saved.actions.length)) ||
    JSON.stringify(councilCommands(saved)) !==
      JSON.stringify(
        councilCommands(requested).slice(0, saved.council?.length ?? 0),
      ) ||
    requested.actions
      .slice(saved.actions.length)
      .some((a) => a.time < saved.time - 1e-7) ||
    (requested.council ?? [])
      .slice(saved.council?.length ?? 0)
      .some(
        (c) =>
          c.time < saved.time - 1e-7 || c.policyCount < saved.actions.length,
      )
  )
    throw new Error("다른 도시의 저장 상태예요.");
  const state = structuredClone(checkpoint.state),
    city = new LiveCitySimulation(saved.seed, saved.cityTrafficFrom ?? Infinity,
      saved.vehicleAccessFrom ?? Infinity, saved.vehicleArrivalFrom ?? Infinity,
      saved.trafficRoutingFrom ?? Infinity, saved.eastBankFrom ?? Infinity,
      saved.eastShopFrom ?? Infinity, saved.dailyCycleFrom ?? Infinity,
      saved.startingBudget ?? 100, saved.dailyServicesFrom ?? Infinity);
  if (previous && !("cityTrafficFrom" in state.world))
    state.world.cityTrafficFrom = saved.cityTrafficFrom ?? Infinity;
  if (beforeAccess && !("vehicleAccessFrom" in state.world))
    state.world.vehicleAccessFrom = saved.vehicleAccessFrom ?? Infinity;
  if (beforeArrival && !("vehicleArrivalFrom" in state.world))
    state.world.vehicleArrivalFrom = saved.vehicleArrivalFrom ?? Infinity;
  if (beforeRouting && !("trafficRoutingFrom" in state.world))
    state.world.trafficRoutingFrom = saved.trafficRoutingFrom ?? Infinity;
  // The east bank adds only its queue checks; its sites appear when it opens.
  if (beforeEast && !("eastBankFrom" in state.world)) {
    state.world.eastBankFrom = saved.eastBankFrom ?? Infinity;
    state.world.eastQueue = [];
  }
  // The east shop adds no engine fields: it joins the logistics state when it opens.
  if (beforeShop && !("eastShopFrom" in state.world))
    state.world.eastShopFrom = saved.eastShopFrom ?? Infinity;
  // The daily cycle adds its switch time and empty commute records.
  if (beforeDaily && !("dailyCycleFrom" in state.world)) {
    state.world.dailyCycleFrom = saved.dailyCycleFrom ?? Infinity;
    state.world.commuteSamples = new Map();
    state.world.commutePeaks = new Map();
  }
  // Income, withdrawals and footbridges start empty; older cities began at 100.
  if (beforeEconomy && !("withdrawals" in state.world)) {
    Object.assign(state.world, {
      startingBudget: saved.startingBudget ?? 100,
      withdrawals: [],
      todayIncome: { lot: 0, fines: 0, park: 0 },
      yesterdayIncome: { lot: 0, fines: 0, park: 0 },
      credited: { lot: 0, fines: 0 },
    });
    Object.assign(state.parking, {
      fees: { lot: false, fines: false },
      earnings: { lot: 0, fines: 0 },
    });
    state.pedestrians.bridges = new Set();
    state.pedestrians.closingBridges = new Set();
  }
  // Hourly everyday life adds only its switch time.
  if (beforeServices && !("dailyServicesFrom" in state.world))
    state.world.dailyServicesFrom = saved.dailyServicesFrom ?? Infinity;
  if (legacy) {
    // Only presentation state changed. Keep the physical city and avoid a full replay.
    Object.assign(state.world, {
      pendingIssues: new Map(),
      nextIssueAt: Math.max(120, saved.time + 100),
      nextStoryAt: Math.max(120, saved.time + 100),
      storyId: 0,
      storyUntil: 0,
      lastStoryId: state.world.eventId,
    });
  }
  putFields(city, state.world);
  putFields(city.pedestrians, state.pedestrians);
  for (const [target, data] of [
    [city.parking, state.parking],
    [city.logistics, state.logistics],
    [city.water, state.water],
  ] as const) {
    putFields(target, data, true);
    // Keep one owner for vehicles, crossings and the clock after rehydration.
    for (const key of shared)
      Object.defineProperty(target, key, {
        value: (city as unknown as Fields)[key],
        writable: true,
        configurable: true,
        enumerable: true,
      });
  }
  putFields(city.council, state.council);
  if (state.signals.length !== city.network.nodes.size)
    throw new Error("지도 상태가 달라요.");
  for (const n of state.signals) {
    const node = city.network.nodes.get(n.id);
    if (!node) throw new Error("지도 위치가 달라요.");
    Object.assign(node.signal, n.signal);
  }
  if (city.parcels.some((p) => p.kind === "library" || p.kind === "park"))
    city.facilities = city.facilitiesFor(city.parcels, city.has("parkFee"));
  if (
    city.time !== saved.time ||
    city.seed !== saved.seed ||
    !Number.isFinite(city.budget) ||
    city.budget < 0 ||
    JSON.stringify(city.save()) !== JSON.stringify(saved)
  )
    throw new Error("도시 기록과 저장 상태가 맞지 않아요.");
  city.cityTrafficFrom = requested.cityTrafficFrom!;
  city.vehicleAccessFrom = requested.vehicleAccessFrom!;
  city.vehicleArrivalFrom = requested.vehicleArrivalFrom!;
  city.trafficRoutingFrom = requested.trafficRoutingFrom!;
  city.eastBankFrom = requested.eastBankFrom!;
  city.eastShopFrom = requested.eastShopFrom!;
  city.dailyCycleFrom = requested.dailyCycleFrom!;
  city.dailyServicesFrom = requested.dailyServicesFrom!;
  return city;
}
