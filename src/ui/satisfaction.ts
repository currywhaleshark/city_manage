import {
  LIVE_POLICIES,
  TOPICS,
  type LiveCitySimulation,
  type Topic,
} from "../simulation/live";
import {
  citySatisfaction,
  SATISFACTION_TOPICS,
  type CitySatisfaction,
  type SatisfactionPart,
} from "../simulation/satisfaction";

export interface SatisfactionSample {
  time: number;
  overall: number;
  topics: Record<Topic, number>;
}
export type SatisfactionLine = "overall" | Topic;

// City seconds. Traffic queues flicker; residents react to the recent trend.
export const SATISFACTION_SMOOTHING = 20;
export const SATISFACTION_SAMPLE = 10;
export const SATISFACTION_TREND = 60;
const MAX_SAMPLES = 360;

const round = (n: number) => Math.round(n * 10) / 10;
const stamp = (time: number) =>
  `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, "0")}`;

/** Display-only history kept beside the city record, like the tutorial. */
export class SatisfactionTracker {
  readonly history: SatisfactionSample[] = [];
  current?: SatisfactionSample;
  detail?: CitySatisfaction;

  reset() {
    this.history.length = 0;
    this.current = this.detail = undefined;
  }

  update(sim: LiveCitySimulation) {
    const raw = citySatisfaction(sim);
    this.detail = raw;
    const previous = this.current;
    if (previous && sim.time < previous.time) this.reset();
    const target: SatisfactionSample = {
      time: sim.time,
      overall: raw.overall,
      topics: Object.fromEntries(
        SATISFACTION_TOPICS.map((t) => [t, raw.topics[t].score]),
      ) as Record<Topic, number>,
    };
    if (!this.current) this.current = target;
    else {
      const k =
        1 - Math.exp(-(sim.time - this.current.time) / SATISFACTION_SMOOTHING);
      const blend = (a: number, b: number) => a + (b - a) * k;
      const topics = { ...this.current.topics };
      for (const t of SATISFACTION_TOPICS)
        topics[t] = blend(topics[t], target.topics[t]);
      this.current = {
        time: sim.time,
        overall: blend(this.current.overall, target.overall),
        topics,
      };
    }
    const last = this.history[this.history.length - 1];
    if (!last || this.current.time - last.time >= SATISFACTION_SAMPLE) {
      this.history.push(this.current);
      if (this.history.length > MAX_SAMPLES) this.history.shift();
    }
  }

  /** Change against the newest sample at least a minute old. */
  trend(line: SatisfactionLine = "overall") {
    if (!this.current) return 0;
    let before: SatisfactionSample | undefined;
    for (const s of this.history)
      if (this.current.time - s.time >= SATISFACTION_TREND) before = s;
    if (!before) return 0;
    return lineValue(this.current, line) - lineValue(before, line);
  }

  save() {
    return this.history.map((s) => ({
      time: round(s.time),
      overall: round(s.overall),
      topics: Object.fromEntries(
        SATISFACTION_TOPICS.map((t) => [t, round(s.topics[t])]),
      ),
    }));
  }

  restore(data: unknown, time: number) {
    this.reset();
    if (!Array.isArray(data)) return;
    let previous = -Infinity;
    for (const s of data.slice(-MAX_SAMPLES)) {
      const valid =
        Number.isFinite(s?.time) &&
        s.time > previous &&
        s.time <= time &&
        [s.overall, ...SATISFACTION_TOPICS.map((t) => s.topics?.[t])].every(
          (n) => Number.isFinite(n) && n >= 0 && n <= 100,
        );
      if (!valid) continue;
      previous = s.time;
      this.history.push({
        time: s.time,
        overall: s.overall,
        topics: Object.fromEntries(
          SATISFACTION_TOPICS.map((t) => [t, s.topics[t]]),
        ) as Record<Topic, number>,
      });
    }
    this.current = this.history[this.history.length - 1];
  }
}

function lineValue(s: SatisfactionSample, line: SatisfactionLine) {
  return line === "overall" ? s.overall : s.topics[line];
}

export function satisfactionBand(score: number) {
  return score >= 65 ? "good" : score >= 40 ? "fair" : "poor";
}
const faces = { good: "😊", fair: "😐", poor: "😟" };
const moods = { good: "만족해요", fair: "보통이에요", poor: "불편해요" };

export function trendMarkup(change: number) {
  const n = Math.round(change);
  if (n >= 1)
    return `<span class="satisfaction-trend up" aria-label="1분 전보다 ${n} 올랐어요">▲${n}</span>`;
  if (n <= -1)
    return `<span class="satisfaction-trend down" aria-label="1분 전보다 ${-n} 내렸어요">▼${-n}</span>`;
  return `<span class="satisfaction-trend same" aria-label="1분 전과 비슷해요">–</span>`;
}

/** Header gauge contents; the button itself is static in the page shell. */
export function satisfactionGauge(tracker: SatisfactionTracker) {
  const score = tracker.current?.overall ?? 0;
  const band = satisfactionBand(score);
  return `<span class="satisfaction-face" aria-hidden="true">${faces[band]}</span><span class="satisfaction-copy"><small>주민 만족도</small><b>${Math.round(score)}</b></span>${trendMarkup(tracker.trend())}<i class="satisfaction-meter" aria-hidden="true"><i class="${band}" style="width:${score.toFixed(0)}%"></i></i>`;
}

function partMarkup(p: SatisfactionPart) {
  const unit = (n: number) => `${n.toFixed(p.digits)}${p.unit}`;
  return `<li><span>${p.label}</span><b>${unit(p.value)}</b><small>${unit(p.good)} 이하면 만족 · ${unit(p.bad)} 이상이면 불편</small></li>`;
}

