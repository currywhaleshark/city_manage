import type { LiveCitySimulation } from "../simulation/live";
import {
  COMMUNITY_PROJECTS,
  communityProject,
  communityMethod,
  communityTargets,
  communityProposals,
  communityProposal,
  communityVoters,
  communityHabitStrength,
  COMMUNITY_HABIT_DURATION,
  type CommunityProjectId,
  type CommunityVote,
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
  vote?: CommunityVote;
  round: number;
  phase: "listening" | "comparing" | "voting" | "result";
  reason: string;
  concern: string;
}
export function communityStatus(sim: LiveCitySimulation) {
  const r = sim.council.current;
  return r
    ? `${r.vote ? communityProposal(r.project, r.method).title : communityProject(r.project).title} · ${sim.time < r.startsAt ? "준비" : "실천"} ${stamp((sim.time < r.startsAt ? r.startsAt : r.endsAt) - sim.time)} 남음`
    : sim.council.records.some(record => communityHabitStrength(record, sim.time) > 0)
      ? "익힌 습관을 이어가고 있어요. 다음 문제도 함께 의논할 수 있어요."
      : "다음 문제를 함께 의논할 수 있어요.";
}
export function communityOverview(sim: LiveCitySimulation) {
  const records = sim.council.records;
  return `<p class="intro">우리 동네 일은 주민도 함께 결정하고 실천해요. 서로 다른 사정을 듣고, 바꿀 수 있는 일부터 약속해 봐요.</p>
    <p class="community-status" id="community-status" role="status">${communityStatus(sim)}</p>
    ${records.length ? `<button class="secondary wide" data-community-record="${records.length - 1}">최근 주민 활동과 결과 보기</button>` : ""}
    <p class="community-step">어떤 문제로 주민회의를 열까요?</p>
    <div class="live-policy-list">${COMMUNITY_PROJECTS.map((p) => `<button class="live-policy" data-community-project="${p.id}" ${sim.council.current ? "disabled" : ""}><strong>${p.problem}</strong><span>장소를 고르고, 주민들이 제안할 방법을 들어요.</span><small>${sim.activeIssues.some((i) => i.topic === p.topic) ? "이 분야에 주민의 부탁이 있어요" : "문제가 다시 생기지 않게 함께 살펴봐요"}</small></button>`).join("")}</div>
    <p class="metric-note">문제와 장소 → 주민 제안 → 주민투표 → 함께 실천 → 돌아보기<br>한 번에 한 활동을 준비해요. 주민의 시간도 한정되어 있어요.</p>`;
}
export function communityListening(d: MeetingDraft) {
  const p = communityProject(d.project),
    v = p.voices[d.voice],
    t = communityTargets(d.project).find((t) => t.id === d.target)!,
    proposal = communityProposals(d.project)[d.voice];
  return `<span class="live-target">${t.name}</span><p class="community-step">1. 주민회의 · 제안 ${d.voice + 1} / ${p.voices.length}</p>
    <article class="community-voice"><strong>${v.name}</strong><p>“${v.text}”</p><h3>${proposal.title}</h3><p>“${proposal.text}”</p></article>
    <p class="tradeoff">함께 생각할 점: ${proposal.concern}</p>
    <p class="metric-note">시장은 서로 다른 제안을 듣고, 주민들이 비교할 수 있도록 도와요.</p>
    <div class="live-actions">${d.voice ? '<button id="community-previous">이전 제안</button>' : '<button id="cancel-meeting">회의 미루기</button>'}<button class="primary" id="community-next">${d.voice < p.voices.length - 1 ? "다음 주민 제안" : "세 가지 제안 비교하기"}</button></div>`;
}
export function communityPlan(d: MeetingDraft, budget: number) {
  const p = communityProject(d.project), proposals = communityProposals(d.project),
    eligible = proposals.filter(m => m.cost <= budget).length;
  return `<span class="live-target">${communityTargets(d.project).find(t => t.id === d.target)!.name}</span><p class="community-step">2. 제안 비교 · 현재 예산 ${budget}</p>
    <div class="community-proposals">${proposals.map(m => `<article class="community-proposal"><small>${m.proposer.name}의 제안</small><h3>${m.title}</h3><p>${m.text}</p><p class="metric-note">예산 ${m.cost} · 준비 ${m.preparation}초 · 실천 10분${budget < m.cost ? "<br>현재 예산 부족 · 이번 투표에서 제외" : ""}</p><p class="tradeoff">${m.concern}</p></article>`).join("")}</div>
    <p class="metric-note">함께 익힌 습관은 활동 뒤에도 이어지며 20분 동안 서서히 약해져요. 다시 의논하고 실천하면 습관을 되살릴 수 있어요.</p>
    <p class="metric-note">예산으로 가능한 제안에 주민들이 한 표씩 투표해요. 가장 많은 표를 얻은 방법을 실천하며, 동점이면 해당 방법끼리 다시 투표해요.</p>
    ${eligible < 2 ? '<p role="status">두 가지 이상을 비교하려면 예산 8이 필요해요. 회의를 미루고 다음 운영 예산을 기다려요.</p>' : ""}
    <details><summary>시청과 주민이 맡을 일</summary><p>${p.roles}</p><p>${p.limit}</p></details>
    <div class="live-actions"><button id="community-back">제안 다시 듣기</button><button class="primary" id="community-vote" ${eligible < 2 || d.heard.length !== p.voices.length ? "disabled" : ""}>주민투표 시작</button></div><button class="secondary wide" id="cancel-meeting">회의 미루기</button>`;
}

