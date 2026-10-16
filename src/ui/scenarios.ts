import { SCENARIOS } from "../scenarios";
import { icon } from "./icons";
import { residentVoices } from "../simulation/residents";
import { WasteSimulation } from "../simulation/services/waste";
import { compareWaste } from "../metrics/scenarios";
import type { TrafficSimulation } from "../simulation";
export const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        ch
      ]!,
  );
export const scenarioDialogs = `
<dialog id="scenario-dialog"><div class="dialog-top"><span class="eyebrow">새봄동에서 해결할 일</span><button id="close-scenarios" class="square" aria-label="도시 문제 닫기">${icon("close")}</button></div><h2>어떤 문제를 살펴볼까요?</h2><p class="dialog-intro">문제를 바꾸면 새 관찰을 시작해요. 저장할 실험은 먼저 기록해 주세요.</p><div class="scenario-list">${SCENARIOS.map((s) => `<button class="scenario-option" data-scenario="${s.id}"><span>${s.number}</span><strong>${s.title}</strong><p>${s.introduction}</p><small>관찰 · 주민 의견 · 정책 · 비교</small></button>`).join("")}</div></dialog>
<dialog id="record-dialog"><div class="dialog-top"><h2>다시 열어 본 실험</h2><button id="close-record" class="square" aria-label="기록 닫기">${icon("close")}</button></div><div id="saved-record-content"></div><button id="print-record" class="secondary">관찰지 인쇄</button></dialog><input type="file" id="record-file" accept="application/json,.json" hidden><article id="print-sheet"></article>`;
export function residentsMarkup(
  sim: TrafficSimulation,
  baseline?: TrafficSimulation,
) {
  return `<p class="metric-note">가상 주민의 이야기예요. ‘관찰한 사실’과 ‘바라는 점’을 나누어 살펴보세요. 다수의 의견만으로 결정할 필요는 없어요.</p>${residentVoices(
    sim,
    baseline,
  )
    .map(
      (v) =>
        `<article class="resident-voice"><h3>${escapeHtml(v.group)}</h3><small>${escapeHtml(v.place)}</small><p><b>관찰한 사실</b> ${escapeHtml(v.fact)}</p><p><b>바라는 점</b> ${escapeHtml(v.opinion)}</p>${v.change ? `<p class="voice-change">${escapeHtml(v.change)}</p>` : ""}</article>`,
    )
    .join("")}`;
}
export const truckPhase = {
  driving: "이동·신호 대기",
  collecting: "멈춰서 수거 중",
  unloading: "처리시설에서 내리는 중",
  finished: "오늘 수거 마침",
  blocked: "길을 찾지 못해 대기",
};
export function wasteObservation(sim: WasteSimulation) {
  const s = sim.wasteStats;
  return `<div class="big-metric"><span>전체 쓰레기 수거율</span><strong>${s.collectionRate.toFixed(1)}<small>%</small></strong><div class="arrival-track"><i style="width:${s.collectionRate}%"></i></div></div><div class="metric-grid"><div><span>남은 쓰레기</span><strong>${s.remaining.toFixed(1)}봉투</strong></div><div><span>한 차례 수거 완료</span><strong>${s.completedSites} / 6곳</strong></div></div><p class="metric-note">처음 쌓인 양 + 새로 나온 양 중 수거한 비율이에요. 봉투는 이 도시의 가상 단위예요.</p><div class="truck-list">${sim.trucks.map((t) => `<button class="truck-row" data-truck="${t.id}"><strong>${t.name} <small>${t.load.toFixed(1)} / ${t.capacity}봉투</small></strong><span>${truckPhase[t.phase]} · ${t.target === "depot" ? "처리시설" : (sim.sites.find((s) => s.id === t.target)?.name ?? "출발 준비")}</span></button>`).join("")}</div><details class="traffic-details" id="waste-sites-details"><summary>어느 곳에 남아 있나요?</summary>${sim.sites.map((site) => `<button class="site-row" data-facility="${site.facilityId}"><span>${site.name}</span><strong>${site.remaining.toFixed(1)}봉투</strong></button>`).join("")}<p class="metric-note">수거 완료는 한 번 모두 비운 곳이에요. 그 뒤에도 새 쓰레기가 나올 수 있어요.</p></details>`;
}
export function wasteResults(before: WasteSimulation, after: WasteSimulation) {
  const comparison = compareWaste(before, after);
  const format = (n: number | null, unit: string) =>
    n === null ? "집계 중" : `${n.toFixed(Number.isInteger(n) ? 0 : 1)}${unit}`;
  const table = `<table><thead><tr><th>관찰한 것</th><th>시행 전</th><th>시행 후</th><th>변화</th></tr></thead><tbody>${comparison.rows
    .map((r) => {
      const d =
        r.before === null || r.after === null ? null : r.after - r.before;
      const cls =
        d === null || Math.abs(d) < 0.05 || r.lower === null
          ? ""
          : (r.lower ? d < 0 : d > 0)
            ? "better"
            : "worse";
      return `<tr><th>${r.label}</th><td>${format(r.before, r.unit)}</td><td>${format(r.after, r.unit)}</td><td class="${cls}">${d === null ? "집계 중" : Math.abs(d) < 0.05 ? "같음" : `${d > 0 ? "+" : ""}${format(d, r.unit === "%" ? "%p" : r.unit)}`}</td></tr>`;
    })
    .join("")}</tbody></table>`;
  const details = `<details class="result-details" id="waste-regions-details"><summary>어느 동네가 달라졌을까요? ${icon("plus", 16)}</summary><table><thead><tr><th>수거장</th><th>남은 양 · 전</th><th>남은 양 · 후</th></tr></thead><tbody>${comparison.sites.map((s) => `<tr><th>${s.name}</th><td>${s.beforeRemaining.toFixed(1)}봉투</td><td class="${s.afterRemaining > s.beforeRemaining + 0.05 ? "worse" : s.afterRemaining < s.beforeRemaining - 0.05 ? "better" : ""}">${s.afterRemaining.toFixed(1)}봉투</td></tr>`).join("")}</tbody></table><p class="metric-note">평균 구간 이동은 도착한 수거 구간만의 평균이에요. 아직 이동 중인 구간은 시행 전 ${comparison.before.unfinishedJourneys}개, 후 ${comparison.after.unfinishedJourneys}개예요.</p></details><details class="result-details"><summary>주민들은 어떻게 느낄까요? ${icon("plus", 16)}</summary>${residentsMarkup(after, before)}</details>`;
  return { table, details, comparison };
}
