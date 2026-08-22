#!/usr/bin/env node
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const execFile = promisify(execFileCallback);
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const literal = (...parts) => parts.join("");

const RULES = Object.freeze([
  {
    rule: "absolute-user-path",
    pattern: new RegExp(literal("/", "Users", "/", "(?!<user>/)[^/\\s]+/"), "u")
  },
  {
    rule: "clipboard-artifact",
    pattern: new RegExp(literal("codex", "-clipboard-"), "iu")
  },
  {
    rule: "generated-image-path",
    pattern: new RegExp(literal("generated", "_images"), "iu")
  },
  {
    rule: "chat-content",
    pattern: new RegExp(literal(
      "\\b(?:chat ",
      "title|conversation ",
      "export|task ",
      "export)\\b"
    ), "iu")
  },
  {
    rule: "temporary-path",
    pattern: new RegExp(literal("/(?:private/)?var/folders/|/private/", "tmp/"), "iu")
  },
  {
    rule: "access-token",
    pattern: new RegExp(literal("\\b(?:ghp", "_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-[A-Za-z0-9]{20,})\\b"), "u")
  },
  {
    rule: "private-key",
    pattern: new RegExp(literal("-----BEGIN ", "(?:RSA |EC |OPENSSH )?PRIVATE KEY-----"), "u")
  },
  {
    rule: "runtime-state",
    pattern: new RegExp(literal("(?:^|[\\s/\\\\])", "\\.runtime", "(?:[/\\\\]|$)"), "u")
  },
  {
    rule: "email-secret",
    pattern: /\b(?:account|email|user_email)\s*[:=]\s*[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu
  }
]);

export function scanText(file, text) {
  if (typeof file !== "string" || typeof text !== "string") {
    throw new TypeError("scanText requires a file name and text");
  }
  const findings = [];
  for (const { rule, pattern } of RULES) {
    if (file === ".gitignore" && rule === "runtime-state") continue;
    if (pattern.test(file) || pattern.test(text)) findings.push({ path: file, rule });
  }
  return { ok: findings.length === 0, findings };
}

export async function scanPaths(paths, { root = process.cwd() } = {}) {
  if (!Array.isArray(paths)) throw new TypeError("scanPaths requires an array");
  const resolvedRoot = await fs.realpath(root);
  const logicalRoot = path.resolve(root);
  const findings = [];
  let scanned = 0;
  for (const input of [...paths].sort()) {
    const absolute = path.resolve(logicalRoot, input);
    const displayPath = path.relative(logicalRoot, absolute) || path.basename(absolute);
    const stat = await fs.lstat(absolute).catch(() => null);
    if (!stat?.isFile() || stat.isSymbolicLink()) {
      findings.push({ path: displayPath, rule: "unsafe-file" });
      continue;
    }
    const realFile = await fs.realpath(absolute);
    const relative = path.relative(resolvedRoot, realFile);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      findings.push({ path: String(input), rule: "unsafe-file" });
      continue;
    }
    scanned += 1;
    const bytes = await fs.readFile(realFile);
    const text = bytes.includes(0) ? "" : bytes.toString("utf8");
    findings.push(...scanText(displayPath, text).findings);
  }
  return { ok: findings.length === 0, findings, scanned };
}

function isReleaseCandidatePath(file) {
  const excludedPrefixes = [
    ".superpowers/",
    "artifacts/",
    "docs/superpowers/",
    "outputs/",
    "screenshots/",
    "tests/",
    "work/"
  ];
  return !excludedPrefixes.some((prefix) => file.startsWith(prefix));
}

async function releaseCandidatePaths() {
  const tracked = (await execFile("git", ["ls-files", "-z"], { cwd: PROJECT_ROOT, encoding: "utf8" })).stdout;
  const untracked = (await execFile("git", ["ls-files", "-z", "--others", "--exclude-standard"], {
    cwd: PROJECT_ROOT,
    encoding: "utf8"
  })).stdout;
  return [...new Set(`${tracked}${untracked}`.split("\0").filter(Boolean))]
    .filter(isReleaseCandidatePath)
    .sort();
}

async function main(args) {
  const files = args.length > 0 ? args : await releaseCandidatePaths();
  const result = await scanPaths(files, { root: PROJECT_ROOT });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

const isEntryPoint = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isEntryPoint) {
  await main(process.argv.slice(2));
}
