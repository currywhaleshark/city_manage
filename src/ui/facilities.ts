import {
  FACILITY_SITES,
  FacilitySimulation,
  SERVICE_NAMES,
  type ServiceKind,
  type FacilityPlan,
} from "../simulation/facilities";
import { compareFacilities } from "../metrics/facilities";
import { escapeHtml, residentsMarkup } from "./scenarios";
import { icon } from "./icons";
export const facilityPlanningControls = `<div id="facility-plan" hidden><label for="facility-site">1. 먼저 공터를 골라요<select id="facility-site">${FACILITY_SITES.map((s) => `<option value="${s.id}">${s.name} · ${s.width * s.depth}㎡</option>`).join("")}</select></label><div class="plot-info"><strong id="plot-area"></strong><span id="plot-current"></span></div><button id="preview-facility-site" class="secondary">지도에서 이 공터 보기</button><p class="metric-note">2. 아래에서 이 공터에 지을 시설을 골라요. 한 공터에는 한 시설만 들어가요. 다른 공터를 골라 건설 계획을 더할 수 있어요.</p><details id="planned-buildings" class="traffic-details"><summary>선택한 공터와 남은 공간</summary><div id="planned-buildings-list"></div></details></div>`;
export function facilityPlanMarkup(plan: FacilityPlan) {
  const buildings = plan.buildings ?? [];
  return `<p>건설 예정 ${buildings.length}곳 · 남는 공터 ${FACILITY_SITES.length - buildings.length}곳</p>${
    buildings
      .map((b) => {
        const site = FACILITY_SITES.find((s) => s.id === b.siteId)!;
        return `<div class="planned-building"><span>${site.name}<small>${SERVICE_NAMES[b.kind]} · 부지 ${site.width * site.depth}㎡</small></span><button class="secondary" data-clear-plot="${site.id}" aria-label="${site.name} 건설 취소">취소</button></div>`;
      })
      .join("") || '<p class="metric-note">아직 선택한 시설이 없어요.</p>'
  }`;
}
export const accessControls = `<div id="facility-access-controls" hidden><label class="layer-picker" for="access-service">필요한 시설<select id="access-service"><option value="library">도서관</option><option value="park">공원</option></select></label></div><div id="facility-observation" hidden></div>`;
export function facilityObservation(
  sim: FacilitySimulation,
  kind: ServiceKind,
) {
  const s = sim.facilityStats;
  return `<div class="big-metric"><span>거리와 이용 자리가 맞는 주민</span><strong>${s.served}<small> / ${s.population}명</small></strong><div class="arrival-track"><i style="width:${s.coverage}%"></i></div></div><div class="metric-grid"><div><span>시설이 너무 먼 주민</span><strong>${s.outsideRange}명</strong></div><div><span>가까워도 자리 부족</span><strong>${s.capacityShortfall}명</strong></div></div><p class="metric-note">각 주민이 하루에 주로 이용할 시설 한 곳을 정한 가상 수요예요. 예상 도보 5분 이내여도 자리가 모자라면 이용하기 어려워요.</p><details class="traffic-details" id="facility-neighborhoods"><summary>동네별 ${SERVICE_NAMES[kind]} 접근성</summary>${s.neighborhoods
    .map((n) => {
      const service = n.services[kind];
      return `<button class="site-row access-row" data-neighborhood="${n.id}"><span>${n.name}<small>가장 가까운 곳까지 ${service.nearest ? (service.nearest.route.seconds / 60).toFixed(1) + "분 예상" : "연결된 길 없음"}</small></span><strong>${service.served} / ${service.demand}명</strong></button>`;
    })
    .join(
      "",
    )}<p class="metric-note">숫자는 이 시설이 필요한 주민 중 이용 가능한 인원이에요. 동네를 누르면 예상 경로를 볼 수 있어요.</p></details><details class="traffic-details" id="facility-capacities"><summary>시설별 이용 자리</summary>${s.facilities.map((f) => `<button class="site-row access-row" data-civic="${f.id}"><span>${f.name}<small>${SERVICE_NAMES[f.kind]} · 하루 이용 자리</small></span><strong>${f.used} / ${f.capacity}명</strong></button>`).join("")}</details><details class="traffic-details" id="facility-method"><summary>어떻게 계산했나요?</summary><p class="metric-note">동네 가운데에서 보도와 횡단 연결망을 따라 길이를 재요. 걷는 속도는 초당 1.2m, 횡단마다 예상 대기는 15초로 두었어요. 실제 보행 애니메이션이나 실측 통학 시간과는 달라요. 가까운 경로부터 정원 안에서 배정하며 같은 거리에서는 정해진 동네 순서를 써요.</p></details>`;
}
export function facilitySelection(
  sim: FacilitySimulation,
  id: string,
  kind: ServiceKind,
) {
  if (id === "b1") id = "park-north";
  if (id === "b10") id = "park-east";
  const row = sim.access.find((r) => r.id === id);
  if (row) {
    const service = row.services[kind];
    return `<p>${row.name} · 가상 주민 ${row.population}명</p><p>${SERVICE_NAMES[kind]} 필요 ${service.demand}명 · 이용 가능 ${service.served}명</p><p>${service.nearest ? `${sim.facilities.find((f) => f.id === service.nearest!.facilityId)!.name}<br>보행 경로 ${service.nearest.route.meters.toFixed(0)}m · 약 ${(service.nearest.route.seconds / 60).toFixed(1)}분` : "갈 수 있는 길이 없어요."}</p><p class="metric-note">지도 선은 계산에 쓴 예상 경로예요. 5분 안에 갈 수 있는지와 남은 이용 자리를 따로 확인해요.</p>`;
  }
  const facility = sim.facilityStats.facilities.find((f) => f.id === id);
  if (facility)
    return `<p>${SERVICE_NAMES[facility.kind]} · 하루 ${facility.capacity}명분</p><p>배정된 주민 ${facility.used}명 · 남는 자리 ${facility.capacity - facility.used}명</p><p class="metric-note">계산된 이용 수요예요. 사람이 실제로 도착한 수는 아니에요.</p>`;
  const site = FACILITY_SITES.find((s) => s.id === id);
  return site
    ? `<p>${site.district} · ${site.width} × ${site.depth}m = ${site.width * site.depth}㎡</p><p>도서관: 예산 55 · 400㎡<br>공원: 예산 35 · 900㎡${site.width * site.depth < 900 ? " (이 공터에는 면적 부족)" : ""}</p><button class="secondary" data-select-site="${site.id}">이 공터에서 시설 정하기</button><p class="metric-note">한 공터에는 한 시설만 지어요. 건설 계획을 세운 뒤 시행해 주세요.</p>`
    : "";
}
export function facilityResults(
  before: FacilitySimulation,
  after: FacilitySimulation,
) {
  const comparison = compareFacilities(before, after);
  const format = (n: number | null, unit: string) =>
    n === null
      ? "계산 불가"
      : `${Number.isInteger(n) ? n : n.toFixed(1)}${unit}`;
  const table = `<table><thead><tr><th>관찰한 것</th><th>시행 전</th><th>시행 후</th></tr></thead><tbody>${comparison.rows.map((r) => `<tr><th>${r.label}</th><td>${format(r.before, r.unit)}</td><td>${format(r.after, r.unit)}</td></tr>`).join("")}</tbody></table>`;
  const details = `<details class="result-details" id="facility-regions-details"><summary>어느 동네가 혜택을 받았나요? ${icon("plus", 16)}</summary><table><thead><tr><th>동네</th><th>이용 가능 · 전</th><th>이용 가능 · 후</th></tr></thead><tbody>${comparison.neighborhoods.map((r) => `<tr><th>${r.name}</th><td>${r.beforeServed}명</td><td class="${r.afterServed > r.beforeServed ? "better" : r.afterServed < r.beforeServed ? "worse" : ""}">${r.afterServed}명</td></tr>`).join("")}</tbody></table><p class="metric-note">시설 종류와 위치에 따라 도움이 되지 않은 동네도 있어요. 거리·정원·필요한 시설을 함께 살펴보세요.</p></details><details class="result-details" id="facility-voices-details"><summary>주민회의에서 다시 살펴보기 ${icon("plus", 16)}</summary>${residentsMarkup(after, before)}</details>`;
  const site = FACILITY_SITES.find((s) => s.id === after.plan.siteId)!;
  return {
    comparison,
    table,
    details:
      `<details class="result-details" id="facility-land-result"><summary>예산과 공터는 어떻게 썼나요?</summary><p>남은 예산 ${100 - after.cost} · 사용 공터 ${after.facilityStats.usedPlots} / ${FACILITY_SITES.length}곳 · 사용 부지 ${after.facilityStats.usedLand}㎡</p>${after.facilityStats.plots
        .filter((p) => p.kind)
        .map(
          (p) => `<p>${p.name} · ${SERVICE_NAMES[p.kind!]} · ${p.area}㎡</p>`,
        )
        .join(
          "",
        )}<p class="metric-note">남은 공터는 ${after.facilityStats.freePlots}곳이에요. 작은 공터에는 넓은 공원이 들어가지 않아요.</p></details>` +
      details,
    summary: `<div class="result-highlight"><span>${icon("home", 29)}</span><div><strong>이용 가능한 주민 ${comparison.before.served}명 → ${comparison.after.served}명</strong><p>건설 ${after.facilityStats.usedPlots}곳 · 남는 공터 ${after.facilityStats.freePlots}곳 · 남은 예산 ${100 - after.cost}</p></div></div>`,
  };
}
