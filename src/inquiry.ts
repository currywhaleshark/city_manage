export const INQUIRY_STEPS = [
  "현장 찾기",
  "원인 조사",
  "의견 듣기",
  "해결책 결정",
  "시행·비교",
  "수정 제안",
] as const;
export interface Evidence {
  id: number;
  phase: "before" | "after";
  kind: "fact" | "opinion";
  time: number;
  place: string;
  text: string;
  used: boolean;
  trial?: number;
}
export interface InquiryDecision {
  reason: string;
  alternative: string;
  evidenceIds: number[];
  policies: string[];
}
export class Inquiry {
  step = 0;
  placeId = "";
  hypothesis = "";
  alternative = "";
  proposal = "";
  evidence: Evidence[] = [];
  decisions: InquiryDecision[] = [];
  collect(item: Omit<Evidence, "id" | "used">) {
    if (this.evidence.length >= 30) return false;
    if (
      this.evidence.some(
        (e) =>
          e.phase === item.phase &&
          e.trial === item.trial &&
          e.kind === item.kind &&
          e.place === item.place &&
          e.text === item.text,
      )
    )
      return false;
    this.evidence.push(
      Object.freeze({ ...item, id: this.evidence.length + 1, used: false }),
    );
    return true;
  }
  toggle(id: number) {
    this.evidence = this.evidence.map((e) =>
      e.id === id ? Object.freeze({ ...e, used: !e.used }) : e,
    );
  }
  decide(reason: string, policies: readonly string[]) {
    this.decisions.push({
      reason,
      alternative: this.alternative,
      policies: [...policies],
      evidenceIds: this.evidence.filter((e) => e.used).map((e) => e.id),
    });
  }
  snapshot() {
    return JSON.parse(
      JSON.stringify({
        hypothesis: this.hypothesis,
        proposal: this.proposal,
        evidence: this.evidence,
        decisions: this.decisions,
      }),
    );
  }
}
