import {
  EnvironmentSimulation,
  DEVELOPMENT_SITES,
  burdenLevel,
} from "../simulation/environment";
import { compareEnvironment } from "../metrics/environment";
import { residentsMarkup } from "./scenarios";
export const environmentControls =
  '<div id="environment-observation" hidden></div>';
const n = (value: number | null, unit = "") =>
  value === null
    ? "집계 중"
    : `${Number.isInteger(value) ? value : value.toFixed(1)}${unit}`;
export function environmentObservation(sim: EnvironmentSimulation) {
  const s = sim.environmentStats;
  return `<div class="big-metric"><span>대상 부지에 남아 있는 녹지</span><strong>${s.greenArea}<small> / ${s.managedArea}㎡</small></strong><div class="arrival-track"><i style="width:${(s.greenArea / s.managedArea) * 100}%"></i></div></div><div class="metric-grid"><div><span>새 일터 이용 자리</span><strong>${s.workCapacity}명분</strong></div><div><span>새 거주 공간</span><strong>${s.housingCapacity}명분</strong></div></div><p class="metric-note">새 자리·공간은 계획된 수용 규모예요. 실제 고용·입주 인원이 아니에요. 전체 도시의 녹지가 아닌 두 확장 부지와 완충 띠 760㎡를 살펴봐요.</p><details class="traffic-details" id="environment-places"><summary>어느 곳의 부담이 커졌나요?</summary>${s.regions.map((r) => `<button class="site-row access-row" data-environment-place="${r.id}"><span>${r.name}<small>현재 ${n(r.currentBurden, "점")} · ${burdenLevel(r.currentBurden)}</small></span><strong>평균 ${n(r.meanBurden)}</strong></button>`).join("")}<p class="metric-note">점수는 시설과의 거리·도로 위 차량으로 계산한 가상 부담이에요. 지도는 현재 값, 결과는 1초마다 관찰한 평균이에요.</p></details><details class="traffic-details" id="environment-traffic"><summary>개발로 늘어난 차량은?</summary><p>기존 수요 ${s.backgroundTrips}건 · 도착 ${s.backgroundArrived}대<br>추가 수요 ${s.addedTrips}건 · 도착 ${s.addedArrived}대<br>산업시설 출근 차량 도착 ${s.industryArrived} / ${s.industryTrips}대</p><p class="metric-note">추가 차량도 같은 도로와 신호에서 기다려요. 아직 도착하지 않은 차량을 이용 완료로 세지 않아요. 건물 앞 주차는 생략하고 연결된 도로 지점 도착을 집계해요.</p></details><details class="traffic-details" id="environment-land"><summary>개발 부지와 보전 구역</summary>${s.parcels.map((p) => `<button class="site-row access-row" data-development="${p.id}"><span>${DEVELOPMENT_SITES.find((site) => site.id === p.id)!.name}<small>개발 ${p.developedArea}㎡ · 보전 지정 ${p.protectedArea}㎡</small></span><strong>녹지 ${p.greenArea}㎡</strong></button>`).join("")}<p class="metric-note">완충 녹지 ${s.bufferArea}㎡. 원래 있던 녹지에 나무를 심으므로 전체 녹지 면적에 다시 더하지 않아요.</p></details><details class="traffic-details" id="environment-method"><summary>어떻게 계산했나요?</summary><p class="metric-note">산업시설과 차량에서 멀어질수록 부담이 작아지는 가상 규칙이에요. 완충 띠를 가로질러 전달되는 산업 부담은 35% 줄이고 차량 부담은 그대로 둬요. 낮음 10점 미만 · 중간 10~20점 미만 · 높음 20점 이상. 실제 소음·대기오염·건강 위험이나 법적 기준을 뜻하지 않아요. 장소 10곳의 평균은 인구 가중치 없이 계산해요.</p></details>`;
}
export function environmentSelection(sim: EnvironmentSimulation, id: string) {
  const s = sim.environmentStats,
    parcel = s.parcels.find((p) => p.id === id);
  if (parcel)
    return `<p>전체 288㎡ · 개발 ${parcel.developedArea}㎡ · 남은 녹지 ${parcel.greenArea}㎡</p><p>보전 지정 ${parcel.protectedArea}㎡ · 새 ${id === "industry" ? "일터 이용 자리" : "거주 공간"} ${parcel.capacity}명분</p><p class="metric-note">이용 공간과 교통 수요는 개발 규모에서 계산해요. 경제 성장률이나 주민 만족도를 직접 더하지 않아요.</p>`;
  const row = s.regions.find((r) => r.id === id);
  return row
    ? `<p>${row.name} · ${row.use}</p><p>현재 부담 ${n(row.currentBurden)}점(가상)<br>시설 ${n(row.facilityBurden)} + 교통 ${n(row.trafficBurden)}</p><p>관찰 중 평균 ${n(row.meanBurden)}점</p><p class="metric-note">거리와 도로 위 차량에 따른 비교 자료예요. 실제 환경 측정값은 아니에요.</p>`
    : "";
}
export function environmentResults(
  before: EnvironmentSimulation,
  after: EnvironmentSimulation,
) {
  const c = compareEnvironment(before, after),
    s = c.after;
  return {
    summary: `<div class="result-highlight"><div><strong>일터 ${s.workCapacity}명분 · 거주 공간 ${s.housingCapacity}명분 추가</strong><p>녹지 ${c.before.greenArea} → ${s.greenArea}㎡ · 추가 차량 수요 ${s.addedTrips}건</p></div></div>`,
    table: `<table><thead><tr><th>관찰한 것</th><th>시행 전</th><th>시행 후</th></tr></thead><tbody>${c.rows.map((r) => `<tr><th>${r.label}</th><td>${n(r.before, r.unit)}</td><td>${n(r.after, r.unit)}</td></tr>`).join("")}</tbody></table>`,
    details: `<details class="result-details" id="environment-regions"><summary>동네별 환경 부담을 비교해요</summary><table><thead><tr><th>장소</th><th>평균 · 전</th><th>평균 · 후</th></tr></thead><tbody>${c.regions.map((r) => `<tr><th>${r.name}</th><td>${n(r.beforeBurden)}</td><td class="${r.afterBurden > r.beforeBurden + 0.05 ? "worse" : r.afterBurden < r.beforeBurden - 0.05 ? "better" : ""}">${n(r.afterBurden)}</td></tr>`).join("")}</tbody></table><p class="metric-note">단위: 점(가상). 평균이 낮아져도 변화가 없거나 부담이 커진 장소가 있을 수 있어요.</p></details><details class="result-details" id="environment-use"><summary>추가 차량은 실제로 도착했나요?</summary><p>개발로 추가된 ${s.addedTrips}건 중 ${s.addedArrived}대 도착. 산업시설 출근은 ${s.industryArrived}/${s.industryTrips}대 도착했어요.</p><p>기존 수요 140대는 전후 모두 같고, 개발 정책에서 생긴 추가 수요만 달라요. 전체 차량 도착 수를 바로 비교하면 수요가 늘어난 영향을 혼동할 수 있어요.</p></details><details class="result-details" id="environment-voices"><summary>주민의 의견은 어떻게 달라졌나요?</summary>${residentsMarkup(after, before)}</details>`,
  };
}
