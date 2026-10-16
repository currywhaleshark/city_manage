import { readWaterData } from "./records/water";
import { waterTargets, type WaterPolicyId } from "./simulation/water";
import { getScenario } from "./scenarios";
import { readDumpingData } from "./records/dumping";
import { DUMPING_SITES } from "./simulation/services/dumping";
import type { Evidence, InquiryDecision } from "./inquiry";
import { PARKING_SITES, createParkingDemand } from "./simulation/parking";
import { validateParcelUses } from "./city/parcels";
import {
  FACILITY_SITES,
  FACILITY_FOOTPRINT,
  facilityPlanCost,
  type FacilityPlan,
} from "./simulation/facilities";
import { SHOP_SITES } from "./simulation/economy";
export interface RecordView {
  schemaVersion: number;
  scenarioId:
    | "traffic"
    | "waste"
    | "facilities"
    | "environment"
    | "logistics"
    | "parking"
    | "dumping"
    | "water";
  inquiry?: {
    hypothesis: string;
    proposal: string;
    evidence: Evidence[];
    decisions: InquiryDecision[];
  };
  title: string;
  seed: number;
  duration: number;
  timeLabel: string;
  rows: { label: string; before: string; after: string }[];
  regions: { label: string; before: string; after: string }[];
  policies: string[];
  reason: string;
  reflection: string;
  investigationCount: number;
  opinions: string[];
  modelVersion: string;
}
const object = (x: unknown): Record<string, any> => {
  if (!x || typeof x !== "object" || Array.isArray(x))
    throw new Error("실험 기록의 항목이 올바르지 않아요.");
  return x as Record<string, any>;
};
const number = (x: unknown) => {
  if (typeof x !== "number" || !Number.isFinite(x) || x < 0)
    throw new Error("실험 기록의 숫자를 확인해 주세요.");
  return x;
};
const string = (x: unknown, max = 1600) => {
  if (typeof x !== "string" || x.length > max)
    throw new Error("실험 기록의 글이 올바르지 않아요.");
  return x;
};
const value = (x: unknown, unit: string) =>
  x === null
    ? "집계 중"
    : `${number(x).toFixed(Number.isInteger(x) ? 0 : 1)}${unit}`;
const validPlaces = (places: any) =>
  Array.isArray(places) &&
  places.length > 0 &&
  places.length <= 100 &&
  places.every((p: any) => typeof p?.id === "string") &&
  new Set(places.map((p: any) => p.id)).size === places.length;
