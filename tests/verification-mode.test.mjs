import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { parseArgs } from "../src/runtime/injector.mjs";
import { buildPayload } from "../src/runtime/payload.mjs";
import { installTheme } from "../src/theme/install-theme.mjs";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const execFile = promisify(execFileCallback);

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.attributes = new Map();
    this.childNodes = [];
    this.parentNode = null;
    this.className = "";
    this.id = "";
    const properties = new Map();
    const classes = new Set();
    this.style = {
      setProperty: (name, value) => properties.set(name, String(value)),
      getPropertyValue: (name) => properties.get(name) ?? ""
    };
    this.classList = {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name)
    };
  }

  append(...nodes) {
    for (const node of nodes) {
      node.parentNode = this;
      this.childNodes.push(node);
    }
  }

  remove() {
    if (this.parentNode === null) return;
    const index = this.parentNode.childNodes.indexOf(this);
    if (index >= 0) this.parentNode.childNodes.splice(index, 1);
    this.parentNode = null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  getAttributeNames() {
    return [...this.attributes.keys()];
  }

  querySelector(selector) {
    return findAll(this, selector)[0] ?? null;
  }
}

function findAll(root, selector) {
  const attribute = selector.match(/^\[([^=]+)="([^"]+)"\]$/);
  const id = selector.match(/^#(.+)$/);
  const found = [];
  const visit = (node) => {
    if (attribute && node.getAttribute?.(attribute[1]) === attribute[2]) found.push(node);
    else if (id && node.id === id[1]) found.push(node);
    for (const child of node.childNodes ?? []) visit(child);
  };
  visit(root);
  return found;
}

function createFakeEnvironment() {
  const root = new FakeElement("html");
  const head = new FakeElement("head");
  const body = new FakeElement("body");
  const nativeRoot = new FakeElement("main");
  nativeRoot.id = "root";
  body.append(nativeRoot);
  root.append(head, body);
  const document = {
    documentElement: root,
    head,
    body,
    createElement: (tagName) => new FakeElement(tagName),
    querySelectorAll: (selector) => findAll(root, selector),
    querySelector: (selector) => findAll(root, selector)[0] ?? null,
    getElementById(id) {
      const visit = (node) => {
        if (node.id === id) return node;
        for (const child of node.childNodes) {
          const found = visit(child);
          if (found) return found;
        }
        return null;
      };
      return visit(root);
    },
    addEventListener() {},
    removeEventListener() {}
  };
  const window = {
    innerWidth: 1440,
    innerHeight: 900,
    devicePixelRatio: 2,
    addEventListener: () => {},
    removeEventListener: () => {},
    setTimeout,
    clearTimeout,
    URL: { revokeObjectURL: () => {} },
    ResizeObserver: class {
      constructor() {}
      observe() {}
      disconnect() {}
    }
  };
  window.Image = class {
    constructor() {
      this.onload = null;
      this.onerror = null;
    }
    set src(value) {
      this._value = value;
      queueMicrotask(() => this.onload?.());
    }
    get src() {
      return this._value;
    }
  };

  return { document, window, nativeRoot };
}

function createPayloadEnvironment() {
  const root = new FakeElement("html");
  root.clientWidth = 1440;
  root.clientHeight = 900;
  const head = new FakeElement("head");
  const body = new FakeElement("body");
  const nativeRoot = new FakeElement("main");
  nativeRoot.id = "root";
  body.append(nativeRoot);
  root.append(head, body);

  const documentListeners = new Map();
  const windowListeners = new Map();
  const timers = new Map();
  let nextTimer = 0;

  const document = {
    documentElement: root,
    head,
    body,
    visibilityState: "visible",
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    getElementById(id) {
      return findAll(root, `#${id}`)[0] ?? null;
    },
    querySelectorAll(selector) {
      return findAll(root, selector);
    },
    querySelector(selector) {
      return findAll(root, selector)[0] ?? null;
    },
    addEventListener(name, listener) {
      const listeners = documentListeners.get(name) ?? new Set();
      listeners.add(listener);
      documentListeners.set(name, listeners);
    },
    removeEventListener(name, listener) {
      const listeners = documentListeners.get(name);
      listeners?.delete(listener);
      if (listeners?.size === 0) documentListeners.delete(name);
    }
  };

  const window = {
    innerWidth: 1440,
    innerHeight: 900,
    devicePixelRatio: 1,
    addEventListener(name, listener) {
      const listeners = windowListeners.get(name) ?? new Set();
      listeners.add(listener);
      windowListeners.set(name, listeners);
    },
    removeEventListener(name, listener) {
      const listeners = windowListeners.get(name);
      listeners?.delete(listener);
      if (listeners?.size === 0) windowListeners.delete(name);
    },
    setTimeout(callback) {
      const id = ++nextTimer;
      timers.set(id, callback);
      return setTimeout(() => {
        timers.delete(id);
        callback();
      }, 0);
    },
    clearTimeout(id) {
      clearTimeout(id);
      timers.delete(id);
    },
    matchMedia: () => ({ matches: true }),
    URL: { revokeObjectURL: () => {} },
    Image: class {
      set src(value) {
        this.value = value;
        queueMicrotask(() => this.onload?.());
      }
      get src() {
        return this.value;
      }
    },
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    }
  };

  return { document, window, nativeRoot, root, documentListeners, windowListeners, timers };
}

