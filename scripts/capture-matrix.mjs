#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  applyPayload,
  discoverTarget,
  CdpSession,
  hasAnchoredCockpitMetrics,
  hasFullWindowBackground,
  parseArgs
} from "../src/runtime/injector.mjs";
import { buildPayload } from "../src/runtime/payload.mjs";

const APPROVED_VIEWPORTS = [
  { width: 800, height: 600, devicePixelRatio: 1 },
  { width: 1024, height: 768, devicePixelRatio: 1 },
  { width: 1280, height: 800, devicePixelRatio: 1 },
  { width: 1440, height: 900, devicePixelRatio: 1 },
  { width: 1728, height: 1117, devicePixelRatio: 1 },
  { width: 1920, height: 1080, devicePixelRatio: 1 },
  { width: 2560, height: 1080, devicePixelRatio: 1 },
  { width: 3440, height: 1440, devicePixelRatio: 1 }
];

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const THEME_ROOT = process.env.XDG_DATA_HOME
  ? path.join(process.env.XDG_DATA_HOME, "Codex Prime Knight Theme")
  : path.join(process.env.HOME ?? "", "Library/Application Support/Codex Prime Knight Theme");
const PORT_PATH = path.join(THEME_ROOT, ".state", "codex.record", "port");
const execFile = promisify(execFileCallback);

function formatViewport(viewport) {
  return `${viewport.width}x${viewport.height}`;
}

function formatError(error) {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

function toHours(hour) {
  if (hour === null || hour === undefined) return Array.from({ length: 24 }, (_, value) => String(value).padStart(2, "0"));
  return [String(hour).padStart(2, "0")];
}

export function buildCapturePlan(args) {
  const viewports = args.viewport ? [args.viewport] : APPROVED_VIEWPORTS;
  const hours = toHours(args.verifyHour);
  return viewports.flatMap((viewport) => hours.map((hour) => ({ viewport, hour })));
}

export async function restoreAfterCapture(session, productionPayload) {
  const errors = [];
  try {
    await session.evaluate("window.__CODEX_PRIME_KNIGHT_THEME__?.destroy?.()");
  } catch (error) {
    errors.push(error);
  }
  try {
    await session.send("Emulation.clearDeviceMetricsOverride");
  } catch (error) {
    errors.push(error);
  }
  try {
    await applyPayload(session, productionPayload);
  } catch (error) {
    errors.push(error);
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, "capture cleanup could not restore the production renderer");
  }
}

export async function runCaptureWithCleanup({ session, capture, cleanup }) {
  let captureError;
  let cleanupError;
  try {
    await capture();
  } catch (error) {
    captureError = error;
  }
  try {
    await cleanup();
  } catch (error) {
    cleanupError = error;
  } finally {
    session.close();
  }
  if (captureError && cleanupError) {
    throw new AggregateError([captureError, cleanupError], "capture and renderer cleanup both failed");
  }
  if (captureError) throw captureError;
  if (cleanupError) throw cleanupError;
}

async function wait(delayMs = 0) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function readThemePort() {
  const raw = await fs.readFile(PORT_PATH, "utf8").catch(() => null);
  if (!raw) throw new Error(`theme port file is missing at ${PORT_PATH}`);
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`theme port value is invalid in ${PORT_PATH}`);
  }
  return parsed;
}

async function verifyInstalledRuntime() {
  const verifyScript = path.join(THEME_ROOT, "scripts", "verify-macos.sh");
  try {
    await execFile("/bin/bash", [verifyScript], {
      env: process.env,
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024
    });
  } catch (error) {
    const detail = String(error?.stderr ?? error?.message ?? error).trim();
    throw new Error(`installed theme runtime identity verification failed${detail ? `: ${detail}` : ""}`);
  }
}

async function setViewport(session, viewport) {
  await session.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.devicePixelRatio,
    mobile: false,
    scale: 1,
    screenOrientation: {
      angle: 0,
      type: "landscapePrimary"
    }
  });
}

async function collectMetrics(session) {
  return session.evaluate(`(() => {
    const theme = window.__CODEX_PRIME_KNIGHT_THEME__;
    const backgroundElement = document.querySelector(".prime-knight-background.is-visible");
    let background = null;
    if (backgroundElement) {
      const rect = backgroundElement.getBoundingClientRect();
      const style = getComputedStyle(backgroundElement);
      background = {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        visible: style.display !== "none"
          && style.visibility !== "hidden"
          && Number(style.opacity) > 0
          && style.backgroundImage !== "none"
      };
    }
    return {
      background,
      metrics: theme?.metrics ? {
        hour: theme.metrics.hour,
        mode: theme.metrics.mode,
        fit: theme.metrics.fit,
        position: theme.metrics.position,
        checksum: theme.metrics.checksum,
        layoutStatus: theme.metrics.layoutStatus,
        sidebar: theme.metrics.sidebar,
        main: theme.metrics.main,
        composer: theme.metrics.composer
      } : null
    };
  })()`);
}

export function normalizeCaptureMetrics(snapshot) {
  const metrics = snapshot?.metrics;
  if (!metrics || !hasFullWindowBackground(snapshot?.background)) return null;
  const layoutStatus = metrics.layoutStatus === "anchored" ? "anchored" : "native";
  if (layoutStatus === "anchored" && !hasAnchoredCockpitMetrics(metrics)) return null;
  return {
    hour: metrics.hour,
    mode: metrics.mode,
    fit: metrics.fit,
    position: metrics.position,
    checksum: metrics.checksum,
    layoutStatus,
    backgroundFullWindow: true,
    sidebar: layoutStatus === "anchored" ? metrics.sidebar : null,
    main: layoutStatus === "anchored" ? metrics.main : null,
    composer: layoutStatus === "anchored" ? metrics.composer : null
  };
}

