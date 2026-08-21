#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { assertBackgroundDimensions } from "./lib/webp-dimensions.mjs";

const MIN_BYTES = 100_000;
const MAX_BYTES = 20 * 1024 * 1024;

function usage() {
  throw new Error("usage: verify-backgrounds.mjs [--write-checksums] <manifest.json> <asset-directory>");
}

const args = process.argv.slice(2);
const writeChecksums = args[0] === "--write-checksums";
const positional = writeChecksums ? args.slice(1) : args;
if (positional.length !== 2) usage();

const [manifestPath, assetDirectory] = positional;
const originalText = await fs.readFile(manifestPath, "utf8");
const manifest = JSON.parse(originalText);
if (!Array.isArray(manifest) || manifest.length !== 24) throw new Error("manifest must contain exactly 24 rows");

const expectedHours = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0"));
const hashes = [];
const results = [];
let invalid = 0;

for (const [index, row] of manifest.entries()) {
  const expectedHour = expectedHours[index];
  const errors = [];
  if (row.hour !== expectedHour) errors.push(`expected hour ${expectedHour}`);
  if (row.src !== `assets/backgrounds/${expectedHour}.webp`) errors.push("unexpected src");
  if (!(Number.isFinite(row.focusX) && row.focusX >= 0 && row.focusX <= 1)) errors.push("invalid focusX");
  if (!(Number.isFinite(row.focusY) && row.focusY >= 0 && row.focusY <= 1)) errors.push("invalid focusY");
  if (!Number.isFinite(row.overlayOpacity) || row.overlayOpacity < 0 || row.overlayOpacity > 1) errors.push("invalid overlayOpacity");

  try {
    const file = await fs.readFile(path.join(assetDirectory, `${expectedHour}.webp`));
    if (file.length <= MIN_BYTES || file.length > MAX_BYTES) errors.push(`size ${file.length} outside bounds`);
    const size = assertBackgroundDimensions(file);
    const checksum = createHash("sha256").update(file).digest("hex");
    hashes.push(checksum);
    if (writeChecksums) row.checksum = checksum;
    else if (row.checksum !== checksum) errors.push("checksum mismatch");
    results.push({ hour: expectedHour, checksum, bytes: file.length, ...size, errors });
  } catch (error) {
    errors.push(error.message);
    results.push({ hour: expectedHour, errors });
  }
  if (errors.length) invalid += 1;
}

const unique = new Set(hashes).size;
if (unique !== hashes.length) {
  invalid += hashes.length - unique;
}

if (writeChecksums && invalid === 0) {
  const rows = manifest.map((row) => JSON.stringify(row)
    .replace(/^\{/, "{ ")
    .replace(/\}$/, " }")
    .replace(/\":/g, '\": ')
    .replace(/,\"/g, ', \"'));
  await fs.writeFile(manifestPath, `[\n  ${rows.join(",\n  ")}\n]\n`);
}

for (const result of results.filter((result) => result.errors.length)) {
  console.error(`${result.hour}: ${result.errors.join(", ")}`);
}
console.log(`${results.length - invalid} valid, ${unique} unique, ${invalid} invalid`);
if (invalid !== 0 || results.length !== 24 || unique !== 24) process.exitCode = 1;