/** Read-only migration: v3 traffic records remain readable; imported text never becomes HTML. */
export function readExperimentRecord(input: string): RecordView {
  if (input.length > 5_000_000)
    throw new Error("기록은 5MB 이하의 JSON 파일로 열어 주세요.");
  let data: Record<string, any>;
  try {
    data = object(JSON.parse(input));
  } catch {
    throw new Error("실험 JSON 파일을 읽을 수 없어요.");
  }
  if (![3, 4, 5, 6, 7].includes(data.schemaVersion))
    throw new Error("지원하는 기록 버전은 3·4·5·6·7이에요.");
  const scenarioId = data.schemaVersion === 3 ? "traffic" : data.scenarioId;
  if (
    ![
      "traffic",
      "waste",
      "facilities",
      "environment",
      "logistics",
      "parking",
      "dumping",
      "water",
    ].includes(scenarioId)
  )
    throw new Error("알 수 없는 도시 문제의 기록이에요.");
  const before = object(data.before),
    after = object(data.after);
  const duration = number(data.duration),
    seed = number(data.seed);
  if (
    (scenarioId === "facilities"
      ? duration !== 0 || data.timeUnit !== "planning-round" || data.round !== 1
      : duration <= 0) ||
    duration > 86400 ||
    number(before.time) !== duration ||
    number(after.time) !== duration
  )
    throw new Error("전후 관찰 시간이 서로 달라요.");
  const rows: RecordView["rows"] = [],
    regions: RecordView["regions"] = [];
  if (scenarioId === "water") {
    const r = readWaterData(data);
    rows.push(...r.rows);
    regions.push(...r.regions);
  } else if (scenarioId === "dumping") {
    const r = readDumpingData(data);
    rows.push(...r.rows);
    regions.push(...r.regions);
  } else if (scenarioId === "parking") {
    const a = object(data.parkingBefore),
      b = object(data.parkingAfter);
    for (const s of [a, b]) {
      if (
        number(s.time) !== duration ||
        number(s.total) !== 6 ||
        ![
          s.parked,
          s.leaving,
          s.finished,
          s.illegal,
          s.legal,
          s.lotUsed,
          s.lotCapacity,
          s.detouredPeople,
        ].every((n) => Number.isInteger(n) && n >= 0) ||
        s.parked + s.leaving + s.finished !== 6 ||
        s.illegal > s.parked ||
        s.legal > 6 ||
        s.lotUsed > s.lotCapacity ||
        s.detouredPeople > 60 ||
        number(s.illegalSeconds) > 6 * duration + 1e-5 ||
        !validPlaces(s.sites) ||
        s.sites.length !== 3 ||
        !PARKING_SITES.every((p) => s.sites.some((r: any) => r.id === p.id))
      )
        throw new Error("주차 차량 수와 현장 기록을 확인해 주세요.");
      let totalSeconds = 0,
        legal = 0,
        illegal = 0;
      for (const r of s.sites) {
        const n = object(r);
        totalSeconds += number(n.illegalSeconds);
        legal += number(n.legal);
        illegal += number(n.illegal);
        if (
          n.illegal > 2 ||
          n.legal > 2 ||
          n.illegalSeconds > duration * 2 + 1e-5 ||
          typeof n.sidewalkBlocked !== "boolean"
        )
          throw new Error("현장별 주차 기록이 맞지 않아요.");
      }
      if (
        Math.abs(totalSeconds - s.illegalSeconds) > 1e-5 ||
        legal !== s.legal ||
        illegal !== s.illegal
      )
        throw new Error("현장별 합계가 맞지 않아요.");
    }
    for (const [key, label, unit, divisor] of [
      ["illegalSeconds", "불법주차가 차지한 시간 합계", "분", 60],
      ["detouredPeople", "차를 피해 돌아간 보행자", "명", 1],
      ["extraWalkingDistance", "보행자가 더 걸은 거리 합계", "m", 1],
      ["legal", "정해진 자리를 이용한 차", "대", 1],
      ["parkingWalkDistance", "주차 뒤 예상 보행 거리 합계", "m", 1],
      ["cost", "사용 예산", "", 1],
    ] as const)
      rows.push({
        label,
        before: value(number(a[key]) / divisor, unit),
        after: value(number(b[key]) / divisor, unit),
      });
    PARKING_SITES.forEach((site) =>
      regions.push({
        label: site.name,
        before: value(
          a.sites.find((s: any) => s.id === site.id).illegalSeconds / 60,
          "분",
        ),
        after: value(
          b.sites.find((s: any) => s.id === site.id).illegalSeconds / 60,
          "분",
        ),
      }),
    );
  } else if (scenarioId === "logistics") {
    const a = object(data.logisticsBefore),
      b = object(data.logisticsAfter);
    const close = (x: number, y: number) => Math.abs(x - y) < 1e-5;
    for (const stats of [a, b]) {
      if (
        data.timeUnit !== "seconds" ||
        number(stats.time) !== duration ||
        !Array.isArray(stats.shops) ||
        stats.shops.length !== 4 ||
        !SHOP_SITES.every(
          (s) => stats.shops.filter((v: any) => v?.id === s.id).length === 1,
        ) ||
        !Array.isArray(stats.sources) ||
        ![2, 3].includes(stats.sources.length) ||
        !["factory", "east-region"].every(
          (id) => stats.sources.filter((s: any) => s?.id === id).length === 1,
        ) ||
        new Set(stats.sources.map((s: any) => s?.id)).size !==
          stats.sources.length ||
        stats.sources.some(
          (s: any) =>
            !["factory", "east-region", "west-region"].includes(s?.id),
        )
      )
        throw new Error("물류 기록의 상점·공급처·시간을 확인해 주세요.");
      for (const raw of stats.shops) {
        const s = object(raw);
        if (
          !close(
            number(s.initial) + number(s.delivered),
            number(s.sold) + number(s.stock),
          ) ||
          !close(number(s.requested), number(s.sold) + number(s.unmet)) ||
          number(s.stock) > number(s.capacity) + 1e-5
        )
          throw new Error("상점의 물자 수량이 맞지 않아요.");
      }
      for (const raw of stats.sources) {
        const s = object(raw);
        if (
          !close(
            number(s.initial) + number(s.generated),
            number(s.stock) + number(s.loaded),
          )
        )
          throw new Error("공급처의 물자 수량이 맞지 않아요.");
      }
      const sum = (items: any[], key: string) =>
        items.reduce((n, s) => n + number(s[key]), 0);
      if (
        !close(
          sum(stats.sources, "loaded"),
          number(stats.delivered) + number(stats.inTrucks),
        ) ||
        !close(sum(stats.shops, "delivered"), stats.delivered) ||
        !close(sum(stats.shops, "unmet"), number(stats.unmet))
      )
        throw new Error("운송 중인 물자와 배송량이 맞지 않아요.");
    }
    for (const [key, label, unit] of [
      ["delivered", "상점에 배송한 물자", "상자"],
      ["unmet", "물건이 없어 못 산 양", "상자"],
      ["stock", "상점에 남은 재고", "상자"],
      ["stockoutShops", "품절을 겪은 상점", "곳"],
      ["averageTravelTime", "평균 이동 · 도착 구간", "초"],
      ["backgroundArrived", "일반 차량 도착", "대"],
      ["remainingBudget", "남은 예산", ""],
    ])
      rows.push({
        label,
        before: value(a[key], unit),
        after: value(b[key], unit),
      });
    for (const raw of a.shops) {
      const s = object(raw),
        other = b.shops.find((v: any) => v.id === s.id);
      regions.push({
        label: string(s.name, 80) + " · 못 산 양",
        before: value(s.unmet, "상자"),
        after: value(other.unmet, "상자"),
      });
    }
  } else if (scenarioId === "environment") {
    if (data.timeUnit !== "seconds")
      throw new Error("환경 관찰의 시간 단위를 확인해 주세요.");
    const a = object(data.environmentBefore),
      b = object(data.environmentAfter);
    for (const stats of [a, b]) {
      if (
        number(stats.time) !== duration ||
        stats.model !== "educational-proxy" ||
        number(stats.sampleCount) !== Math.floor(duration) ||
        number(stats.developedArea) + number(stats.greenArea) !==
          number(stats.managedArea) ||
        stats.managedArea !== 760 ||
        !validPlaces(stats.regions) ||
        number(stats.backgroundArrived) > number(stats.backgroundTrips) ||
        number(stats.addedArrived) > number(stats.addedTrips)
      )
        throw new Error("개발·환경 기록의 조건을 확인해 주세요.");
    }
    if (a.regions.length !== b.regions.length)
      throw new Error("전후 관찰 장소가 달라요.");
    for (const [key, label, unit] of [
      ["developedArea", "개발한 면적", "㎡"],
      ["greenArea", "남아 있는 녹지", "㎡"],
      ["workCapacity", "새 일터 이용 자리", "명분"],
      ["housingCapacity", "새 거주 공간", "명분"],
      ["addedTrips", "추가 차량 수요", "건"],
      ["backgroundArrived", "기존 차량 도착 · 140대", "대"],
      ["meanBurden", "평균 환경 부담 · 가상", "점"],
      ["remainingBudget", "남은 예산", ""],
    ])
      rows.push({
        label,
        before: value(a[key], unit),
        after: value(b[key], unit),
      });
    for (const raw of a.regions) {
      const row = object(raw),
        other = b.regions.find((r: any) => r?.id === row.id);
      if (!other) throw new Error("전후 관찰 장소가 달라요.");
      regions.push({
        label: string(row.name, 80),
        before: value(row.meanBurden, "점"),
        after: value(other.meanBurden, "점"),
      });
    }
  } else if (scenarioId === "facilities") {
    const a = object(data.facilitiesBefore),
      b = object(data.facilitiesAfter);
    for (const stats of [a, b]) {
      if (
        stats.round !== 1 ||
        number(stats.served) > number(stats.reachable) ||
        number(stats.reachable) > number(stats.population) ||
        number(stats.unserved) + stats.served !== stats.population ||
        !validPlaces(stats.neighborhoods)
      )
        throw new Error("시설 계획의 인원이나 동네 기록을 확인해 주세요.");
    }
    if (
      a.neighborhoods.length !== b.neighborhoods.length ||
      a.population !== b.population
    )
      throw new Error("전후 주민 수요가 달라요.");
    if (a.usedPlots !== undefined && b.usedPlots !== undefined) {
      for (const [key, label, unit] of [
        ["usedPlots", "사용한 공터", "곳"],
        ["freePlots", "남은 공터", "곳"],
        ["usedLand", "시설에 배정한 땅", "㎡"],
      ])
        rows.push({
          label,
          before: value(a[key], unit),
          after: value(b[key], unit),
        });
    }
    for (const [key, label, unit] of [
      ["served", "거리·정원이 맞는 주민", "명"],
      ["unserved", "이용하기 어려운 주민", "명"],
      ["capacityShortfall", "가까워도 자리 부족", "명"],
      ["capacity", "하루 전체 이용 자리", "명분"],
      ["remainingBudget", "남은 예산", ""],
    ])
      rows.push({
        label,
        before: value(a[key], unit),
        after: value(b[key], unit),
      });
    rows.push({
      label: "가장 가까운 시설까지 · 예상 평균",
      before: value(number(a.averageNearestSeconds) / 60, "분"),
      after: value(number(b.averageNearestSeconds) / 60, "분"),
    });
    for (const raw of a.neighborhoods) {
      const row = object(raw),
        other = b.neighborhoods.find((r: any) => r?.id === row.id);
      if (!other) throw new Error("전후 동네가 서로 달라요.");
      regions.push({
        label: string(row.name, 80),
        before: value(row.served, "명"),
        after: value(other.served, "명"),
      });
    }
  } else if (scenarioId === "waste") {
    const a = object(data.wasteBefore),
      b = object(data.wasteAfter);
    if (number(a.time) !== duration || number(b.time) !== duration)
      throw new Error("수거 기록의 관찰 시간이 달라요.");
    for (const [key, label, unit] of [
      ["collectionRate", "전체 수거율", "%"],
      ["remaining", "남은 일반 쓰레기", "봉투"],
      ["generated", "새로 나온 쓰레기", "봉투"],
      ["completedSites", "한 차례 수거를 마친 곳", "곳"],
      ["averageTravelTime", "평균 구간 이동 · 도착 구간", "초"],
      ["cost", "정책 비용", ""],
    ])
      rows.push({
        label,
        before: value(a[key], unit),
        after: value(b[key], unit),
      });
    if (
      !Array.isArray(a.sites) ||
      !Array.isArray(b.sites) ||
      a.sites.length !== 6 ||
      b.sites.length !== 6
    )
      throw new Error("수거장 기록이 빠졌어요.");
    for (const raw of a.sites) {
      const site = object(raw),
        other = b.sites.find((s: any) => s?.id === site.id);
      if (!other) throw new Error("수거장 전후 기록이 달라요.");
      regions.push({
        label: string(site.name, 80),
        before: value(site.remaining, "봉투"),
        after: value(other.remaining, "봉투"),
      });
    }
  } else {
    for (const [key, label, unit] of [
      ["arrived", "도착한 자동차", "대"],
      ["averageTravelTime", "평균 이동 · 도착 차량", "초"],
      ["averageDemandWait", "전체 1대당 누적 대기", "초"],
      ["queued", "출발지 대기", "대"],
    ])
      rows.push({
        label,
        before: value(before[key], unit),
        after: value(after[key], unit),
      });
    if (data.pedestriansBefore && data.pedestriansAfter)
      rows.push({
        label: "보행자 1인당 누적 대기",
        before: value(object(data.pedestriansBefore).averageWaitingTime, "초"),
        after: value(object(data.pedestriansAfter).averageWaitingTime, "초"),
      });
  }
  const ids =
    data.schemaVersion === 3
      ? Object.entries(object(data.policy ?? {}))
          .filter(
            ([key, v]) =>
              ["signal", "bypass", "oneWay"].includes(key) && v === true,
          )
          .map(([key]) => key)
      : (data.policyIds ?? []);
  if (
    !Array.isArray(ids) ||
    ids.length > getScenario(scenarioId).policies.length ||
    new Set(ids).size !== ids.length ||
    ids.some(
      (id) =>
        typeof id !== "string" ||
        !getScenario(scenarioId).policies.some((p) => p.id === id),
    )
  )
    throw new Error("정책 기록을 확인해 주세요.");
  if (
    ids.reduce(
      (total, id) =>
        total + getScenario(scenarioId).policies.find((p) => p.id === id)!.cost,
      0,
    ) > getScenario(scenarioId).budget
  )
    throw new Error("정책 비용이 예산을 넘어요.");
  let facilityPlan: FacilityPlan | undefined;
  if (scenarioId === "parking") {
    const p = object(data.parkingPlan),
      plot = FACILITY_SITES.find((s) => s.id === p.siteId);
    if (
      !plot ||
      !PARKING_SITES.some((s) => s.id === p.patrolSite) ||
      !["school", "market"].includes(p.loadingSite) ||
      !Array.isArray(p.reservedPlots) ||
      p.reservedPlots.length > 6
    )
      throw new Error("주차 정책 위치를 확인해 주세요.");
    validateParcelUses([
      ...p.reservedPlots,
      ...(ids.includes("parkingLot")
        ? [{ siteId: p.siteId, kind: "parking" }]
        : []),
    ]);
    const cost = ids.reduce(
      (n, id) =>
        n + getScenario("parking").policies.find((p) => p.id === id)!.cost,
      0,
    );
    if (
      data.parkingBefore.cost !== 0 ||
      data.parkingAfter.cost !== cost ||
      data.budget !== 100 - cost ||
      data.parkingAfter.lotCapacity !==
        (ids.includes("parkingLot")
          ? Math.floor((plot.width * plot.depth) / 240)
          : 0) ||
      JSON.stringify(data.parkingDemand) !==
        JSON.stringify(createParkingDemand(seed))
    )
      throw new Error("주차 수요·비용·공터 기록이 맞지 않아요.");
  }
  if (
    scenarioId === "facilities" &&
    data.facilityPlan?.buildings !== undefined
  ) {
    const raw = object(data.facilityPlan);
    if (
      !FACILITY_SITES.some((s) => s.id === raw.siteId) ||
      !Array.isArray(raw.buildings) ||
      raw.buildings.length > FACILITY_SITES.length
    )
      throw new Error("건설 계획을 확인해 주세요.");
    const occupied = new Set<string>();
    for (const b of raw.buildings) {
      const site = FACILITY_SITES.find((s) => s.id === b?.siteId);
      if (
        !site ||
        !["library", "park"].includes(b.kind) ||
        occupied.has(site.id) ||
        site.width * site.depth <
          FACILITY_FOOTPRINT[b.kind as "library" | "park"]
      )
        throw new Error("건설 부지의 중복이나 면적을 확인해 주세요.");
      occupied.add(site.id);
    }
    for (const kind of ["library", "park"])
      if (
        ids.includes(kind) !== raw.buildings.some((b: any) => b.kind === kind)
      )
        throw new Error("정책과 건설 계획이 달라요.");
    facilityPlan = raw as unknown as FacilityPlan;
    const cost = facilityPlanCost(ids, facilityPlan);
    if (
      cost > 100 ||
      cost !== data.facilitiesAfter.cost ||
      100 - cost !== data.facilitiesAfter.remainingBudget ||
      occupied.size !== data.facilitiesAfter.usedPlots
    )
      throw new Error("건설 비용과 사용한 공터를 확인해 주세요.");
  }
  const policies = ids.flatMap((id) => {
    const p = getScenario(scenarioId).policies.find((p) => p.id === id)!;
    if (scenarioId === "water")
      return `${p.title} (${p.cost}) · ${waterTargets(id as WaterPolicyId).find((t) => t.id === data.waterPlan[id])!.name}`;
    if (scenarioId === "dumping")
      return `${p.title} (${p.cost}) · ${DUMPING_SITES.find((s) => s.id === data.dumpingPlan[id])!.name}`;
    if (scenarioId === "parking") {
      const plan = object(data.parkingPlan);
      return `${p.title} (${p.cost}) · ${id === "parkingLot" ? FACILITY_SITES.find((s) => s.id === plan.siteId)!.name : PARKING_SITES.find((s) => s.id === (id === "patrol" ? plan.patrolSite : plan.loadingSite))!.name}`;
    }
    if (scenarioId === "facilities" && ["library", "park"].includes(id)) {
      if (facilityPlan)
        return facilityPlan
          .buildings!.filter((b) => b.kind === id)
          .map(
            (b) =>
              `${p.title} (${p.cost}) · ${FACILITY_SITES.find((s) => s.id === b.siteId)!.name}`,
          );
      const site = FACILITY_SITES.find(
        (s) => s.id === object(data.facilityPlan).siteId,
      );
      if (!site) throw new Error("건설 부지 기록을 확인해 주세요.");
      const legacyNames: Record<string, string> = {
        north: "북쪽 주택가 마당",
        west: "서쪽 주택가 마당",
        south: "남쪽 주택가 마당",
      };
      return `${p.title} (${id === "library" ? 60 : 50}) · ${legacyNames[site.id] ?? site.name}`;
    }
    return `${p.title} (${p.cost})`;
  });
  const opinions =
    data.residents === undefined
      ? []
      : (() => {
          if (!Array.isArray(data.residents) || data.residents.length > 20)
            throw new Error("주민 의견 기록을 확인해 주세요.");
          return data.residents.map((r: unknown) => {
            const v = object(r);
            return `${string(v.group, 80)}: ${string(v.opinion, 400)}`;
          });
        })();
  return {
    schemaVersion: data.schemaVersion,
    inquiry:
      data.schemaVersion < 5 || data.inquiry === undefined
        ? undefined
        : readInquiry(data.inquiry, duration, scenarioId),
    scenarioId,
    title: getScenario(scenarioId).title,
    seed,
    duration,
    timeLabel:
      scenarioId === "facilities"
        ? "시설 계획 1회 비교 · 보행 시간은 예상치"
        : scenarioId === "water"
          ? "5분씩 3차 관찰 · 가상 오염도, 실제 수질 등급이 아님"
          : scenarioId === "dumping"
            ? "5분씩 3차 관찰 · 교육용 배출 행동 가정"
            : `${duration / 60}분 관찰${scenarioId === "environment" ? " · 환경 부담은 가상 지표" : ""}`,
    rows,
    regions,
    opinions,
    policies,
    reason:
      data.decisionReason === undefined ? "" : string(data.decisionReason),
    reflection: string(data.reflection ?? ""),
    investigationCount:
      data.schemaVersion >= 5 && data.inquiry
        ? readInquiry(data.inquiry, duration, scenarioId).evidence.length
        : Array.isArray(data.investigations)
          ? data.investigations.length
          : 0,
    modelVersion: string(
      data.waterModelVersion ??
        data.dumpingModelVersion ??
        data.parkingModelVersion ??
        data.logisticsModelVersion ??
        data.environmentModelVersion ??
        data.facilityModelVersion ??
        data.serviceModelVersion ??
        data.modelVersion,
      80,
    ),
  };
}
function readInquiry(
  raw: unknown,
  duration: number,
  scenarioId: string,
): NonNullable<RecordView["inquiry"]> {
  const s = object(raw);
  if (
    !Array.isArray(s.evidence) ||
    s.evidence.length > 30 ||
    !Array.isArray(s.decisions) ||
    s.decisions.length > 100
  )
    throw new Error("조사 수첩의 크기를 확인해 주세요.");
  const evidence: Evidence[] = s.evidence.map((r: unknown, index: number) => {
    const v = object(r);
    if (
      v.id !== index + 1 ||
      !["before", "after"].includes(v.phase) ||
      !["fact", "opinion"].includes(v.kind) ||
      typeof v.used !== "boolean" ||
      number(v.time) > duration + 1e-5
    )
      throw new Error("조사 자료의 순서와 시점을 확인해 주세요.");
    const trial = v.trial ?? (v.phase === "before" ? 0 : 1);
    if (
      !Number.isInteger(trial) ||
      trial < 0 ||
      trial > s.decisions.length ||
      (v.phase === "before" ? trial !== 0 : trial === 0)
    )
      throw new Error("조사 자료의 실험 회차를 확인해 주세요.");
    return {
      id: v.id,
      phase: v.phase,
      kind: v.kind,
      trial,
      used: v.used,
      time: v.time,
      place: string(v.place, 120),
      text: string(v.text, 1600),
    };
  });
  const decisions: InquiryDecision[] = s.decisions.map((r: unknown) => {
    const v = object(r);
    if (
      !Array.isArray(v.evidenceIds) ||
      v.evidenceIds.length > 30 ||
      new Set(v.evidenceIds).size !== v.evidenceIds.length ||
      v.evidenceIds.some((id: unknown) => !evidence.some((e) => e.id === id)) ||
      !Array.isArray(v.policies) ||
      v.policies.length > 10 ||
      v.policies.some(
        (id: unknown) =>
          !getScenario(scenarioId).policies.some((p) => p.id === id),
      )
    )
      throw new Error("선택 근거를 확인해 주세요.");
    return {
      reason: string(v.reason, 400),
      alternative: string(v.alternative, 400),
      evidenceIds: v.evidenceIds,
      policies: v.policies,
    };
  });
  return {
    hypothesis: string(s.hypothesis, 400),
    proposal: string(s.proposal, 400),
    evidence,
    decisions,
  };
}
