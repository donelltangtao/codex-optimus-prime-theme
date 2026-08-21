import test from "node:test";
import assert from "node:assert/strict";

import { presentationFor } from "../src/background/presentation.mjs";

const art = {
  positionWide: "78% 48%",
  positionStandard: "72% 50%",
  positionCompact: "center top"
};

test("viewport modes preserve native space", () => {
  assert.deepEqual(presentationFor({ width: 800, height: 600, devicePixelRatio: 2 }, art), {
    mode: "compact", fit: "contain", position: "center top", chromeDensity: "minimal", topChromePx: 10, bottomChromePx: 10
  });
  assert.equal(presentationFor({ width: 1440, height: 900, devicePixelRatio: 2 }, art).mode, "standard");
  assert.equal(presentationFor({ width: 2560, height: 1080, devicePixelRatio: 2 }, art).mode, "ultrawide");
  assert.equal(presentationFor({ width: 1024, height: 580, devicePixelRatio: 2 }, art).chromeDensity, "minimal");
});

test("standard mode uses its complete presentation mapping", () => {
  assert.deepEqual(presentationFor({ width: 900, height: 650, devicePixelRatio: 2 }, art), {
    mode: "standard", fit: "cover", position: "72% 50%", chromeDensity: "full", topChromePx: 48, bottomChromePx: 48
  });
});

test("wide mode starts at the exact width boundary", () => {
  assert.deepEqual(presentationFor({ width: 1600, height: 900, devicePixelRatio: 2 }, art), {
    mode: "wide", fit: "cover", position: "78% 48%", chromeDensity: "full", topChromePx: 48, bottomChromePx: 48
  });
});

test("ultrawide mode starts at the exact aspect boundary", () => {
  assert.deepEqual(presentationFor({ width: 1300, height: 650, devicePixelRatio: 2 }, art), {
    mode: "ultrawide", fit: "cover", position: "78% 48%", chromeDensity: "full", topChromePx: 48, bottomChromePx: 48
  });
});

test("compact boundaries retain precedence below 900 width or 650 height", () => {
  assert.equal(presentationFor({ width: 899, height: 900, devicePixelRatio: 2 }, art).mode, "compact");
  assert.equal(presentationFor({ width: 1200, height: 649, devicePixelRatio: 2 }, art).mode, "compact");
});