export function satisfactionTopics(
  tracker: SatisfactionTracker,
  open: Set<string> = new Set(),
) {
  const { current, detail } = tracker;
  if (!current || !detail) return "";
  return SATISFACTION_TOPICS.map((t) => {
    const score = current.topics[t];
    const band = satisfactionBand(score);
    return `<details class="satisfaction-topic" data-satisfaction-topic="${t}" ${open.has(t) ? "open" : ""}><summary><span class="satisfaction-topic-title">${TOPICS[t]}</span><span class="satisfaction-bar" aria-hidden="true"><i class="${band}" style="width:${score.toFixed(0)}%"></i></span><b>${Math.round(score)}</b>${trendMarkup(tracker.trend(t))}</summary><p class="metric-note">왜 이 점수일까요? 지금 도시에서 잰 수치예요.</p><ul class="satisfaction-parts">${detail.topics[t].parts.map(partMarkup).join("")}</ul></details>`;
  }).join("");
}

const W = 340,
  H = 160,
  PAD = { left: 28, right: 8, top: 18, bottom: 22 };

export function satisfactionChart(
  tracker: SatisfactionTracker,
  sim: LiveCitySimulation,
  line: SatisfactionLine,
) {
  const samples = tracker.history;
  if (samples.length < 2)
    return '<p class="metric-note">도시 시간이 조금 더 흐르면 만족도 변화가 그래프로 나타나요.</p>';
  const from = samples[0].time,
    to = Math.max(samples[samples.length - 1].time, from + 60);
  const x = (t: number) =>
    PAD.left + ((t - from) / (to - from)) * (W - PAD.left - PAD.right);
  const y = (v: number) =>
    PAD.top + ((100 - v) / 100) * (H - PAD.top - PAD.bottom);
  const points = samples
    .map((s) => `${x(s.time).toFixed(1)},${y(lineValue(s, line)).toFixed(1)}`)
    .join(" ");
  const grid = [0, 40, 65, 100]
    .map(
      (v) =>
        `<line class="grid" x1="${PAD.left}" x2="${W - PAD.right}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${PAD.left - 4}" y="${y(v) + 3}" text-anchor="end">${v}</text>`,
    )
    .join("");
  const visible = (t: number) => t >= from && t <= to;
  const policies = sim.actions
    .filter(
      (a) =>
        visible(a.time) &&
        (line === "overall" ||
          LIVE_POLICIES.find((p) => p.id === a.id)!.topic === line),
    )
    .map((a) => {
      const title = LIVE_POLICIES.find((p) => p.id === a.id)!.title;
      return `<g class="policy-mark"><title>${stamp(a.time)} ${title} 시행</title><line x1="${x(a.time)}" x2="${x(a.time)}" y1="${PAD.top}" y2="${H - PAD.bottom}"/><circle cx="${x(a.time)}" cy="${PAD.top - 7}" r="5"/></g>`;
    })
    .join("");
  const solved = sim.news
    .filter(
      (n) =>
        n.type === "improved" &&
        visible(n.time) &&
        (line === "overall" || n.topic === line),
    )
    .map(
      (n) =>
        `<g class="solved-mark"><title>${stamp(n.time)} ${n.title}</title><text x="${x(n.time)}" y="${H - PAD.bottom - 4}" text-anchor="middle">✓</text></g>`,
    )
    .join("");
  const name = line === "overall" ? "전체 만족도" : `${TOPICS[line]} 만족도`;
  return `<svg class="satisfaction-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${name}의 시간 변화. 정책 시행 ${policies ? "시점을 세로선으로 표시" : "기록 없음"}">${grid}${policies}<polyline points="${points}"/>${solved}<text class="axis" x="${PAD.left}" y="${H - 6}">${stamp(from)}</text><text class="axis" x="${W - PAD.right}" y="${H - 6}" text-anchor="end">${stamp(to)}</text></svg><p class="satisfaction-legend"><span class="legend-line"></span>${name} <span class="legend-policy"></span>정책 시행 <span class="legend-solved">✓</span>문제가 나아짐</p>`;
}

export function satisfactionSummary(tracker: SatisfactionTracker) {
  const score = tracker.current?.overall ?? 0;
  const band = satisfactionBand(score);
  return `<span class="satisfaction-face ${band}" aria-hidden="true">${faces[band]}</span><div><small>주민들은 지금</small><strong>${moods[band]} · ${Math.round(score)}점</strong></div>${trendMarkup(tracker.trend())}`;
}

export function satisfactionPanel(
  tracker: SatisfactionTracker,
  sim: LiveCitySimulation,
  line: SatisfactionLine,
) {
  const chips = (["overall", ...SATISFACTION_TOPICS] as SatisfactionLine[])
    .map(
      (l) =>
        `<button class="satisfaction-line" data-satisfaction-line="${l}" aria-pressed="${l === line}">${l === "overall" ? "전체" : TOPICS[l]}</button>`,
    )
    .join("");
  return `<div class="satisfaction-summary" id="satisfaction-summary">${satisfactionSummary(tracker)}</div><p class="intro">주민이 겪는 불편을 잰 수치로 만든 점수예요. 분야를 눌러 어떤 수치 때문인지 살펴봐요.</p><div id="satisfaction-topics">${satisfactionTopics(tracker)}</div><h3>시간에 따른 변화</h3><div class="satisfaction-lines" role="group" aria-label="그래프에 볼 분야">${chips}</div><div id="satisfaction-chart">${satisfactionChart(tracker, sim, line)}</div><p class="metric-note">화살표는 도시 시간 1분 전과 비교한 변화예요. 여러 생활 변화가 함께 반영되므로 정책 하나의 효과로 단정하지 않아요. 준비 시간이 필요한 정책은 효과가 늦게 나타나요.</p>`;
}
