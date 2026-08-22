#!/usr/bin/env node
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import { scanPaths } from "./privacy-scan.mjs";

const execFile = promisify(execFileCallback);
const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = "1.0.2";
const REPOSITORY_DIRECTORY = `codex-optimus-prime-theme-v${VERSION}`;
const ARCHIVE_NAME = `${REPOSITORY_DIRECTORY}-macos.zip`;
const FIXED_TIME = new Date("1980-01-01T00:00:00.000Z");

const BACKGROUND_PATHS = Array.from(
  { length: 24 },
  (_, hour) => `assets/backgrounds/${String(hour).padStart(2, "0")}.webp`
);
const FRAME_NAMES = [
  "corner-tl", "corner-tr", "corner-bl", "corner-br", "edge-h", "edge-v",
  "divider-v", "divider-v-top", "divider-v-bottom", "divider-h",
  "divider-h-left", "divider-h-right", "energy-core", "chamber-sidebar",
  "chamber-main", "chamber-composer"
];
const FRAME_PATHS = FRAME_NAMES.map((name) => `assets/frame/${name}.webp`);
const LAUNCHER_APP_ROOT = "macos/Codex 擎天柱主题.app";
const LAUNCHER_APP_PATHS = [
  "Contents/Info.plist",
  "Contents/MacOS/Codex擎天柱主题",
  "Contents/PkgInfo",
  "Contents/Resources/AppIcon.icns",
  "Contents/_CodeSignature/CodeDirectory",
  "Contents/_CodeSignature/CodeRequirements",
  "Contents/_CodeSignature/CodeResources",
  "Contents/_CodeSignature/CodeSignature"
].map((relative) => `${LAUNCHER_APP_ROOT}/${relative}`);

export const PUBLIC_REPOSITORY_PATHS = Object.freeze([
  ".github/workflows/test.yml",
  ".gitignore",
  "ASSET_PROVENANCE.md",
  "CHANGELOG.md",
  "Install Prime Knight Theme.command",
  "LICENSE",
  ...LAUNCHER_APP_PATHS,
  "NOTICE.md",
  "README.md",
  "README.zh-CN.md",
  "Restore Native Codex.command",
  "Start Prime Knight Theme.command",
  "THIRD_PARTY_NOTICES.md",
  "Verify Prime Knight Theme.command",
  ...BACKGROUND_PATHS,
  ...FRAME_PATHS,
  "config/backgrounds.json",
  "docs/TROUBLESHOOTING.md",
  "package.json",
  "scripts/build-release.mjs",
  "scripts/capture-matrix.mjs",
  "scripts/common-macos.sh",
  "scripts/lib/webp-dimensions.mjs",
  "scripts/privacy-scan.mjs",
  "scripts/restore-macos.sh",
  "scripts/snapshot-codex-integrity-macos.sh",
  "scripts/start-macos.sh",
  "scripts/summarize-theme-matrix.mjs",
  "scripts/verify-backgrounds.mjs",
  "scripts/verify-macos.sh",
  "scripts/install-macos.sh",
  "src/background/clock.mjs",
  "src/background/manifest.mjs",
  "src/background/presentation.mjs",
  "src/background/rotator.mjs",
  "src/runtime/injector.mjs",
  "src/runtime/payload.mjs",
  "src/runtime/watcher.mjs",
  "src/theme/cockpit-layout.mjs",
  "src/theme/install-theme.mjs",
  "src/theme/prime-knight.css",
  "tests/background-assets.test.mjs",
  "tests/background-clock.test.mjs",
  "tests/background-manifest.test.mjs",
  "tests/background-presentation.test.mjs",
  "tests/background-rotator.test.mjs",
  "tests/cockpit-layout.test.mjs",
  "tests/codex-integrity-script.test.mjs",
  "tests/frame-assets.test.mjs",
  "tests/injector-security.test.mjs",
  "tests/macos-scripts.test.mjs",
  "tests/payload.test.mjs",
  "tests/privacy-scan.test.mjs",
  "tests/release-package.test.mjs",
  "tests/theme-matrix-summary.test.mjs",
  "tests/theme-shell.test.mjs",
  "tests/verification-mode.test.mjs"
].sort());

export const PUBLIC_PRIVACY_PATHS = Object.freeze(
  PUBLIC_REPOSITORY_PATHS.filter((file) => !file.startsWith("tests/"))
);

