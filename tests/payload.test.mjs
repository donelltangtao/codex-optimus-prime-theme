import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { buildPayload, MAX_BACKGROUND_BYTES } from "../src/runtime/payload.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function minimalWebP(hour, size = 32) {
  const data = Buffer.alloc(size, hour);
  data.write("RIFF", 0, "ascii");
  data.writeUInt32LE(size - 8, 4);
  data.write("WEBP", 8, "ascii");
  data.write("VP8 ", 12, "ascii");
  return data;
}

function transparentWebP(seed = 0, size = 48) {
  const data = Buffer.alloc(size, seed);
  data.write("RIFF", 0, "ascii");
  data.writeUInt32LE(size - 8, 4);
  data.write("WEBP", 8, "ascii");
  data.write("VP8X", 12, "ascii");
  data.writeUInt32LE(10, 16);
  data[20] = 0x10;
  data.writeUIntLE(0, 24, 3);
  data.writeUIntLE(0, 27, 3);
  data.write("ALPH", 30, "ascii");
  data.writeUInt32LE(size - 38, 34);
  return data;
}

const frameNames = [
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

function rowFor(hour, checksum) {
  const key = String(hour).padStart(2, "0");
  return {
    hour: key,
    src: `assets/backgrounds/${key}.webp`,
    focusX: 0.5,
    focusY: 0.5,
    safeArea: "left",
    positionWide: "72% 50%",
    positionStandard: "68% 50%",
    positionCompact: "center top",
    overlayOpacity: 0.4,
    dominantTone: hour < 6 ? "deep-night" : hour < 10 ? "dawn" : hour < 17 ? "day-command" : hour < 20 ? "dusk" : "night-battle",
    checksum
  };
}

async function createPayloadFixture(t, {
  oversizedHour = null,
  oversizedFrame = null,
  opaqueFrame = null,
  invalidFrame = null,
  cssText = "#prime-knight-shell { display: contents; }"
} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "prime-knight-payload-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const backgrounds = path.join(root, "assets/backgrounds");
  const theme = path.join(root, "src/theme");
  await fs.mkdir(backgrounds, { recursive: true });
  await fs.mkdir(theme, { recursive: true });
  await fs.writeFile(path.join(theme, "prime-knight.css"), cssText);
  const frames = path.join(root, "assets/frame");
  await fs.mkdir(frames, { recursive: true });
  for (const [index, name] of frameNames.entries()) {
    const frameSize = name === oversizedFrame ? 2 * 1024 * 1024 : 48;
    const data = transparentWebP(index + 1, frameSize);
    if (name === opaqueFrame) data[20] = 0;
    if (name === invalidFrame) data.write("NOPE", 8, "ascii");
    await fs.writeFile(path.join(frames, `${name}.webp`), data);
  }

  const rows = [];
  for (let hour = 0; hour < 24; hour += 1) {
    const data = minimalWebP(hour, hour === oversizedHour ? MAX_BACKGROUND_BYTES + 1 : 32);
    const key = String(hour).padStart(2, "0");
    await fs.writeFile(path.join(backgrounds, `${key}.webp`), data);
    rows.push(rowFor(hour, createHash("sha256").update(data).digest("hex")));
  }
  const manifestPath = path.join(root, "config/backgrounds.json");
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, JSON.stringify(rows));
  return {
    cssPath: path.join(theme, "prime-knight.css"),
    manifestPath,
    assetsRoot: root,
    projectRoot
  };
}

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
      setProperty: (name, value) => properties.set(name, value),
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
    if (!this.parentNode) return;
    const index = this.parentNode.childNodes.indexOf(this);
    if (index >= 0) this.parentNode.childNodes.splice(index, 1);
    this.parentNode = null;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  getAttributeNames() { return [...this.attributes.keys()]; }
  querySelector(selector) { return findAll(this, selector)[0] ?? null; }
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

function addListener(store, name, listener) {
  const listeners = store.get(name) ?? new Set();
  listeners.add(listener);
  store.set(name, listeners);
}

function removeListener(store, name, listener) {
  const listeners = store.get(name);
  listeners?.delete(listener);
  if (listeners?.size === 0) store.delete(name);
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
  let styleCreations = 0;
  let nextTimer = 0;
  const timers = new Map();
  const document = {
    documentElement: root,
    head,
    body,
    visibilityState: "visible",
    createElement(tagName) {
      if (tagName === "style") styleCreations += 1;
      return new FakeElement(tagName);
    },
    getElementById(id) { return findAll(root, `#${id}`)[0] ?? null; },
    querySelectorAll(selector) { return findAll(root, selector); },
    querySelector(selector) { return findAll(root, selector)[0] ?? null; },
    addEventListener(name, listener) { addListener(documentListeners, name, listener); },
    removeEventListener(name, listener) { removeListener(documentListeners, name, listener); }
  };
  const window = {
    innerWidth: 1440,
    innerHeight: 900,
    devicePixelRatio: 2,
    addEventListener(name, listener) { addListener(windowListeners, name, listener); },
    removeEventListener(name, listener) { removeListener(windowListeners, name, listener); },
    setTimeout(callback, delay = 0) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    matchMedia: () => ({ matches: true }),
    URL: { revokeObjectURL() {} },
    Image: class {
      set src(value) {
        this.value = value;
        if (value) queueMicrotask(() => this.onload?.());
      }
      get src() { return this.value; }
    },
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    }
  };
  return {
    document,
    window,
    nativeRoot,
    root,
    documentListeners,
    windowListeners,
    timers,
    get styleCreations() { return styleCreations; }
  };
}