function makeBackgroundData(seed = 0) {
  const buffer = Buffer.alloc(64);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(56, 4);
  buffer.write("WEBP", 8, "ascii");
  buffer.write("VP8 ", 12, "ascii");
  buffer.fill(seed, 20);
  return buffer;
}

async function createFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "prime-knight-verify-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const backgroundRows = Array.from({ length: 24 }, (_, hour) => {
    const backgroundHour = String(hour).padStart(2, "0");
    const bytes = makeBackgroundData(hour + 1);
    const checksum = createHash("sha256").update(bytes).digest("hex");
    return {
      hour: backgroundHour,
      src: `assets/backgrounds/${backgroundHour}.webp`,
      positionWide: "72% 50%",
      positionStandard: "70% 50%",
      positionCompact: "center top",
      overlayOpacity: 0.4,
      safeArea: "left",
      focusX: 0.5,
      focusY: 0.5,
      dominantTone: "deep-night",
      checksum
    };
  });

  const manifestPath = path.join(root, "config");
  await fs.mkdir(manifestPath, { recursive: true });
  await fs.writeFile(path.join(manifestPath, "backgrounds.json"), JSON.stringify(backgroundRows));

  const cssDir = path.join(root, "src/theme");
  await fs.mkdir(cssDir, { recursive: true });
  await fs.writeFile(path.join(cssDir, "prime-knight.css"), "#prime-knight-shell { position: fixed; }");

  const assetsDir = path.join(root, "assets/backgrounds");
  await fs.mkdir(assetsDir, { recursive: true });
  for (const row of backgroundRows) {
    const bytes = makeBackgroundData(Number(row.hour) + 1);
    await fs.writeFile(path.join(root, row.src), bytes);
  }

  const frameDir = path.join(root, "assets/frame");
  await fs.mkdir(frameDir, { recursive: true });
  for (const name of [
    "corner-tl", "corner-tr", "corner-bl", "corner-br", "edge-h", "edge-v",
    "divider-v", "divider-v-top", "divider-v-bottom",
    "divider-h", "divider-h-left", "divider-h-right", "energy-core",
    "chamber-sidebar", "chamber-main", "chamber-composer"
  ]) {
    const frameBuffer = Buffer.alloc(64);
    frameBuffer.write("RIFF", 0, "ascii");
    frameBuffer.writeUInt32LE(56, 4);
    frameBuffer.write("WEBP", 8, "ascii");
    frameBuffer.write("VP8X", 12, "ascii");
    frameBuffer.writeUInt32LE(10, 16);
    frameBuffer[20] = 0x10;
    frameBuffer.writeUIntLE(0, 24, 3);
    frameBuffer.writeUIntLE(0, 27, 3);
    frameBuffer.write("ALPH", 30, "ascii");
    frameBuffer.writeUInt32LE(26, 34);
    await fs.writeFile(path.join(frameDir, `${name}.webp`), frameBuffer);
  }

  return {
    root,
    manifestRows: backgroundRows,
    manifestPath: path.join(manifestPath, "backgrounds.json"),
    cssPath: path.join(cssDir, "prime-knight.css"),
    projectRoot: PROJECT_ROOT
  };
}

function createPayloadContext() {
  const env = createPayloadEnvironment();
  return {
    env,
    context: vm.createContext({
      window: env.window,
      document: env.document,
      AbortController,
      Date,
      Promise,
      Map,
      Set,
      WeakMap,
      Object,
      Array,
      Number,
      String,
      Boolean,
      Error,
      TypeError,
      JSON,
      console,
      queueMicrotask
    })
  };
}

