import { createHash } from "node:crypto";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseManifest } from "../background/manifest.mjs";

// Payload assembly follows the local, path-free encoding pattern from
// Kerwin0624/codex-black-hole-skin (MIT); see THIRD_PARTY_NOTICES.md.
export const MAX_BACKGROUND_BYTES = 20 * 1024 * 1024;
export const MAX_FRAME_BYTES = 2 * 1024 * 1024;
export const FRAME_NAMES = Object.freeze([
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
]);
const HOURS_REGEX = /^(?:[01][0-9]|2[0-3])$/;
const GLOBAL_KEY = "__CODEX_PRIME_KNIGHT_THEME__";
const defaultProjectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function assertFileSystem(fileSystem) {
  if (!fileSystem || typeof fileSystem.readFile !== "function" || typeof fileSystem.realpath !== "function") {
    throw new TypeError("buildPayload requires readFile() and realpath() filesystem methods");
  }
}

function assertContained(root, candidate, label) {
  const relative = path.relative(root, candidate);
  if (relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))) {
    return;
  }
  throw new Error(`${label} must stay inside assetsRoot`);
}

function isWebP(data) {
  return Buffer.isBuffer(data)
    && data.length >= 16
    && data.subarray(0, 4).toString("ascii") === "RIFF"
    && data.subarray(8, 12).toString("ascii") === "WEBP";
}

function webPChunks(data) {
  if (!isWebP(data) || data.readUInt32LE(4) + 8 !== data.length) return null;
  const chunks = [];
  let offset = 12;
  while (offset < data.length) {
    if (offset + 8 > data.length) return null;
    const type = data.subarray(offset, offset + 4).toString("ascii");
    const size = data.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > data.length) return null;
    chunks.push({ type, start, size });
    offset = end + (size % 2);
  }
  return offset === data.length ? chunks : null;
}

function hasWebPAlpha(data, chunks) {
  const extended = chunks.find((chunk) => chunk.type === "VP8X");
  if (extended?.size >= 10 && (data[extended.start] & 0x10)) return true;
  const lossless = chunks.find((chunk) => chunk.type === "VP8L");
  if (!lossless || lossless.size < 5 || data[lossless.start] !== 0x2f) return false;
  const header = data.readUInt32LE(lossless.start + 1);
  return Boolean(header & 0x10000000);
}

function dataUrl(data) {
  return `data:image/webp;base64,${data.toString("base64")}`;
}

async function readContainedFile(fileSystem, root, requestedPath, label) {
  let canonicalPath;
  try {
    canonicalPath = await fileSystem.realpath(requestedPath);
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`${label} is missing: ${requestedPath}`);
    throw error;
  }
  assertContained(root, canonicalPath, label);
  return { canonicalPath, data: await fileSystem.readFile(canonicalPath) };
}

async function encodeBackgrounds(fileSystem, root, manifest) {
  const encoded = [];
  for (const row of manifest) {
    const requestedPath = path.resolve(root, row.src);
    const { data } = await readContainedFile(fileSystem, root, requestedPath, `Background ${row.hour}`);
    if (!isWebP(data)) throw new Error(`Background ${row.hour} is not a valid WebP file`);
    if (data.length > MAX_BACKGROUND_BYTES) {
      throw new Error(`Background ${row.hour} exceeds the 20 MiB limit`);
    }
    const checksum = createHash("sha256").update(data).digest("hex");
    if (checksum !== row.checksum) throw new Error(`Background checksum mismatch for hour ${row.hour}`);
    encoded.push({ ...row, src: dataUrl(data) });
  }
  return encoded;
}

async function encodeFrames(fileSystem, root) {
  const encoded = {};
  for (const name of FRAME_NAMES) {
    const requestedPath = path.resolve(root, `assets/frame/${name}.webp`);
    const { data } = await readContainedFile(fileSystem, root, requestedPath, `Frame ${name}`);
    const chunks = webPChunks(data);
    if (chunks === null) throw new Error(`Frame ${name} is not a valid WebP file`);
    if (data.length >= MAX_FRAME_BYTES) throw new Error(`Frame ${name} exceeds the 2 MiB limit`);
    if (!hasWebPAlpha(data, chunks)) throw new Error(`Frame ${name} must contain an alpha channel`);
    encoded[`--prime-knight-frame-${name}`] = `url("${dataUrl(data)}")`;
  }
  return encoded;
}

