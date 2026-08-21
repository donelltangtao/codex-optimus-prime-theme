import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { summarizeMatrix, summarizeMatrixReport } from "../scripts/summarize-theme-matrix.mjs";

const checksum = "a".repeat(64);

function row(overrides = {}) {
  return {
    viewport: "800x600",
    hour: "00",
    mode: "compact",
    fit: "contain",
    checksum,
    layoutStatus: "native",
    backgroundFullWindow: true,
    runtimeErrors: [],
    screenshot: "800x600/00.png",
    screenshotChecksum: checksum,
    actualScreenshotChecksum: checksum,
    manualReview: "pass",
    ...overrides
  };
}

test("matrix requires every size-hour pair", () => {
  const result = summarizeMatrix([row()], ["800x600"], ["00", "01"]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ["800x600/01"]);
});

test("matrix rejects duplicates, runtime errors, mode mismatches, and compact cover", () => {
  const result = summarizeMatrix([
    row({ fit: "cover", runtimeErrors: ["renderer failed"] }),
    row()
  ], ["800x600"], ["00"]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.duplicates, ["800x600/00"]);
  assert.deepEqual(result.runtimeErrors, ["800x600/00: renderer failed"]);
  assert.ok(result.validationErrors.includes("800x600/00: expected fit contain, received cover"));
});

test("matrix requires screenshot checksum agreement and explicit manual review", () => {
  const result = summarizeMatrix([
    row({ actualScreenshotChecksum: "b".repeat(64), manualReview: "pending" })
  ], ["800x600"], ["00"]);
  assert.equal(result.ok, false);
  assert.equal(result.captured, 0);
  assert.deepEqual(result.manualReview, { passed: 0, pending: 1, failed: 0 });
  assert.ok(result.validationErrors.includes("800x600/00: screenshot checksum mismatch"));
});

test("matrix rejects a capture whose background does not cover the viewport", () => {
  const result = summarizeMatrix([
    row({ backgroundFullWindow: false })
  ], ["800x600"], ["00"]);
  assert.equal(result.ok, false);
  assert.ok(result.validationErrors.includes("800x600/00: background does not cover the full viewport"));
});

test("a complete, valid, manually approved matrix passes", () => {
  const result = summarizeMatrix([row()], ["800x600"], ["00"]);
  assert.equal(result.ok, true);
  assert.equal(result.expected, 1);
  assert.equal(result.captured, 1);
  assert.deepEqual(result.manualReview, { passed: 1, pending: 0, failed: 0 });
});

test("report loading verifies PNG bytes without trusting report paths", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "Prime Knight matrix "));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const viewportDir = path.join(root, "800x600");
  await fs.mkdir(viewportDir);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("fixture")]);
  const pngChecksum = createHash("sha256").update(png).digest("hex");
  await fs.writeFile(path.join(viewportDir, "00.png"), png);
  const reportPath = path.join(root, "report.json");
  await fs.writeFile(reportPath, JSON.stringify({ entries: [row({ screenshotChecksum: pngChecksum })] }));
  const result = await summarizeMatrixReport(reportPath, ["800x600"], ["00"]);
  assert.equal(result.ok, true);

  const outside = path.join(path.dirname(root), "outside.png");
  await fs.writeFile(outside, png);
  t.after(() => fs.rm(outside, { force: true }));
  await fs.writeFile(reportPath, JSON.stringify({ entries: [row({ screenshot: "../outside.png", screenshotChecksum: pngChecksum })] }));
  const escaped = await summarizeMatrixReport(reportPath, ["800x600"], ["00"]);
  assert.equal(escaped.ok, false);
  assert.match(escaped.validationErrors.join("\n"), /unsafe screenshot path/);
});
