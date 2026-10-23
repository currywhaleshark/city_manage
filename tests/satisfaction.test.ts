import test from "node:test";
import assert from "node:assert/strict";
import { LiveCitySimulation } from "../src/simulation/live";
import {
  citySatisfaction,
  partScore,
  SATISFACTION_TOPICS,
} from "../src/simulation/satisfaction";
import {
  SatisfactionTracker,
  SATISFACTION_SAMPLE,
  satisfactionChart,
  satisfactionPanel,
} from "../src/ui/satisfaction";

test("part scores run linearly from the content value to the unhappy value", () => {
  assert.equal(partScore(0, 0, 6), 100);
  assert.equal(partScore(3, 0, 6), 50);
  assert.equal(partScore(9, 0, 6), 0);
  assert.equal(partScore(-1, 0, 6), 100);
});

test("satisfaction is read from the city's measured values", () => {
  const city = new LiveCitySimulation();
  city.runUntil(60);
  const s = citySatisfaction(city);
  for (const t of SATISFACTION_TOPICS) {
    assert.ok(s.topics[t].score >= 0 && s.topics[t].score <= 100);
    assert.ok(s.topics[t].parts.length > 0);
  }
  assert.equal(s.topics.parking.parts[0].value, city.values.parking);
  assert.equal(s.topics.access.parts[0].value, city.values.access);
  const mean =
    SATISFACTION_TOPICS.reduce((n, t) => n + s.topics[t].score, 0) /
    SATISFACTION_TOPICS.length;
  assert.equal(s.overall, mean);
});

test("a new library raises access satisfaction without touching the city", () => {
  const city = new LiveCitySimulation();
  const before = citySatisfaction(city).topics.access.score;
  const budget = city.budget;
  citySatisfaction(city);
  assert.equal(city.budget, budget, "reading satisfaction is side-effect free");
  city.apply("library", city.targets("library")[0].id);
  assert.ok(citySatisfaction(city).topics.access.score > before);
});

test("the tracker smooths, samples and reports a one-minute trend", () => {
  const city = new LiveCitySimulation();
  const tracker = new SatisfactionTracker();
  for (let t = 0; t <= 180; t += 2) {
    city.runUntil(t);
    tracker.update(city);
  }
  assert.ok(tracker.history.length >= 180 / SATISFACTION_SAMPLE);
  for (let i = 1; i < tracker.history.length; i++)
    assert.ok(
      tracker.history[i].time - tracker.history[i - 1].time >=
        SATISFACTION_SAMPLE,
    );
  const raw = citySatisfaction(city).overall;
  const current = tracker.current!.overall;
  assert.ok(Math.abs(current - raw) < 40);
  const minuteAgo = [...tracker.history]
    .reverse()
    .find((s) => city.time - s.time >= 60)!;
  assert.equal(tracker.trend(), current - minuteAgo.overall);
});

test("saved history round-trips and rejects invalid or future samples", () => {
  const city = new LiveCitySimulation();
  const tracker = new SatisfactionTracker();
  for (let t = 0; t <= 60; t += 5) {
    city.runUntil(t);
    tracker.update(city);
  }
  const saved = tracker.save();
  const restored = new SatisfactionTracker();
  restored.restore(JSON.parse(JSON.stringify(saved)), city.time);
  assert.equal(restored.history.length, saved.length);
  assert.equal(restored.current!.overall, saved[saved.length - 1].overall);

  const bad = [
    ...saved,
    { ...saved[0], time: city.time + 100 },
    { time: city.time + 200, overall: 150, topics: saved[0].topics },
  ];
  restored.restore(bad, city.time);
  assert.equal(restored.history.length, saved.length);
  restored.restore("broken", city.time);
  assert.equal(restored.history.length, 0);
  assert.equal(restored.current, undefined);
});

test("a city that starts over clears the earlier history", () => {
  const old = new LiveCitySimulation();
  const tracker = new SatisfactionTracker();
  old.runUntil(40);
  tracker.update(old);
  tracker.update(new LiveCitySimulation());
  assert.equal(tracker.history.length, 1);
  assert.equal(tracker.history[0].time, 0);
});

test("the chart marks policies and only the selected topic's actions", () => {
  const city = new LiveCitySimulation();
  const tracker = new SatisfactionTracker();
  tracker.update(city);
  city.runUntil(20);
  city.apply("cleanup", city.targets("cleanup")[0].id);
  for (let t = 30; t <= 80; t += 10) {
    city.runUntil(t);
    tracker.update(city);
  }
  const marks = (svg: string) => svg.split('class="policy-mark"').length - 1;
  assert.equal(marks(satisfactionChart(tracker, city, "overall")), 1);
  assert.equal(marks(satisfactionChart(tracker, city, "waste")), 1);
  assert.equal(marks(satisfactionChart(tracker, city, "water")), 0);
  assert.match(satisfactionPanel(tracker, city, "overall"), /주민 만족도|주민들은 지금/);
});
