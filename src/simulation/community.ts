import type { LiveCitySimulation } from "./live";
import { PARKING_SITES, type ParkingRequest } from "./parking";
import { DUMPING_SITES } from "./services/dumping";
import { WATER_SOURCES } from "./water";
import type { PlacementTarget } from "../renderer/placement";
import type { AppliedPolicyMap } from "../policies/map";

export const COMMUNITY_PROJECTS = [
  {
    id: "walking",
    topic: "parking",
    title: "가까운 길 함께 걷기",
    description: "갈 수 있는 주민이 가까운 거리를 걸어 다녀요.",
    roles:
      "주민은 함께 걸을 시간과 길을 정하고, 시청은 안전한 보행로와 주차 공간을 살펴요.",
    limit:
      "이미 주차한 차는 그대로예요. 무거운 짐이나 이동의 어려움 때문에 차가 필요한 주민도 있어요.",
    voices: [
      {
        id: "child",
        name: "걸어 다니는 어린이",
        text: "보도에 차가 있으면 돌아가야 해요. 안전하게 함께 걸을 수 있으면 좋겠어요.",
      },
      {
        id: "driver",
        name: "차가 필요한 주민",
        text: "무거운 짐을 옮길 때는 차가 필요해요. 모두에게 걷기만 하라고 하면 어려워요.",
      },
      {
        id: "worker",
        name: "시간이 다른 주민",
        text: "정해진 시간에는 일하러 가요. 다른 시간에도 참여할 수 있으면 좋겠어요.",
      },
    ],
  },
  {
    id: "sorting",
    topic: "waste",
    title: "우리 골목 배출 약속",
    description: "주민들이 배출 장소와 방법을 서로 알려요.",
    roles:
      "주민은 배출 안내를 나누고, 시청은 가까운 배출함과 정기 수거를 맡아요.",
    limit:
      "이미 쌓인 봉투는 수거해야 해요. 배출함이 멀거나 가득 차면 안내만으로 부족해요.",
    voices: [
      {
        id: "neighbor",
        name: "골목 주민",
        text: "어디에 내놓는지 헷갈려요. 이웃끼리 쉽게 알려 주면 지키기 좋겠어요.",
      },
      {
        id: "collector",
        name: "환경미화원",
        text: "배출함이 가득 차면 수거도 필요해요. 주민의 안내 활동과 시청의 수거가 함께 가야 해요.",
      },
      {
        id: "worker",
        name: "시간이 다른 주민",
        text: "모이는 시간에는 일해요. 집에 돌아온 뒤 안내를 읽고 실천할 수도 있을까요?",
      },
    ],
  },
  {
    id: "waterCare",
    topic: "water",
    title: "생활하수 줄이기 약속",
    description: "주민과 가게가 기름을 따로 모으고 세제를 알맞게 써요.",
    roles:
      "주민과 가게는 생활 속 배출을 줄이고, 시청과 작업장은 하수 처리와 작업장 배출 관리를 맡아요.",
    limit:
      "선택한 생활하수 유입구에만 작용해요. 작업장 오염과 물 위 쓰레기는 따로 다뤄야 해요.",
    voices: [
      {
        id: "walker",
        name: "하천을 걷는 주민",
        text: "청소를 해도 물이 탁해요. 집과 가게에서 흘려보내는 것도 함께 살펴봐요.",
      },
      {
        id: "merchant",
        name: "음식점 주인",
        text: "기름을 따로 모을 수 있어요. 실천 방법을 함께 정하고 처리 시설도 살펴봐 주세요.",
      },
      {
        id: "worker",
        name: "시간이 다른 주민",
        text: "낮 모임에는 못 가요. 편한 시간에 방법을 배우고 실천하고 싶어요.",
      },
    ],
  },
] as const;
export type CommunityProjectId = (typeof COMMUNITY_PROJECTS)[number]["id"];
export const COMMUNITY_METHODS = [
  {
    id: "together",
    title: "정해진 시간에 모여 실천",
    cost: 5,
    preparation: 30,
    participation: 0.4,
    description:
      "준비가 짧고 예산이 적게 들어요. 그 시간에 올 수 있는 주민이 함께해요.",
  },
  {
    id: "flexible",
    title: "시간을 나누어 실천",
    cost: 10,
    preparation: 60,
    participation: 0.65,
    description:
      "안내와 준비에 예산·시간이 더 들어요. 모임에 못 오는 주민도 따로 참여해요.",
  },
] as const;
export type CommunityMethodId = (typeof COMMUNITY_METHODS)[number]["id"];
export const COMMUNITY_DURATION = 600;
export interface CommunityDecision {
  time: number;
  /** Interleave with policies at the same simulation tick, including old v1 saves. */
  policyCount: number;
  project: CommunityProjectId;
  target: string;
  method: CommunityMethodId;
  heard: string[];
  reason: string;
  concern: string;
  reflection: string;
}
export interface CommunityRecord extends CommunityDecision {
  before: number;
  startsAt: number;
  endsAt: number;
  started: boolean;
  result?: { time: number; after: number };
  walkingTrips: number;
  guidedBags: number;
  preventedPollution: number;
}
export const communityProject = (id: CommunityProjectId) =>
  COMMUNITY_PROJECTS.find((p) => p.id === id)!;
