import { type CityEvent, type LiveCitySimulation } from "../simulation/live";
import { cityChangeText } from "../simulation/change-messages";

export type TutorialStage = "observe" | "spotlight" | "story" | "policy" | "watch" | "result" | "free" | "done";
type Comparison = LiveCitySimulation["policyComparisons"][number];
export interface TutorialSave {
  version: 1;
  stage: TutorialStage;
  elapsed: number;
  issueId?: number;
  actionIndex?: number;
  result?: { before: number; after: number; time: number };
}

/** Guidance follows real problems/actions; it never changes the simulation. */
export class CityTutorial {
  stage: TutorialStage = "done";
  elapsed = 0;
  issue?: CityEvent;
  actionIndex?: number;
  result?: Comparison;

  get active() { return this.stage !== "done"; }
  start() {
    this.stage = "observe";
    this.elapsed = 0;
    this.issue = undefined;
    this.actionIndex = undefined;
    this.result = undefined;
  }
  finish() { this.stage = "done"; }
  private move(stage: TutorialStage) {
    this.stage = stage;
    this.elapsed = 0;
  }
  advance(sim: LiveCitySimulation, seconds: number) {
    if (!this.active || seconds <= 0) return;
    this.elapsed += seconds;
    if (this.stage === "observe" && this.elapsed >= 12) {
      const issue = sim.activeIssues.find((event) => event.position);
      if (issue) {
        this.issue = structuredClone(issue);
        this.move("spotlight");
      }
    } else if (this.stage === "spotlight" && this.elapsed >= 4) {
      this.move("story");
    } else if (this.stage === "watch" && this.actionIndex !== undefined) {
      const action = sim.actions[this.actionIndex];
      if (action && sim.time >= action.time + 120) {
        const comparison = sim.policyComparisons[this.actionIndex];
        if (comparison) {
          this.result = structuredClone(comparison);
          this.move("result");
        }
      }
    }
  }
  policiesOpened() {
    if (this.stage === "story") this.move("policy");
  }
  policyApplied(sim: LiveCitySimulation) {
    if (!this.active || ["watch", "result", "free"].includes(this.stage)) return;
    this.actionIndex = sim.actions.length - 1;
    this.move("watch");
  }
  resultRead() {
    if (this.stage === "result") this.move("free");
  }
  story(automatic?: CityEvent) {
    if (!this.active) return automatic;
    return ["story", "policy"].includes(this.stage) ? this.issue : undefined;
  }
  save(): TutorialSave {
    return {
      version: 1, stage: this.stage, elapsed: this.elapsed,
      issueId: this.issue?.id, actionIndex: this.actionIndex,
      result: this.result && { before: this.result.before, after: this.result.now, time: this.result.time },
    };
  }
  restore(value: unknown, sim: LiveCitySimulation) {
    this.start();
    this.finish();
    const s = value as Partial<TutorialSave> | undefined;
    const stages: TutorialStage[] = ["observe", "spotlight", "story", "policy", "watch", "result", "free", "done"];
    if (!s || s.version !== 1 || !stages.includes(s.stage!) || !Number.isFinite(s.elapsed) || s.elapsed! < 0) return;
    this.stage = s.stage!;
    this.elapsed = Math.min(s.elapsed!, 86400);
    this.issue = sim.news.find((event) => event.id === s.issueId && event.type === "problem" && event.position);
    if (["spotlight", "story", "policy"].includes(this.stage) && !this.issue) this.move("observe");
    if (Number.isSafeInteger(s.actionIndex) && s.actionIndex! >= 0 && sim.actions[s.actionIndex!])
      this.actionIndex = s.actionIndex;
    if (["watch", "result"].includes(this.stage) && this.actionIndex === undefined) this.move("observe");
    if (this.stage === "result") {
      const r = s.result;
      if (r && [r.before, r.after, r.time].every(Number.isFinite) && r.before >= 0 && r.after >= 0 && r.time <= sim.time && r.time >= sim.actions[this.actionIndex!].time + 120) {
        this.result = { ...sim.policyComparisons[this.actionIndex!], before: r.before, now: r.after, time: r.time };
      } else this.move("watch");
    }
  }
}

export function tutorialResultText(result: Comparison) {
  const delta = result.now - result.before;
  return cityChangeText(result.action.id === "signal" ? "traffic" : result.topic,
    Math.abs(delta) < 0.5 ? "same" : delta < 0 ? "less" : "more");
}
