import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { scanPaths, scanText } from "../scripts/privacy-scan.mjs";

test("privacy scanner names local and chat artifacts in stable rule order", () => {
  const localPath = "/" + ["Users", "example", "a"].join("/");
  const clipboardMarker = ["codex", "clipboard", "abc"].join("-");
  const generatedMarker = ["generated", "images"].join("_");
  const result = scanText("fixture.txt", `${localPath} ${clipboardMarker} ${generatedMarker} chat title`);
  assert.equal(result.ok, false);
  assert.deepEqual(result.findings.map((finding) => finding.rule), [
    "absolute-user-path",
    "clipboard-artifact",
    "generated-image-path",
    "chat-content"
  ]);
});

test("privacy scanner rejects credentials, private keys, runtime state, and machine temp paths", () => {
  const secret = ["ghp", "A".repeat(36)].join("_");
  const text = [
    secret,
    "-----BEGIN PRIVATE KEY-----",
    "/private/var/folders/aa/bb/T/file",
    ".runtime/watcher.pid"
  ].join("\n");
  const rules = scanText("fixture.txt", text).findings.map((finding) => finding.rule);
  assert.deepEqual(rules, ["temporary-path", "access-token", "private-key", "runtime-state"]);
});

test("documented portable placeholders do not trigger local-path findings", () => {
  const result = scanText("README.md", "$HOME/.codex/pets and <user>/project are portable examples");
  assert.deepEqual(result, { ok: true, findings: [] });
});

test("path scanning checks names and UTF-8 text but skips binary payload bytes", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "Prime Knight privacy "));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const safe = path.join(root, "safe.txt");
  const badName = path.join(root, ["codex", "clipboard", "export.txt"].join("-"));
  const binary = path.join(root, "asset.webp");
  await fs.writeFile(safe, "safe portable content\n");
  await fs.writeFile(badName, "safe contents\n");
  await fs.writeFile(binary, Buffer.from([0, 1, 2, 3, 4, 5]));
  const result = await scanPaths([safe, badName, binary], { root });
  assert.equal(result.ok, false);
  assert.deepEqual(result.findings.map((finding) => finding.rule), ["clipboard-artifact"]);
  assert.equal(result.scanned, 3);
});
