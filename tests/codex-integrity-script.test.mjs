import test from "node:test";
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

test("integrity snapshot is read-only and checks the official identity", async () => {
  const script = await fs.readFile("scripts/snapshot-codex-integrity-macos.sh", "utf8");
  assert.match(script, /codesign[^\n]*--verify[^\n]*--deep[^\n]*--strict/);
  assert.match(script, /CFBundleIdentifier/);
  assert.match(script, /pk_verify_codex_signature/);
  assert.doesNotMatch(script, /codesign[^\n]*--force|xattr[^\n]*-d|defaults[^\n]*write/);
});

test("snapshot writes stable JSON and fails closed when strict signature validation fails", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "Prime Knight integrity "));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const output = path.join(root, "snapshot.json");
  const node = process.execPath.replaceAll("'", "'\\''");
  const body = [
    "source scripts/snapshot-codex-integrity-macos.sh",
    `pk_initialize_paths() { PK_NODE='${node}'; }`,
    "pk_require_supported_environment() { :; }",
    "pk_discover_codex_app() { printf '/Applications/ChatGPT.app\\n'; }",
    "pk_snapshot_bundle_value() { case \"$2\" in CFBundleIdentifier) printf 'com.openai.codex\\n' ;; CFBundleShortVersionString) printf '26.810.52044\\n' ;; CFBundleVersion) printf '52044\\n' ;; CFBundleExecutable) printf 'ChatGPT\\n' ;; esac; }",
    "pk_snapshot_architecture() { printf 'arm64\\n'; }",
    "pk_snapshot_codesign_details() { printf 'CDHash=0123456789abcdef0123456789abcdef01234567\\nTeamIdentifier=2DC432GLL2\\n'; }",
    "pk_snapshot_requirement() { printf 'designated => identifier \\\"com.openai.codex\\\"\\n'; }",
    "pk_snapshot_codesign_integrity() { return 1; }",
    "pk_verify_codex_signature() { return 1; }",
    "snapshot_main \"$OUTPUT\""
  ].join("; ");
  const result = await execFile("/bin/bash", ["-c", body], {
    cwd: process.cwd(),
    env: { ...process.env, OUTPUT: output },
    encoding: "utf8"
  }).then(({ stdout, stderr }) => ({ status: 0, stdout, stderr }), (error) => ({
    status: error.code,
    stdout: error.stdout ?? "",
    stderr: error.stderr ?? ""
  }));
  assert.equal(result.status, 1, result.stderr);
  const snapshot = JSON.parse(await fs.readFile(output, "utf8"));
  assert.equal(snapshot.bundlePath, "/Applications/ChatGPT.app");
  assert.equal(snapshot.bundleIdentifier, "com.openai.codex");
  assert.equal(snapshot.codesignValid, false);
  assert.equal(snapshot.officialSignatureValid, false);
  assert.match(snapshot.immutableDigest, /^[0-9a-f]{64}$/);
});

test("snapshot refuses a symlink output instead of overwriting its destination", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "Prime Knight integrity link "));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const destination = path.join(root, "destination.json");
  const output = path.join(root, "snapshot.json");
  await fs.writeFile(destination, "preserve\n");
  await fs.symlink(destination, output);
  const body = [
    "source scripts/snapshot-codex-integrity-macos.sh",
    "pk_initialize_paths() { :; }",
    "pk_require_supported_environment() { :; }",
    "snapshot_main \"$OUTPUT\""
  ].join("; ");
  const result = await execFile("/bin/bash", ["-c", body], {
    cwd: process.cwd(),
    env: { ...process.env, OUTPUT: output },
    encoding: "utf8"
  }).then(() => ({ status: 0 }), (error) => ({ status: error.code }));
  assert.equal(result.status, 1);
  assert.equal(await fs.readFile(destination, "utf8"), "preserve\n");
});