export const communityMethod = (id: CommunityMethodId) =>
  COMMUNITY_METHODS.find((m) => m.id === id)!;
export function communityTargets(id: CommunityProjectId): PlacementTarget[] {
  const sites =
    id === "walking"
      ? PARKING_SITES
      : id === "sorting"
        ? DUMPING_SITES
        : WATER_SOURCES.filter((s) => s.kind === "sewer").map((s) => ({
            ...s,
            position: { x: s.x, z: s.z },
          }));
  return sites.map((s) => ({
    id: s.id,
    name: s.name,
    position: s.position,
    width: 18,
    depth: 18,
    detail: "이곳의 문제를 함께 의논해요",
  }));
}

/** Voluntary, temporary participation. No approval score or guaranteed resolution. */
export class ResidentsCouncil {
  readonly records: CommunityRecord[] = [];
  private nextInvitation = 180;
  private invited = new Set<string>();
  constructor(private readonly city: LiveCitySimulation) {}
  get current() {
    return this.records.find((r) => this.city.time < r.endsAt - 1e-7);
  }
  private active(project: CommunityProjectId, target: string) {
    const r = this.current;
    return r &&
      r.project === project &&
      r.target === target &&
      this.city.time + 1e-7 >= r.startsAt
      ? r
      : undefined;
  }
  private measure(project: CommunityProjectId, target: string) {
    return project === "walking"
      ? this.city.parking.parkingStats.sites.find((s) => s.id === target)!
          .illegal
      : project === "sorting"
        ? this.city.illegal(target).remaining
        : this.city.values.water;
  }
  start(
    project: CommunityProjectId,
    target: string,
    method: CommunityMethodId,
    heard: string[],
    reason = "",
    concern = "",
  ) {
    const p = communityProject(project),
      m = communityMethod(method);
    if (!p || !m || !communityTargets(project).some((t) => t.id === target))
      throw new Error("활동과 지도 위치를 다시 살펴봐요.");
    if (this.current)
      throw new Error(
        "지금 약속한 활동을 마친 뒤 다음 활동을 의논해요. 활동을 도울 주민의 시간도 한정되어 있어요.",
      );
    if (this.records.length >= 100)
      throw new Error(
        "이 도시의 주민 회의 기록이 가득 찼어요. 기록을 파일로 저장해 주세요.",
      );
    if (
      !Array.isArray(heard) ||
      heard.length !== p.voices.length ||
      !p.voices.every((v) => heard.includes(v.id))
    )
      throw new Error("서로 다른 세 주민의 이야기를 먼저 들어 봐요.");
    if (this.city.budget < m.cost)
      throw new Error("준비 예산이 부족해요. 다음 운영 예산을 기다려요.");
    const r: CommunityRecord = {
      time: this.city.time,
      policyCount: this.city.actions.length,
      project,
      target,
      method,
      heard: [...heard],
      reason: reason.slice(0, 400),
      concern: concern.slice(0, 400),
      reflection: "",
      before: this.measure(project, target),
      startsAt: this.city.time + m.preparation,
      endsAt: this.city.time + m.preparation + COMMUNITY_DURATION,
      started: false,
      walkingTrips: 0,
      guidedBags: 0,
      preventedPollution: 0,
    };
    this.records.push(r);
    this.city.budget -= m.cost;
    this.announce(
      r,
      "주민 회의에서 정한 약속",
      `${p.title} · ${m.title}. 준비 뒤 10분 동안 함께 실천하고 다시 살펴봐요.`,
    );
    this.city.revision++;
    return r;
  }
  tick() {
    if (this.city.time + 1e-7 >= this.nextInvitation) {
      this.nextInvitation += 180;
      const issue = this.city.activeIssues.find(
        (i) =>
          ["parking", "waste", "water"].includes(i.topic) &&
          this.city.time - i.time >= 120 &&
          !this.invited.has(i.topic),
      );
      if (issue && !this.current) {
        this.invited.add(issue.topic);
        this.city.communityNews(
          issue.topic,
          "이 문제, 주민도 함께 의논해요",
          "불편이 계속되고 있어요. 동네 소식의 주민 회의에서 서로 다른 사정을 듣고, 함께 할 수 있는 일을 정해 봐요.",
          issue.position!,
          "시설과 행정의 역할도 함께 살펴봐요.",
        );
      }
    }
    for (const r of this.records) {
      if (!r.started && this.city.time + 1e-7 >= r.startsAt) {
        r.started = true;
        this.announce(
          r,
          "주민 활동을 시작했어요",
          `${communityProject(r.project).description} 참여하기 어려운 주민의 사정도 존중해요.`,
        );
        this.city.revision++;
      }
      if (!r.result && this.city.time + 1e-7 >= r.endsAt) {
        r.result = {
          time: this.city.time,
          after: this.measure(r.project, r.target),
        };
        const text =
          r.result.after < r.before - 0.1
            ? "불편이 줄었어요. 다른 정책과 수거·교통 변화도 함께 살펴봐요."
            : r.result.after > r.before + 0.1
              ? "전체 수치가 높아졌어요. 주민이 실천한 일과 다른 오염원·교통 변화도 함께 살펴봐요."
              : "전후 수치가 비슷해요. 주민이 실천한 일과 앞으로 필요한 도움을 함께 살펴봐요.";
        this.announce(
          r,
          "주민 활동을 돌아봐요",
          `${text} 다음 약속을 함께 정해요.`,
        );
        this.city.revision++;
      }
    }
  }
  private announce(r: CommunityRecord, title: string, text: string) {
    const p = communityProject(r.project),
      target = communityTargets(r.project).find((t) => t.id === r.target)!;
    this.city.communityNews(
      p.topic,
      title,
      text,
      target.position,
      r.result
        ? `${this.city.unit(p.topic)}: 회의 때 ${r.before.toFixed(1)} → 활동 뒤 ${r.result.after.toFixed(1)}. 여러 변화가 함께 반영돼요.`
        : target.name,
    );
  }
  chooseWalking(request: ParkingRequest) {
    const r = this.active("walking", request.siteId);
    if (
      this.city.parking.episodes.some(
        (e) =>
          e.phase !== "finished" &&
          e.request.siteId === request.siteId &&
          e.request.surface === request.surface,
      )
    )
      return false;
    // Stable per-request willingness; reopening the meeting never rerolls residents.
    const willingness =
      ((Math.imul(request.id ^ this.city.seed, 2654435761) >>> 0) % 1000) /
      1000;
    if (!r || willingness >= communityMethod(r.method).participation)
      return false;
    const site = PARKING_SITES.find((s) => s.id === request.siteId)!;
    this.city.pedestrians.scheduleDemand([
      {
        id: 2000000 + request.id,
        routeId: site.routeId,
        departAt: this.city.time + 1,
        speed: 1.2,
        color: request.color,
      },
    ]);
    r.walkingTrips++;
    return true;
  }
  awarenessBoost(target: string) {
    const r = this.active("sorting", target);
    return r ? 0.3 * communityMethod(r.method).participation : 0;
  }
  waterFactor(target: string) {
    const r = this.active("waterCare", target);
    return r ? 1 - 0.3 * communityMethod(r.method).participation : 1;
  }
  recordDisposal(target: string, amount: number) {
    const r = this.active("sorting", target);
    if (r) r.guidedBags += amount;
  }
  recordPrevention(target: string, amount: number) {
    const r = this.active("waterCare", target);
    if (r) r.preventedPollution += amount;
  }
  addMapMarkers(map: AppliedPolicyMap) {
    const r = this.current;
    if (!r) return;
    const p = communityProject(r.project),
      t = communityTargets(r.project).find((t) => t.id === r.target)!;
    map.places.push({
      id: `community-${r.project}-${r.target}`,
      name: t.name,
      scope: "주민이 함께 실천하는 곳",
      position: t.position,
      outlines: [],
      policies: [
        {
          id: r.project,
          title: p.title,
          detail: `${r.started ? "함께 실천 중" : "주민 활동 준비 중"} · ${p.description}`,
          tradeoff: p.limit,
        },
      ],
    });
  }
  save(): CommunityDecision[] {
    return this.records.map(
      ({
        time,
        policyCount,
        project,
        target,
        method,
        heard,
        reason,
        concern,
        reflection,
      }) => ({
        time,
        policyCount,
        project,
        target,
        method,
        heard: [...heard],
        reason,
        concern,
        reflection,
      }),
    );
  }
}
