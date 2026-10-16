import { LiveCitySimulation } from "../simulation/live";
import type { TrafficSimulation } from "../simulation";
import {
  WaterSimulation,
  WATER_POLICIES,
  waterTargets,
  type WaterPolicyId,
} from "../simulation/water";
import {
  DumpingSimulation,
  DUMPING_SITES,
  DUMPING_POLICIES,
  dumpingBinPosition,
  type DumpingPolicyId,
} from "../simulation/services/dumping";
import {
  ParkingSimulation,
  PARKING_POLICIES,
  PARKING_SITES,
} from "../simulation/parking";
import { BUILDABLE_PLOTS, RIVER } from "../city/world";
import type { Vec2 } from "../types";
import { SCHOOL_NODE } from "../scenario";
import { POLICIES } from "./index";
import { LogisticsSimulation, LOGISTICS_POLICIES } from "../simulation/economy";
import { CITY_FACILITIES } from "../city/data";
import { WasteSimulation, WASTE_POLICIES } from "../simulation/services/waste";
import {
  FacilitySimulation,
  FACILITY_POLICIES,
  FACILITY_SITES,
} from "../simulation/facilities";
import {
  EnvironmentSimulation,
  ENVIRONMENT_POLICIES,
  DEVELOPMENT_SITES,
  BUFFER_STRIPS,
} from "../simulation/environment";

export interface AppliedPolicy {
  id: string;
  title: string;
  detail: string;
  tradeoff: string;
}
export interface PolicyPlace {
  id: string;
  name: string;
  scope: string;
  note?: string;
  policies: AppliedPolicy[];
  position?: Vec2;
  outlines: Vec2[][];
}
export interface AppliedPolicyMap {
  places: PolicyPlace[];
  shared: PolicyPlace[];
}
const rectangle = (x: number, z: number, w: number, d: number): Vec2[] => [
  { x: x - w / 2, z: z - d / 2 },
  { x: x + w / 2, z: z - d / 2 },
  { x: x + w / 2, z: z + d / 2 },
  { x: x - w / 2, z: z + d / 2 },
];

