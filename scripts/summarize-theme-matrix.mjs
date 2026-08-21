#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const APPROVED_VIEWPORT_NAMES = Object.freeze([
  "800x600",
  "1024x768",
  "1280x800",
  "1440x900",
  "1728x1117",
  "1920x1080",
  "2560x1080",
  "3440x1440"
]);
export const APPROVED_HOURS = Object.freeze(
  Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0"))
);

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function expectedPresentation(viewport) {
  const match = /^(\d+)x(\d+)$/.exec(viewport);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  let mode;
  if (width < 900 || height < 650) mode = "compact";
  else if (width / height >= 2) mode = "ultrawide";
  else if (width >= 1600) mode = "wide";
  else mode = "standard";
  return { mode, fit: mode === "compact" ? "contain" : "cover" };
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

export function summarizeMatrix(rows, viewports = APPROVED_VIEWPORT_NAMES, hours = APPROVED_HOURS) {
  if (!Array.isArray(rows) || !Array.isArray(viewports) || !Array.isArray(hours)) {
    throw new TypeError("matrix rows, viewports, and hours must be arrays");
  }
  const expectedPairs = viewports.flatMap((viewport) => hours.map((hour) => `${viewport}/${hour}`));
  const expectedSet = new Set(expectedPairs);
  const counts = new Map();
  const runtimeErrors = [];
  const validationErrors = [];
  const validScreenshotPairs = new Set();
  const reviewByPair = new Map();

  for (const entry of rows) {
    const viewport = typeof entry?.viewport === "string" ? entry.viewport : "<invalid>";
    const hour = typeof entry?.hour === "string" ? entry.hour : "<invalid>";
    const pair = `${viewport}/${hour}`;
    counts.set(pair, (counts.get(pair) ?? 0) + 1);
    if (!expectedSet.has(pair)) {
      validationErrors.push(`${pair}: unexpected viewport-hour pair`);
      continue;
    }
    const presentation = expectedPresentation(viewport);
    if (entry.mode !== presentation.mode) {
      validationErrors.push(`${pair}: expected mode ${presentation.mode}, received ${String(entry.mode)}`);
    }
    if (entry.fit !== presentation.fit) {
      validationErrors.push(`${pair}: expected fit ${presentation.fit}, received ${String(entry.fit)}`);
    }
    if (!SHA256_PATTERN.test(entry.checksum ?? "")) {
      validationErrors.push(`${pair}: invalid background checksum`);
    }
    if (entry.backgroundFullWindow !== true) {
      validationErrors.push(`${pair}: background does not cover the full viewport`);
    }
    if (entry.layoutStatus !== "anchored" && entry.layoutStatus !== "native") {
      validationErrors.push(`${pair}: invalid layout status`);
    }
    if (!Array.isArray(entry.runtimeErrors)) {
      validationErrors.push(`${pair}: runtimeErrors must be an array`);
    } else {
      for (const error of entry.runtimeErrors) runtimeErrors.push(`${pair}: ${String(error)}`);
    }

    const expectedScreenshot = `${viewport}/${hour}.png`;
    let screenshotValid = true;
    if (entry.screenshot !== expectedScreenshot) {
      validationErrors.push(`${pair}: unexpected screenshot path`);
      screenshotValid = false;
    }
    if (entry.screenshotReadError) {
      validationErrors.push(`${pair}: ${entry.screenshotReadError}`);
      screenshotValid = false;
    }
    if (!SHA256_PATTERN.test(entry.screenshotChecksum ?? "")) {
      validationErrors.push(`${pair}: invalid screenshot checksum`);
      screenshotValid = false;
    }
    if (entry.actualScreenshotChecksum !== entry.screenshotChecksum) {
      validationErrors.push(`${pair}: screenshot checksum mismatch`);
      screenshotValid = false;
    }
    if (screenshotValid) validScreenshotPairs.add(pair);
    reviewByPair.set(pair, entry.manualReview);
  }

  const missing = expectedPairs.filter((pair) => !counts.has(pair));
  const duplicates = uniqueSorted([...counts].filter(([, count]) => count > 1).map(([pair]) => pair));
  const manualReview = { passed: 0, pending: 0, failed: 0 };
  for (const pair of expectedPairs) {
    const review = reviewByPair.get(pair);
    if (review === "pass") manualReview.passed += 1;
    else if (review === "fail") manualReview.failed += 1;
    else manualReview.pending += 1;
  }
  const captured = [...validScreenshotPairs].filter((pair) => expectedSet.has(pair)).length;
  const ok = expectedPairs.length > 0
    && missing.length === 0
    && duplicates.length === 0
    && runtimeErrors.length === 0
    && validationErrors.length === 0
    && captured === expectedPairs.length
    && manualReview.passed === expectedPairs.length;
  return {
    ok,
    expected: expectedPairs.length,
    captured,
    missing,
    duplicates,
    runtimeErrors,
    validationErrors: uniqueSorted(validationErrors),
    manualReview
  };
}

async function hydrateScreenshot(entry, screenshotRoot) {
  const hydrated = { ...entry, actualScreenshotChecksum: null };
  const relative = entry?.screenshot;
  if (typeof relative !== "string" || path.isAbsolute(relative)) {
    hydrated.screenshotReadError = "unsafe screenshot path";
    return hydrated;
  }
  const resolvedRoot = await fs.realpath(screenshotRoot);
  const candidate = path.resolve(resolvedRoot, relative);
  const relativeToRoot = path.relative(resolvedRoot, candidate);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    hydrated.screenshotReadError = "unsafe screenshot path";
    return hydrated;
  }
  try {
    const stat = await fs.lstat(candidate);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("screenshot is not a regular file");
    const realCandidate = await fs.realpath(candidate);
    const realRelative = path.relative(resolvedRoot, realCandidate);
    if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) throw new Error("unsafe screenshot path");
    const bytes = await fs.readFile(realCandidate);
    if (bytes.length < PNG_SIGNATURE.length || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
      throw new Error("screenshot is not a PNG file");
    }
    hydrated.actualScreenshotChecksum = createHash("sha256").update(bytes).digest("hex");
  } catch (error) {
    hydrated.screenshotReadError = error?.message ?? String(error);
  }
  return hydrated;
}

export async function summarizeMatrixReport(
  reportPath,
  viewports = APPROVED_VIEWPORT_NAMES,
  hours = APPROVED_HOURS
) {
  const absoluteReport = path.resolve(reportPath);
  const report = JSON.parse(await fs.readFile(absoluteReport, "utf8"));
  if (!Array.isArray(report.entries)) throw new TypeError("matrix report entries must be an array");
  const screenshotRoot = path.dirname(absoluteReport);
  const rows = await Promise.all(report.entries.map((entry) => hydrateScreenshot(entry, screenshotRoot)));
  return summarizeMatrix(rows, viewports, hours);
}

async function main(args) {
  if (args.length !== 1) throw new Error("usage: summarize-theme-matrix.mjs <report.json>");
  const result = await summarizeMatrixReport(args[0]);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

const isEntryPoint = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isEntryPoint) {
  await main(process.argv.slice(2));
}