export async function waitForCaptureMetrics(session, expectedHour, {
  attempts = 30,
  delayMs = 100,
  read = collectMetrics,
  waitFn = wait
} = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const metrics = normalizeCaptureMetrics(await read(session));
    if (metrics?.hour === expectedHour) return metrics;
    if (attempt + 1 < attempts) await waitFn(delayMs);
  }
  return null;
}

async function setHour(session, hour) {
  return session.evaluate(`(() => {
    const theme = window.__CODEX_PRIME_KNIGHT_THEME__;
    if (!theme?.setHour) throw new Error("theme API setHour is not available");
    return theme.setHour(${JSON.stringify(hour)});
  })()`, 20_000);
}

async function captureFrame(session, filePath) {
  const capture = await session.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  if (!capture?.data) throw new Error("capture response has no data");
  const bytes = Buffer.from(capture.data, "base64");
  await fs.writeFile(filePath, bytes);
  return createHash("sha256").update(bytes).digest("hex");
}

async function collectReportLine(session, outputDirectory, viewport, hour) {
  const viewportName = formatViewport(viewport);
  const result = {
    hour,
    viewport: viewportName,
    checksum: null,
    mode: null,
    fit: null,
    position: null,
    layoutStatus: null,
    backgroundFullWindow: false,
    sidebar: null,
    main: null,
    composer: null,
    screenshot: `${viewportName}/${hour}.png`,
    screenshotChecksum: null,
    manualReview: "pending",
    runtimeErrors: []
  };
  try {
    await setHour(session, hour);
  } catch (error) {
    result.runtimeErrors.push(`setHour:${formatError(error)}`);
  }

  try {
    const metrics = await waitForCaptureMetrics(session, hour);
    if (!metrics) throw new Error("theme metrics unavailable");
    result.checksum = metrics.checksum;
    result.mode = metrics.mode;
    result.fit = metrics.fit;
    result.position = metrics.position;
    result.layoutStatus = metrics.layoutStatus;
    result.backgroundFullWindow = metrics.backgroundFullWindow;
    result.sidebar = metrics.sidebar;
    result.main = metrics.main;
    result.composer = metrics.composer;
  } catch (error) {
    result.runtimeErrors.push(`metrics:${formatError(error)}`);
  }

  const outDir = path.join(outputDirectory, formatViewport(viewport));
  const outFile = path.join(outDir, `${hour}.png`);
  try {
    await fs.mkdir(path.dirname(outFile), { recursive: true });
    result.screenshotChecksum = await captureFrame(session, outFile);
  } catch (error) {
    result.runtimeErrors.push(`screenshot:${formatError(error)}`);
  }
  return result;
}

async function main(argv) {
  const args = parseArgs(["--verify", ...argv]);

  const outputDirectory = path.resolve(process.cwd(), args.outputDirectory);
  await fs.mkdir(outputDirectory, { recursive: true });

  const port = await readThemePort();
  const capturePlan = buildCapturePlan(args);
  const payload = await buildPayload({
    cssPath: path.join(PROJECT_ROOT, "src/theme/prime-knight.css"),
    manifestPath: path.join(PROJECT_ROOT, "config/backgrounds.json"),
    assetsRoot: PROJECT_ROOT,
    projectRoot: PROJECT_ROOT,
    verificationMode: true
  });
  const productionPayload = await buildPayload({
    cssPath: path.join(PROJECT_ROOT, "src/theme/prime-knight.css"),
    manifestPath: path.join(PROJECT_ROOT, "config/backgrounds.json"),
    assetsRoot: PROJECT_ROOT,
    projectRoot: PROJECT_ROOT
  });
  await verifyInstalledRuntime();
  const target = await discoverTarget({ port });
  const session = await new CdpSession(target.target, port).open();
  const reportPath = path.join(outputDirectory, "report.json");
  const report = [];

  await runCaptureWithCleanup({
    session,
    capture: async () => {
      await applyPayload(session, payload);
      let activeViewport = null;
      for (const { viewport, hour } of capturePlan) {
        const viewportName = formatViewport(viewport);
        if (viewportName !== activeViewport) {
          await setViewport(session, viewport);
          activeViewport = viewportName;
        }
        report.push(await collectReportLine(session, outputDirectory, viewport, hour));
      }
      const manifest = {
        generatedAt: new Date().toISOString(),
        verifyHour: args.verifyHour,
        viewportOverride: args.viewport ? formatViewport(args.viewport) : null,
        outputDirectory,
        entries: report
      };
      await fs.writeFile(reportPath, `${JSON.stringify(manifest, null, 2)}${os.EOL}`, "utf8");
      const errors = report.flatMap((entry) => entry.runtimeErrors);
      if (errors.length > 0) {
        throw new AggregateError(errors.map((error) => new Error(error)), "theme matrix has runtime errors");
      }
      console.log(`Prime Knight matrix capture complete: ${report.length} entries`);
    },
    cleanup: () => restoreAfterCapture(session, productionPayload)
  });
}

if (path.resolve(process.argv[1] ?? "") === path.resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Prime Knight matrix capture failed: ${error.message}`);
    process.exitCode = 1;
  });
}
