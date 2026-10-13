import test from "node:test";
import assert from "node:assert/strict";
import { RenderClock } from "../src/renderer/quality";

test("render cadence retains 60/30 FPS across 60, 120 and 144 Hz displays", () => {
  for (const hz of [60, 120, 144])
    for (const quality of ["normal", "light"] as const) {
      const clock = new RenderClock();
      let drawn = 0;
      for (let frame = 0; frame < hz * 10; frame++)
        if (clock.due((frame * 1000) / hz, quality)) drawn++;
      assert.ok(
        Math.abs(drawn - (quality === "normal" ? 600 : 300)) <= 1,
        `${hz} Hz, ${quality}: ${drawn} frames over 10s`,
      );
    }
});

test("quality switches draw immediately and long pauses discard missed renders", () => {
  const clock = new RenderClock();
  assert.equal(clock.due(0, "normal"), true);
  assert.equal(clock.due(2, "normal"), false);
  assert.equal(clock.due(3, "light"), true);
  assert.equal(clock.due(10, "light"), false);
  assert.equal(clock.due(5000, "light"), true);
  assert.equal(clock.due(5001, "light"), false);
  assert.equal(clock.due(5002, "normal"), true);
});
