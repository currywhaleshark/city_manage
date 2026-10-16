import {
  DumpingSimulation,
  DUMPING_SITES,
} from "../simulation/services/dumping";
import { compareDumping } from "../metrics/dumping";
import { residentsMarkup, truckPhase } from "./scenarios";
export function dumpingFact(sim: DumpingSimulation, id: string) {
  const s = sim.dumpingStats.sites.find((s) => s.id === id)!;
  const reasons = sim.disposalEvents.filter((e) => e.source === id),
    unknown = reasons
      .filter((e) => e.reason === "rules")
      .reduce((n, e) => n + e.amount, 0),
    far = reasons
      .filter((e) => e.reason === "distance")
      .reduce((n, e) => n + e.amount, 0);
  return `관찰 ${sim.round}차 · 무단투기 ${s.remaining.toFixed(1)}봉투 · 새 투기 ${s.newDumped}봉투 · 청소 뒤 재발 ${s.repeatDumped}봉투. 가장 가까운 지정 배출 장소까지 약 ${Math.round(s.nearestDistance)}m(가상 직각 거리).${reasons.length ? ` 모형 속 투기 까닭: 방법을 몰랐음 ${unknown}봉투 · 장소가 멀었음 ${far}봉투.` : ""}${sim.dumpingConfiguration.dropoff && sim.plan.dropoff === id ? ` 배출함에 ${s.binRemaining.toFixed(1)}봉투, 그중 넘친 양 ${s.binOverflow.toFixed(1)}봉투.` : ""}${sim.dumpingConfiguration.outreach && sim.plan.outreach === id ? ` 안내 활동은 ${sim.round === 1 ? "준비 중 · 2차부터 참여" : "일부 주민 참여 중"}.` : ""}`;
}
export function dumpingSelection(sim: DumpingSimulation, id: string) {
  const site = DUMPING_SITES.find((s) => s.id === id)!;
  const logs = sim.disposalEvents.filter((e) => e.source === id).slice(-4);
  return `<p>${dumpingFact(sim, id)}</p><p class="metric-note">이곳의 투기물과 지정 장소의 쓰레기는 따로 세어요. 봉투와 거리는 학습용 가상 단위예요.</p><button class="primary wide" data-dumping-inquiry="${id}">이 현장 조사하기</button><details class="traffic-details"><summary>최근 배출 기록</summary>${logs.length ? logs.map((e) => `<p>${e.round}차 · ${Math.floor(e.time)}초 · ${e.amount}봉투 → ${e.kind === "illegal" ? (e.repeat ? "청소 뒤 다시 투기" : "무단투기") : "지정 장소에 배출"}</p>`).join("") : "<p>아직 새 배출 기록이 없어요.</p>"}<p>${site.group}: ${site.opinion}</p></details>`;
}
export const dumpingObservation = `<div id="dumping-summary"></div><p class="metric-note">무단투기와 정상 배출 장소에서 넘친 양은 달라요. 세 번의 5분 관찰을 이어 봐요. 실제 날짜가 바뀌는 모형은 아니에요.</p><button class="secondary wide" id="next-dumping-round">이어서 관찰하기</button><div>${DUMPING_SITES.map((s) => `<button class="site-row" data-dumping-site="${s.id}"><span>${s.name}<small data-dumping-amount="${s.id}"></small></span><strong>보기 →</strong></button>`).join("")}</div><details class="traffic-details"><summary>수거차와 기존 수거장</summary><div id="dumping-collection"></div></details>`;
export function dumpingSummary(sim: DumpingSimulation) {
  const s = sim.dumpingStats;
  return `<div class="big-metric"><span>관찰 ${sim.round} / 3차 · 남은 무단투기</span><strong>${s.illegalRemaining.toFixed(1)}<small>봉투</small></strong></div><div class="metric-grid"><div><span>새 투기 · 누적</span><strong>${s.newDumped}봉투</strong></div><div><span>청소 뒤 재발 · 누적</span><strong>${s.repeatDumped}봉투</strong></div><div><span>지정 장소 넘침</span><strong>${s.overflow.toFixed(1)}봉투</strong></div><div><span>도시 전체 잔량</span><strong>${s.remaining.toFixed(1)}봉투</strong></div></div>`;
}
export function dumpingCollection(sim: DumpingSimulation) {
  return `${sim.trucks.map((t) => `<button class="truck-row" data-truck="${t.id}"><strong>${t.name} · ${t.load.toFixed(1)} / ${t.capacity}봉투</strong><span>${truckPhase[t.phase]} · ${sim.sites.find((s) => s.id === t.target)?.name ?? "처리시설"}</span></button>`).join("")}<p>기존 수거장 잔량 ${sim.dumpingStats.normalRemaining.toFixed(1)}봉투</p>${sim.dumpingStats.normalSites.map((s) => `<p>${s.name}: ${s.remaining.toFixed(1)}봉투</p>`).join("")}`;
}
export function dumpingResults(
  before: DumpingSimulation,
  after: DumpingSimulation,
) {
  const c = compareDumping(before, after),
    delta = c.after.illegalRemaining - c.before.illegalRemaining;
  const table = `<table><thead><tr><th>관찰한 것</th><th>시행 전</th><th>시행 후</th></tr></thead><tbody>${c.rows.map((r) => `<tr><th>${r.label}</th><td>${r.before.toFixed(1)}${r.unit}</td><td class="${r.lower === null ? "" : r.after === r.before ? "" : (r.lower ? r.after < r.before : r.after > r.before) ? "better" : "worse"}">${r.after.toFixed(1)}${r.unit}</td></tr>`).join("")}</tbody></table>`;
  return {
    table,
    summary: `<div class="result-highlight"><div><strong>남은 투기물이 ${Math.abs(delta).toFixed(1)}봉투 ${delta < 0 ? "줄었어요" : delta > 0 ? "늘었어요" : "차이 나요"}</strong><p>치운 뒤 재발 ${c.after.repeatDumped}봉투 · 사용 예산 ${after.cost}. 지정 장소와 다른 이웃의 변화도 봐요.</p></div></div>`,
    details: `<details class="result-details" id="dumping-round-results"><summary>치운 뒤에도 다시 쌓였나요?</summary><table><thead><tr><th>관찰 회차</th><th>남은 투기 · 전</th><th>후</th><th>청소 뒤 재발 · 후</th></tr></thead><tbody>${after.rounds.map((r, i) => `<tr><th>${r.round}차</th><td>${before.rounds[i].illegalRemaining.toFixed(1)}</td><td>${r.illegalRemaining.toFixed(1)}</td><td>${r.repeatDumped}</td></tr>`).join("")}</tbody></table><p class="metric-note">재발은 한 번 모두 치운 현장에 새로 버린 봉투의 누적량이에요. 청소하지 않아 재발량이 0인 곳도 깨끗하다는 뜻은 아니에요.</p></details><details class="result-details"><summary>어느 현장과 수거장이 달라졌나요?</summary><table><thead><tr><th>장소</th><th>남은 양 · 전</th><th>후</th></tr></thead><tbody>${[...c.sites, ...before.dumpingStats.normalSites.map((s) => ({ name: s.name, before: s.remaining, after: after.dumpingStats.normalSites.find((t) => t.id === s.id)!.remaining }))].map((s) => `<tr><th>${s.name}</th><td>${s.before.toFixed(1)}</td><td class="${s.after > s.before + 0.05 ? "worse" : s.after < s.before - 0.05 ? "better" : ""}">${s.after.toFixed(1)}</td></tr>`).join("")}</tbody></table></details><details class="result-details"><summary>주민의 생각</summary>${residentsMarkup(after, before)}</details><button class="secondary wide" id="review-inquiry">조사 자료와 선택 이유 돌아보기</button><p class="metric-note">같은 배출량과 행동 선택을 비교한 가상 실험이에요. 안내의 참여율·거리 선택은 교육용 가정이고 실제 정책 효과를 예측하지 않아요. 하천으로 흘러드는 과정은 아직 계산하지 않아요.</p>`,
  };
}
