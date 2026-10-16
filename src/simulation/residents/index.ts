import { WasteSimulation } from "../services/waste";
import { WaterSimulation, WATER_SITES, waterLevel } from "../water";
import { DumpingSimulation, DUMPING_SITES } from "../services/dumping";
import { ParkingSimulation, PARKING_SITES } from "../parking";
import type { TrafficSimulation } from "../../simulation";
import { formatSeconds } from "../../metrics";
import { FacilitySimulation } from "../facilities";
import { LogisticsSimulation } from "../economy";
export interface ResidentVoice {
  id: string;
  group: string;
  place: string;
  /** The actual building represented by this group, not its travel destination. */
  facilityId: string;
  position?: { x: number; z: number };
  summary: string;
  fact: string;
  opinion: string;
  change?: string;
}
export function residentVoices(
  sim: TrafficSimulation,
  baseline?: TrafficSimulation,
): ResidentVoice[] {
  if (sim instanceof WaterSimulation)
    return WATER_SITES.map((site, i) => {
      const s = sim.waterStats.sites[i],
        old =
          baseline instanceof WaterSimulation
            ? baseline.waterStats.sites[i]
            : undefined;
      return {
        id: site.id,
        facilityId: site.facilityId,
        position: { x: site.position.x - 16, z: site.position.z },
        group: site.group,
        place: site.name,
        summary: site.opinion,
        opinion: site.opinion,
        fact: `관찰 ${sim.round}차 · 가상 오염도 ${s.level.toFixed(1)} (${waterLevel(s.level)}) · 물 위 쓰레기 ${s.litter.toFixed(1)}봉투`,
        change: old
          ? `가상 오염도 ${old.level.toFixed(1)} → ${s.level.toFixed(1)}. 물 위 쓰레기 ${old.litter.toFixed(1)} → ${s.litter.toFixed(1)}봉투.`
          : undefined,
      };
    });
  if (sim instanceof DumpingSimulation)
    return DUMPING_SITES.map((site) => {
      const s = sim.dumpingStats.sites.find((s) => s.id === site.id)!,
        old =
          baseline instanceof DumpingSimulation
            ? baseline.dumpingStats.sites.find((s) => s.id === site.id)
            : undefined;
      return {
        id: site.id,
        facilityId: site.facilityId,
        position: site.position,
        group: site.group,
        place: site.name,
        summary: site.opinion,
        opinion: site.opinion,
        fact: `관찰 ${sim.round}차 · 투기물 ${s.remaining.toFixed(1)}봉투. 새 투기 ${s.newDumped}봉투 · 청소 뒤 재발 ${s.repeatDumped}봉투. 가까운 배출 장소 약 ${Math.round(s.nearestDistance)}m(가상).`,
        change: old
          ? `남은 투기물 ${old.remaining.toFixed(1)} → ${s.remaining.toFixed(1)}봉투. 정상 배출 장소의 넘침과 다른 수거장도 확인해요.`
          : undefined,
      };
    });
  if (sim instanceof ParkingSimulation)
    return PARKING_SITES.map((site) => {
      const s = sim.parkingStats.sites.find((s) => s.id === site.id)!;
      const old =
        baseline instanceof ParkingSimulation
          ? baseline.parkingStats.sites.find((s) => s.id === site.id)
          : undefined;
      return {
        id: `parking-${site.id}`,
        facilityId: site.facilityId,
        position: site.position,
        group: site.group,
        place: site.name,
        summary: site.opinion,
        opinion: site.opinion,
        fact: `불법주차 ${s.illegal}대 · 길을 차지한 시간 합계 ${(s.illegalSeconds / 60).toFixed(1)}분 · 보행로 ${s.sidewalkBlocked ? "막힘" : "열림"}`,
        change: old
          ? `길을 차지한 시간 합계: ${(old.illegalSeconds / 60).toFixed(1)} → ${(s.illegalSeconds / 60).toFixed(1)}분. ${s.legal}대는 정해진 자리를 이용했어요.`
          : undefined,
      };
    });
  if (sim instanceof LogisticsSimulation) {
    const requests = [
      ["북쪽 가게 주인", "작은 가게도 배송 순서에서 잊지 말아 주세요."],
      [
        "시장 상인",
        "손님이 오기 전에 물건이 도착하면 좋겠어요. 도착한 차에서 빨리 내려야 해요.",
      ],
      [
        "공원 옆 주민",
        "필요한 물건을 가까운 가게에서 사고 싶어요. 화물차 때문에 길이 더 막히지는 않을까요?",
      ],
      [
        "남쪽 가게 주인",
        "우리 가게만 좋아지는지, 다른 가게도 물건을 받는지 함께 살펴봐 주세요.",
      ],
    ];
    return [
      ...sim.shops.map((s, i) => {
        const previous =
          baseline instanceof LogisticsSimulation
            ? baseline.shops.find((shop) => shop.id === s.id)
            : undefined;
        const delta = previous ? s.unmet - previous.unmet : 0;
        return {
          id: s.id,
          facilityId: s.facilityId,
          group: requests[i][0],
          place: s.name,
          summary: requests[i][1],
          opinion: requests[i][1],
          fact: `재고 ${s.stock.toFixed(1)}상자 · 배송받음 ${s.delivered.toFixed(1)}상자 · 물건이 없어 못 산 양 ${s.unmet.toFixed(1)}상자`,
          change: previous
            ? Math.abs(delta) < 0.05
              ? "사지 못한 물량은 전과 비슷해요."
              : `사지 못한 물량이 ${Math.abs(delta).toFixed(1)}상자 ${delta < 0 ? "줄었어요" : "늘었어요"}.`
            : undefined,
        };
      }),
      {
        id: "producer",
        facilityId: "b15",
        group: "공장 배송 담당자",
        place: "새봄 생활용품 공장",
        summary:
          "물건을 만들어도 제때 보내야 해요. 이웃 마을 물자도 함께 살펴봐요.",
        opinion:
          "차만 늘리면 물건을 더 만들지는 못해요. 공장 재고와 길, 이웃 마을의 공급을 함께 살펴봐 주세요.",
        fact: `공장 새 생산 ${sim.logisticsStats.produced.toFixed(1)}상자 · 공장에서 상점 배송 ${sim.logisticsStats.localDelivered.toFixed(1)}상자 · 외부에서 상점 배송 ${sim.logisticsStats.externalDelivered.toFixed(1)}상자`,
      },
    ];
  }
  if (sim instanceof EnvironmentSimulation) {
    const stats = sim.environmentStats;
    const old =
      baseline instanceof EnvironmentSimulation
        ? baseline.environmentStats
        : undefined;
    return [
      [
        "b12",
        "남쪽 주민",
        "살 공간도 필요하지만 남은 녹지와 우리 집 주변 부담도 함께 봐 주세요.",
        "집도 필요하고, 우리 동네 나무도 지키고 싶어요.",
      ],
      [
        "b13",
        "공장 건너 주민",
        "완충 녹지를 만들어도 차가 줄어드는지는 따로 확인해 주세요.",
        "공장 옆에 나무를 심으면 어떨까요? 차도 살펴봐요.",
      ],
      [
        "b6",
        "학교 주변 보호자",
        "일터와 집이 늘면 등굣길의 차와 보행 대기가 어떻게 달라질지 궁금해요.",
        "집과 일터가 늘면 학교 앞 차도 많아질까요?",
      ],
      [
        "b15",
        "공장 근로자",
        "새 일터 이용 자리와 실제로 도착하는 출근 차량을 함께 살펴봐 주세요.",
        "일할 곳이 늘면 좋겠어요. 출근길도 편하면 좋겠고요.",
      ],
    ].map(([id, group, opinion, summary]) => {
      const region = stats.regions.find((r) => r.id === id)!;
      const previous = old?.regions.find((r) => r.id === id);
      const delta =
        previous?.meanBurden != null && region.meanBurden != null
          ? region.meanBurden - previous.meanBurden
          : null;
      return {
        id,
        facilityId: id,
        summary,
        group,
        place: region.name,
        fact: `관찰 중 평균 환경 부담 ${region.meanBurden === null ? "집계 전" : region.meanBurden.toFixed(1) + "점(가상)"}. 새 일터 ${stats.workCapacity}명분 · 거주 공간 ${stats.housingCapacity}명분 · 대상 녹지 ${stats.greenArea}㎡.`,
        opinion,
        change:
          delta === null
            ? undefined
            : `이 장소의 평균 부담이 ${Math.abs(delta) < 0.05 ? "비슷해요" : Math.abs(delta).toFixed(1) + "점 " + (delta < 0 ? "줄었어요" : "늘었어요")}. 기존 차량 도착은 ${old!.backgroundArrived}대에서 ${stats.backgroundArrived}대가 됐어요.`,
      };
    });
  }
  if (sim instanceof FacilitySimulation)
    return sim.access.map((row) => {
      const library = row.services.library,
        park = row.services.park;
      const previous =
        baseline instanceof FacilitySimulation
          ? baseline.access.find((r) => r.id === row.id)
          : undefined;
      const delta = previous ? row.served - previous.served : 0;
      const minutes = (seconds?: number) =>
        seconds === undefined ? "길 없음" : (seconds / 60).toFixed(1) + "분";
      const libraryWait = library.demand - library.served,
        parkWait = park.demand - park.served;
      return {
        id: row.id,
        facilityId: row.id,
        summary:
          libraryWait > parkWait
            ? "우리 동네에서도 도서관을 편하게 쓰고 싶어요."
            : parkWait > 0
              ? "가까운 공원에서 쉬고 뛰어놀고 싶어요."
              : "우리 동네는 괜찮아요. 먼 곳의 이웃도 살펴봐요.",
        group: `${row.name} 주민`,
        place: `${row.name} · 가상 ${row.population}명`,
        fact: `도서관 약 ${minutes(library.nearest?.route.seconds)}, 공원 약 ${minutes(park.nearest?.route.seconds)} 예상. 도서관 이용 가능 ${library.served}/${library.demand}명, 공원 ${park.served}/${park.demand}명.`,
        opinion:
          libraryWait > parkWait
            ? "책을 읽을 곳이 필요한데 이용하기 어려워요. 도서관 위치와 자리를 먼저 살펴봐 주세요."
            : parkWait > 0
              ? "가까운 곳에서 쉬거나 운동하고 싶어요. 도서관만 늘리면 우리에게 필요한 공원은 그대로예요."
              : "우리 동네는 이용할 수 있어요. 멀리 사는 이웃에게도 도움이 되는 계획이면 좋겠어요.",
        change: previous
          ? delta === 0
            ? `이용 가능한 주민 수는 그대로예요. 아직 ${row.unserved}명이 거리나 정원 때문에 이용하기 어려워요.`
            : `${Math.abs(delta)}명이 ${delta > 0 ? "더 이용할 수 있어요" : "이용하기 어려워졌어요"}. ${row.unserved}명은 여전히 이용하기 어려워요.`
          : undefined,
      };
    });
  if (sim instanceof WasteSimulation) {
    const requests = [
      [
        "북쪽 주민·보호자",
        "집 앞 쓰레기도 중요하지만 등굣길이 더 막히지는 않았으면 해요.",
        "쓰레기를 치워 주세요. 등굣길도 덜 막히면 좋겠어요.",
      ],
      [
        "학교 가는 길 주민",
        "냄새가 나기 전에 자주 수거해 주면 좋겠어요.",
        "냄새가 나기 전에 쓰레기를 가져가 주세요.",
      ],
      [
        "서쪽 끝 고령 주민",
        "가까운 길부터 돌면 우리 동네는 계속 마지막이 될까 걱정돼요.",
        "멀리 사는 우리 동네도 잊지 말아 주세요.",
      ],
      [
        "남쪽 주민·근로자",
        "분리배출에 참여할게요. 참여 방법도 쉽게 알려 주세요.",
        "쓰레기를 나눠 버리는 방법을 알려 주세요.",
      ],
      [
        "동쪽 상인",
        "손님이 오기 전에 수거해 주세요. 수거차가 오래 서 있으면 출입이 불편해요.",
        "손님이 오기 전에 쓰레기를 가져가 주세요.",
      ],
      [
        "학교 주변 보호자",
        "학생들이 건너는 동안에는 수거차도 꼭 기다려 주세요.",
        "쓰레기차도 길을 건너는 아이들을 기다려 주세요.",
      ],
    ];
    return sim.sites.map((site, i) => {
      const previous =
        baseline instanceof WasteSimulation
          ? baseline.sites.find((s) => s.id === site.id)
          : undefined;
      const delta = previous ? site.remaining - previous.remaining : 0;
      return {
        id: site.id,
        facilityId: site.facilityId,
        summary: requests[i][2],
        group: requests[i][0],
        place: site.name,
        fact: `남은 일반 쓰레기 ${site.remaining.toFixed(1)}봉투 · 수거한 양 ${site.collected.toFixed(1)}봉투 · 참여 설정 ${Math.round(site.participation * 100)}%`,
        opinion: requests[i][1],
        change: previous
          ? Math.abs(delta) < 0.05
            ? "시행 전후 남은 양이 비슷해요."
            : `시행 전보다 ${Math.abs(delta).toFixed(1)}봉투 ${delta > 0 ? "더 남아 있어요. 먼저 비워 달라는 요구가 이어져요." : "줄었어요. 다음 수거도 지켜보고 싶어요."}`
          : undefined,
      };
    });
  }
  return [
    {
      id: "families",
      facilityId: "b6",
      summary: "아이들이 학교 앞 길을 편하게 건너면 좋겠어요.",
      group: "학교 주변 보호자",
      place: "학교 앞",
      fact: `보행자 도착 ${sim.pedestrians.stats.arrived}명 · 1인당 대기 ${formatSeconds(sim.pedestrians.stats.averageWaitingTime)}`,
      opinion:
        "자동차가 빨리 가는 것만큼 아이들이 편하게 건너는 것도 중요해요.",
    },
    {
      id: "commuters",
      facilityId: "b4",
      summary: "출근길이 덜 막히면 좋겠어요. 이웃의 길도 살펴봐요.",
      group: "서쪽 주민·근로자",
      place: "등굣길과 출근길",
      fact: `일반 차량 도착 ${sim.stats.arrived}대 · 출발지 대기 ${sim.stats.queued}대`,
      opinion:
        "출근길이 편해지면 좋겠어요. 반대쪽 이웃이 너무 돌아가지는 않는지도 살펴봐 주세요.",
    },
  ];
}
import { EnvironmentSimulation } from "../environment";