/** Read the running simulation, never the policy form's unsubmitted choices. */
export function appliedPolicyMap(sim: TrafficSimulation): AppliedPolicyMap {
  if (sim instanceof LiveCitySimulation) return sim.policyMap;
  const places: PolicyPlace[] = [],
    shared: PolicyPlace[] = [];
  const definitions =
    sim instanceof WaterSimulation
      ? WATER_POLICIES
      : sim instanceof DumpingSimulation
        ? DUMPING_POLICIES
        : sim instanceof ParkingSimulation
          ? PARKING_POLICIES
          : sim instanceof LogisticsSimulation
            ? LOGISTICS_POLICIES
            : sim instanceof WasteSimulation
              ? WASTE_POLICIES
              : sim instanceof FacilitySimulation
                ? FACILITY_POLICIES
                : sim instanceof EnvironmentSimulation
                  ? ENVIRONMENT_POLICIES
                  : POLICIES;
  const policy = (id: string, detail: string): AppliedPolicy => {
    const p = definitions.find((p) => p.id === id)!;
    return { id, title: p.title, detail, tradeoff: p.tradeoff };
  };
  if (sim instanceof WaterSimulation) {
    for (const id of sim.policyIds as WaterPolicyId[]) {
      const target = waterTargets(id).find((t) => t.id === sim.plan[id])!;
      places.push({
        id: `water-${id}`,
        name: target.name,
        scope: id === "sewer" ? "이 공터 · 연결된 하수관" : "이 지점에 적용",
        position: target.position,
        outlines: [
          rectangle(
            target.position.x,
            target.position.z,
            id === "sewer" ? 12 : target.width,
            id === "sewer" ? 12 : target.depth,
          ),
          ...(id === "riverCleanup"
            ? [rectangle(RIVER.x, target.position.z + 18, 22, 1.1)]
            : []),
        ],
        policies: [
          policy(id, WATER_POLICIES.find((p) => p.id === id)!.description),
        ],
      });
    }
    return { places, shared };
  }
  if (sim instanceof DumpingSimulation) {
    for (const site of DUMPING_SITES) {
      const ids = sim.policyIds.filter(
        (id) => sim.plan[id as DumpingPolicyId] === site.id,
      );
      if (!ids.length) continue;
      const p =
        ids.length === 1 && ids[0] === "dropoff"
          ? dumpingBinPosition(site.id)
          : site.position;
      places.push({
        id: `dumping-${site.id}`,
        name: site.name,
        scope: "이 현장에 적용",
        position: p,
        outlines: ids.map((id) => {
          const pos =
            id === "dropoff" ? dumpingBinPosition(site.id) : site.position;
          return rectangle(
            pos.x,
            pos.z,
            id === "dropoff" ? 3 : 12,
            id === "dropoff" ? 4 : 12,
          );
        }),
        policies: ids.map((id) =>
          policy(
            id,
            id === "cleanup"
              ? "기존 수거차가 이곳부터 방문해요. 도착해 치운 만큼만 줄어요."
              : id === "dropoff"
                ? "12㎡ 배출 공간 · 16봉투 보관. 넘친 정상 배출은 투기물과 구분해요."
                : "2차 관찰부터 일부 주민이 참여해요. 이미 쌓인 봉투는 치우지 않아요.",
          ),
        ),
      });
    }
    return { places, shared };
  }
  if (sim instanceof ParkingSimulation) {
    for (const id of sim.policyIds) {
      const lot = BUILDABLE_PLOTS.find((p) => p.id === sim.plan.siteId)!;
      const site = PARKING_SITES.find(
        (s) =>
          s.id ===
          (id === "patrol" ? sim.plan.patrolSite : sim.plan.loadingSite),
      )!;
      const position =
        id === "parkingLot"
          ? lot.position
          : id === "loadingBay"
            ? sim.bayPose(site.id)
            : site.position;
      places.push({
        id: `parking-${id}`,
        name: id === "parkingLot" ? lot.name : site.name,
        scope: "이 장소에 적용",
        position,
        outlines: [
          rectangle(
            position.x,
            position.z,
            id === "parkingLot" ? lot.width : 18,
            id === "parkingLot" ? lot.depth : 18,
          ),
        ],
        policies: [
          policy(
            id,
            id === "parkingLot"
              ? `${sim.lotCapacity}대 주차 · 다른 시설에 쓸 공터를 사용해요.`
              : id === "patrol"
                ? "이 현장의 불법주차만 안내·단속해요."
                : "150초 이내 정차 차량 1대가 이용해요.",
          ),
        ],
      });
    }
    return { places, shared };
  }
  if (sim instanceof LogisticsSimulation) {
    if (sim.configuration.shortcut) {
      const road = [...sim.network.roads.values()].find((r) => r.bypass)!;
      const a = sim.network.nodes.get(road.startNodeId)!.position,
        b = sim.network.nodes.get(road.endNodeId)!.position;
      const position = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
      places.push({
        id: "logistics-shortcut",
        name: "학교 북쪽 물류 지름길",
        scope: "이 도로에 적용",
        position,
        outlines: [
          rectangle(
            position.x,
            position.z,
            Math.abs(a.x - b.x) || 10,
            Math.abs(a.z - b.z) || 10,
          ),
        ],
        policies: [
          policy(
            "shortcut",
            "끊긴 구간을 양방향으로 이었어요. 화물차와 일반 차량 모두 새 길을 선택할 수 있어요.",
          ),
        ],
      });
    }
    if (sim.configuration.handling) {
      const shop = CITY_FACILITIES.find((f) => f.id === "b7")!;
      places.push({
        id: "logistics-handling",
        name: "상점 네 곳 하역 지원",
        scope: "테두리 친 네 상점",
        position: shop.position,
        outlines: sim.shops.map((s) => {
          const p = CITY_FACILITIES.find(
            (f) => f.id === s.facilityId,
          )!.position;
          return rectangle(p.x, p.z, 34, 34);
        }),
        policies: [
          policy(
            "handling",
            "네 상점에서 물자를 내리는 속도를 초당 0.8상자에서 1.4상자로 늘렸어요. 도착한 화물차에만 적용해요.",
          ),
        ],
      });
    }
    if (sim.configuration.diversify) {
      const s = sim.sources.find((s) => s.id === "west-region")!;
      places.push({
        id: "logistics-diversify",
        name: "강빛마을 교류 입구",
        scope: "이 입구에 적용",
        position: s.position,
        outlines: [rectangle(s.position.x, s.position.z, 10, 10)],
        policies: [
          policy(
            "diversify",
            "서쪽 마을의 물자가 준비돼요. 외부 담당 차량이 서쪽·동쪽 입구를 번갈아 방문해요.",
          ),
        ],
      });
    }
    if (sim.configuration.trucks === 3)
      shared.push({
        id: "logistics-trucks",
        name: "동네 전체 배송 운영",
        scope: "동네 전체",
        outlines: [],
        policies: [
          policy(
            "cargoTruck",
            "화물차 3대가 상점 네 곳을 나누어 배송해요. 공장의 생산량은 그대로예요.",
          ),
        ],
      });
  } else if (sim instanceof WasteSimulation) {
    const details: Record<string, string> = {
      extraTruck: `동네 수거차를 2대에서 ${sim.trucks.length}대로 늘렸어요. 여러 수거 지역을 나누어 맡아요.`,
      route:
        "수거 순서를 바꾸어 남쪽·서쪽을 먼저 방문해요. 먼저 돌던 지역은 더 기다릴 수 있어요.",
      reduce: `수거 지역 ${sim.sites.length}곳에서 참여한 만큼 새 일반 쓰레기를 줄여요. 이미 쌓인 양은 그대로예요.`,
    };
    for (const id of sim.policyIds)
      shared.push({
        id: `waste-${id}`,
        name: "동네 전체 수거 지역",
        scope: "동네 전체",
        policies: [policy(id, details[id])],
        outlines: [],
      });
  } else if (sim instanceof FacilitySimulation) {
    for (const f of sim.facilities) {
      const policies: AppliedPolicy[] = [];
      if (f.isNew)
        policies.push(
          policy(
            f.kind,
            `${f.name}에 하루 ${f.capacity}명분의 이용 자리를 만들었어요.`,
          ),
        );
      if (f.id === "library-existing") {
        if (sim.configuration.expand)
          policies.push(
            policy(
              "expand",
              `기존 도서관의 하루 이용 자리가 80명분에서 ${f.capacity}명분으로 늘었어요.`,
            ),
          );
        if (sim.configuration.gate)
          policies.push(
            policy(
              "gate",
              "이 도서관의 서쪽 출입로를 열어 돌아가는 보행 경로를 줄였어요.",
            ),
          );
      }
      if (policies.length)
        places.push({
          id: f.id,
          name: f.name,
          scope: "이 시설에 적용",
          position: f.position,
          policies,
          outlines: [
            rectangle(
              f.position.x,
              f.position.z,
              FACILITY_SITES.find((s) => s.id === f.siteId)?.width ?? 23,
              FACILITY_SITES.find((s) => s.id === f.siteId)?.depth ?? 20,
            ),
          ],
        });
    }
  } else if (sim instanceof EnvironmentSimulation) {
    for (const site of DEVELOPMENT_SITES) {
      const parcel = sim.parcels.find((p) => p.id === site.id)!;
      const policies: AppliedPolicy[] = [],
        outlines: Vec2[][] = [];
      if (parcel.developedArea) {
        policies.push(
          policy(
            site.id,
            `${parcel.developedArea}㎡를 개발하고 ${site.id === "industry" ? "일터" : "거주 공간"} ${parcel.capacity}명분을 늘렸어요.`,
          ),
        );
        const w = parcel.developedArea / 12;
        outlines.push(
          rectangle(site.position.x + 12 - w / 2, site.position.z, w, 12),
        );
      }
      if (sim.configuration.conserve) {
        policies.push(
          policy(
            "conserve",
            `이 부지의 녹지 ${parcel.protectedArea}㎡를 보전해요. 개발할 수 있는 곳은 나머지 96㎡예요.`,
          ),
        );
        const w = parcel.protectedArea / 12;
        outlines.push(
          rectangle(site.position.x - 12 + w / 2, site.position.z, w, 12),
        );
      }
      if (policies.length)
        places.push({
          id: site.id,
          name: site.name,
          scope: "이 부지에 적용",
          position: site.position,
          policies,
          outlines,
        });
    }
    if (sim.configuration.buffer)
      places.push({
        id: "buffer",
        name: "공장 서쪽 두 녹지 띠",
        scope: "이 녹지 띠에 적용",
        position: { x: 202, z: 168 },
        policies: [
          policy(
            "buffer",
            "공장 서쪽의 두 녹지 띠에 나무를 심었어요. 도로가 지나는 틈은 비워 둬요.",
          ),
        ],
        outlines: BUFFER_STRIPS.map((s) =>
          rectangle(
            (s.minX + s.maxX) / 2,
            (s.minZ + s.maxZ) / 2,
            s.maxX - s.minX,
            s.maxZ - s.minZ,
          ),
        ),
      });
    if (sim.configuration.small)
      shared.push({
        id: "small",
        name: "이번 계획의 개발 부지",
        scope: "개발 부지 공통",
        outlines: [],
        note:
          sim.configuration.industry || sim.configuration.housing
            ? undefined
            : "개발 선택 없음 · 변화 없음",
        policies: [
          policy(
            "small",
            sim.configuration.industry || sim.configuration.housing
              ? "선택한 새 산업·주거 개발을 각각 96㎡로 제한해요. 기존 건물은 줄이지 않아요."
              : "개발을 선택하지 않아 줄어드는 건물이나 차량은 없어요. 정책 예산 10은 사용했어요.",
          ),
        ],
      });
  } else {
    if (sim.policy.signal) {
      const node = sim.network.nodes.get(SCHOOL_NODE)!;
      places.push({
        id: "signal",
        name: "학교 앞 교차로",
        scope: "이 교차로에 적용",
        position: node.position,
        policies: [
          policy(
            "signal",
            `동서 초록불 ${node.signal.ew}초 · 남북 초록불 ${node.signal.ns}초로 바꿨어요.`,
          ),
        ],
        outlines: [rectangle(node.position.x, node.position.z, 17, 17)],
      });
    }
    for (const road of sim.network.roads.values()) {
      const id = road.bypass
        ? "bypass"
        : road.direction === "one-way"
          ? "oneWay"
          : undefined;
      if (!id || !sim.policy[id]) continue;
      const a = sim.network.nodes.get(road.startNodeId)!.position,
        b = sim.network.nodes.get(road.endNodeId)!.position;
      const position = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
      places.push({
        id,
        name: id === "bypass" ? "학교 북쪽 우회도로" : "학교 가는 길 서쪽",
        scope: "이 도로에 적용",
        position,
        policies: [
          policy(
            id,
            id === "bypass"
              ? "이 구간에 양방향 우회도로를 새로 이었어요."
              : "이 구간의 두 차로가 모두 학교 쪽으로 향해요.",
          ),
        ],
        outlines: [
          rectangle(
            position.x,
            position.z,
            Math.abs(a.x - b.x) || 10,
            Math.abs(a.z - b.z) || 10,
          ),
        ],
      });
    }
  }
  return { places, shared };
}