test("parseArgs requires verification mode for test-only overrides", () => {
  assert.throws(() => parseArgs(["--hour", "20"]), /verification mode/i);
  assert.equal(parseArgs(["--verify", "--hour", "20"]).verifyHour, "20");
  assert.throws(() => parseArgs(["--verify", "--hour", "24"]), /00-23/i);
  assert.throws(() => parseArgs(["--verify", "--viewport", "bad"]), /viewport/i);
  assert.equal(parseArgs(["--verify"]).viewport, null);
});

test("capture matrix zero-argument command enters verification and reads the committed runtime port", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "prime-knight-capture-home-"));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const script = path.join(PROJECT_ROOT, "scripts/capture-matrix.mjs");
  let error;
  try {
    await execFile(process.execPath, [script], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, HOME: home },
      timeout: 5_000
    });
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, "capture should fail because the fixture has no active theme runtime");
  assert.doesNotMatch(error.stderr, /requires verification mode/i);
  assert.match(error.stderr, /\.state\/codex\.record\/port/);
});

test("default capture plan contains every approved viewport-hour pair", async () => {
  const capture = await import("../scripts/capture-matrix.mjs");
  assert.equal(typeof capture.buildCapturePlan, "function");
  const plan = capture.buildCapturePlan(parseArgs(["--verify"]));
  assert.equal(plan.length, 192);
  assert.equal(new Set(plan.map(({ viewport, hour }) => `${viewport.width}x${viewport.height}/${hour}`)).size, 192);
  assert.deepEqual(plan[0], {
    viewport: { width: 800, height: 600, devicePixelRatio: 1 },
    hour: "00"
  });
  assert.deepEqual(plan.at(-1), {
    viewport: { width: 3440, height: 1440, devicePixelRatio: 1 },
    hour: "23"
  });
});

test("matrix capture accepts a native layout only when the background covers the viewport", async () => {
  const capture = await import("../scripts/capture-matrix.mjs");
  const normalized = capture.normalizeCaptureMetrics({
    background: {
      left: 0,
      top: 0,
      width: 1920,
      height: 1080,
      viewportWidth: 1920,
      viewportHeight: 1080,
      visible: true
    },
    metrics: {
      hour: "20",
      mode: "wide",
      fit: "cover",
      position: "78% 50%",
      checksum: "a".repeat(64),
      layoutStatus: "native",
      sidebar: null,
      main: null,
      composer: null
    }
  });
  assert.deepEqual(normalized, {
    hour: "20",
    mode: "wide",
    fit: "cover",
    position: "78% 50%",
    checksum: "a".repeat(64),
    layoutStatus: "native",
    backgroundFullWindow: true,
    sidebar: null,
    main: null,
    composer: null
  });

  assert.equal(capture.normalizeCaptureMetrics({
    background: {
      left: 240,
      top: 0,
      width: 1680,
      height: 1080,
      viewportWidth: 1920,
      viewportHeight: 1080,
      visible: true
    },
    metrics: normalized
  }), null);
});

test("matrix capture waits through transient and stale theme metrics", async () => {
  const capture = await import("../scripts/capture-matrix.mjs");
  const snapshot = (hour, visible = true) => ({
    background: {
      left: 0,
      top: 0,
      width: 1920,
      height: 1080,
      viewportWidth: 1920,
      viewportHeight: 1080,
      visible
    },
    metrics: {
      hour,
      mode: "wide",
      fit: "cover",
      position: "78% 50%",
      checksum: "a".repeat(64),
      layoutStatus: "native",
      sidebar: null,
      main: null,
      composer: null
    }
  });
  const sequence = [snapshot("19", false), snapshot("19"), snapshot("20")];
  let waits = 0;
  const settled = await capture.waitForCaptureMetrics({}, "20", {
    attempts: 3,
    delayMs: 0,
    read: async () => sequence.shift(),
    waitFn: async () => { waits += 1; }
  });
  assert.equal(settled.hour, "20");
  assert.equal(settled.backgroundFullWindow, true);
  assert.equal(waits, 2);

  const exhausted = await capture.waitForCaptureMetrics({}, "20", {
    attempts: 2,
    delayMs: 0,
    read: async () => snapshot("19"),
    waitFn: async () => {}
  });
  assert.equal(exhausted, null);
});

