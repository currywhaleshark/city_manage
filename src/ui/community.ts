import type { LiveCitySimulation } from "../simulation/live";
import {
  COMMUNITY_PROJECTS,
  COMMUNITY_METHODS,
  communityProject,
  communityMethod,
  communityTargets,
  type CommunityProjectId,
  type CommunityMethodId,
  type CommunityRecord,
} from "../simulation/community";

const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const stamp = (t: number) =>
  `${Math.floor(Math.max(0, t) / 60)}:${String(Math.floor(Math.max(0, t) % 60)).padStart(2, "0")}`;
export interface MeetingDraft {
  project: CommunityProjectId;
  target: string;
  wasPaused: boolean;
  voice: number;
  heard: string[];
  method?: CommunityMethodId;
  reason: string;
  concern: string;
}
export function communityStatus(sim: LiveCitySimulation) {
  const r = sim.council.current;
  return r
    ? `${communityProject(r.project).title} · ${sim.time < r.startsAt ? "준비" : "실천"} ${stamp((sim.time < r.startsAt ? r.startsAt : r.endsAt) - sim.time)} 남음`
    : "다음 문제를 함께 의논할 수 있어요.";
}
export function communityOverview(sim: LiveCitySimulation) {
  const records = sim.council.records;
  return `<p class="intro">우리 동네 일은 주민도 함께 결정하고 실천해요. 서로 다른 사정을 듣고, 바꿀 수 있는 일부터 약속해 봐요.</p>
    <p class="community-status" id="community-status" role="status">${communityStatus(sim)}</p>
    ${records.length ? `<button class="secondary wide" data-community-record="${records.length - 1}">최근 주민 활동과 결과 보기</button>` : ""}
    <div class="live-policy-list">${COMMUNITY_PROJECTS.map((p) => `<button class="live-policy" data-community-project="${p.id}" ${sim.council.current ? "disabled" : ""}><strong>${p.title}</strong><span>${p.description}</span><small>${sim.activeIssues.some((i) => i.topic === p.topic) ? "이 분야에 주민의 부탁이 있어요" : "문제가 다시 생기지 않게 함께 살펴봐요"}</small></button>`).join("")}</div>
    <p class="metric-note">한 번에 한 활동을 준비해요. 주민의 시간도 한정되어 있어요.<br>회의에서 듣기 → 방법 정하기 → 함께 실천 → 다시 살펴보기</p>`;
}
export function communityListening(d: MeetingDraft) {
  const p = communityProject(d.project),
    v = p.voices[d.voice],
    t = communityTargets(d.project).find((t) => t.id === d.target)!;
  return `<span class="live-target">${t.name}</span><p class="community-step">1. 서로 다른 의견 듣기 · ${d.voice + 1} / ${p.voices.length}</p>
    <article class="community-voice"><strong>${v.name}</strong><p>“${v.text}”</p></article>
    <p class="metric-note">모두 같은 생각을 하지는 않아요. 이 주민에게 필요한 것은 무엇일까요?</p>
    <div class="live-actions">${d.voice ? '<button id="community-previous">이전 의견</button>' : '<button id="cancel-meeting">나중에 의논하기</button>'}<button class="primary" id="community-next">${d.voice < p.voices.length - 1 ? "다음 주민 의견" : "의견을 모아 결정하기"}</button></div>`;
}
export function communityPlan(d: MeetingDraft, budget: number) {
  const p = communityProject(d.project),
    m = d.method && communityMethod(d.method);
  return `<span class="live-target">${communityTargets(d.project).find((t) => t.id === d.target)!.name}</span><p class="community-step">2. 실천할 방법 정하기</p>
    <p class="intro">${p.roles}</p><div class="live-policy-list" role="group" aria-label="참여 방법">${COMMUNITY_METHODS.map((m) => `<button class="live-policy community-method" data-community-method="${m.id}" aria-pressed="${d.method === m.id}"><strong>${m.title}<em>예산 ${m.cost}</em></strong><span>${m.description}</span><small>준비 ${m.preparation}초 · 실천 10분</small></button>`).join("")}</div>
    <p class="tradeoff">${p.limit}</p>
    <label class="decision-reason">이 방법을 고른 까닭 <small>말로 나누고 넘어가도 돼요</small><textarea id="community-reason" maxlength="400" rows="2" placeholder="어떤 의견과 자료를 참고했나요?">${escape(d.reason)}</textarea></label>
    <label class="decision-reason">놓치지 않을 다른 의견<textarea id="community-concern" maxlength="400" rows="2" placeholder="참여하기 어려운 이웃에게 무엇이 필요할까요?">${escape(d.concern)}</textarea></label>
    <p class="metric-note">${m ? `예산 ${budget} → ${budget - m.cost}` : "두 방법을 살펴보고 하나를 골라요."}<br>활동 기간이 끝나면 효과도 멈춰요. 결과를 보고 다음 약속을 정해요.</p>
    <div class="live-actions"><button id="community-back">의견 다시 듣기</button><button class="primary" id="start-community" ${!m || budget < m.cost ? "disabled" : ""}>이 약속으로 실천</button></div>`;
}
export function communityRecord(sim: LiveCitySimulation, index: number) {
  const r = sim.council.records[index],
    p = communityProject(r.project),
    m = communityMethod(r.method);
  return `<span class="live-target">${communityTargets(r.project).find((t) => t.id === r.target)!.name}</span>
    <p class="community-step">${r.result ? "4. 결과를 다시 살펴보기" : "3. 주민이 함께 실천하기"}</p>
    ${r.result ? `<div class="community-comparison"><span>${sim.unit(p.topic)}</span><strong>${r.before.toFixed(1)} → ${r.result.after.toFixed(1)}</strong><small>${stamp(r.time)} 회의 때 → ${stamp(r.result.time)} 활동 뒤</small></div><p class="metric-note">수치는 이 기간의 실제 변화예요. 수거·교통·다른 정책도 함께 바뀌었으니 주민 활동만의 효과로 단정하지 않아요.</p>` : `<p class="community-status" id="community-status">${communityStatus(sim)}</p><p class="metric-note">활동이 끝나면 이곳에 당시 결과가 남아요.</p>`}
    ${!r.result ? `<button class="secondary wide" data-community-record="${index}">활동 결과 확인</button>` : ""}<div class="community-contribution"><strong>주민이 함께 바꾼 일</strong><p>${r.project === "walking" ? `새로 걷기를 선택한 이동 ${r.walkingTrips}건` : r.project === "sorting" ? `배출 안내로 지정 장소에 향한 쓰레기 ${r.guidedBags.toFixed(1)}봉투` : `선택한 유입구에서 새로 생길 오염을 ${r.preventedPollution.toFixed(1)}만큼 줄였어요. (가상 단위)`}</p></div><p class="intro">${p.limit}</p>
    <details><summary>회의에서 나눈 이야기</summary><p>${m.title} · 준비 예산 ${m.cost}</p>${p.voices.map((v) => `<p><b>${v.name}</b><br>${v.text}</p>`).join("")}<p>고른 까닭: ${escape(r.reason || "말로 의견을 나눴어요.")}</p><p>함께 살필 의견: ${escape(r.concern || "글로 남긴 의견은 없어요.")}</p><p>${p.roles}</p></details>
    <label class="decision-reason">잘된 점과 다음에 바꿀 점<textarea data-community-reflection="${index}" maxlength="400" rows="3" placeholder="불편이 남은 이웃에게 무엇이 더 필요할까요?">${escape(r.reflection)}</textarea></label>
    <div class="live-actions"><button data-panel-open="policy">필요한 정책 살펴보기</button><button data-panel-open="community">다음 주민 회의</button></div>`;
}
export function communityHistory(records: CommunityRecord[]) {
  return `<details><summary>주민이 함께 정한 약속 ${records.length}개</summary>${records.map((r, i) => `<button class="live-news wide" data-community-record="${i}"><small>${stamp(r.time)} · ${r.result ? "활동 마침" : "활동 기록"}</small><strong>${communityProject(r.project).title}</strong><span>${escape(r.reason || "서로 다른 주민의 이야기를 듣고 방법을 정했어요.")}</span></button>`).join("")}</details>`;
}
