import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { parseManifest } from "../src/background/manifest.mjs";

function validManifest() {
  return Array.from({ length: 24 }, (_, hour) => ({
    hour: String(hour).padStart(2, "0"),
    src: `assets/backgrounds/${String(hour).padStart(2, "0")}.webp`,
    focusX: 0.5,
    focusY: 0.5,
    safeArea: "left",
    positionWide: "72% 50%",
    positionStandard: "68% 50%",
    positionCompact: "center top",
    overlayOpacity: 0.4,
    dominantTone: hour < 6 ? "deep-night" : hour < 10 ? "dawn" : hour < 17 ? "day-command" : hour < 20 ? "dusk" : "night-battle",
    checksum: "a".repeat(64)
  }));
}

test("manifest contains every hour exactly once", async () => {
  const raw = JSON.parse(await fs.readFile("config/backgrounds.json", "utf8"));
  const rows = parseManifest(raw, { allowProvisionalChecksums: true });

  assert.deepEqual(rows.map((row) => row.hour), Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0")));
  assert.equal(new Set(rows.map((row) => row.src)).size, 24);
});

test("manifest sorts rows by numeric hour", () => {
  const manifest = validManifest();
  [manifest[0], manifest[23]] = [manifest[23], manifest[0]];

  assert.deepEqual(parseManifest(manifest).map((row) => row.hour), Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0")));
});

test("manifest rejects a duplicate hour", () => {
  const manifest = validManifest();
  manifest[23].hour = "22";

  assert.throws(() => parseManifest(manifest), /hour/);
});

test("manifest rejects focusX outside 0..1", () => {
  const manifest = validManifest();
  manifest[0].focusX = 1.01;

  assert.throws(() => parseManifest(manifest), /focusX/);
});

test("manifest rejects overlayOpacity outside 0..1", () => {
  const manifest = validManifest();
  manifest[0].overlayOpacity = -0.01;

  assert.throws(() => parseManifest(manifest), /overlayOpacity/);
});

test("manifest rejects an absolute source path", () => {
  const manifest = validManifest();
  manifest[0].src = "/assets/backgrounds/00.webp";

  assert.throws(() => parseManifest(manifest), /src/);
});

test("manifest rejects a URL source path", () => {
  const manifest = validManifest();
  manifest[0].src = "https://example.test/00.webp";

  assert.throws(() => parseManifest(manifest), /src/);
});

test("manifest rejects a checksum that is not lowercase SHA-256 hex", () => {
  const manifest = validManifest();
  manifest[0].checksum = "A".repeat(64);

  assert.throws(() => parseManifest(manifest), /checksum/);
});

test("strict manifest validation rejects provisional all-zero checksums", () => {
  const manifest = validManifest();
  manifest[0].checksum = "0".repeat(64);

  assert.throws(() => parseManifest(manifest), /checksum/);
});

test("v1 package rejects provisional checksums even when a caller requests local opt-in", () => {
  const manifest = validManifest();
  manifest[0].checksum = "0".repeat(64);

  assert.throws(
    () => parseManifest(manifest, { allowProvisionalChecksums: true, packageVersion: "0.1.0-local" }),
    /checksum/
  );
});

test("explicit opt-in rejects provisional all-zero checksums on a release package version", () => {
  const manifest = validManifest();
  manifest[0].checksum = "0".repeat(64);

  assert.throws(() => parseManifest(manifest, { allowProvisionalChecksums: true, packageVersion: "0.1.0" }), /checksum/);
});