test("capture cleanup clears device emulation and restores the production payload", async () => {
  const capture = await import("../scripts/capture-matrix.mjs");
  assert.equal(typeof capture.restoreAfterCapture, "function");
  const calls = [];
  const session = {
    async evaluate(expression) {
      calls.push(["evaluate", expression]);
      return true;
    },
    async send(method) {
      calls.push(["send", method]);
      return {};
    }
  };
  await capture.restoreAfterCapture(session, "production-payload");
  assert.match(calls[0][1], /destroy/);
  assert.deepEqual(calls[1], ["send", "Emulation.clearDeviceMetricsOverride"]);
  assert.deepEqual(calls[2], ["evaluate", "production-payload"]);
});

test("capture lifecycle always closes the session and preserves capture plus cleanup failures", async () => {
  const capture = await import("../scripts/capture-matrix.mjs");
  assert.equal(typeof capture.runCaptureWithCleanup, "function");
  const calls = [];
  const session = { close() { calls.push("close"); } };
  const captureError = new Error("capture failed");
  const cleanupError = new Error("cleanup failed");

  await assert.rejects(
    capture.runCaptureWithCleanup({
      session,
      capture: async () => { calls.push("capture"); throw captureError; },
      cleanup: async () => { calls.push("cleanup"); throw cleanupError; }
    }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [captureError, cleanupError]);
      return true;
    }
  );
  assert.deepEqual(calls, ["capture", "cleanup", "close"]);
});

test("installTheme tracks verification hour and removes it after destroy", async () => {
  const { document, window } = createFakeEnvironment();
  const theme = installTheme({
    document,
    window,
    manifest: [
      {
        hour: "08",
        src: "assets/backgrounds/08.webp",
        positionWide: "70% 50%",
        positionStandard: "70% 50%",
        positionCompact: "center top",
        overlayOpacity: 0.4,
        checksum: "08-checksum"
      },
      {
        hour: "20",
        src: "assets/backgrounds/20.webp",
        positionWide: "82% 50%",
        positionStandard: "72% 50%",
        positionCompact: "center top",
        overlayOpacity: 0.4,
        checksum: "20-checksum"
      }
    ],
    initialHour: "08",
    verificationMode: true,
    cssText: "#prime-knight-shell { display: block; }"
  });

  const shell = document.getElementById("prime-knight-shell");
  assert.equal(shell.getAttribute("data-prime-knight-verification"), "08");
  assert.equal(theme.metrics.hour, "08");

  await theme.setHour("20");
  assert.equal(shell.getAttribute("data-prime-knight-verification"), "20");
  assert.equal(theme.metrics.hour, "20");

  theme.destroy();
  assert.equal(document.querySelectorAll('[data-prime-knight-owned="true"]').length, 0);
  assert.equal(document.getElementById("prime-knight-shell"), null);
});

test("buildPayload exposes setHour only in verification mode", async (t) => {
  const fixture = await createFixture(t);
  const productionPayload = await buildPayload({
    cssPath: fixture.cssPath,
    manifestPath: fixture.manifestPath,
    assetsRoot: fixture.root,
    projectRoot: fixture.projectRoot,
    allowProvisionalChecksums: true
  });
  const verificationPayload = await buildPayload({
    cssPath: fixture.cssPath,
    manifestPath: fixture.manifestPath,
    assetsRoot: fixture.root,
    projectRoot: fixture.projectRoot,
    allowProvisionalChecksums: true,
    verificationMode: true,
    verificationHour: "20"
  });

  const production = createPayloadContext();
  vm.runInContext(productionPayload, production.context);
  const productionApi = production.context.window.__CODEX_PRIME_KNIGHT_THEME__;
  assert.equal(Object.keys(productionApi).includes("setHour"), false);
  productionApi.destroy();

  const verification = createPayloadContext();
  vm.runInContext(verificationPayload, verification.context);
  const verificationApi = verification.context.window.__CODEX_PRIME_KNIGHT_THEME__;
  assert.equal(Object.keys(verificationApi).includes("setHour"), true);
  assert.equal(typeof verificationApi.setHour, "function");
  assert.equal(verificationApi.metrics.hour, "20");
  await verificationApi.setHour("08");
  assert.equal(verificationApi.metrics.hour, "08");
  verificationApi.destroy();
});
