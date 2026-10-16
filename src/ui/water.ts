import {
  WaterSimulation,
  WATER_SITES,
  WATER_SOURCES,
  WATER_CELL_LENGTH,
  waterLevel,
} from "../simulation/water";
import { compareWater } from "../metrics/water";
import { residentsMarkup } from "./scenarios";
import { WORLD } from "../city/world";
export function waterFact(sim: WaterSimulation, id: string) {
  const s = sim.waterStats.sites.find((s) => s.id === id)!;
  const cell = WATER_SITES.find((site) => site.id === id)!.cell;
  const origins = new Map<string, number>();
  for (const packet of sim.packets) {
    if (
      packet.kind !== "dissolved" ||
      Math.floor((packet.z - WORLD.min) / WATER_CELL_LENGTH) !== cell
    )
      continue;
    origins.set(
      packet.source,
      (origins.get(packet.source) ?? 0) + packet.amount,
    );
  }
  const mainSources = [...origins]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(
      ([source, amount]) =>
        `${WATER_SOURCES.find((s) => s.id === source)?.name ?? "처음부터 있던 오염"} ${amount.toFixed(1)}가상단위`,
    )
    .join(" · ");
  return `관찰 ${sim.round}차 · ${s.name}: 가상 오염도 ${s.level.toFixed(1)} (${waterLevel(s.level)}) · 이 구간 물 위 쓰레기 ${s.litter.toFixed(1)}봉투. 이 구간에 도착해 남은 오염의 주요 출처(모형): ${mainSources || "없음"}. 물은 상류에서 하류로 흘러요. 색은 실제 수질을 뜻하지 않아요.`;
}
export function waterSources(sim: WaterSimulation) {
  const status = [
    sim.configuration.outlet
      ? `배출구 장치: ${sim.time < 60 ? "준비 중 · 1분 뒤 작동" : "처리 중"}`
      : "",
    sim.configuration.sewer
      ? `생활하수 시설: ${sim.time <= 300 ? "공사 중 · 2차부터 처리" : "처리 중"}`
      : "",
    sim.configuration.riverCleanup
      ? `둔치 청소: ${sim.time < 60 ? "준비 중 · 1분 뒤 시작" : "작업 중"} · 차단막 ${sim.captured.toFixed(1)} / 8봉투${sim.captured >= 8 - 1e-7 ? " · 가득 차서 새 쓰레기는 지나가요" : ""}`
      : "차단막을 설치하지 않았어요.",
  ]
    .filter(Boolean)
    .map((text) => `<p>${text}</p>`)
    .join("");
  return `${status}<p class="metric-note">배출구에서 생긴 양 = 처리한 양 + 강에 들어간 양. 지도 밖 상류에서도 소량이 들어와요.</p>${sim.sources.map((s, i) => `<p><strong>${WATER_SOURCES[i].name}</strong><br>발생 ${s.raw.toFixed(1)} · 처리 ${s.treated.toFixed(1)} · 유입 ${s.entered.toFixed(1)} 가상단위</p>`).join("")}`;
}
export function waterSelection(sim: WaterSimulation, id: string) {
  return `<p>${waterFact(sim, id)}</p><button class="primary wide" data-water-inquiry="${id}">이 지점 조사하기</button><details class="traffic-details"><summary>오염은 어디에서 들어왔나요?</summary>${waterSources(sim)}</details>`;
}
export const waterObservation = `<div id="water-summary"></div><p class="metric-note">색은 가상 오염도, 봉투는 물 위 쓰레기예요. 5분씩 세 번, 같은 물길을 이어서 관찰해요.</p><button class="secondary wide" id="next-water-round">이어서 관찰하기</button>${WATER_SITES.map((s) => `<button class="site-row" data-water-site="${s.id}"><span>${s.name}<small data-water-amount="${s.id}"></small></span><strong>보기 →</strong></button>`).join("")}<details class="traffic-details"><summary>유입구별 발생·처리와 차단막</summary><div id="water-sources"></div></details>`;
export function waterSummary(sim: WaterSimulation) {
  const s = sim.waterStats;
  return `<div class="big-metric"><span>관찰 ${sim.round} / 3차 · 하류 가상 오염도</span><strong>${s.sites[2].level.toFixed(1)}<small>${waterLevel(s.sites[2].level)}</small></strong></div><div class="metric-grid"><div><span>유입 전 처리 · 누적</span><strong>${s.treated.toFixed(1)}<small>가상단위</small></strong></div><div><span>남은 둔치·물 위 쓰레기</span><strong>${s.litterRemaining.toFixed(1)}봉투</strong></div></div>`;
}
export function waterResults(before: WaterSimulation, after: WaterSimulation) {
  const c = compareWater(before, after),
    delta = c.after.sites[2].level - c.before.sites[2].level;
  const table = `<table><thead><tr><th>관찰한 것</th><th>시행 전</th><th>시행 후</th></tr></thead><tbody>${c.sites.map((s) => `<tr><th>${s.name} · 가상 오염도</th><td>${s.before.toFixed(1)}</td><td class="${s.after < s.before - 0.01 ? "better" : ""}">${s.after.toFixed(1)}</td></tr>`).join("")}</tbody></table>`;
  return {
    table,
    summary: `<div class="result-highlight"><div><strong>${Math.abs(delta) < 0.05 ? "하류 오염도는 비슷해요" : `하류 오염도가 ${Math.abs(delta).toFixed(1)} ${delta < 0 ? "낮아졌어요" : "높아졌어요"}`}</strong><p>사용 예산 ${after.cost} · 물에 섞인 오염과 떠 있는 쓰레기를 따로 봐요.</p></div></div>`,
    details: `<details class="result-details" id="water-round-results"><summary>하류에는 언제 변화가 나타났나요?</summary><table><thead><tr><th>관찰</th><th>하류 · 전</th><th>후</th></tr></thead><tbody>${after.rounds.map((r, i) => `<tr><th>${r.round}차</th><td>${before.rounds[i].levels[2].toFixed(1)}</td><td>${r.levels[2].toFixed(1)}</td></tr>`).join("")}</tbody></table><p class="metric-note">처리 시설을 고쳐도 이미 강에 들어간 오염은 바로 없어지지 않아요. 물이 이동하는 데 시간이 걸려요.</p></details><details class="result-details"><summary>처리한 양·남은 양·지도 밖으로 나간 양</summary><table><thead><tr><th>자료</th><th>전</th><th>후</th></tr></thead><tbody>${c.rows.map((r) => `<tr><th>${r.label}</th><td>${r.before.toFixed(1)}</td><td>${r.after.toFixed(1)}</td></tr>`).join("")}</tbody></table><p class="metric-note">오염은 가상단위, 쓰레기는 봉투예요. 지도 밖으로 나간 양은 처리한 양이 아니에요.</p></details><details class="result-details"><summary>주민의 생각</summary>${residentsMarkup(after, before)}</details><button class="secondary wide" id="review-inquiry">조사 자료와 선택 이유 돌아보기</button><p class="metric-note">고정된 물의 속도와 가상 유입량으로 비교해요. 실제 수질 등급이나 마실 수 있는 물인지 판단하는 자료는 아니에요.</p>`,
  };
}
