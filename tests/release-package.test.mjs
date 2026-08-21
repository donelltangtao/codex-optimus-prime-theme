import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  PUBLIC_PRIVACY_PATHS,
  PUBLIC_REPOSITORY_PATHS,
  buildRelease
} from "../scripts/build-release.mjs";

const COMMAND_FILES = [
  "Install Prime Knight Theme.command",
  "Start Prime Knight Theme.command",
  "Verify Prime Knight Theme.command",
  "Restore Native Codex.command"
];

async function sha256(file) {
  return createHash("sha256").update(await fs.readFile(file)).digest("hex");
}

async function listTree(root, relative = "") {
  const rows = [];
  const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name, "en"));
  for (const entry of entries) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    rows.push(child);
    if (entry.isDirectory()) rows.push(...await listTree(root, child));
  }
  return rows;
}

test("release metadata declares the public v1 product", async () => {
  const pkg = JSON.parse(await fs.readFile("package.json", "utf8"));
  assert.equal(pkg.name, "codex-prime-knight-theme");
  assert.equal(pkg.version, "1.0.1");
  assert.equal(pkg.engines.node, ">=20.10.0");
  assert.match(await fs.readFile("README.md", "utf8"), /codex擎天柱主题 v1/i);
  assert.match(await fs.readFile("README.zh-CN.md", "utf8"), /双击.*Install Prime Knight Theme\.command/s);
  assert.match(await fs.readFile("docs/TROUBLESHOOTING.md", "utf8"), /Restore Native Codex\.command/);
});

test("public repository allowlist excludes local evidence and the optional pet", () => {
  const forbidden = [
    "pets/",
    "artifacts/",
    "screenshots/",
    ".runtime/",
    ".profile/",
    ".state/",
    "docs/superpowers/",
    "docs/local-verification/",
    "install-pet",
    "uninstall-pet"
  ];
  for (const file of PUBLIC_REPOSITORY_PATHS) {
    for (const marker of forbidden) {
      assert.equal(file.includes(marker), false, `${file} includes forbidden marker ${marker}`);
    }
  }
  assert.equal(new Set(PUBLIC_REPOSITORY_PATHS).size, PUBLIC_REPOSITORY_PATHS.length);
  assert.equal(PUBLIC_REPOSITORY_PATHS.includes("README.md"), true);
  assert.equal(PUBLIC_REPOSITORY_PATHS.includes("assets/backgrounds/20.webp"), true);
  assert.equal(PUBLIC_REPOSITORY_PATHS.includes("src/runtime/watcher.mjs"), true);
});

test("release builder creates one deterministic, private-data-free macOS ZIP", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "prime-knight-v1-release-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const first = await buildRelease({ projectRoot: process.cwd(), outputRoot: path.join(root, "first") });
  const second = await buildRelease({ projectRoot: process.cwd(), outputRoot: path.join(root, "second") });

  assert.equal(await sha256(first.zipPath), await sha256(second.zipPath));
  assert.equal(first.archiveChecksum, await sha256(first.zipPath));
  assert.equal(
    await fs.readFile(first.checksumPath, "utf8"),
    `${first.archiveChecksum}  ${path.basename(first.zipPath)}\n`
  );

  const releaseRoot = first.repositoryPath;
  const tree = await listTree(releaseRoot);
  assert.equal(tree.some((entry) => entry === "pets" || entry.startsWith("pets/")), false);
  assert.equal(tree.some((entry) => entry === ".git" || entry.startsWith(".git/")), false);
  assert.equal(tree.some((entry) => entry.includes("screenshots") || entry.includes(".state")), false);
  assert.equal(tree.filter((entry) => /^assets\/backgrounds\/\d{2}\.webp$/.test(entry)).length, 24);

  for (const command of COMMAND_FILES) {
    const stat = await fs.stat(path.join(releaseRoot, command));
    assert.notEqual(stat.mode & 0o111, 0, `${command} must be executable`);
  }

  const privacy = JSON.parse(await fs.readFile(first.privacyReportPath, "utf8"));
  assert.equal(privacy.ok, true);
  assert.equal(privacy.scanned, PUBLIC_PRIVACY_PATHS.length);
});