function validateSelfContainedCss(cssText) {
  if (typeof cssText !== "string" || cssText.trim().length === 0) {
    throw new Error("Stylesheet must be non-empty");
  }
  if (cssText.includes("\\")) throw new Error("Stylesheet CSS escapes are not allowed");
  const normalized = cssText.replace(/\/\*[\s\S]*?\*\//g, "");
  if (/@import\b/i.test(normalized)) throw new Error("Stylesheet @import is not allowed");
  if (/\burl\s*\(/i.test(normalized)) throw new Error("Stylesheet url() tokens are not allowed");
  if (/\/Users\//i.test(cssText)) throw new Error("Stylesheet must not contain an absolute user path");
  if (/\bfile:/i.test(cssText)) throw new Error("Stylesheet file: URLs are not allowed");
  return cssText;
}

function assertSelfContainedPayload(payload) {
  if (/\/Users\//i.test(payload)) throw new Error("Generated payload contains an absolute user path");
  if (/\bfile:/i.test(payload)) throw new Error("Generated payload contains a file: URL");
  if (/\bhttps?:/i.test(payload) || /["']\/\/[^/]/.test(payload)) {
    throw new Error("Generated payload contains a remote reference");
  }
  return payload;
}

function stripModuleSyntax(clockSource, rotatorSource, presentationSource, layoutSource, installerSource) {
  const clock = clockSource.replaceAll("export function ", "function ");
  const rotator = rotatorSource
    .replace(/^import\s+\{\s*hourKey,\s*millisecondsToNextHour,\s*nextHourKey\s*\}\s+from\s+["'][^"']+["'];?\s*$/m, "")
    .replaceAll("export function ", "function ");
  const presentation = presentationSource.replaceAll("export function ", "function ");
  const layout = layoutSource.replaceAll("export function ", "function ");
  const installer = installerSource
    .replace(/^import\s+\{\s*presentationFor\s*\}\s+from\s+["'][^"']+["'];?\s*$/m, "")
    .replace(/^import\s+\{[\s\S]*?calculateCockpitLayout,[\s\S]*?cockpitCssVariables,[\s\S]*?discoverCockpitAnchors[\s\S]*?\}\s+from\s+["'][^"']+["'];?\s*$/m, "")
    .replaceAll("export function ", "function ");
  const rendererSource = `${clock}\n${rotator}\n${presentation}\n${layout}\n${installer}`;
  if (/^\s*(?:import|export)\s/m.test(rendererSource)) {
    throw new Error("Renderer source contains unsupported module syntax");
  }
  return rendererSource;
}

function normalizeHour(value) {
  const normalized = String(value).padStart(2, "0");
  if (!HOURS_REGEX.test(normalized)) {
    throw new TypeError("Invalid theme hour");
  }
  return normalized;
}

function rendererPayload({
  rendererSource,
  cssText,
  manifest,
  frames,
  verificationMode = false,
  verificationHour = null
}) {
  const safeVerificationHour = verificationHour == null ? null : normalizeHour(verificationHour);
  return `(() => {
  "use strict";
  ${rendererSource}
  const GLOBAL_KEY = ${JSON.stringify(GLOBAL_KEY)};
  const cssText = ${JSON.stringify(cssText)};
  const manifest = ${JSON.stringify(manifest)};
  const frames = ${JSON.stringify(frames)};
  const verificationMode = ${Boolean(verificationMode)};
  const verificationHour = ${JSON.stringify(safeVerificationHour)};
  window[GLOBAL_KEY]?.destroy?.();
  const loadBackground = (row, context) => loadBrowserImage(window, row, context);
  const installed = installTheme({
    document,
    window,
    manifest,
    initialHour: verificationHour ?? String(new Date().getHours()).padStart(2, "0"),
    cssText,
    verificationMode,
    loadBackground
  });
  const shell = document.getElementById("prime-knight-shell");
  for (const [name, value] of Object.entries(frames)) shell.style.setProperty(name, value);
  const rotator = createHourlyRotator({
    now: () => new Date(),
    schedule: window.setTimeout.bind(window),
    cancel: window.clearTimeout.bind(window),
    load: loadBackground,
    show: (row, context) => installed.setHour(row.hour, context),
    manifest
  });
  const resync = (reason) => {
    if (document.visibilityState === "hidden") return;
    void rotator.resync(reason);
  };
  const onVisibilityChange = () => resync("visibilitychange");
  const onFocus = () => resync("focus");
  let resizeTimer = null;
  const onResize = () => {
    if (resizeTimer !== null) window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      resizeTimer = null;
      resync("display-resize");
    }, 120);
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("focus", onFocus);
  window.addEventListener("resize", onResize, { passive: true });
  void rotator.start();
  const metrics = {};
  Object.defineProperties(metrics, {
    hour: { enumerable: true, get: () => installed.metrics.hour },
    mode: { enumerable: true, get: () => installed.metrics.mode },
    fit: { enumerable: true, get: () => installed.metrics.fit },
    position: { enumerable: true, get: () => installed.metrics.position },
    checksum: { enumerable: true, get: () => installed.metrics.checksum },
    refreshCount: { enumerable: true, get: () => installed.metrics.refreshCount },
    testMode: { enumerable: true, get: () => installed.metrics.testMode },
    layoutStatus: { enumerable: true, get: () => installed.metrics.layoutStatus },
    sidebar: { enumerable: true, get: () => installed.metrics.sidebar },
    main: { enumerable: true, get: () => installed.metrics.main },
    composer: { enumerable: true, get: () => installed.metrics.composer },
    rotation: { enumerable: true, get: () => rotator.getState() }
  });
  Object.freeze(metrics);
  let api;
  const destroy = () => {
    rotator.stop();
    if (resizeTimer !== null) window.clearTimeout(resizeTimer);
    resizeTimer = null;
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("resize", onResize);
    installed.destroy();
    if (window[GLOBAL_KEY] === api) delete window[GLOBAL_KEY];
  };
  api = {};
  Object.defineProperties(api, {
    destroy: { enumerable: true, value: destroy },
    metrics: { enumerable: true, get: () => metrics }
  });
  if (verificationMode) Object.defineProperty(api, "setHour", { enumerable: true, value: installed.setHour });
  Object.freeze(api);
  Object.defineProperty(window, GLOBAL_KEY, {
    configurable: true,
    enumerable: false,
    writable: false,
    value: api
  });
  return { installed: true, metrics: api.metrics };
})()`;
}

/**
 * Builds a path-free renderer expression. Strict checksum validation is the
 * default; provisional checksums require an explicit local-development opt-in.
 */
export async function buildPayload({
  cssPath,
  manifestPath,
  assetsRoot,
  projectRoot = defaultProjectRoot,
  fileSystem = fsPromises,
  allowProvisionalChecksums = false,
  verificationMode = false,
  verificationHour = null,
  packageVersion
} = {}) {
  assertFileSystem(fileSystem);
  for (const [name, value] of Object.entries({ cssPath, manifestPath, assetsRoot, projectRoot })) {
    if (typeof value !== "string" || value.length === 0) throw new TypeError(`buildPayload requires ${name}`);
  }

  const canonicalRoot = await fileSystem.realpath(assetsRoot);
  const canonicalCssPath = await fileSystem.realpath(cssPath);
  const canonicalManifestPath = await fileSystem.realpath(manifestPath);
  assertContained(canonicalRoot, canonicalCssPath, "Stylesheet");
  assertContained(canonicalRoot, canonicalManifestPath, "Manifest");

  const [cssBuffer, manifestBuffer] = await Promise.all([
    fileSystem.readFile(canonicalCssPath),
    fileSystem.readFile(canonicalManifestPath)
  ]);
  const rawManifest = JSON.parse(manifestBuffer.toString("utf8"));
  const manifest = parseManifest(rawManifest, { allowProvisionalChecksums, packageVersion });
  const [encodedManifest, encodedFrames] = await Promise.all([
    encodeBackgrounds(fileSystem, canonicalRoot, manifest),
    encodeFrames(fileSystem, canonicalRoot)
  ]);
  const cssText = validateSelfContainedCss(cssBuffer.toString("utf8"));

  const clockPath = path.join(projectRoot, "src/background/clock.mjs");
  const rotatorPath = path.join(projectRoot, "src/background/rotator.mjs");
  const presentationPath = path.join(projectRoot, "src/background/presentation.mjs");
  const layoutPath = path.join(projectRoot, "src/theme/cockpit-layout.mjs");
  const installerPath = path.join(projectRoot, "src/theme/install-theme.mjs");
  const [clockSource, rotatorSource, presentationSource, layoutSource, installerSource] = await Promise.all([
    fileSystem.readFile(clockPath, "utf8"),
    fileSystem.readFile(rotatorPath, "utf8"),
    fileSystem.readFile(presentationPath, "utf8"),
    fileSystem.readFile(layoutPath, "utf8"),
    fileSystem.readFile(installerPath, "utf8")
  ]);
  const rendererSource = stripModuleSyntax(
    String(clockSource),
    String(rotatorSource),
    String(presentationSource),
    String(layoutSource),
    String(installerSource)
  );
  return assertSelfContainedPayload(rendererPayload({
    rendererSource,
    cssText,
    manifest: encodedManifest,
    frames: encodedFrames,
    verificationMode,
    verificationHour
  }));
}
