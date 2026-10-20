import type { LiveCitySimulation } from "./live";
import { PARKING_SITES, type ParkingRequest } from "./parking";
import { DUMPING_SITES } from "./services/dumping";
import { WATER_SOURCES } from "./water";
import type { PlacementTarget } from "../renderer/placement";
import type { AppliedPolicyMap } from "../policies/map";
import { cityChangeText } from "./change-messages";

export const COMMUNITY_PROJECTS = [
  {
    id: "walking",
    topic: "parking",
    problem: "길을 막는 차와 불편한 보행",
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
    problem: "골목에 다시 쌓이는 쓰레기",
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
    problem: "생활하수로 더러워지는 하천",
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
    id: "relay",
    title: "이웃이 번갈아 안내",
    cost: 8,
    preparation: 45,
    participation: 0.55,
    description: "이웃이 차례로 방법을 알려요. 안내를 맡을 주민과 시간이 필요해요.",
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
export const COMMUNITY_HABIT_DURATION = 1200;
/** Full practice during the activity, followed by a gradual loss of the learned habit. */
export function communityHabitStrength(record: CommunityRecord, time: number) {
  if (time + 1e-7 < record.startsAt) return 0;
  return Math.max(0, Math.min(1, 1 - (time - record.endsAt) / COMMUNITY_HABIT_DURATION));
}
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
  /** Absent in historical meetings, which must not be given invented ballots. */
  vote?: CommunityVote;
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

const PROPOSALS: Record<CommunityProjectId, Record<CommunityMethodId, { title: string; text: string; concern: string }>> = {
  walking: {
    together: { title: "시간을 정해 함께 걷기", text: "가까운 길은 이웃과 함께 걸어요. 함께 갈 시간과 안전한 길을 정하면 좋겠어요.", concern: "모이는 시간에 올 수 없는 이웃은 참여하기 어려워요." },
    relay: { title: "이웃이 번갈아 걷는 길 안내", text: "안내할 이웃이 차례로 안전한 길을 알려 주면, 차를 덜 타고 걸어갈 수 있겠어요.", concern: "안내할 이웃이 필요하고, 짐이 많거나 이동이 어려우면 차가 필요해요." },
    flexible: { title: "각자 시간에 걷는 길 약속", text: "길 안내를 나누고 갈 수 있는 시간에 걸어요. 모임에 못 오는 이웃도 참여할 수 있어요.", concern: "안내를 준비할 예산과 시간이 더 들어요. 모든 이동을 걷기로 바꿀 수는 없어요." },
  },
  sorting: {
    together: { title: "함께 모여 배출 방법 익히기", text: "배출 장소에서 쓰레기를 어디에, 어떻게 내놓는지 함께 익히고 실천해요.", concern: "모이는 시간에 못 오는 이웃에게는 전달하기 어려워요." },
    relay: { title: "골목별로 번갈아 배출 안내", text: "이웃이 차례로 배출 장소와 방법을 알려 줘요. 헷갈리는 점도 물어볼 수 있어요.", concern: "안내를 맡을 이웃이 필요해요. 가득 찬 배출함은 시청이 수거해야 해요." },
    flexible: { title: "집마다 배출 안내를 나누기", text: "그림 안내를 집마다 나누면, 모임에 못 와도 자기 시간에 읽고 올바르게 버릴 수 있어요.", concern: "안내를 만드는 예산과 시간이 더 들어요. 멀거나 가득 찬 배출함 문제는 남아요." },
  },
  waterCare: {
    together: { title: "모여서 생활하수 줄이기 배우기", text: "기름 따로 모으기와 세제 알맞게 쓰기를 함께 배우고 집에서 실천해요.", concern: "모이는 시간에 올 수 없는 이웃은 참여하기 어려워요." },
    relay: { title: "가게와 이웃이 번갈아 실천 안내", text: "가게와 이웃이 차례로 기름과 세제 사용법을 알려 주며 생활하수를 줄여요.", concern: "안내할 사람과 시간이 필요해요. 작업장 배출은 별도로 관리해야 해요." },
    flexible: { title: "집과 가게에 실천 안내 나누기", text: "쉬운 안내를 나누면 낮에 일하는 이웃도 편한 시간에 배우고 실천할 수 있어요.", concern: "준비 예산과 시간이 더 들어요. 이미 흐르는 오염은 시설의 도움도 필요해요." },
  },
};
export function communityProposals(project: CommunityProjectId) {
  return COMMUNITY_METHODS.map((m, index) => ({ ...m, ...PROPOSALS[project][m.id], proposer: communityProject(project).voices[index] }));
}
export const communityProposal = (project: CommunityProjectId, method: CommunityMethodId) =>
  communityProposals(project).find(p => p.id === method)!;

// Eleven fictional residents have stable preferences. Votes are a classroom
// model, not a poll of real residents or a reward for the mayor's written answer.
const PREFERENCES: { reason: string; ranking: CommunityMethodId[] }[] = [
  { reason: "적은 예산으로 빨리 시작하고 싶어요.", ranking: ["together", "relay", "flexible"] },
  { reason: "함께 배우는 모임이 좋지만, 못 오는 날에는 안내를 읽고 싶어요.", ranking: ["together", "flexible", "relay"] },
  { reason: "가까운 이웃에게 직접 물어보고 싶어요.", ranking: ["relay", "together", "flexible"] },
  { reason: "번갈아 도우면 좋겠어요. 어려우면 안내로 참여할래요.", ranking: ["relay", "flexible", "together"] },
  { reason: "모임 시간이 맞지 않아 각자 실천하는 방법이 필요해요.", ranking: ["flexible", "relay", "together"] },
  { reason: "내 시간에 참여하고 싶어요. 함께 배우는 날도 있으면 좋겠어요.", ranking: ["flexible", "together", "relay"] },
];
export function communityVoters(seed: number, project: CommunityProjectId, target: string) {
  let hash = seed >>> 0;
  for (const char of `${project}:${target}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return Array.from({ length: 11 }, (_, i) => {
    hash ^= hash << 13; hash ^= hash >>> 17; hash ^= hash << 5;
    const preference = PREFERENCES[(hash >>> 0) % PREFERENCES.length];
    return { id: `resident-${i + 1}`, name: `주민 ${i + 1}`, ...preference, ranking: [...preference.ranking] };
  });
}
export interface CommunityVote {
  version: 1;
  budget: number;
  rounds: { candidates: CommunityMethodId[]; ballots: { voter: string; method: CommunityMethodId }[] }[];
  winner: CommunityMethodId;
}
export function holdCommunityVote(seed: number, project: CommunityProjectId, target: string, budget: number): CommunityVote {
  if (!communityProject(project) || !communityTargets(project).some(t => t.id === target) || !Number.isSafeInteger(budget) || budget < 0)
    throw new Error("회의의 문제·장소·예산을 다시 살펴봐요.");
  const candidates = COMMUNITY_METHODS.filter(m => m.cost <= budget).map(m => m.id);
  if (candidates.length < 2) throw new Error("두 가지 이상을 비교해 투표하려면 예산 8이 필요해요. 다음 운영 예산을 기다려요.");
  const voters = communityVoters(seed, project, target);
  const vote = (options: CommunityMethodId[]) => ({ candidates: options, ballots: voters.map(v => ({ voter: v.id, method: v.ranking.find(m => options.includes(m))! })) });
  const leaders = (round: CommunityVote["rounds"][number]) => {
    const counts = round.candidates.map(id => round.ballots.filter(b => b.method === id).length);
    return round.candidates.filter((_, i) => counts[i] === Math.max(...counts));
  };
  const rounds = [vote(candidates)];
  let winners = leaders(rounds[0]);
  if (winners.length > 1) { // With eleven votes and three options, only two can tie for first.
    rounds.push(vote(winners));
    winners = leaders(rounds[1]);
  }
  return { version: 1, budget, rounds, winner: winners[0] };
}
export function validateCommunityVote(value: CommunityVote, seed: number, project: CommunityProjectId, target: string, method: CommunityMethodId) {
  if (!value || value.version !== 1) throw new Error("주민투표 기록을 확인해 주세요.");
  const expected = holdCommunityVote(seed, project, target, value.budget);
  if (value.winner !== method || value.winner !== expected.winner || !Array.isArray(value.rounds) || value.rounds.length !== expected.rounds.length ||
    expected.rounds.some((r, i) => {
      const actual = value.rounds[i];
      return !actual || !Array.isArray(actual.candidates) || actual.candidates.join() !== r.candidates.join() || !Array.isArray(actual.ballots) || actual.ballots.length !== r.ballots.length ||
        r.ballots.some((b, j) => actual.ballots[j]?.voter !== b.voter || actual.ballots[j]?.method !== b.method);
    })) throw new Error("주민투표의 표수와 결정된 방법이 맞지 않아요.");
  return expected;
}
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
  private influence(project: CommunityProjectId, target: string) {
    let strongest: { record: CommunityRecord; participation: number } | undefined;
    for (const record of this.records) {
      if (record.project !== project || record.target !== target) continue;
      const participation = communityMethod(record.method).participation *
        communityHabitStrength(record, this.city.time);
      // Meetings refresh practice; repeating one never stacks unlimited bonuses.
      if (participation > (strongest?.participation ?? 0)) strongest = { record, participation };
    }
    return strongest;
  }
  private measure(project: CommunityProjectId, target: string) {
    return project === "walking"
      ? this.city.parking.parkingStats.sites.find((s) => s.id === target)!
          .illegal
      : project === "sorting"
        ? this.city.illegal(target).remaining
        : this.city.values.water;
  }
  /** Retains historical commands; new player decisions go through decide(). */
  start(
    project: CommunityProjectId,
    target: string,
    method: CommunityMethodId,
    heard: string[],
    reason = "",
    concern = "",
    vote?: CommunityVote,
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
    if (vote) {
      validateCommunityVote(vote, this.city.seed, project, target, method);
      if (vote.budget !== this.city.budget) throw new Error("투표 때와 예산이 달라요. 회의를 다시 열어 주세요.");
    }
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
      ...(vote ? { vote: structuredClone(vote) } : {}),
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
      vote ? `주민투표로 ‘${communityProposal(project, method).title}’을 정했어요. 다른 의견도 살피며 준비 뒤 10분 동안 실천해요.` : `${p.title} · ${m.title}. 준비 뒤 10분 동안 함께 실천하고 다시 살펴봐요.`,
    );
    this.city.revision++;
    return r;
  }
  decide(project: CommunityProjectId, target: string, heard: string[], vote: CommunityVote, reason = "", concern = "") {
    if (!vote) throw new Error("주민들의 제안을 듣고 투표를 먼저 진행해요.");
    return this.start(project, target, vote.winner, heard, reason, concern, vote);
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
        const direction =
          r.result.after < r.before - 0.1
            ? "less"
            : r.result.after > r.before + 0.1
              ? "more"
              : "same";
        const text = cityChangeText(
          communityProject(r.project).topic,
          direction,
        );
        this.announce(
          r,
          "주민 활동을 돌아봐요",
          `${text} 익힌 습관은 이후 20분 동안 서서히 약해져요. 다른 정책과 생활 변화도 살피며 다음 약속을 정해요.`,
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
    const influence = this.influence("walking", request.siteId);
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
    if (!influence || willingness >= influence.participation)
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
    influence.record.walkingTrips++;
    return true;
  }
  awarenessBoost(target: string) {
    return 0.5 * (this.influence("sorting", target)?.participation ?? 0);
  }
  waterFactor(target: string) {
    return 1 - 0.3 * (this.influence("waterCare", target)?.participation ?? 0);
  }
  recordDisposal(target: string, amount: number) {
    const influence = this.influence("sorting", target);
    if (influence) influence.record.guidedBags += amount;
  }
  recordPrevention(target: string, amount: number) {
    const influence = this.influence("waterCare", target);
    if (influence) influence.record.preventedPollution += amount;
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
          title: r.vote ? communityProposal(r.project, r.method).title : p.title,
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
        vote,
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
        ...(vote ? { vote: structuredClone(vote) } : {}),
      }),
    );
  }
}
