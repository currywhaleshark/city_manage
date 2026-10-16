import {
  TOPICS,
  type LiveCitySimulation,
  type LiveSave,
  type Topic,
} from "../simulation/live";
import { cityStamp } from "./live-study";

const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const number = (value: number) => Number(value.toFixed(1)).toString();
export function changeText(before: number, after: number) {
  const difference = Number((after - before).toFixed(1));
  return difference === 0
    ? "변화 없음"
    : `${number(Math.abs(difference))} ${difference < 0 ? "줄었어요" : "늘었어요"}`;
}
export function policyComparisonMarkup(sim: LiveCitySimulation) {
  if (!sim.actions.length)
    return '<p class="metric-note">정책을 시행하면 적용한 장소와 시행 전후의 수치를 여기서 함께 볼 수 있어요.</p>';
  return `<section class="policy-comparisons" aria-label="정책을 시행한 뒤의 변화"><h3>정책을 시행한 뒤</h3>${[
    ...sim.policyComparisons,
  ]
    .reverse()
    .map(
      (p, index) =>
        `<details class="policy-comparison" ${index === 0 ? "open" : ""}><summary>${escape(p.place)} · ${escape(p.title)}</summary><p class="metric-note">도시 시간 ${cityStamp(p.action.time)}에 시행 · ${p.scope === p.place ? escape(p.scope) : `적용 장소와 별도로 ${escape(p.scope)}`}의 수치</p><p>${escape(p.measurement)}</p><div class="study-comparison"><span>시행 전 ${number(p.before)}</span><strong>→</strong><span>관찰 때 ${number(p.now)}</span></div><p>${changeText(p.before, p.now)} · ${cityStamp(p.time)}에 확인</p><p class="study-remaining">${p.now > 0 ? `아직 남은 수치: ${number(p.now)}. 지도와 주민 이야기에서 남은 불편을 찾아봐요.` : "이 지표의 수치는 0이에요. 다른 불편이나 다시 생기는 문제도 살펴봐요."}</p><p class="metric-note">${escape(p.tradeoff)}</p>${p.action.reason ? `<p>선택한 까닭: ${escape(p.action.reason)}</p>` : ""}<button data-review-policy="${sim.actions.indexOf(p.action)}">${p.position ? "이 장소 다시 살펴보기" : "도시 전체 지도 살펴보기"}</button></details>`,
    )
    .join(
      "",
    )}<p class="metric-note">시행 전과 이 창을 열 때의 실제 수치를 비교해요. 다른 정책·생활 변화도 함께 반영되므로 정책 하나의 효과로 단정하지 않아요.</p></section>`;
}

type Observation = LiveSave["observations"][number];
export class ObservationComparison {
  readonly snapshots: Observation[];
  from: number;
  to: number;
  constructor(sim: LiveCitySimulation) {
    this.snapshots = [
      ...structuredClone(sim.observations),
      { time: sim.time, values: { ...sim.values } },
    ];
    this.to = this.snapshots.length - 1;
    this.from = Math.max(0, this.to - 1);
  }
  controls() {
    if (this.snapshots.length < 2) return "";
    const options = (selected: number) =>
      this.snapshots
        .map(
          (o, i) =>
            `<option value="${i}" ${i === selected ? "selected" : ""}>${i === this.snapshots.length - 1 ? "창을 열 때" : `관찰 ${i + 1}`} · ${cityStamp(o.time)}</option>`,
        )
        .join("");
    return `<details class="observation-comparison"><summary>도시 전체의 두 시점 비교</summary><div class="study-times"><label>먼저<select id="compare-from">${options(this.from)}</select></label><label>나중<select id="compare-to">${options(this.to)}</select></label></div><div id="observation-comparison-result">${this.result()}</div><p class="metric-note">도시 전체의 기록이에요. 줄어든 수치만으로 문제가 모두 해결되었다고 단정하지 않아요.</p></details>`;
  }
  result() {
    const first = this.snapshots[this.from],
      last = this.snapshots[this.to];
    if (!first || !last || first.time > last.time || this.from === this.to)
      return '<p role="status">서로 다른 두 시점을 고르고, 먼저 관찰한 시점을 왼쪽에 놓아요.</p>';
    return `<table class="study-table"><caption>도시 시간 ${cityStamp(first.time)} → ${cityStamp(last.time)}</caption><thead><tr><th scope="col">분야</th><th scope="col">먼저</th><th scope="col">나중</th></tr></thead><tbody>${(Object.keys(TOPICS) as Topic[]).map((topic) => `<tr><th scope="row">${TOPICS[topic]}<small>${{ parking: "불법주차 · 대", waste: "길가 투기물 · 봉투", water: "하류 · 가상 오염도", supply: "재고 부족 · 상점", access: "이용 어려움 · 명" }[topic]}</small></th><td>${number(first.values[topic])}</td><td>${number(last.values[topic])}<small>${changeText(first.values[topic], last.values[topic])}</small></td></tr>`).join("")}</tbody></table>`;
  }
}