test("builds one self-contained renderer payload with 24 backgrounds and 16 cockpit frames", async (t) => {
  const fixture = await createPayloadFixture(t);
  const payload = await buildPayload(fixture);

  assert.equal(typeof payload, "string");
  assert.doesNotThrow(() => new Function(`return (${payload});`));
  assert.equal((payload.match(/data:image\/webp;base64,/g) ?? []).length, 40);
  for (const name of frameNames) {
    assert.match(payload, new RegExp(`--prime-knight-frame-${name}`));
  }
  assert.doesNotMatch(payload, /\/Users\//);
  assert.doesNotMatch(payload, /file:/i);
  assert.doesNotMatch(payload, /assets\/backgrounds\/\d{2}\.webp/);
  assert.doesNotMatch(payload, /assets\/frame\/[a-z-]+\.webp/);
  assert.doesNotMatch(payload, /https?:|\/\/[^/]/i);
  assert.match(payload, /__CODEX_PRIME_KNIGHT_THEME__/);
  assert.match(payload, /destroy/);
  assert.match(payload, /installTheme\(/);
  assert.match(payload, /rotator\.start\(\)/);
  assert.match(payload, /installed\.setHour\(row\.hour, context\)/);
  assert.match(payload, /rotator\.stop\(\)/);
  assert.doesNotMatch(payload, /DREAM_SKIN/);
});

test("executes one install with a sole frozen API and destroys all owned state", async (t) => {
  const fixture = await createPayloadFixture(t);
  const payload = await buildPayload(fixture);
  const environment = createPayloadEnvironment();
  const context = vm.createContext({
    window: environment.window,
    document: environment.document,
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
    JSON
  });

  const result = vm.runInContext(payload, context);
  const api = environment.window.__CODEX_PRIME_KNIGHT_THEME__;
  assert.equal(result.installed, true);
  assert.equal(environment.styleCreations, 1);
  assert.deepEqual(
    Object.getOwnPropertyNames(environment.window).filter((name) => name.includes("PRIME_KNIGHT")),
    ["__CODEX_PRIME_KNIGHT_THEME__"]
  );
  assert.deepEqual(Object.keys(api).sort(), ["destroy", "metrics"]);
  assert.equal(Object.isFrozen(api), true);
  assert.equal(Object.isFrozen(api.metrics), true);
  assert.equal(Object.getOwnPropertyDescriptor(api, "metrics").set, undefined);
  assert.throws(() => { api.metrics = {}; }, TypeError);
  assert.equal(api.metrics.layoutStatus, "native");
  assert.equal(api.metrics.sidebar, null);
  assert.equal(api.metrics.main, null);
  assert.equal(api.metrics.composer, null);
  assert.equal(environment.document.querySelectorAll('[data-prime-knight-owned="true"]').length, 2);

  api.destroy();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal("__CODEX_PRIME_KNIGHT_THEME__" in environment.window, false);
  assert.equal(environment.document.querySelectorAll('[data-prime-knight-owned="true"]').length, 0);
  assert.equal(environment.nativeRoot.getAttribute("data-prime-knight-content-layer"), null);
  assert.equal(environment.root.getAttributeNames().some((name) => name.startsWith("data-prime-knight-")), false);
  assert.equal(environment.documentListeners.size, 0);
  assert.equal(environment.windowListeners.size, 0);
  assert.equal(environment.timers.size, 0);
});

test("payload coalesces renderer resync during resize bursts", async (t) => {
  const fixture = await createPayloadFixture(t);
  const payload = await buildPayload(fixture);
  const environment = createPayloadEnvironment();
  const context = vm.createContext({
    window: environment.window,
    document: environment.document,
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
    JSON
  });
  vm.runInContext(payload, context);
  await new Promise((resolve) => setImmediate(resolve));
  const resizeListeners = [...(environment.windowListeners.get("resize") ?? [])];
  assert.equal(resizeListeners.length, 2);
  for (let burst = 0; burst < 3; burst += 1) {
    for (const listener of resizeListeners) listener();
  }
  assert.equal([...environment.timers.values()].filter(({ delay }) => delay === 120).length, 2);
  environment.window.__CODEX_PRIME_KNIGHT_THEME__.destroy();
  assert.equal(environment.timers.size, 0);
});

test("rejects CSS escapes, normalized imports, and every url token", async (t) => {
  const fixture = await createPayloadFixture(t);
  const cases = [
    String.raw`body { content: "\6"; }`,
    String.raw`body { content: "\69"; }`,
    String.raw`body { content: "\069 "; }`,
    String.raw`body { content: "\0069"; }`,
    String.raw`body { content: "\00069 "; }`,
    String.raw`body { content: "\000069"; }`,
    String.raw`body { content: "\i"; }`,
    String.raw`@\69mport "https://example.test/theme.css";`,
    String.raw`@\000069 mport "https://example.test/theme.css";`,
    String.raw`.frame { background: u\72l("https://example.test/frame.webp"); }`,
    String.raw`.frame { background: u\000072 l('https://example.test/frame.webp'); }`,
    String.raw`.frame { background: u\rl("https://example.test/frame.webp"); }`,
    '@import "theme.css";',
    '@Im/**/PoRt "theme.css";',
    '@IMPORT URL("data:text/css,body{}");',
    '.frame { background: URL("../../assets/frame/corner.webp"); }',
    '.frame { background: url(//example.test/frame.webp); }',
    '.frame { background: url(file:///tmp/frame.webp); }',
    '.frame { background: url(https://example.test/frame.webp); }',
    '.frame { background: U/**/rL("data:image/webp;base64,UklGRg=="); }',
    '.frame { background: url("data:image/webp;base64,UklGRg=="); }',
    ".frame { background: URL('data:image/webp;base64,UklGRg=='); }"
  ];
  for (const cssText of cases) {
    await fs.writeFile(fixture.cssPath, cssText);
    await assert.rejects(buildPayload(fixture), /stylesheet|CSS|escape|url/i, cssText);
  }
});

test("current approved CSS satisfies the conservative source grammar", async (t) => {
  const approvedCss = await fs.readFile(path.join(projectRoot, "src/theme/prime-knight.css"), "utf8");
  const fixture = await createPayloadFixture(t, { cssText: approvedCss });
  const payload = await buildPayload(fixture);

  assert.equal((payload.match(/data:image\/webp;base64,/g) ?? []).length, 40);
});

test("rejects literal user paths and file URLs even outside url()", async (t) => {
  const fixture = await createPayloadFixture(t);
  for (const cssText of [
    'body::before { content: "/Users/alice/private.webp"; }',
    'body::before { content: "file:///tmp/private.webp"; }'
  ]) {
    await fs.writeFile(fixture.cssPath, cssText);
    await assert.rejects(buildPayload(fixture), /self-contained|path|file:/i, cssText);
  }
});

test("rejects a background larger than 20 MiB", async (t) => {
  const fixture = await createPayloadFixture(t, { oversizedHour: 7 });

  await assert.rejects(buildPayload(fixture), /20 MiB/);
});

test("rejects a background whose bytes do not match the manifest checksum", async (t) => {
  const fixture = await createPayloadFixture(t);
  await fs.appendFile(path.join(fixture.assetsRoot, "assets/backgrounds/09.webp"), Buffer.from([1]));

  await assert.rejects(buildPayload(fixture), /checksum.*09/i);
});

test("rejects a frame whose real path escapes the asset root", async (t) => {
  const fixture = await createPayloadFixture(t);
  const outside = path.join(path.dirname(fixture.assetsRoot), "outside-frame.webp");
  await fs.writeFile(outside, transparentWebP(9));
  t.after(() => fs.rm(outside, { force: true }));
  const target = path.join(fixture.assetsRoot, "assets/frame/corner-tl.webp");
  await fs.rm(target);
  await fs.symlink(outside, target);

  await assert.rejects(buildPayload(fixture), /corner-tl.*inside assetsRoot/i);
});

test("rejects a frame without a WebP signature", async (t) => {
  const fixture = await createPayloadFixture(t, { invalidFrame: "corner-tr" });

  await assert.rejects(buildPayload(fixture), /corner-tr.*valid WebP/i);
});

test("rejects a frame at or above the 2 MiB cap", async (t) => {
  const fixture = await createPayloadFixture(t, { oversizedFrame: "edge-h" });

  await assert.rejects(buildPayload(fixture), /edge-h.*2 MiB/i);
});

test("rejects a frame without an alpha channel", async (t) => {
  const fixture = await createPayloadFixture(t, { opaqueFrame: "energy-core" });

  await assert.rejects(buildPayload(fixture), /energy-core.*alpha/i);
});

test("production payload builds strictly with real assets and checksums", async () => {
  const payload = await buildPayload({
    cssPath: path.join(projectRoot, "src/theme/prime-knight.css"),
    manifestPath: path.join(projectRoot, "config/backgrounds.json"),
    assetsRoot: projectRoot,
    projectRoot
  });

  assert.equal((payload.match(/data:image\/webp;base64,/g) ?? []).length, 40);
  assert.doesNotMatch(payload, /\/Users\//);
  assert.doesNotMatch(payload, /\bfile:/i);
});
