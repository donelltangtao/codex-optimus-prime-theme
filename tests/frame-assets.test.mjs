import test from "node:test";
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { readWebPDimensions } from "../scripts/lib/webp-dimensions.mjs";

const execFile = promisify(execFileCallback);

const FRAME_NAMES = [
  "corner-tl",
  "corner-tr",
  "corner-bl",
  "corner-br",
  "edge-h",
  "edge-v",
  "divider-v",
  "divider-v-top",
  "divider-v-bottom",
  "divider-h",
  "divider-h-left",
  "divider-h-right",
  "energy-core",
  "chamber-sidebar",
  "chamber-main",
  "chamber-composer"
];

const FRAME_DIMENSIONS = {
  "corner-tl": [512, 512],
  "corner-tr": [512, 512],
  "corner-bl": [512, 512],
  "corner-br": [512, 512],
  "edge-h": [1024, 128],
  "edge-v": [128, 1024],
  "divider-v": [128, 1024],
  "divider-v-top": [512, 512],
  "divider-v-bottom": [512, 512],
  "divider-h": [1024, 128],
  "divider-h-left": [512, 512],
  "divider-h-right": [512, 512],
  "energy-core": [768, 320],
  "chamber-sidebar": [512, 2048],
  "chamber-main": [2048, 1248],
  "chamber-composer": [2048, 348]
};

const CURRENT_CSS_FRAME_NAMES = [
  "chamber-sidebar",
  "chamber-main",
  "chamber-composer"
];

function webPChunks(data) {
  const chunks = [];
  for (let offset = 12; offset + 8 <= data.length;) {
    const type = data.subarray(offset, offset + 4).toString("ascii");
    const size = data.readUInt32LE(offset + 4);
    chunks.push({ type, start: offset + 8, size });
    offset += 8 + size + (size % 2);
  }
  return chunks;
}

function hasAlpha(data) {
  const chunks = webPChunks(data);
  const extended = chunks.find((chunk) => chunk.type === "VP8X");
  return chunks.some((chunk) => chunk.type === "ALPH")
    || Boolean(extended && (data[extended.start] & 0x10));
}

async function decodedAlphaBounds(file, t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "prime-knight-frame-alpha-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const pamPath = path.join(directory, "decoded.pam");
  await execFile(process.env.PK_DWEBP ?? "dwebp", [file, "-pam", "-o", pamPath]);
  const data = await fs.readFile(pamPath);
  const headerEnd = data.indexOf(Buffer.from("ENDHDR\n"));
  assert.notEqual(headerEnd, -1, `${file} must decode to PAM`);
  const header = data.subarray(0, headerEnd).toString("ascii");
  const width = Number(header.match(/WIDTH (\d+)/)?.[1]);
  const height = Number(header.match(/HEIGHT (\d+)/)?.[1]);
  const pixels = data.subarray(headerEnd + "ENDHDR\n".length);
  let left = width;
  let top = height;
  let right = 0;
  let bottom = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] <= 16) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x + 1);
      bottom = Math.max(bottom, y + 1);
    }
  }
  return { left, top, right, bottom, width, height };
}

test("production frame fragments are bounded transparent WebP assets", async () => {
  for (const name of FRAME_NAMES) {
    const data = await fs.readFile(path.join("assets/frame", `${name}.webp`));
    assert.equal(data.subarray(0, 4).toString("ascii"), "RIFF", name);
    assert.equal(data.subarray(8, 12).toString("ascii"), "WEBP", name);
    assert.ok(data.length < 2 * 1024 * 1024, `${name} must stay below 2 MiB`);
    assert.equal(hasAlpha(data), true, `${name} must retain a real alpha channel`);
    const { width, height } = readWebPDimensions(data);
    assert.deepEqual([width, height], FRAME_DIMENSIONS[name], `${name} must use its measured production slot`);
  }
});

test("production chamber frames touch every exterior edge without a transparent gap", async (t) => {
  const bounds = {};
  for (const name of CURRENT_CSS_FRAME_NAMES) {
    bounds[name] = await decodedAlphaBounds(path.join("assets/frame", `${name}.webp`), t);
  }

  for (const [name, box] of Object.entries(bounds)) {
    assert.deepEqual(
      { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
      { left: 0, top: 0, right: box.width, bottom: box.height },
      `${name} must place visible chassis pixels on all four chamber edges`
    );
  }
});

test("frame CSS remains layout-neutral and density-aware", async () => {
  const css = await fs.readFile("src/theme/prime-knight.css", "utf8");
  const hostRule = css.match(/#prime-knight-shell\s*\{([^}]*)\}/)?.[1] ?? "";
  const contentRule = css.match(/\[data-prime-knight-content-layer="true"\]\s*\{([^}]*)\}/)?.[1] ?? "";

  assert.match(hostRule, /display:\s*contents/);
  assert.doesNotMatch(hostRule, /(?:^|[;\n]\s*)(?:position|z-index|isolation|transform|opacity|filter|contain|mix-blend-mode)\s*:/);
  assert.deepEqual([...contentRule.matchAll(/([a-z-]+)\s*:/g)].map((match) => match[1]), ["position", "z-index"]);
  assert.match(css, /\.prime-knight-background\s*\{[\s\S]*?z-index:\s*0/);
  assert.match(css, /\[data-prime-knight-content-layer="true"\]\s*\{[\s\S]*?z-index:\s*1/);
  assert.match(css, /\.prime-knight-chrome\s*\{[\s\S]*?z-index:\s*2/);
  assert.match(css, /\.prime-knight-chamber-frame\s*\{[^}]*background-size:\s*100% 100%/s);
  assert.match(css, /\.prime-knight-chamber-frame-sidebar\s*\{[^}]*width:\s*var\(--prime-knight-sidebar-right\)/s);
  assert.match(css, /\.prime-knight-chamber-frame-main\s*\{[^}]*width:\s*var\(--prime-knight-main-width\)[^}]*height:\s*var\(--prime-knight-main-height\)/s);
  assert.match(css, /\.prime-knight-chamber-frame-composer\s*\{[^}]*top:\s*var\(--prime-knight-composer-top\)/s);
  assert.doesNotMatch(css, /\\|@import\b|\burl\s*\(/i);
  for (const name of CURRENT_CSS_FRAME_NAMES) {
    assert.match(css, new RegExp(`var\\(--prime-knight-frame-${name}\\)`));
  }
});
