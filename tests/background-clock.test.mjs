import test from "node:test";
import assert from "node:assert/strict";

import { hourKey, millisecondsToNextHour, nextHourKey } from "../src/background/clock.mjs";

test("23 rolls to 00 and computes exact boundary", () => {
  const date = new Date(2026, 7, 18, 23, 59, 59, 500);

  assert.equal(hourKey(date), "23");
  assert.equal(nextHourKey("23"), "00");
  assert.equal(millisecondsToNextHour(date), 500);
});

test("midnight resolves to 00 and waits until the following hour", () => {
  const date = new Date(2026, 7, 18, 0, 0, 0, 0);

  assert.equal(hourKey(date), "00");
  assert.equal(nextHourKey("00"), "01");
  assert.equal(millisecondsToNextHour(date), 3_600_000);
});
