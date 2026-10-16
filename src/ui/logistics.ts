import { LogisticsSimulation } from "../simulation/economy";
import { compareLogistics } from "../metrics/logistics";
import { residentsMarkup } from "./scenarios";
export const cargoPhase = {
  driving: "이동·신호 대기",
  loading: "멈춰서 싣는 중",
  unloading: "상점에서 내리는 중",
  blocked: "연결된 길이 없어 대기",
};
const n = (value: number | null, unit = "") =>
  value === null
    ? "집계 중"
    : `${value.toFixed(Number.isInteger(value) ? 0 : 1)}${unit}`;
export function logisticsObservation(sim: LogisticsSimulation) {
  const s = sim.logisticsStats;
  return `<div class="big-metric"><span>상점에 도착해 내려놓은 물자</span><strong>${s.delivered.toFixed(1)}<small>상자</small></strong></div><div class="metric-grid"><div><span>물건이 없어 못 산 양</span><strong>${s.unmet.toFixed(1)}상자</strong></div><div><span>품절을 겪은 상점</span><strong>${s.stockoutShops} / 4곳</strong></div></div><p class="metric-note">공장·이웃 마을 → 화물차 → 상점 → 소비. 차가 실제로 도착해 내려놓아야 재고가 늘어요. 상자는 가상 물량 단위예요.</p>
  <div class="truck-list">${sim.trucks.map((t) => `<button class="truck-row" data-truck="${t.id}"><strong>${t.name}<small>${t.load.toFixed(1)} / ${t.capacity}상자</small></strong><span>${cargoPhase[t.phase]} · ${(sim.sources.find((s) => s.id === t.target) ?? sim.shops.find((s) => s.id === t.target))!.name}</span></button>`).join("")}</div>
  <details class="traffic-details" id="logistics-shops"><summary>어느 상점에 물건이 부족한가요?</summary>${sim.shops.map((shop) => `<button class="site-row access-row" data-facility="${shop.facilityId}"><span>${shop.name}<small>못 산 양 ${shop.unmet.toFixed(1)}상자</small></span><strong>재고 ${shop.stock.toFixed(1)}</strong></button>`).join("")}</details>
  <details class="traffic-details" id="logistics-sources"><summary>물건은 어디에서 오나요?</summary>${sim.sources.map((source) => `<button class="site-row access-row" data-cargo-source="${source.id}"><span>${source.name}<small>${source.external ? "입구로 들어온" : "새로 생산한"} 양 ${source.generated.toFixed(1)}상자</small></span><strong>대기 ${source.stock.toFixed(1)}</strong></button>`).join("")}<p class="metric-note">외부 마을의 생산과 입구까지 이동은 공급률로 단순화했어요. 지도 안에서는 화물차가 같은 도로·신호를 이용해요.</p></details>
  <details class="traffic-details" id="logistics-method"><summary>생산·소비·배송 규칙</summary><p class="metric-note">공장 분당 9상자, 외부 입구마다 분당 6상자가 준비돼요. 화물차는 최대 36상자를 싣고 담당 상점을 순환해요. 최소 30초 동안 싣고 6상자 이상이면 출발하며, 가득 차면 먼저 출발해요. 상점에는 최대 60상자를 보관해요. 하역은 초당 0.8상자, 지원하면 1.4상자예요. 못 산 수요는 다음에 다시 주문하지 않아요.</p><p>공장에서 배송 ${n(s.localDelivered, "상자")} · 이웃 마을에서 배송 ${n(s.externalDelivered, "상자")}<br>차에 실린 양 ${n(s.inTrucks, "상자")} · 일반 차량 도착 ${s.backgroundArrived}대</p></details>`;
}
export function logisticsSelection(
  sim: LogisticsSimulation,
  kind: string,
  id: string,
) {
  if (kind === "service") {
    const t = sim.trucks.find((t) => String(t.id) === id);
    if (!t) return "<p>이 관찰에는 배정되지 않은 화물차예요.</p>";
    const v = sim.vehicles.get(t.id);
    const roads = (v?.route ?? sim.serviceJourneys.get(t.id)?.route ?? [])
      .slice(v?.routeIndex ?? 0)
      .map((r) => sim.network.roads.get(r)!.name);
    return `<p>${cargoPhase[t.phase]} · 적재 ${n(t.load)} / ${t.capacity}상자</p><p>물자의 출처: ${sim.sources.find((s) => s.id === t.cargoSource)!.name}<br>목적지: ${(sim.sources.find((s) => s.id === t.target) ?? sim.shops.find((s) => s.id === t.target))!.name}</p><details class="traffic-details" id="cargo-route"><summary>담당 상점과 현재 경로</summary><p>${t.itinerary.map((id) => sim.shops.find((s) => s.id === id)!.name).join(" → ")}</p><p>${roads.join(" → ") || "연결된 길이 없어 기다리고 있어요."}</p><p>배송 완료 ${n(t.delivered)}상자</p></details>`;
  }
  const shop = sim.shops.find((s) => s.facilityId === id);
  if (shop)
    return `<p>${shop.name} · 현재 재고 ${n(shop.stock)} / ${shop.capacity}상자</p><p>배송받음 ${n(shop.delivered)}상자 · 판매 ${n(shop.sold)}상자<br>물건이 없어 못 산 양 ${n(shop.unmet)}상자<br>물건이 부족했던 시간 ${(shop.stockoutSeconds / 60).toFixed(1)}분</p><p class="metric-note">처음 재고 ${shop.initial} + 배송받은 양 = 판매한 양 + 남은 재고. 분당 수요 ${n(shop.demandRate * 60)}상자.</p>`;
  const source = sim.sources.find(
    (s) => s.id === id || (id === "b15" && s.id === "factory"),
  );
  if (source)
    return `<p>${source.name}</p><p>출발을 기다리는 물자 ${n(source.stock)}상자<br>${source.external ? "이웃 마을에서 입구로 들어온" : "새로 생산한"} 양 ${n(source.generated)}상자<br>화물차에 실은 양 ${n(source.loaded)}상자</p><p class="metric-note">처음 물자 ${source.initial} + ${source.external ? "입구 공급" : "생산"} = 남은 양 + 차에 실은 양. 상점 배송 완료와는 달라요.</p>`;
  return "";
}
export function logisticsResults(
  before: LogisticsSimulation,
  after: LogisticsSimulation,
) {
  const c = compareLogistics(before, after),
    delta = c.after.unmet - c.before.unmet;
  return {
    summary: `<div class="result-highlight" data-outcome="${Math.abs(delta) < 0.05 ? "same" : delta < 0 ? "better" : "worse"}"><div><strong>${Math.abs(delta) < 0.05 ? "사지 못한 물량은 비슷해요" : `사지 못한 물량이 ${Math.abs(delta).toFixed(1)}상자 ${delta < 0 ? "줄었어요" : "늘었어요"}`}</strong><p>상점에 배송 ${n(c.after.delivered)}상자 · 사용 예산 ${after.cost}</p></div></div>`,
    table: `<table><thead><tr><th>관찰한 것</th><th>시행 전</th><th>시행 후</th></tr></thead><tbody>${c.rows.map((r) => `<tr><th>${r.label}</th><td>${n(r.before, r.unit)}</td><td class="${r.lower === null || r.before === null || r.after === null || Math.abs(r.after - r.before) < 0.05 ? "" : r.after < r.before === r.lower ? "better" : "worse"}">${n(r.after, r.unit)}</td></tr>`).join("")}</tbody></table>`,
    details: `<details class="result-details" id="logistics-regions"><summary>어느 상점에 도움이 되었나요?</summary><table><thead><tr><th>상점</th><th>못 산 양 · 전</th><th>못 산 양 · 후</th></tr></thead><tbody>${c.shops.map((s) => `<tr><th>${s.name}</th><td>${n(s.beforeUnmet)}상자</td><td class="${Math.abs(s.afterUnmet - s.beforeUnmet) < 0.05 ? "" : s.afterUnmet < s.beforeUnmet ? "better" : "worse"}">${n(s.afterUnmet)}상자</td></tr>`).join("")}</tbody></table></details><details class="result-details" id="logistics-exchange"><summary>우리 동네와 이웃 마을의 교류</summary><p>공장에서 배송: ${n(c.before.localDelivered)} → ${n(c.after.localDelivered)}상자<br>이웃 마을에서 배송: ${n(c.before.externalDelivered)} → ${n(c.after.externalDelivered)}상자<br>화물차에 남은 양: ${n(c.before.inTrucks)} → ${n(c.after.inTrucks)}상자</p><p class="metric-note">공급처에서 준비한 물자와 상점에 도착한 물자는 달라요. 평균 이동은 도착 구간만 집계해요. 아직 이동 중·길 대기 구간은 전 ${c.before.unfinishedJourneys}개, 후 ${c.after.unfinishedJourneys}개예요. 생산량이 많아도 길이 막히면 상점이 품절될 수 있어요.</p></details><details class="result-details"><summary>주민 의견은 어떻게 달라졌나요?</summary>${residentsMarkup(after, before)}</details>`,
  };
}
