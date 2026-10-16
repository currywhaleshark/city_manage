import { ParkingSimulation, PARKING_SITES } from "../simulation/parking";
import { compareParking } from "../metrics/parking";
import { residentsMarkup } from "./scenarios";
export const parkingControls = `<div id="parking-plan" hidden><p class="metric-note">정책을 고르면 지도에서 적용할 곳을 선택해요.</p><div id="parking-locations"></div></div>`;
export function parkingFact(sim: ParkingSimulation, id: string) {
  const s = sim.parkingStats.sites.find((s) => s.id === id)!;
  return `불법주차 ${s.illegal}대 · 차지한 시간 합계 ${(s.illegalSeconds / 60).toFixed(1)}분 · 보행로 ${s.sidewalkBlocked ? "막힘" : "열림"} · 정해진 자리 이용 ${s.legal}대`;
}
export function parkingSelection(sim: ParkingSimulation, id: string) {
  const site = PARKING_SITES.find((s) => s.id === id)!;
  return `<p>${parkingFact(sim, id)}</p><p>${site.reason}</p><p class="metric-note">한 곳마다 처음에 차도 1대·보행로 1대가 있어요. 차도에서는 뒤차가 기다리고, 보행로에서는 사람이 바깥쪽으로 돌아가요.</p><button class="secondary wide" data-inquiry-site="${id}">이 현장 조사하기</button>`;
}
export const parkingObservation = `<div class="big-metric"><span>지금 길을 차지한 불법주차</span><strong><b id="parking-count">6</b><small>대</small></strong></div><p id="parking-walkers" class="metric-note"></p>${PARKING_SITES.map((s) => `<button class="site-row access-row" data-parking-site="${s.id}"><span>${s.name}<small data-parking-fact="${s.id}"></small></span><strong>보기 →</strong></button>`).join("")}<p class="metric-note">현장을 눌러 위치를 보고 ‘우리 동네 조사’에 자료를 남겨요.</p>`;
export function parkingResults(
  before: ParkingSimulation,
  after: ParkingSimulation,
) {
  const c = compareParking(before, after),
    delta = c.before.illegalSeconds - c.after.illegalSeconds;
  const n = (v: number | null) =>
    v === null ? "집계 중" : v.toFixed(Number.isInteger(v) ? 0 : 1);
  return {
    summary: `<div class="result-highlight"><div><strong>길을 차지한 시간이 ${(Math.abs(delta) / 60).toFixed(1)}분 ${delta >= 0 ? "줄었어요" : "늘었어요"}</strong><p>세 현장의 누적 시간 합계예요. 어디에 도움이 됐는지도 비교해요.</p></div></div>`,
    table: `<table><thead><tr><th>관찰한 것</th><th>시행 전</th><th>시행 후</th></tr></thead><tbody>${c.rows.map((r) => `<tr><th>${r.label}</th><td>${n(r.before)}${r.unit}</td><td>${n(r.after)}${r.unit}</td></tr>`).join("")}</tbody></table>`,
    details: `<details class="result-details"><summary>어느 현장이 달라졌나요?</summary><table><thead><tr><th>현장</th><th>차지한 시간 · 전</th><th>후</th></tr></thead><tbody>${c.sites.map((s) => `<tr><th>${s.name}</th><td>${n(s.before)}분</td><td>${n(s.after)}분</td></tr>`).join("")}</tbody></table><p>공동주차장 이용 ${c.after.lotUsed} / ${c.after.lotCapacity}대. 멀리 있는 운전자는 빈자리가 있어도 이용하지 않아요.</p></details><details class="result-details"><summary>주민의 생각</summary>${residentsMarkup(after, before)}</details><button class="secondary wide" id="review-inquiry">조사 자료와 선택 이유 돌아보기</button><p class="metric-note">처음 세워 둔 6대의 주차를 비교하는 가상 모형이에요. 도로의 차는 길을 따라 나가고, 보행로·주차면의 차는 이용 시간이 끝나면 표시가 사라져요. 주차장까지 진입하는 운전과 이후 새로운 주차 수요는 이번 모형에서 생략했어요.</p>`,
  };
}