export function communityVoting(d: MeetingDraft, seed: number) {
  return `<span class="live-target">${communityTargets(d.project).find(t => t.id === d.target)!.name}</span><p class="community-step">3. 주민투표 · 투표함에 11표가 모였어요</p>
    <p class="intro">주민들은 자기 사정을 생각하며, 가능한 제안 가운데 하나에 한 표씩 투표했어요.</p>
    <p class="metric-note">게임 속 가상 주민 11명이 서로 다른 생활 사정을 바탕으로 투표하는 학습용 모형이에요. 시장은 개표를 진행하고 정해진 활동을 도와요.</p>
    <details><summary>주민들이 생각한 사정</summary>${communityVoters(seed, d.project, d.target).map(v => `<p><b>${v.name}</b> · ${v.reason}</p>`).join("")}</details>
    <div class="live-actions"><button id="community-compare">제안 다시 보기</button><button class="primary" id="community-count">투표함 열어 개표하기</button></div>`;
}
function tally(project: CommunityProjectId, vote: CommunityVote, round: number) {
  const r = vote.rounds[round];
  return `<ul class="community-tally" aria-label="${round ? "결선" : "첫"} 투표 결과">${r.candidates.map(id => `<li><span>${communityProposal(project, id).title}</span><strong>${r.ballots.filter(b => b.method === id).length}표</strong></li>`).join("")}</ul>`;
}
export function communityResult(d: MeetingDraft) {
  const vote = d.vote!, final = d.round === vote.rounds.length - 1,
    winner = communityProposal(d.project, vote.winner);
  return `<span class="live-target">${communityTargets(d.project).find(t => t.id === d.target)!.name}</span><p class="community-step">3. 주민투표 · ${d.round ? "결선 개표" : "개표 결과"}</p>
    ${d.round ? `<details><summary>첫 투표의 동점 결과</summary>${tally(d.project, vote, 0)}</details>` : ""}${tally(d.project, vote, d.round)}
    ${!final ? `<p class="community-status" role="status">가장 많은 표를 얻은 두 방법이 동점이에요. 두 방법을 놓고 주민 11명이 다시 투표해요.</p><button class="primary wide" id="community-runoff">결선투표 개표하기</button>` : `<p class="community-status" role="status">주민들이 정한 방법: <b>${winner.title}</b></p>
    <p class="tradeoff">다른 의견도 살펴요: ${winner.concern}</p><details><summary>함께 남겨 둘 다른 제안</summary>${communityProposals(d.project).filter(p => p.id !== winner.id).map(p => `<p><b>${p.title}</b><br>${p.text}</p>`).join("")}</details>
    <label class="decision-reason">시장으로서 도울 일 <small>말로 나누고 넘어가도 돼요</small><textarea id="community-reason" maxlength="400" rows="2" placeholder="주민의 결정을 어떻게 도울까요?">${escape(d.reason)}</textarea></label>
    <label class="decision-reason">소수 의견과 참여하기 어려운 이웃 살피기<textarea id="community-concern" maxlength="400" rows="2" placeholder="다른 방법을 원했던 이웃에게 무엇이 필요할까요?">${escape(d.concern)}</textarea></label>
    <p class="metric-note">준비 예산 ${vote.budget} → ${vote.budget - winner.cost} · ${winner.preparation}초 준비 뒤 10분간 실천해요.<br>익힌 습관은 이후 20분 동안 서서히 약해져요. 남은 문제는 다시 의논해요.</p><button class="primary wide" id="start-community">투표로 정한 활동 지원하기</button>`}
    <button class="secondary wide" id="cancel-meeting">지금은 시행하지 않고 회의 닫기</button>`;
}
export function communityRecord(sim: LiveCitySimulation, index: number) {
  const r = sim.council.records[index],
    p = communityProject(r.project),
    m = communityMethod(r.method);
  return `<span class="live-target">${communityTargets(r.project).find((t) => t.id === r.target)!.name}</span>
    <p class="community-step">${r.result ? "5. 결과를 다시 살펴보기" : "4. 주민이 함께 실천하기"}</p>
    ${r.vote ? `<p class="community-status">주민투표로 정한 방법: ${communityProposal(r.project, r.method).title}</p><details><summary>주민투표 기록 · 11명 참여${r.vote.rounds.length > 1 ? " · 결선 포함" : ""}</summary>${r.vote.rounds.map((_, i) => `<p>${i ? "결선투표" : "첫 투표"}</p>${tally(r.project, r.vote!, i)}`).join("")}<p class="metric-note">가상 주민의 학습용 투표예요. 다른 제안과 사정도 다음 회의에서 다시 살펴요.</p></details>` : '<p class="metric-note">이전 방식의 주민회의 기록이에요. 당시 투표 기록은 없어요.</p>'}
    ${r.result ? `<div class="community-comparison"><span>${sim.unit(p.topic)}</span><strong>${r.before.toFixed(1)} → ${r.result.after.toFixed(1)}</strong><small>${stamp(r.time)} 회의 때 → ${stamp(r.result.time)} 활동 뒤</small></div><p class="metric-note">수치는 이 기간의 실제 변화예요. 수거·교통·다른 정책도 함께 바뀌었으니 주민 활동만의 효과로 단정하지 않아요.</p>` : `<p class="community-status" id="community-status">${communityStatus(sim)}</p><p class="metric-note">활동이 끝나면 이곳에 당시 결과가 남아요.</p>`}
    ${!r.result ? `<button class="secondary wide" data-community-record="${index}">활동 결과 확인</button>` : ""}<div class="community-contribution"><strong>주민이 함께 바꾼 일</strong><p>${r.project === "walking" ? `새로 걷기를 선택한 이동 ${r.walkingTrips}건` : r.project === "sorting" ? `배출 안내로 지정 장소에 향한 쓰레기 ${r.guidedBags.toFixed(1)}봉투` : `선택한 유입구에서 새로 생길 오염을 ${r.preventedPollution.toFixed(1)}만큼 줄였어요. (가상 단위)`}</p><small>함께 한 활동과 이후 이어진 습관의 기여를 합한 기록이에요.</small></div>
    ${r.result && communityHabitStrength(r, sim.time) > 0 ? `<p class="community-status">익힌 습관을 이어가요 · ${stamp(r.endsAt + COMMUNITY_HABIT_DURATION - sim.time)} 동안 서서히 약해져요. 다른 활동을 의논해도 이 습관은 이어져요.</p>` : ""}
    <p class="intro">${p.limit}</p>
    <details><summary>회의에서 나눈 이야기</summary><p>${r.vote ? communityProposal(r.project, r.method).title : m.title} · 준비 예산 ${m.cost}</p>${r.vote ? communityProposals(r.project).map(proposal => `<p><b>${proposal.proposer.name} · ${proposal.title}</b><br>${proposal.text}<br>${proposal.concern}</p>`).join("") : p.voices.map((v) => `<p><b>${v.name}</b><br>${v.text}</p>`).join("")}<p>${r.vote ? "시장으로서 도울 일" : "고른 까닭"}: ${escape(r.reason || "말로 의견을 나눴어요.")}</p><p>함께 살필 의견: ${escape(r.concern || "글로 남긴 의견은 없어요.")}</p><p>${p.roles}</p></details>
    <label class="decision-reason">잘된 점과 다음에 바꿀 점<textarea data-community-reflection="${index}" maxlength="400" rows="3" placeholder="불편이 남은 이웃에게 무엇이 더 필요할까요?">${escape(r.reflection)}</textarea></label>
    <div class="live-actions"><button data-panel-open="policy">필요한 정책 살펴보기</button><button data-panel-open="community">다음 주민 회의</button></div>`;
}
export function communityHistory(records: CommunityRecord[]) {
  return `<details><summary>주민이 함께 정한 약속 ${records.length}개</summary>${records.map((r, i) => `<button class="live-news wide" data-community-record="${i}"><small>${stamp(r.time)} · ${r.result ? "활동 마침" : "활동 기록"}${r.vote ? " · 주민투표" : ""}</small><strong>${r.vote ? communityProposal(r.project, r.method).title : communityProject(r.project).title}</strong><span>${escape(r.reason || "서로 다른 주민의 이야기를 듣고 방법을 정했어요.")}</span></button>`).join("")}</details>`;
}
