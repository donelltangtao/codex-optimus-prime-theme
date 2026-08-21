import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { assertBackgroundDimensions, readWebPDimensions } from "../scripts/lib/webp-dimensions.mjs";
import { parseManifest } from "../src/background/manifest.mjs";

function vp8xFixture(width, height) {
  const buffer = Buffer.alloc(30);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WEBP", 8, "ascii");
  buffer.write("VP8X", 12, "ascii");
  buffer.writeUInt32LE(10, 16);
  buffer.writeUIntLE(width - 1, 24, 3);
  buffer.writeUIntLE(height - 1, 27, 3);
  return buffer;
}

test("background dimension validation rejects a wrong-size WebP fixture", () => {
  assert.throws(
    () => assertBackgroundDimensions(vp8xFixture(2559, 1440)),
    /expected 2560x1440.*2559x1440/i
  );
});

test("all production backgrounds are unique, bounded WebP files", async () => {
  const rows = parseManifest(JSON.parse(await fs.readFile("config/backgrounds.json", "utf8")));
  const hashes = [];
  for (const row of rows) {
    const file = await fs.readFile(path.join("assets/backgrounds", `${row.hour}.webp`));
    assert.equal(file.subarray(8, 12).toString("ascii"), "WEBP");
    assert.ok(file.length > 100_000 && file.length <= 20 * 1024 * 1024);
    assert.deepEqual(readWebPDimensions(file), { width: 2560, height: 1440 });
    const hash = createHash("sha256").update(file).digest("hex");
    assert.equal(hash, row.checksum);
    hashes.push(hash);
  }
  assert.equal(new Set(hashes).size, 24);
});
