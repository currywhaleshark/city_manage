import test from "node:test";
import assert from "node:assert/strict";
import { LiveCitySimulation, restoreLiveCity, validateLiveSave } from "../src/simulation/live";
import { captureLiveCheckpoint, restoreLiveCheckpoint } from "../src/simulation/checkpoint";
import { communityProject, communityProposals, communityMethod, communityVoters, holdCommunityVote, type CommunityProjectId } from "../src/simulation/community";

const heard = (project: CommunityProjectId) => communityProject(project).voices.map(v => v.id);

test("resident votes are stable, budget-aware, one per resident, with an actual runoff for tied leaders", () => {
  const winners = new Set<string>();
  let runoffs = 0;
  for (let seed = 2400; seed < 2440; seed++) for (const budget of [8, 10, 100]) {
    const vote = holdCommunityVote(seed, "sorting", "alley", budget);
    assert.deepEqual(vote, holdCommunityVote(seed, "sorting", "alley", budget));
    winners.add(vote.winner);
    const voters = communityVoters(seed, "sorting", "alley");
    vote.rounds.forEach((r, i) => {
      assert.equal(r.ballots.length, 11);
      assert.equal(new Set(r.ballots.map(b => b.voter)).size, 11);
      assert.ok(r.candidates.every(id => communityMethod(id).cost <= budget));
      for (const b of r.ballots) assert.equal(b.method, voters.find(v => v.id === b.voter)!.ranking.find(id => r.candidates.includes(id)));
      if (i) {
        runoffs++;
        assert.equal(r.candidates.length, 2);
        const first = vote.rounds[0];
        const counts = first.candidates.map(id => first.ballots.filter(b => b.method === id).length);
        assert.deepEqual(r.candidates, first.candidates.filter((_, j) => counts[j] === Math.max(...counts)));
      }
    });
    const last = vote.rounds.at(-1)!;
    const count = (id: string) => last.ballots.filter(b => b.method === id).length;
    assert.ok(last.candidates.filter(id => id !== vote.winner).every(id => count(vote.winner) > count(id)));
  }
  assert.equal(winners.size, 3, "there is no preselected winning solution");
  assert.ok(runoffs > 0);
  assert.throws(() => holdCommunityVote(2404, "sorting", "alley", 7), /두 가지/);
  assert.throws(() => holdCommunityVote(2404, "waterCare", "factoryNorth", 100));
  for (const project of ["walking", "sorting", "waterCare"] as const) {
    const proposals = communityProposals(project);
    assert.equal(new Set(proposals.map(p => p.title)).size, 3);
    assert.equal(new Set(proposals.map(p => p.proposer.id)).size, 3);
  }
});

test("the mayor implements only the counted winner and cannot change a vote, skip voices or spend twice", () => {
  const city = new LiveCitySimulation();
  const vote = holdCommunityVote(city.seed, "sorting", "alley", city.budget);
  const original = structuredClone(vote);
  assert.equal(city.council.records.length, 0);
  assert.equal(city.budget, 100, "holding the vote does not start an activity");
  assert.throws(() => city.council.decide("sorting", "alley", [], vote));
  assert.throws(() => city.council.decide("sorting", "alley", heard("sorting"), undefined!));
  assert.throws(() => city.council.decide("sorting", "alley", heard("sorting"), { ...vote, winner: "flexible" }));
  const corrupted = structuredClone(vote);
  corrupted.rounds[0].ballots[0].voter = "resident-2";
  assert.throws(() => city.council.decide("sorting", "alley", heard("sorting"), corrupted));
  const changedBudget = holdCommunityVote(city.seed, "sorting", "alley", 80);
  assert.throws(() => city.council.decide("sorting", "alley", heard("sorting"), changedBudget), /예산/);
  assert.equal(city.budget, 100);
  assert.equal(city.council.records.length, 0);
  const record = city.council.decide("sorting", "alley", heard("sorting"), vote, "안내를 도와요", "다른 시간에도 참여해요");
  assert.equal(record.method, vote.winner);
  assert.equal(city.budget, 100 - communityMethod(vote.winner).cost);
  vote.rounds[0].ballots.length = 0;
  assert.deepEqual(record.vote, original, "the counted vote cannot be changed through the draft");
  assert.throws(() => city.council.decide("sorting", "alley", heard("sorting"), original));
  assert.equal(city.council.records.length, 1);
});

