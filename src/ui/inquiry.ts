import { Inquiry, INQUIRY_STEPS } from "../inquiry";
import { escapeHtml as e } from "./scenarios";
export const inquiryPanel = `<section id="panel-inquiry" class="floating-panel inquiry-panel" data-panel="inquiry" role="region" aria-labelledby="inquiry-title" hidden><div class="panel-heading"><div><span class="eyebrow">보고 · 듣고 · 함께 결정해요</span><h2 id="inquiry-title" data-panel-heading tabindex="-1">우리 동네 조사</h2></div><button class="square" data-close-panel aria-label="조사 닫기">×</button></div><div id="inquiry-content" class="panel-body"></div></section>`;
export interface InquiryContext {
  places: {
    id: string;
    name: string;
    fact: string;
    opinion: string;
    group: string;
  }[];
  phase: "before" | "after";
  time: number;
  done: boolean;
  reason: string;
}
export function inquiryMarkup(state: Inquiry, context: InquiryContext) {
  const place =
    context.places.find((p) => p.id === state.placeId) ?? context.places[0];
  state.placeId = place.id;
  const field = (id: string, label: string, value: string) =>
    `<label class="decision-reason">${label}<textarea data-inquiry-field="${id}" rows="2" maxlength="400">${e(value)}</textarea></label>`;
  const source = `<label class="layer-picker">조사할 곳<select id="inquiry-place">${context.places.map((p) => `<option value="${p.id}" ${p.id === place.id ? "selected" : ""}>${e(p.name)}</option>`).join("")}</select></label>`;
  const evidence = state.evidence.length
    ? `<ul class="evidence-list">${state.evidence.map((v) => `<li><label><input type="checkbox" data-evidence="${v.id}" ${v.used ? "checked" : ""}><span><small>${v.kind === "fact" ? "자료" : "의견"} · ${v.phase === "before" ? "시행 전" : `시행 후 ${v.trial ?? 1}회`} ${Math.floor(v.time)}초 · ${e(v.place)}</small>${e(v.text)}</span></label></li>`).join("")}</ul>`
    : `<p class="metric-note">아직 담은 자료가 없어요. 원인 조사와 의견 듣기에서 담아 보세요.</p>`;
  const bodies = [
    `${source}<p>어디에서, 누가 불편한지 찾아봐요.</p><button class="primary wide" data-inquiry-action="focus">지도에서 이곳 보기</button><p class="metric-note">지도를 살펴본 뒤 아래 ‘다음’으로 조사해요.</p>`,
    `${source}<div class="inquiry-fact"><small>지금 관찰한 사실 · ${Math.floor(context.time)}초</small><p>${e(place.fact)}</p></div><button class="secondary wide" data-inquiry-action="fact">이 자료 담기</button>${field("hypothesis", "왜 이런 문제가 생겼을까요?", state.hypothesis)}<p class="metric-note">생각한 원인과 관찰한 사실을 구분해요. 다른 현장도 살펴봐요.</p>`,
    `${source}<blockquote class="inquiry-quote"><small>${e(place.group)} · 가상 주민</small><p>“${e(place.opinion)}”</p></blockquote><button class="secondary wide" data-inquiry-action="opinion">이 의견 담기</button><button class="secondary wide" data-inquiry-action="voices">지도 말풍선으로 듣기</button><p class="metric-note">같은 문제를 겪어도 바라는 해결책이 다를 수 있어요.</p>`,
    `<p>까닭을 설명할 때 쓸 자료와 의견을 골라요.</p>${evidence}${field("alternative", "다른 방법의 좋은 점·어려운 점", state.alternative)}${field("reason", "나는 왜 이 방법을 고르나요?", context.reason)}<button class="primary wide" data-inquiry-action="policy">위치와 예산을 정해 정책 고르기</button>`,
    `<p>같은 조건으로 정책 시행 전후를 비교해요.</p><button class="primary wide" data-inquiry-action="${context.done ? "results" : "observe"}">${context.done ? "결과 비교 열기" : "실시간 현황 보기"}</button><p class="metric-note">달라진 현장뿐 아니라 그대로인 이웃도 찾아봐요. 시행 후에도 자료와 의견을 담을 수 있어요.</p>${evidence}`,
    `<p>누구에게 도움이 되었나요? 아직 남은 문제는 무엇인가요?</p>${field("proposal", "다음에는 어떻게 고치고, 누가 함께하면 좋을까요?", state.proposal)}<button class="secondary wide" data-inquiry-action="policy">다른 정책 계획하기</button><p class="metric-note">담은 자료·시행 때의 선택 이유·수정 제안은 결과 화면에서 저장·인쇄할 수 있어요.</p>`,
  ];
  return `<nav class="inquiry-steps" aria-label="조사 단계">${INQUIRY_STEPS.map((s, i) => `<button data-inquiry-step="${i}" aria-current="${i === state.step ? "step" : "false"}" title="${s}">${i + 1}</button>`).join("")}</nav><h3>${state.step + 1}. ${INQUIRY_STEPS[state.step]}</h3>${bodies[state.step]}<p class="inquiry-count" role="status">담은 자료 ${state.evidence.filter((v) => v.kind === "fact").length}개 · 주민 의견 ${state.evidence.filter((v) => v.kind === "opinion").length}개</p><div class="inquiry-nav"><button class="secondary" data-inquiry-step="${state.step - 1}" ${state.step === 0 ? "disabled" : ""}>이전</button><button class="primary" data-inquiry-step="${state.step + 1}" ${state.step === 5 ? "disabled" : ""}>다음 →</button></div>`;
}
