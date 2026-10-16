import { readExperimentRecord, type RecordView } from "../records";
import { escapeHtml } from "./scenarios";
export function recordMarkup(record: RecordView) {
  const table = (rows: RecordView["rows"]) =>
    `<table><thead><tr><th>관찰한 것</th><th>시행 전</th><th>시행 후</th></tr></thead><tbody>${rows.map((r) => `<tr><th>${escapeHtml(r.label)}</th><td>${escapeHtml(r.before)}</td><td>${escapeHtml(r.after)}</td></tr>`).join("")}</tbody></table>`;
  const inquiry = record.inquiry;
  const notebook =
    inquiry &&
    (inquiry.evidence.length ||
      inquiry.hypothesis ||
      inquiry.proposal ||
      inquiry.decisions.some((d) => d.alternative || d.evidenceIds.length))
      ? `<h3>우리의 조사 수첩</h3><p>생각한 원인: ${escapeHtml(inquiry.hypothesis || "(아직 적지 않았어요)")}</p><ol>${inquiry.evidence.map((v) => `<li><b>${v.kind === "fact" ? "자료" : "의견"} · ${escapeHtml(v.place)}</b> · ${v.phase === "before" ? "시행 전" : `시행 후 ${v.trial ?? 1}회`} ${Math.floor(v.time)}초<br>${escapeHtml(v.text)}</li>`).join("")}</ol>${inquiry.decisions.map((d, i) => `<h4>정책 시행 ${i + 1}회의 선택 근거</h4><p>${escapeHtml(d.reason || "(아직 적지 않았어요)")}<br>참고한 수첩 항목: ${d.evidenceIds.join(", ") || "없음"}<br>다른 방법과 비교: ${escapeHtml(d.alternative || "(아직 적지 않았어요)")}</p>`).join("")}<h3>수정 제안</h3><p class="student-writing">${escapeHtml(inquiry.proposal || "(아직 적지 않았어요)")}</p>`
      : "";
  return `<h2>${record.title}</h2><p>이름: __________________　 날짜: ________________</p><p>${escapeHtml(record.timeLabel)} · 조건 ${record.seed} · 조사한 자료 ${record.investigationCount}건</p><p>선택한 정책: ${escapeHtml(record.policies.join(" · ") || "없음")}</p>${table(record.rows)}${record.regions.length ? `<h3>어느 동네가 달라졌나요?</h3>${table(record.regions)}` : ""}${notebook}<h3>선택한 까닭</h3><p class="student-writing">${escapeHtml(record.reason || "(아직 적지 않았어요)")}</p><h3>결과를 보고 든 생각</h3><p class="student-writing">${escapeHtml(record.reflection || "(아직 적지 않았어요)")}</p><p class="metric-note">시뮬레이션 ${escapeHtml(record.modelVersion)} · 기록 버전 ${record.schemaVersion}. 가상 도시의 실험 결과예요.</p>`;
}
export function installRecordTools(
  build: () => unknown,
  notify: (message: string) => void,
) {
  const $ = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!;
  let loaded: RecordView | undefined;
  $("#open-record").addEventListener("click", () =>
    $<HTMLInputElement>("#record-file").click(),
  );
  $("#record-file").addEventListener("change", async () => {
    const input = $<HTMLInputElement>("#record-file"),
      file = input.files?.[0];
    if (!file) return;
    try {
      if (file.size > 5_000_000)
        throw new Error("기록은 5MB 이하로 열어 주세요.");
      loaded = readExperimentRecord(await file.text());
      $("#saved-record-content").innerHTML =
        recordMarkup(loaded) +
        (loaded.opinions.length
          ? `<details class="result-details"><summary>저장한 주민 의견</summary>${loaded.opinions.map((text) => `<p>${escapeHtml(text)}</p>`).join("")}</details>`
          : "");
      $<HTMLDialogElement>("#record-dialog").showModal();
    } catch (error) {
      notify(error instanceof Error ? error.message : "기록을 열 수 없어요.");
    }
    input.value = "";
  });
  $("#close-record").addEventListener("click", () =>
    $<HTMLDialogElement>("#record-dialog").close(),
  );
  const print = (record: RecordView) => {
    $("#print-sheet").innerHTML = recordMarkup(record);
    window.print();
  };
  $("#print-record").addEventListener("click", () => {
    if (loaded) print(loaded);
  });
  $("#print-current").addEventListener("click", () => {
    try {
      print(readExperimentRecord(JSON.stringify(build())));
    } catch {
      notify("정책 실험을 마친 뒤 출력해 주세요.");
    }
  });
}