test("ballots and minority notes survive JSON and checkpoints, while historical meetings retain no invented vote", async () => {
  const city = new LiveCitySimulation();
  city.runUntil(60);
  city.apply("dropoff", "alley");
  const vote = holdCommunityVote(city.seed, "sorting", "alley", city.budget);
  const record = city.council.decide("sorting", "alley", heard("sorting"), vote, "수거를 챙겨요", "낮에 일하는 이웃도 도와요");
  record.reflection = "모임에 못 온 이웃의 의견도 다시 들어요";
  city.runUntil(80);
  const saved = city.save();
  const replay = await restoreLiveCity(JSON.parse(JSON.stringify(saved)));
  const cached = restoreLiveCheckpoint(captureLiveCheckpoint(city), saved);
  for (const s of [replay, cached]) {
    assert.deepEqual(s.council.records, city.council.records);
    assert.deepEqual(s.news, city.news);
    s.runUntil(120);
  }
  city.runUntil(120);
  assert.deepEqual(replay.council.records, city.council.records);
  assert.deepEqual(cached.council.records, city.council.records);
  for (const mutate of [
    (v: any) => { v.winner = "flexible"; },
    (v: any) => { v.rounds[0].ballots.pop(); },
    (v: any) => { v.rounds[1].candidates = ["flexible", "relay"]; },
    (v: any) => { v.budget = NaN; },
  ]) {
    const bad = structuredClone(saved);
    mutate(bad.council![0].vote);
    assert.throws(() => validateLiveSave(bad));
  }
  const old = new LiveCitySimulation();
  old.council.start("waterCare", "homes", "flexible", heard("waterCare"));
  old.runUntil(65);
  assert.equal((await restoreLiveCity(old.save())).council.records[0].vote, undefined);
  assert.deepEqual(restoreLiveCheckpoint(captureLiveCheckpoint(old), old.save()).council.records, old.council.records);
});

test("problems remain visible without policy, policy mitigates locally, and the residents' elected action adds a limited improvement", t => {
  for (const seed of [2404, 2405]) for (const topic of ["parking", "waste", "water"] as const) {
    const results: number[] = [];
    const project = topic === "parking" ? "walking" : topic === "waste" ? "sorting" : "waterCare";
    const target = topic === "waste" ? "alley" : "homes";
    for (const mode of [0, 1, 2]) {
      const city = new LiveCitySimulation(seed);
      city.runUntil(120);
      if (mode) {
        if (topic === "parking") city.apply("patrol", target);
        if (topic === "waste") city.apply("dropoff", target);
        if (topic === "water") city.apply("sewer", "riverside");
      }
      if (mode === 2) city.council.decide(project, target, heard(project), holdCommunityVote(seed, project, target, city.budget));
      let illegalSeconds = 0;
      for (let second = 121; second <= 720; second++) {
        city.runUntil(second);
        illegalSeconds += city.parking.parkingStats.sites.find(s => s.id === "homes")!.illegal;
      }
      const metric = topic === "parking" ? illegalSeconds : topic === "waste" ? city.illegal("alley").remaining : city.water.sources.find(s => s.id === "homes")!.entered;
      results.push(metric);
      assert.ok(metric > 0, "participation never guarantees disappearance of the problem");
      assert.ok(city.news.some(n => n.type === "problem"), "problems are still observable after routing fixes");
      if (mode === 2) {
        const r = city.council.records[0];
        assert.ok(topic === "parking" ? r.walkingTrips > 0 : topic === "waste" ? r.guidedBags > 0 : r.preventedPollution > 0);
        assert.ok(city.parking.parkingStats.sites.some(s => s.id !== target && s.illegal > 0));
        assert.ok(city.water.sources.find(s => s.id === "factoryNorth")!.entered > 0);
        city.runUntil(r.endsAt + 0.1);
        assert.ok(r.result, "the temporary activity ends and can be reconsidered");
      }
    }
    t.diagnostic(JSON.stringify({ seed, topic, none: results[0], policy: results[1], electedParticipation: results[2] }));
    assert.ok(results[1] < results[0], `${seed} ${topic}: local policy helps`);
    assert.ok(results[2] < results[1], `${seed} ${topic}: participation adds a real local improvement`);
  }
});