function assertInside(parent, candidate, label) {
  const relative = path.relative(parent, candidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} must be a child of ${parent}`);
  }
}

async function sha256(file) {
  return createHash("sha256").update(await fs.readFile(file)).digest("hex");
}

async function validateSourceFile(projectRoot, relative) {
  const source = path.resolve(projectRoot, relative);
  assertInside(projectRoot, source, `release source ${relative}`);
  const stat = await fs.lstat(source);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`release source must be a regular file: ${relative}`);
  }
  const realRoot = await fs.realpath(projectRoot);
  const realSource = await fs.realpath(source);
  assertInside(realRoot, realSource, `real release source ${relative}`);
  return { source, stat };
}

async function copyReleaseFile(projectRoot, repositoryPath, relative) {
  const { source, stat } = await validateSourceFile(projectRoot, relative);
  const destination = path.join(repositoryPath, relative);
  await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o755 });
  await fs.copyFile(source, destination, fs.constants.COPYFILE_EXCL);
  const executable = relative.endsWith(".command") || relative.endsWith(".sh")
    || relative.startsWith(`${LAUNCHER_APP_ROOT}/Contents/MacOS/`);
  await fs.chmod(destination, executable ? 0o755 : 0o644);
  await fs.utimes(destination, FIXED_TIME, FIXED_TIME);
  if (stat.size !== (await fs.stat(destination)).size) {
    throw new Error(`release copy size mismatch: ${relative}`);
  }
}

async function listFiles(root, relative = "") {
  const rows = [];
  const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name, "en"));
  for (const entry of entries) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`release tree contains a symlink: ${child}`);
    if (entry.isDirectory()) rows.push(...await listFiles(root, child));
    else if (entry.isFile()) rows.push(child);
    else throw new Error(`release tree contains a non-file: ${child}`);
  }
  return rows;
}

async function createZip(outputRoot, repositoryPath, zipPath) {
  const files = await listFiles(repositoryPath);
  const relativeFiles = files.map((file) => `${path.basename(repositoryPath)}/${file}`);
  await execFile("/usr/bin/zip", ["-X", "-q", zipPath, ...relativeFiles], {
    cwd: outputRoot,
    maxBuffer: 10 * 1024 * 1024
  });
}

export async function buildRelease({
  projectRoot = SCRIPT_ROOT,
  outputRoot = path.join(SCRIPT_ROOT, "artifacts", "release")
} = {}) {
  projectRoot = path.resolve(projectRoot);
  outputRoot = path.resolve(outputRoot);
  const projectStat = await fs.stat(projectRoot);
  if (!projectStat.isDirectory()) throw new Error("projectRoot must be a directory");
  const rootPath = path.parse(outputRoot).root;
  if (outputRoot === rootPath || outputRoot === projectRoot) {
    throw new Error("refusing unsafe release output directory");
  }
  assertInside(projectRoot, path.join(projectRoot, "__release-boundary__"), "project boundary");

  const parent = path.dirname(outputRoot);
  await fs.mkdir(parent, { recursive: true });
  const temporaryRoot = await fs.mkdtemp(path.join(parent, ".prime-knight-release-"));
  const repositoryPath = path.join(temporaryRoot, REPOSITORY_DIRECTORY);
  await fs.mkdir(repositoryPath, { recursive: true, mode: 0o755 });

  try {
    for (const relative of PUBLIC_REPOSITORY_PATHS) {
      await copyReleaseFile(projectRoot, repositoryPath, relative);
    }
    for (const directory of await fs.readdir(repositoryPath, { withFileTypes: true })) {
      if (directory.isDirectory()) {
        await fs.utimes(path.join(repositoryPath, directory.name), FIXED_TIME, FIXED_TIME);
      }
    }

    const privacy = await scanPaths(PUBLIC_PRIVACY_PATHS, { root: repositoryPath });
    if (!privacy.ok) {
      throw new Error(`release privacy scan failed: ${JSON.stringify(privacy.findings)}`);
    }

    const zipPath = path.join(temporaryRoot, ARCHIVE_NAME);
    await createZip(temporaryRoot, repositoryPath, zipPath);
    const archiveChecksum = await sha256(zipPath);
    const checksumPath = path.join(temporaryRoot, "SHA256SUMS.txt");
    const privacyReportPath = path.join(temporaryRoot, "privacy-report.json");
    await fs.writeFile(checksumPath, `${archiveChecksum}  ${ARCHIVE_NAME}\n`, { mode: 0o644 });
    await fs.writeFile(privacyReportPath, `${JSON.stringify(privacy, null, 2)}\n`, { mode: 0o600 });

    await fs.rm(outputRoot, { recursive: true, force: true });
    await fs.rename(temporaryRoot, outputRoot);
    return {
      repositoryPath: path.join(outputRoot, REPOSITORY_DIRECTORY),
      zipPath: path.join(outputRoot, ARCHIVE_NAME),
      checksumPath: path.join(outputRoot, "SHA256SUMS.txt"),
      privacyReportPath: path.join(outputRoot, "privacy-report.json"),
      archiveChecksum
    };
  } catch (error) {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

async function main(args) {
  if (args.length > 1) throw new Error("usage: build-release.mjs [output-directory]");
  const outputRoot = args[0] ? path.resolve(process.cwd(), args[0]) : undefined;
  const result = await buildRelease({ outputRoot });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const isEntryPoint = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isEntryPoint) {
  await main(process.argv.slice(2));
}
