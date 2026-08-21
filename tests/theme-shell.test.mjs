import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { installTheme } from "../src/theme/install-theme.mjs";

const cssText = await fs.readFile("src/theme/prime-knight.css", "utf8");

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.attributes = new Map();
    this.childNodes = [];
    this.parentNode = null;
    this.rect = null;
    this.className = "";
    this.id = "";
    this.computedStyle = {};
    const properties = new Map();
    this.style = {
      setProperty: (name, value) => properties.set(name, value),
      getPropertyValue: (name) => properties.get(name) ?? ""
    };
    const classes = new Set();
    this.classList = {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name)
    };
  }

  get parentElement() {
    return this.parentNode;
  }

  getBoundingClientRect() {
    return this.rect;
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

  querySelectorAll(selector) {
    return findAll(this, selector);
  }
}

function findAll(root, selector) {
  const match = selector.match(/^\[([^=]+)="([^"]+)"\]$/);
  const tagName = /^[a-z][a-z0-9-]*$/.test(selector) ? selector.toLowerCase() : null;
  const found = [];
  const visit = (node) => {
    if (match && node.getAttribute(match[1]) === match[2]) found.push(node);
    if (tagName && String(node.tagName).toLowerCase() === tagName) found.push(node);
    for (const child of node.childNodes) visit(child);
  };
  visit(root);
  return found;
}

function createFakeEnvironment() {
  const root = new FakeElement("html");
  const head = new FakeElement("head");
  const body = new FakeElement("body");
  const nativeContent = new FakeElement("main");
  nativeContent.id = "root";
  body.append(nativeContent);
  root.append(head, body);
  const document = {
    documentElement: root,
    head,
    body,
    createElement: (tagName) => new FakeElement(tagName),
    defaultView: {
      getComputedStyle: (element) => ({
        display: "block",
        visibility: "visible",
        opacity: "1",
        backgroundColor: "rgba(0, 0, 0, 0)",
        ...element.computedStyle
      })
    },
    querySelectorAll: (selector) => findAll(root, selector),
    getElementById: (id) => {
      const visit = (node) => {
        if (node.id === id) return node;
        for (const child of node.childNodes) {
          const found = visit(child);
          if (found) return found;
        }
        return null;
      };
      return visit(root);
    }
  };
  const listeners = new Map();
  const observers = [];
  const mutationObservers = [];
  const timers = new Map();
  let nextTimer = 0;
  const window = {
    innerWidth: 1440,
    innerHeight: 900,
    devicePixelRatio: 2,
    addEventListener: (name, handler) => listeners.set(name, handler),
    removeEventListener: (name, handler) => {
      if (listeners.get(name) === handler) listeners.delete(name);
    },
    setTimeout(callback) {
      const id = ++nextTimer;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    URL: { revokeObjectURL() {} },
    ResizeObserver: class {
      constructor(callback) {
        this.callback = callback;
        this.disconnected = false;
        observers.push(this);
      }

      observe(target) {
        this.target = target;
      }

      disconnect() {
        this.disconnected = true;
      }
    },
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback;
        this.disconnected = false;
        mutationObservers.push(this);
      }

      observe(target, options) {
        this.target = target;
        this.options = options;
      }

      disconnect() {
        this.disconnected = true;
      }
    }
  };
  return { document, window, listeners, observers, mutationObservers, timers, nativeContent };
}

function addCockpitAnchors(environment, {
  sidebar = { left: 0, top: 0, right: 252, bottom: 900, width: 252, height: 900 },
  composer = { left: 252, top: 720, right: 1440, bottom: 900, width: 1188, height: 180 },
  surfaceHorizontalInset = 80,
  surfaceInset = 16,
  inputInset = 20,
  inputTag = "textarea",
  contentEditable = false
} = {}) {
  environment.nativeContent.rect = {
    left: sidebar.right,
    top: 0,
    right: environment.window.innerWidth,
    bottom: environment.window.innerHeight,
    width: environment.window.innerWidth - sidebar.right,
    height: environment.window.innerHeight
  };
  const navigation = new FakeElement("nav");
  navigation.rect = sidebar;
  const composerContainer = new FakeElement("section");
  composerContainer.rect = composer;
  const composerSurface = new FakeElement("div");
  composerSurface.setAttribute("role", "presentation");
  composerSurface.rect = {
    left: composer.left + surfaceHorizontalInset,
    top: composer.top + surfaceInset,
    right: composer.right - surfaceHorizontalInset,
    bottom: composer.bottom - surfaceInset,
    width: composer.width - (surfaceHorizontalInset * 2),
    height: composer.height - (surfaceInset * 2)
  };
  composerSurface.computedStyle.backgroundColor = "rgb(45, 45, 45)";
  const textarea = new FakeElement(inputTag);
  if (contentEditable) textarea.setAttribute("contenteditable", "true");
  textarea.rect = {
    left: composerSurface.rect.left + inputInset,
    top: composerSurface.rect.top + inputInset,
    right: composerSurface.rect.right - inputInset,
    bottom: composerSurface.rect.bottom - inputInset,
    width: composerSurface.rect.width - (inputInset * 2),
    height: composerSurface.rect.height - (inputInset * 2)
  };
  composerSurface.append(textarea);
  composerContainer.append(composerSurface);
  environment.nativeContent.append(navigation, composerContainer);
  return { navigation, composerContainer, composerSurface, textarea };
}

test("theme shell cannot intercept or resize Codex", async () => {
  const hostRule = cssText.match(/#prime-knight-shell\s*\{([^}]*)\}/)?.[1] ?? "";
  const contentRule = cssText.match(/\[data-prime-knight-content-layer="true"\]\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(hostRule, /display:\s*contents/);
  assert.doesNotMatch(hostRule, /(?:^|[;\n]\s*)(?:position|z-index|isolation|transform|opacity|filter|contain|mix-blend-mode)\s*:/);
  assert.match(cssText, /#prime-knight-shell[\s\S]*pointer-events:\s*none/);
  assert.doesNotMatch(cssText, /(?:\:root|html|body|#root)[^{]*\{[^}]*(?:transform|scale|padding)\s*:/s);
  assert.match(cssText, /\.prime-knight-background,\s*\.prime-knight-readability-mask\s*\{[\s\S]*position:\s*fixed/);
  assert.match(cssText, /\.prime-knight-chrome\s*\{[^}]*position:\s*fixed/s);
  assert.match(cssText, /\.prime-knight-background\s*\{[\s\S]*z-index:\s*0/);
  assert.match(cssText, /\.prime-knight-readability-mask\s*\{[\s\S]*z-index:\s*0/);
  assert.match(contentRule, /position:\s*relative/);
  assert.deepEqual([...contentRule.matchAll(/([a-z-]+)\s*:/g)].map((match) => match[1]), ["position", "z-index"]);
  assert.match(contentRule, /z-index:\s*1/);
  assert.match(cssText, /\.prime-knight-chrome[\s\S]*z-index:\s*2/);
  assert.match(cssText, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*\.prime-knight-background\s*\{[\s\S]*transition-duration:\s*0ms/);
});

test("cleanup owns only prime-knight nodes", async () => {
  const source = await fs.readFile("src/theme/install-theme.mjs", "utf8");
  assert.match(source, /prime-knight-shell/);
  assert.match(source, /data-prime-knight-owned/);
  assert.doesNotMatch(source, /document\.body\.innerHTML\s*=/);
  assert.match(source, /clearTimeout/);
  assert.match(source, /revokeObjectURL/);
  assert.match(source, /resources\.clear\(\)/);
});

test("installation requires the real stylesheet before changing native DOM", () => {
  const { document, window, nativeContent } = createFakeEnvironment();
  assert.throws(() => installTheme({ document, window }), /cssText/);
  assert.equal(document.querySelectorAll('[data-prime-knight-owned="true"]').length, 0);
  assert.equal(nativeContent.getAttribute("data-prime-knight-content-layer"), null);
});

test("installation refuses to decorate a document without a safe native content root", () => {
  const { document, window, nativeContent } = createFakeEnvironment();
  nativeContent.remove();
  assert.throws(() => installTheme({ document, window, cssText }), /native content root/);
  assert.equal(document.querySelectorAll('[data-prime-knight-owned="true"]').length, 0);
});

test("resource registry releases each tracked timeout and object URL once", async () => {
  const { createResourceRegistry } = await import("../src/theme/install-theme.mjs");
  const cleared = [];
  const revoked = [];
  const resources = createResourceRegistry({
    clearTimeout: (timeout) => cleared.push(timeout),
    revokeObjectURL: (url) => revoked.push(url)
  });
  resources.trackTimeout("theme-timeout");
  resources.trackObjectUrl("blob:prime-knight");

  resources.clear();
  resources.clear();
  assert.deepEqual(cleared, ["theme-timeout"]);
  assert.deepEqual(revoked, ["blob:prime-knight"]);
});

test("background-only installation marks the native main surface without creating chrome overlays", () => {
  const environment = createFakeEnvironment();
  const { document, window, listeners, observers, nativeContent } = environment;
  addCockpitAnchors(environment);
  document.documentElement.setAttribute("data-prime-knight-stale", "true");
  document.documentElement.setAttribute("data-native-marker", "preserve");
  const theme = installTheme({
    document,
    window,
    manifest: [{
      hour: "08",
      positionWide: "78% 48%",
      positionStandard: "72% 50%",
      positionCompact: "center top",
      overlayOpacity: 0.5
    }],
    initialHour: "08",
    testMode: true,
    cssText
  });

  assert.deepEqual(
    document.documentElement.getAttributeNames().filter((name) => name.startsWith("data-prime-knight-")),
    ["data-prime-knight-mode"]
  );
  assert.equal(document.documentElement.getAttribute("data-native-marker"), "preserve");
  assert.equal(document.querySelectorAll('[data-prime-knight-owned="true"]').length, 2);
  assert.equal(document.querySelectorAll('[data-prime-knight-layer="chrome-sidebar"]').length, 0);
  assert.equal(document.querySelectorAll('[data-prime-knight-layer="chrome-main"]').length, 0);
  assert.equal(document.querySelectorAll('[data-prime-knight-layer="chrome-composer"]').length, 0);
  assert.equal(nativeContent.getAttribute("data-prime-knight-content-layer"), "true");
  assert.equal(nativeContent.getAttribute("data-prime-knight-native-surface"), "true");
  assert.equal(document.head.childNodes.find((node) => node.tagName === "style").textContent, cssText);
  const shell = document.body.childNodes.find((node) => node.id === "prime-knight-shell");
  assert.equal(shell.getAttribute("data-prime-knight-density"), "full");
  assert.equal(shell.style.getPropertyValue("--prime-knight-fit"), "cover");
  assert.equal(shell.style.getPropertyValue("--prime-knight-position"), "72% 50%");
  assert.equal(shell.style.getPropertyValue("--prime-knight-overlay"), "0.5");
  assert.equal(shell.style.getPropertyValue("--prime-knight-chrome-density"), "full");
  assert.equal(shell.getAttribute("data-prime-knight-layout"), "anchored");
  assert.equal(shell.style.getPropertyValue("--prime-knight-sidebar-right"), "252px");
  assert.equal(shell.style.getPropertyValue("--prime-knight-composer-top"), "720px");
  assert.equal(shell.style.getPropertyValue("--prime-knight-main-left"), "252px");
  assert.equal(shell.style.getPropertyValue("--prime-knight-main-width"), "1188px");
  assert.equal(shell.style.getPropertyValue("--prime-knight-main-height"), "720px");
  assert.equal(document.querySelectorAll('[data-prime-knight-layer="background-a"]').length, 1);
  assert.equal(document.querySelectorAll('[data-prime-knight-layer="background-b"]').length, 1);
  assert.equal(document.querySelectorAll('[data-prime-knight-layer="readability-mask"]').length, 1);
  assert.equal(observers.length, 1);
  assert.equal(observers[0].target, document.documentElement);
  assert.deepEqual([...listeners.keys()].sort(), ["resize", "scroll"]);
  assert.equal(theme.metrics.layoutStatus, "anchored");
  assert.deepEqual(theme.metrics.sidebar, { left: 0, top: 0, width: 252, height: 900 });
  assert.deepEqual(theme.metrics.main, { left: 252, top: 0, width: 1188, height: 720 });
  assert.deepEqual(theme.metrics.composer, { left: 252, top: 720, width: 1188, height: 180 });
  assert.equal(nativeContent.style.getPropertyValue("padding"), "");
  assert.equal(nativeContent.style.getPropertyValue("transform"), "");

  window.innerWidth = 760;
  window.innerHeight = 620;
  theme.refreshViewport();
  assert.equal(shell.getAttribute("data-prime-knight-density"), "minimal");

  theme.destroy();
  theme.destroy();
  assert.equal(document.querySelectorAll('[data-prime-knight-owned="true"]').length, 0);
  assert.equal(document.documentElement.getAttribute("data-native-marker"), "preserve");
  assert.equal(document.documentElement.getAttributeNames().some((name) => name.startsWith("data-prime-knight-")), false);
  assert.equal(nativeContent.getAttribute("data-prime-knight-content-layer"), null);
  assert.equal(nativeContent.getAttribute("data-prime-knight-native-surface"), null);
  assert.equal(observers[0].disconnected, true);
  assert.equal(listeners.size, 0);
});

test("titlebar-shifted main surface remains eligible for background tinting", () => {
  const environment = createFakeEnvironment();
  const { document, window, nativeContent } = environment;
  addCockpitAnchors(environment);
  nativeContent.rect = { left: 252, top: -30.5, right: 1440, bottom: 869.5, width: 1188, height: 900 };

  const theme = installTheme({ document, window, initialHour: "08", testMode: true, cssText });

  assert.equal(nativeContent.getAttribute("data-prime-knight-native-surface"), "true");
  theme.destroy();
});

test("sidebar and composer surfaces reveal the full-window background without changing native geometry", () => {
  const environment = createFakeEnvironment();
  const { document, window, nativeContent } = environment;
  const { navigation, composerContainer, composerSurface } = addCockpitAnchors(environment);
  const before = {
    sidebar: navigation.getBoundingClientRect(),
    composer: composerContainer.getBoundingClientRect(),
    inputSurface: composerSurface.getBoundingClientRect()
  };

  const theme = installTheme({ document, window, initialHour: "08", testMode: true, cssText });

  assert.equal(navigation.getAttribute("data-prime-knight-native-sidebar"), "true");
  assert.equal(composerSurface.getAttribute("data-prime-knight-native-composer-surface"), "true");
  assert.deepEqual(navigation.getBoundingClientRect(), before.sidebar);
  assert.deepEqual(composerContainer.getBoundingClientRect(), before.composer);
  assert.deepEqual(composerSurface.getBoundingClientRect(), before.inputSurface);
  assert.equal(nativeContent.style.getPropertyValue("padding"), "");
  assert.equal(nativeContent.style.getPropertyValue("transform"), "");

  theme.destroy();
  assert.equal(navigation.getAttribute("data-prime-knight-native-sidebar"), null);
  assert.equal(composerSurface.getAttribute("data-prime-knight-native-composer-surface"), null);
});

test("an optional composer tint miss never hides the full-window background", () => {
  const environment = createFakeEnvironment();
  const { document, window, nativeContent } = environment;
  const { navigation, composerSurface } = addCockpitAnchors(environment);
  composerSurface.computedStyle.backgroundColor = "transparent";

  const theme = installTheme({ document, window, initialHour: "08", testMode: true, cssText });
  const shell = document.getElementById("prime-knight-shell");

  assert.equal(shell.getAttribute("data-prime-knight-layout"), "anchored");
  assert.equal(theme.metrics.layoutStatus, "anchored");
  assert.equal(nativeContent.getAttribute("data-prime-knight-native-surface"), "true");
  assert.equal(navigation.getAttribute("data-prime-knight-native-sidebar"), "true");
  assert.equal(composerSurface.getAttribute("data-prime-knight-native-composer-surface"), null);

  theme.destroy();
});

test("composer tint can target an opaque native ancestor without changing its geometry", () => {
  const environment = createFakeEnvironment();
  const { document, window } = environment;
  const { composerContainer, composerSurface, textarea } = addCockpitAnchors(environment);
  const composerBody = new FakeElement("div");
  composerBody.rect = { ...composerSurface.getBoundingClientRect() };
  textarea.remove();
  composerSurface.append(composerBody);
  composerBody.append(textarea);
  composerContainer.rect = { ...composerSurface.getBoundingClientRect() };
  const before = composerSurface.getBoundingClientRect();

  const theme = installTheme({ document, window, initialHour: "08", testMode: true, cssText });

  assert.equal(composerSurface.getAttribute("data-prime-knight-native-composer-surface"), "true");
  assert.deepEqual(composerSurface.getBoundingClientRect(), before);
  theme.destroy();
});

test("composer surround gradient is cleared without changing any native geometry", () => {
  const environment = createFakeEnvironment();
  const { document, window, nativeContent } = environment;
  const { composerContainer, composerSurface } = addCockpitAnchors(environment);
  const bottomRegion = new FakeElement("div");
  bottomRegion.rect = { ...composerContainer.getBoundingClientRect() };
  const surroundGradient = new FakeElement("div");
  surroundGradient.rect = { ...bottomRegion.getBoundingClientRect() };
  surroundGradient.computedStyle.backgroundImage = "linear-gradient(rgb(24, 24, 24), rgb(24, 24, 24))";
  surroundGradient.computedStyle.pointerEvents = "none";
  surroundGradient.computedStyle.position = "absolute";
  composerContainer.remove();
  bottomRegion.append(surroundGradient, composerContainer);
  nativeContent.append(bottomRegion);
  const before = {
    region: bottomRegion.getBoundingClientRect(),
    gradient: surroundGradient.getBoundingClientRect(),
    composer: composerContainer.getBoundingClientRect(),
    input: composerSurface.getBoundingClientRect()
  };

  const theme = installTheme({ document, window, initialHour: "08", testMode: true, cssText });

  assert.equal(surroundGradient.getAttribute("data-prime-knight-native-composer-backdrop"), "true");
  assert.deepEqual(bottomRegion.getBoundingClientRect(), before.region);
  assert.deepEqual(surroundGradient.getBoundingClientRect(), before.gradient);
  assert.deepEqual(composerContainer.getBoundingClientRect(), before.composer);
  assert.deepEqual(composerSurface.getBoundingClientRect(), before.input);
  theme.destroy();
  assert.equal(surroundGradient.getAttribute("data-prime-knight-native-composer-backdrop"), null);
});

test("composer surround gradient can live in a parallel native branch", () => {
  const environment = createFakeEnvironment();
  const { document, window, nativeContent } = environment;
  addCockpitAnchors(environment);
  const gradientBranch = new FakeElement("div");
  gradientBranch.rect = { left: 120, top: 720, right: 1440, bottom: 900, width: 1320, height: 180 };
  const surroundGradient = new FakeElement("div");
  surroundGradient.rect = { ...gradientBranch.getBoundingClientRect() };
  surroundGradient.computedStyle.backgroundImage = "linear-gradient(rgb(24, 24, 24), rgb(24, 24, 24))";
  surroundGradient.computedStyle.pointerEvents = "none";
  surroundGradient.computedStyle.position = "absolute";
  gradientBranch.append(surroundGradient);
  nativeContent.append(gradientBranch);

  const theme = installTheme({ document, window, initialHour: "08", testMode: true, cssText });

  assert.equal(surroundGradient.getAttribute("data-prime-knight-native-composer-backdrop"), "true");
  theme.destroy();
});

test("compact project composer still clears its bottom surround", () => {
  const environment = createFakeEnvironment();
  const { document, window, nativeContent } = environment;
  const { composerContainer, composerSurface } = addCockpitAnchors(environment, {
    composer: { left: 306.5, top: 856, right: 1042.5, bottom: 900, width: 736, height: 44 },
    surfaceHorizontalInset: 0,
    surfaceInset: 0,
    inputInset: 12,
    inputTag: "div",
    contentEditable: true
  });
  const offscreenEditor = new FakeElement("div");
  offscreenEditor.setAttribute("contenteditable", "true");
  offscreenEditor.rect = { left: 320, top: -5400, right: 1024, bottom: -4684, width: 704, height: 716 };
  nativeContent.append(offscreenEditor);
  const surroundGradient = new FakeElement("div");
  surroundGradient.rect = { left: 252, top: 840, right: 1440, bottom: 900, width: 1188, height: 60 };
  surroundGradient.computedStyle.backgroundImage = "linear-gradient(rgb(24, 24, 24), rgb(24, 24, 24))";
  surroundGradient.computedStyle.pointerEvents = "none";
  surroundGradient.computedStyle.position = "absolute";
  nativeContent.append(surroundGradient);

  const theme = installTheme({ document, window, initialHour: "08", testMode: true, cssText });
  const shell = document.getElementById("prime-knight-shell");

  assert.equal(shell.getAttribute("data-prime-knight-layout"), "anchored");
  assert.equal(composerSurface.getAttribute("data-prime-knight-native-composer-surface"), "true");
  assert.equal(surroundGradient.getAttribute("data-prime-knight-native-composer-backdrop"), "true");
  assert.deepEqual(composerContainer.getBoundingClientRect(), { left: 306.5, top: 856, right: 1042.5, bottom: 900, width: 736, height: 44 });
  theme.destroy();
});

test("right side panel reveals the full-window background without changing native geometry", () => {
  const environment = createFakeEnvironment();
  const { document, window, nativeContent } = environment;
  addCockpitAnchors(environment);
  const sidePanel = new FakeElement("aside");
  sidePanel.rect = { left: 780, top: 0, right: 1440, bottom: 900, width: 660, height: 900 };
  const outerSurface = new FakeElement("div");
  outerSurface.rect = { ...sidePanel.rect };
  outerSurface.computedStyle.backgroundColor = "rgb(24, 24, 24)";
  const innerSurface = new FakeElement("div");
  innerSurface.rect = { left: 781, top: 0, right: 1440, bottom: 900, width: 659, height: 900 };
  innerSurface.computedStyle.backgroundColor = "rgb(24, 24, 24)";
  const scrollSurface = new FakeElement("div");
  scrollSurface.rect = { left: 781, top: 46, right: 1440, bottom: 900, width: 659, height: 854 };
  scrollSurface.computedStyle.backgroundColor = "rgb(24, 24, 24)";
  const topToolbar = new FakeElement("div");
  topToolbar.rect = { left: 781, top: 0, right: 1440, bottom: 46, width: 659, height: 46 };
  topToolbar.computedStyle.backgroundColor = "rgb(24, 24, 24)";
  const shortcutShelf = new FakeElement("div");
  shortcutShelf.rect = { left: 789, top: 408, right: 1432, bottom: 492, width: 643, height: 84 };
  shortcutShelf.computedStyle.backgroundColor = "rgb(24, 24, 24)";
  shortcutShelf.computedStyle.position = "sticky";
  const firstShortcut = new FakeElement("button");
  firstShortcut.rect = { left: 836, top: 408, right: 1372, bottom: 448, width: 536, height: 40 };
  const secondShortcut = new FakeElement("button");
  secondShortcut.rect = { left: 836, top: 452, right: 1372, bottom: 492, width: 536, height: 40 };
  shortcutShelf.append(firstShortcut, secondShortcut);
  const nativeControl = new FakeElement("button");
  nativeControl.rect = { left: 1396, top: 9, right: 1424, bottom: 37, width: 28, height: 28 };
  const fileTree = new FakeElement("file-tree-container");
  fileTree.rect = { left: 1191, top: 123, right: 1432, bottom: 900, width: 241, height: 777 };
  fileTree.computedStyle.backgroundColor = "rgb(24, 24, 24)";
  scrollSurface.append(nativeControl);
  scrollSurface.append(fileTree);
  scrollSurface.append(shortcutShelf);
  innerSurface.append(topToolbar, scrollSurface);
  outerSurface.append(innerSurface);
  sidePanel.append(outerSurface);
  nativeContent.append(sidePanel);
  const before = {
    panel: sidePanel.getBoundingClientRect(),
    outer: outerSurface.getBoundingClientRect(),
    inner: innerSurface.getBoundingClientRect(),
    scroll: scrollSurface.getBoundingClientRect(),
    toolbar: topToolbar.getBoundingClientRect(),
    shelf: shortcutShelf.getBoundingClientRect(),
    firstShortcut: firstShortcut.getBoundingClientRect(),
    secondShortcut: secondShortcut.getBoundingClientRect(),
    control: nativeControl.getBoundingClientRect(),
    fileTree: fileTree.getBoundingClientRect()
  };

  const theme = installTheme({ document, window, initialHour: "08", testMode: true, cssText });

  assert.equal(sidePanel.getAttribute("data-prime-knight-native-side-panel"), "true");
  for (const surface of [outerSurface, innerSurface, scrollSurface, topToolbar, shortcutShelf]) {
    assert.equal(surface.getAttribute("data-prime-knight-native-side-panel-cover"), "true");
  }
  assert.equal(fileTree.getAttribute("data-prime-knight-native-side-panel-cover"), "true");
  for (const shortcut of [firstShortcut, secondShortcut]) {
    assert.equal(shortcut.getAttribute("data-prime-knight-native-side-panel-cover"), null);
  }
  assert.equal(nativeControl.getAttribute("data-prime-knight-native-side-panel-cover"), null);
  assert.deepEqual(sidePanel.getBoundingClientRect(), before.panel);
  assert.deepEqual(outerSurface.getBoundingClientRect(), before.outer);
  assert.deepEqual(innerSurface.getBoundingClientRect(), before.inner);
  assert.deepEqual(scrollSurface.getBoundingClientRect(), before.scroll);
  assert.deepEqual(topToolbar.getBoundingClientRect(), before.toolbar);
  assert.deepEqual(shortcutShelf.getBoundingClientRect(), before.shelf);
  assert.deepEqual(firstShortcut.getBoundingClientRect(), before.firstShortcut);
  assert.deepEqual(secondShortcut.getBoundingClientRect(), before.secondShortcut);
  assert.deepEqual(nativeControl.getBoundingClientRect(), before.control);
  assert.deepEqual(fileTree.getBoundingClientRect(), before.fileTree);

  theme.destroy();
  assert.equal(sidePanel.getAttribute("data-prime-knight-native-side-panel"), null);
  for (const surface of [outerSurface, innerSurface, scrollSurface, topToolbar, shortcutShelf]) {
    assert.equal(surface.getAttribute("data-prime-knight-native-side-panel-cover"), null);
  }
  assert.equal(fileTree.getAttribute("data-prime-knight-native-side-panel-cover"), null);
});

test("floating output popover reveals the background without changing native geometry", () => {
  const environment = createFakeEnvironment();
  const { document, window, nativeContent } = environment;
  addCockpitAnchors(environment);
  const passiveWrapper = new FakeElement("div");
  passiveWrapper.rect = { left: 1124, top: 58.5, right: 1440, bottom: 195.5, width: 316, height: 137 };
  passiveWrapper.computedStyle.pointerEvents = "none";
  const interactiveWrapper = new FakeElement("div");
  interactiveWrapper.rect = { left: 1124, top: 58.5, right: 1424, bottom: 195.5, width: 300, height: 137 };
  interactiveWrapper.computedStyle.pointerEvents = "auto";
  const popoverSurface = new FakeElement("div");
  popoverSurface.rect = { left: 1124, top: 58.5, right: 1424, bottom: 195.5, width: 300, height: 137 };
  popoverSurface.computedStyle.backgroundColor = "rgb(45, 45, 45)";
  popoverSurface.computedStyle.position = "relative";
  popoverSurface.computedStyle.overflow = "hidden";
  popoverSurface.computedStyle.borderRadius = "24px";
  const section = new FakeElement("section");
  section.setAttribute("role", "presentation");
  section.rect = { left: 1124, top: 68.5, right: 1424, bottom: 189.5, width: 300, height: 121 };
  const firstAction = new FakeElement("button");
  const secondAction = new FakeElement("button");
  section.append(firstAction, secondAction);
  popoverSurface.append(section);
  interactiveWrapper.append(popoverSurface);
  passiveWrapper.append(interactiveWrapper);
  nativeContent.append(passiveWrapper);
  const before = popoverSurface.getBoundingClientRect();

  const theme = installTheme({ document, window, initialHour: "08", testMode: true, cssText });

  assert.equal(popoverSurface.getAttribute("data-prime-knight-native-output-popover"), "true");
  assert.equal(passiveWrapper.getAttribute("data-prime-knight-native-output-popover"), null);
  assert.equal(interactiveWrapper.getAttribute("data-prime-knight-native-output-popover"), null);
  assert.deepEqual(popoverSurface.getBoundingClientRect(), before);

  theme.destroy();
  assert.equal(popoverSurface.getAttribute("data-prime-knight-native-output-popover"), null);
});

test("empty source popover reveals its background and header with one native action", () => {
  const environment = createFakeEnvironment();
  const { document, window, nativeContent } = environment;
  addCockpitAnchors(environment);
  const passiveWrapper = new FakeElement("div");
  passiveWrapper.rect = { left: 1124, top: 58.5, right: 1440, bottom: 133.5, width: 316, height: 75 };
  passiveWrapper.computedStyle.pointerEvents = "none";
  const interactiveWrapper = new FakeElement("div");
  interactiveWrapper.rect = { left: 1124, top: 58.5, right: 1424, bottom: 133.5, width: 300, height: 75 };
  interactiveWrapper.computedStyle.pointerEvents = "auto";
  const popoverSurface = new FakeElement("div");
  popoverSurface.rect = { left: 1124, top: 58.5, right: 1424, bottom: 133.5, width: 300, height: 75 };
  popoverSurface.computedStyle.backgroundColor = "rgb(45, 45, 45)";
  popoverSurface.computedStyle.position = "relative";
  popoverSurface.computedStyle.overflow = "hidden";
  popoverSurface.computedStyle.borderRadius = "25px";
  const section = new FakeElement("section");
  section.setAttribute("role", "presentation");
  section.rect = { left: 1124, top: 68.5, right: 1424, bottom: 127.5, width: 300, height: 59 };
  const header = new FakeElement("header");
  header.rect = { left: 1124, top: 68.5, right: 1424, bottom: 96.5, width: 300, height: 28 };
  header.computedStyle.backgroundColor = "rgb(45, 45, 45)";
  header.computedStyle.position = "sticky";
  header.append(new FakeElement("button"));
  section.append(header);
  popoverSurface.append(section);
  interactiveWrapper.append(popoverSurface);
  passiveWrapper.append(interactiveWrapper);
  nativeContent.append(passiveWrapper);
  const before = { popover: popoverSurface.getBoundingClientRect(), header: header.getBoundingClientRect() };

  const theme = installTheme({ document, window, initialHour: "08", testMode: true, cssText });

  assert.equal(popoverSurface.getAttribute("data-prime-knight-native-output-popover"), "true");
  assert.equal(header.getAttribute("data-prime-knight-native-output-popover-header"), "true");
  assert.deepEqual(popoverSurface.getBoundingClientRect(), before.popover);
  assert.deepEqual(header.getBoundingClientRect(), before.header);

  theme.destroy();
  assert.equal(popoverSurface.getAttribute("data-prime-knight-native-output-popover"), null);
  assert.equal(header.getAttribute("data-prime-knight-native-output-popover-header"), null);
});

test("expanded floating output popover remains transparent as source groups grow", () => {
  const environment = createFakeEnvironment();
  const { document, window, nativeContent } = environment;
  addCockpitAnchors(environment);
  const passiveWrapper = new FakeElement("div");
  passiveWrapper.rect = { left: 1124, top: 58.5, right: 1440, bottom: 569.5, width: 316, height: 511 };
  passiveWrapper.computedStyle.pointerEvents = "none";
  const interactiveWrapper = new FakeElement("div");
  interactiveWrapper.rect = { left: 1124, top: 58.5, right: 1424, bottom: 569.5, width: 300, height: 511 };
  interactiveWrapper.computedStyle.pointerEvents = "auto";
  const popoverSurface = new FakeElement("div");
  popoverSurface.rect = { left: 1124, top: 58.5, right: 1424, bottom: 569.5, width: 300, height: 511 };
  popoverSurface.computedStyle.backgroundColor = "rgb(45, 45, 45)";
  popoverSurface.computedStyle.position = "relative";
  popoverSurface.computedStyle.overflow = "hidden";
  popoverSurface.computedStyle.borderRadius = "25px";
  const sections = [
    { top: 68.5, bottom: 316.5 },
    { top: 328.5, bottom: 399.5 },
    { top: 411.5, bottom: 563.5 }
  ].map(({ top, bottom }) => {
    const section = new FakeElement("section");
    section.setAttribute("role", "presentation");
    section.rect = { left: 1124, top, right: 1424, bottom, width: 300, height: bottom - top };
    const header = new FakeElement("header");
    header.rect = { left: 1124, top, right: 1424, bottom: top + 28, width: 300, height: 28 };
    header.computedStyle.backgroundColor = "rgb(45, 45, 45)";
    header.computedStyle.position = "sticky";
    header.append(new FakeElement("button"));
    section.append(header, new FakeElement("button"));
    return { section, header };
  });
  popoverSurface.append(...sections.map(({ section }) => section));
  interactiveWrapper.append(popoverSurface);
  passiveWrapper.append(interactiveWrapper);
  nativeContent.append(passiveWrapper);
  const unrelatedHeader = new FakeElement("header");
  unrelatedHeader.rect = { left: 1124, top: 620, right: 1424, bottom: 648, width: 300, height: 28 };
  unrelatedHeader.computedStyle.backgroundColor = "rgb(45, 45, 45)";
  unrelatedHeader.computedStyle.position = "sticky";
  nativeContent.append(unrelatedHeader);

  const theme = installTheme({ document, window, initialHour: "08", testMode: true, cssText });

  assert.equal(popoverSurface.getAttribute("data-prime-knight-native-output-popover"), "true");
  for (const { header } of sections) {
    assert.equal(header.getAttribute("data-prime-knight-native-output-popover-header"), "true");
  }
  assert.equal(unrelatedHeader.getAttribute("data-prime-knight-native-output-popover-header"), null);
  assert.deepEqual(popoverSurface.getBoundingClientRect(), { left: 1124, top: 58.5, right: 1424, bottom: 569.5, width: 300, height: 511 });

  theme.destroy();
  assert.equal(popoverSurface.getAttribute("data-prime-knight-native-output-popover"), null);
  for (const { header } of sections) {
    assert.equal(header.getAttribute("data-prime-knight-native-output-popover-header"), null);
  }
});

test("opening the right side panel still clears the narrowed composer surround", () => {
  const environment = createFakeEnvironment();
  const { document, window, nativeContent } = environment;
  const { composerContainer, composerSurface } = addCockpitAnchors(environment, {
    composer: { left: 252, top: 720, right: 780, bottom: 900, width: 528, height: 180 }
  });
  const sidePanel = new FakeElement("aside");
  sidePanel.rect = { left: 780, top: 0, right: 1440, bottom: 900, width: 660, height: 900 };
  nativeContent.append(sidePanel);
  const bottomRegion = new FakeElement("div");
  bottomRegion.rect = { left: 268, top: 720, right: 764, bottom: 900, width: 496, height: 180 };
  const surroundGradient = new FakeElement("div");
  surroundGradient.rect = { ...bottomRegion.rect };
  surroundGradient.computedStyle.backgroundImage = "linear-gradient(rgb(24, 24, 24), rgb(24, 24, 24))";
  surroundGradient.computedStyle.pointerEvents = "none";
  surroundGradient.computedStyle.position = "absolute";
  bottomRegion.append(surroundGradient);
  nativeContent.append(bottomRegion);
  const before = {
    composer: composerContainer.getBoundingClientRect(),
    surface: composerSurface.getBoundingClientRect(),
    gradient: surroundGradient.getBoundingClientRect()
  };

  const theme = installTheme({ document, window, initialHour: "08", testMode: true, cssText });

  assert.equal(sidePanel.getAttribute("data-prime-knight-native-side-panel"), "true");
  assert.equal(composerSurface.getAttribute("data-prime-knight-native-composer-surface"), "true");
  assert.equal(surroundGradient.getAttribute("data-prime-knight-native-composer-backdrop"), "true");
  assert.deepEqual(composerContainer.getBoundingClientRect(), before.composer);
  assert.deepEqual(composerSurface.getBoundingClientRect(), before.surface);
  assert.deepEqual(surroundGradient.getBoundingClientRect(), before.gradient);

  theme.destroy();
});

test("writing block backdrop reveals the hourly art without changing editor card geometry", () => {
  const environment = createFakeEnvironment();
  const { document, window, nativeContent } = environment;
  addCockpitAnchors(environment);
  const writingSurface = new FakeElement("div");
  writingSurface.rect = { left: 303, top: 20, right: 1039, bottom: 184, width: 736, height: 164 };
  writingSurface.computedStyle.position = "relative";
  writingSurface.computedStyle.overflow = "clip";
  writingSurface.computedStyle.borderRadius = "24px";
  const backdrop = new FakeElement("div");
  backdrop.rect = { ...writingSurface.rect };
  backdrop.computedStyle.position = "absolute";
  backdrop.computedStyle.pointerEvents = "none";
  backdrop.computedStyle.backgroundColor = "rgb(42, 42, 42)";
  backdrop.computedStyle.borderRadius = "24px";
  const editor = new FakeElement("div");
  editor.setAttribute("contenteditable", "true");
  editor.rect = { left: 319, top: 74, right: 1023, bottom: 168, width: 704, height: 94 };
  const editButton = new FakeElement("button");
  editButton.rect = { left: 311, top: 28, right: 383, bottom: 64, width: 72, height: 36 };
  editButton.computedStyle.backgroundColor = "rgb(42, 42, 42)";
  editButton.computedStyle.borderRadius = "24px";
  const copyButton = new FakeElement("button");
  copyButton.rect = { left: 995, top: 28, right: 1031, bottom: 64, width: 36, height: 36 };
  copyButton.computedStyle.backgroundColor = "rgba(0, 0, 0, 0)";
  copyButton.computedStyle.borderRadius = "10px";
  writingSurface.append(backdrop, editor, editButton, copyButton);
  nativeContent.append(writingSurface);
  const unrelatedAction = new FakeElement("button");
  unrelatedAction.rect = { left: 311, top: 220, right: 383, bottom: 256, width: 72, height: 36 };
  unrelatedAction.computedStyle.backgroundColor = "rgb(42, 42, 42)";
  unrelatedAction.computedStyle.borderRadius = "24px";
  nativeContent.append(unrelatedAction);
  const unrelatedBackdrop = new FakeElement("div");
  unrelatedBackdrop.rect = { left: 400, top: 330, right: 900, bottom: 450, width: 500, height: 120 };
  unrelatedBackdrop.computedStyle.position = "absolute";
  unrelatedBackdrop.computedStyle.pointerEvents = "none";
  unrelatedBackdrop.computedStyle.backgroundColor = "rgb(42, 42, 42)";
  nativeContent.append(unrelatedBackdrop);
  const before = {
    surface: writingSurface.getBoundingClientRect(),
    backdrop: backdrop.getBoundingClientRect(),
    editor: editor.getBoundingClientRect(),
    editButton: editButton.getBoundingClientRect(),
    copyButton: copyButton.getBoundingClientRect()
  };

  const theme = installTheme({ document, window, initialHour: "08", testMode: true, cssText });

  assert.equal(backdrop.getAttribute("data-prime-knight-native-writing-backdrop"), "true");
  assert.equal(editButton.getAttribute("data-prime-knight-native-writing-action"), "true");
  assert.equal(copyButton.getAttribute("data-prime-knight-native-writing-action"), null);
  assert.equal(unrelatedAction.getAttribute("data-prime-knight-native-writing-action"), null);
  assert.equal(writingSurface.getAttribute("data-prime-knight-native-writing-backdrop"), null);
  assert.equal(unrelatedBackdrop.getAttribute("data-prime-knight-native-writing-backdrop"), null);
  assert.deepEqual(writingSurface.getBoundingClientRect(), before.surface);
  assert.deepEqual(backdrop.getBoundingClientRect(), before.backdrop);
  assert.deepEqual(editor.getBoundingClientRect(), before.editor);
  assert.deepEqual(editButton.getBoundingClientRect(), before.editButton);
  assert.deepEqual(copyButton.getBoundingClientRect(), before.copyButton);

  theme.destroy();
  assert.equal(backdrop.getAttribute("data-prime-knight-native-writing-backdrop"), null);
  assert.equal(editButton.getAttribute("data-prime-knight-native-writing-action"), null);
});

test("compact join-chat writing card reveals only its full-size passive backdrop", () => {
  const environment = createFakeEnvironment();
  const { document, window, nativeContent } = environment;
  addCockpitAnchors(environment);
  const writingSurface = new FakeElement("div");
  writingSurface.rect = { left: 303, top: 324, right: 1039, bottom: 414, width: 736, height: 90 };
  writingSurface.computedStyle.position = "relative";
  writingSurface.computedStyle.overflow = "clip";
  writingSurface.computedStyle.borderRadius = "24px";
  const backdrop = new FakeElement("div");
  backdrop.rect = { ...writingSurface.rect };
  backdrop.computedStyle.position = "absolute";
  backdrop.computedStyle.pointerEvents = "none";
  backdrop.computedStyle.backgroundColor = "rgb(42, 42, 42)";
  backdrop.computedStyle.borderRadius = "24px";
  const content = new FakeElement("div");
  content.rect = { ...writingSurface.rect };
  content.computedStyle.position = "relative";
  const joinButton = new FakeElement("button");
  const copyButton = new FakeElement("button");
  content.append(joinButton, copyButton);
  const border = new FakeElement("div");
  border.rect = { ...writingSurface.rect };
  border.computedStyle.position = "absolute";
  border.computedStyle.pointerEvents = "none";
  border.computedStyle.borderRadius = "24px";
  writingSurface.append(backdrop, content, border);
  nativeContent.append(writingSurface);
  const unrelatedSurface = new FakeElement("div");
  unrelatedSurface.rect = { left: 303, top: 440, right: 1039, bottom: 530, width: 736, height: 90 };
  unrelatedSurface.computedStyle.position = "relative";
  unrelatedSurface.computedStyle.overflow = "clip";
  unrelatedSurface.computedStyle.borderRadius = "24px";
  const unrelatedBackdrop = new FakeElement("div");
  unrelatedBackdrop.rect = { ...unrelatedSurface.rect };
  unrelatedBackdrop.computedStyle.position = "absolute";
  unrelatedBackdrop.computedStyle.pointerEvents = "none";
  unrelatedBackdrop.computedStyle.backgroundColor = "rgb(42, 42, 42)";
  const unrelatedContent = new FakeElement("div");
  unrelatedContent.append(new FakeElement("button"));
  unrelatedSurface.append(unrelatedBackdrop, unrelatedContent);
  nativeContent.append(unrelatedSurface);
  const before = {
    surface: writingSurface.getBoundingClientRect(),
    backdrop: backdrop.getBoundingClientRect(),
    content: content.getBoundingClientRect()
  };

  const theme = installTheme({ document, window, initialHour: "08", testMode: true, cssText });

  assert.equal(backdrop.getAttribute("data-prime-knight-native-writing-backdrop"), "true");
  assert.equal(border.getAttribute("data-prime-knight-native-writing-backdrop"), null);
  assert.equal(unrelatedBackdrop.getAttribute("data-prime-knight-native-writing-backdrop"), null);
  assert.deepEqual(writingSurface.getBoundingClientRect(), before.surface);
  assert.deepEqual(backdrop.getBoundingClientRect(), before.backdrop);
  assert.deepEqual(content.getBoundingClientRect(), before.content);

  theme.destroy();
  assert.equal(backdrop.getAttribute("data-prime-knight-native-writing-backdrop"), null);
});

test("native code blocks reveal the hourly art without changing code or copy geometry", () => {
  const environment = createFakeEnvironment();
  const { document, window, nativeContent } = environment;
  addCockpitAnchors(environment);
  const blocks = [
    { left: 303, top: 512.5, right: 1039, bottom: 856, width: 736, height: 343.5 },
    { left: 326, top: 741, right: 1039, bottom: 815, width: 713, height: 74 }
  ].map((rect) => {
    const block = new FakeElement("div");
    block.rect = rect;
    block.computedStyle.position = "relative";
    block.computedStyle.overflow = "clip";
    block.computedStyle.borderRadius = "12px";
    block.computedStyle.backgroundColor = "rgba(255, 255, 255, 0.05)";
    const header = new FakeElement("div");
    header.rect = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.top + 35, width: rect.width, height: 35 };
    header.computedStyle.position = "sticky";
    header.computedStyle.backgroundColor = "rgb(24, 24, 24)";
    header.computedStyle.backgroundImage = "linear-gradient(rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.05))";
    header.computedStyle.borderRadius = "12px 12px 0 0";
    const code = new FakeElement("code");
    code.rect = { left: rect.left + 16, top: rect.top + 43, right: rect.right - 16, bottom: rect.bottom - 8, width: rect.width - 32, height: 23 };
    const copyButton = new FakeElement("button");
    copyButton.rect = { left: rect.right - 40, top: rect.top + 8, right: rect.right - 8, bottom: rect.top + 40, width: 32, height: 32 };
    header.append(copyButton);
    block.append(header, code);
    nativeContent.append(block);
    return { block, header, code, copyButton };
  });
  const inlineCodeContainer = new FakeElement("div");
  inlineCodeContainer.rect = { left: 500, top: 500, right: 700, bottom: 532, width: 200, height: 32 };
  inlineCodeContainer.computedStyle.position = "relative";
  inlineCodeContainer.computedStyle.overflow = "clip";
  inlineCodeContainer.computedStyle.borderRadius = "8px";
  inlineCodeContainer.computedStyle.backgroundColor = "rgba(255, 255, 255, 0.05)";
  inlineCodeContainer.append(new FakeElement("code"));
  nativeContent.append(inlineCodeContainer);
  const before = blocks.map(({ block, header, code, copyButton }) => ({
    block: block.getBoundingClientRect(),
    header: header.getBoundingClientRect(),
    code: code.getBoundingClientRect(),
    copyButton: copyButton.getBoundingClientRect()
  }));

  const theme = installTheme({ document, window, initialHour: "08", testMode: true, cssText });

  for (const [index, { block, header, code, copyButton }] of blocks.entries()) {
    assert.equal(block.getAttribute("data-prime-knight-native-code-block"), "true");
    assert.equal(header.getAttribute("data-prime-knight-native-code-block-header"), "true");
    assert.deepEqual(block.getBoundingClientRect(), before[index].block);
    assert.deepEqual(header.getBoundingClientRect(), before[index].header);
    assert.deepEqual(code.getBoundingClientRect(), before[index].code);
    assert.deepEqual(copyButton.getBoundingClientRect(), before[index].copyButton);
  }
  assert.equal(inlineCodeContainer.getAttribute("data-prime-knight-native-code-block"), null);

  theme.destroy();
  for (const { block, header } of blocks) {
    assert.equal(block.getAttribute("data-prime-knight-native-code-block"), null);
    assert.equal(header.getAttribute("data-prime-knight-native-code-block-header"), null);
  }
});

test("partially visible long code block keeps its visible header transparent", () => {
  const environment = createFakeEnvironment();
  const { document, window, nativeContent } = environment;
  addCockpitAnchors(environment);
  const block = new FakeElement("div");
  block.rect = { left: 303, top: 628, right: 1039, bottom: 971.5, width: 736, height: 343.5 };
  block.computedStyle.position = "relative";
  block.computedStyle.overflow = "clip";
  block.computedStyle.borderRadius = "12.5px";
  block.computedStyle.backgroundColor = "rgba(255, 255, 255, 0.05)";
  const header = new FakeElement("div");
  header.rect = { left: 303, top: 628, right: 1039, bottom: 663, width: 736, height: 35 };
  header.computedStyle.position = "sticky";
  header.computedStyle.backgroundColor = "rgb(36, 36, 36)";
  header.computedStyle.backgroundImage = "linear-gradient(rgb(36, 36, 36), rgb(36, 36, 36))";
  const copyButton = new FakeElement("button");
  header.append(copyButton);
  const code = new FakeElement("code");
  code.rect = { left: 319, top: 671, right: 1023, bottom: 955.5, width: 704, height: 284.5 };
  block.append(header, code);
  nativeContent.append(block);
  const offscreenBlock = new FakeElement("div");
  offscreenBlock.rect = { left: 303, top: 930, right: 1039, bottom: 1273.5, width: 736, height: 343.5 };
  offscreenBlock.computedStyle.position = "relative";
  offscreenBlock.computedStyle.overflow = "clip";
  offscreenBlock.computedStyle.borderRadius = "12.5px";
  offscreenBlock.computedStyle.backgroundColor = "rgba(255, 255, 255, 0.05)";
  const offscreenHeader = new FakeElement("div");
  offscreenHeader.rect = { left: 303, top: 930, right: 1039, bottom: 965, width: 736, height: 35 };
  offscreenHeader.computedStyle.position = "sticky";
  offscreenHeader.computedStyle.backgroundColor = "rgb(36, 36, 36)";
  offscreenHeader.append(new FakeElement("button"));
  offscreenBlock.append(offscreenHeader, new FakeElement("code"));
  nativeContent.append(offscreenBlock);
  const before = {
    block: block.getBoundingClientRect(),
    header: header.getBoundingClientRect(),
    code: code.getBoundingClientRect()
  };

  const theme = installTheme({ document, window, initialHour: "08", testMode: true, cssText });

  assert.equal(block.getAttribute("data-prime-knight-native-code-block"), "true");
  assert.equal(header.getAttribute("data-prime-knight-native-code-block-header"), "true");
  assert.equal(offscreenBlock.getAttribute("data-prime-knight-native-code-block"), null);
  assert.equal(offscreenHeader.getAttribute("data-prime-knight-native-code-block-header"), null);
  assert.deepEqual(block.getBoundingClientRect(), before.block);
  assert.deepEqual(header.getBoundingClientRect(), before.header);
  assert.deepEqual(code.getBoundingClientRect(), before.code);

  theme.destroy();
  assert.equal(block.getAttribute("data-prime-knight-native-code-block"), null);
  assert.equal(header.getAttribute("data-prime-knight-native-code-block-header"), null);
});

test("short code block headers become transparent after scrolling into view", () => {
  const environment = createFakeEnvironment();
  const { document, window, listeners, timers, nativeContent } = environment;
  addCockpitAnchors(environment);
  const block = new FakeElement("div");
  block.rect = { left: 303, top: 1040, right: 1039, bottom: 1114, width: 736, height: 74 };
  block.computedStyle.position = "relative";
  block.computedStyle.overflow = "clip";
  block.computedStyle.borderRadius = "12.5px";
  block.computedStyle.backgroundColor = "rgba(255, 255, 255, 0.05)";
  const header = new FakeElement("div");
  header.rect = { left: 303, top: 1040, right: 1039, bottom: 1075, width: 736, height: 35 };
  header.computedStyle.position = "sticky";
  header.computedStyle.backgroundColor = "rgb(24, 24, 24)";
  header.computedStyle.backgroundImage = "linear-gradient(rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.05))";
  header.append(new FakeElement("button"));
  block.append(header, new FakeElement("code"));
  nativeContent.append(block);

  const theme = installTheme({ document, window, initialHour: "08", testMode: true, cssText });

  assert.equal(block.getAttribute("data-prime-knight-native-code-block"), null);
  assert.equal(header.getAttribute("data-prime-knight-native-code-block-header"), null);
  block.rect = { left: 303, top: 390.5, right: 1039, bottom: 464.5, width: 736, height: 74 };
  header.rect = { left: 303, top: 390.5, right: 1039, bottom: 425.5, width: 736, height: 35 };
  listeners.get("scroll")();
  const [timer, callback] = [...timers.entries()][0];
  timers.delete(timer);
  callback();

  assert.equal(block.getAttribute("data-prime-knight-native-code-block"), "true");
  assert.equal(header.getAttribute("data-prime-knight-native-code-block-header"), "true");

  theme.destroy();
  assert.equal(listeners.has("scroll"), false);
});

test("the full-window background and native surface tints remain active on pages without a task composer", () => {
  const environment = createFakeEnvironment();
  const { document, window, nativeContent } = environment;
  const { navigation, composerContainer } = addCockpitAnchors(environment);
  composerContainer.remove();

  const theme = installTheme({ document, window, initialHour: "08", testMode: true, cssText });
  const shell = document.getElementById("prime-knight-shell");
  const nativeFallbackRule = cssText.match(/#prime-knight-shell\[data-prime-knight-layout="native"\][\s\S]*?\{([^}]*)\}/)?.[0] ?? "";

  assert.equal(shell.getAttribute("data-prime-knight-layout"), "native");
  assert.equal(theme.metrics.layoutStatus, "native");
  assert.equal(nativeContent.getAttribute("data-prime-knight-native-surface"), "true");
  assert.equal(navigation.getAttribute("data-prime-knight-native-sidebar"), "true");
  assert.doesNotMatch(nativeFallbackRule, /prime-knight-background|prime-knight-readability-mask/);

  theme.destroy();
});

test("unresolved native anchors fail closed without guessing chamber coordinates", () => {
  const { document, window, nativeContent } = createFakeEnvironment();
  const theme = installTheme({ document, window, initialHour: "08", testMode: true, cssText });
  const shell = document.getElementById("prime-knight-shell");

  assert.equal(shell.getAttribute("data-prime-knight-layout"), "native");
  assert.equal(shell.style.getPropertyValue("--prime-knight-sidebar-right"), "");
  assert.equal(shell.style.getPropertyValue("--prime-knight-composer-top"), "");
  assert.equal(theme.metrics.layoutStatus, "native");
  assert.equal(theme.metrics.sidebar, null);
  assert.equal(theme.metrics.main, null);
  assert.equal(theme.metrics.composer, null);
  assert.equal(nativeContent.style.getPropertyValue("padding"), "");
  assert.equal(nativeContent.style.getPropertyValue("transform"), "");
  theme.destroy();
});

test("sectional shell CSS keeps full-bleed backgrounds visible and hides only obsolete chrome in native fallback", () => {
  for (const name of ["chamber-sidebar", "chamber-main", "chamber-composer"]) {
    assert.match(cssText, new RegExp(`var\\(--prime-knight-frame-${name}\\)`));
  }
  assert.match(cssText, /data-prime-knight-layout="native"[\s\S]*\.prime-knight-chrome/);
  assert.doesNotMatch(cssText, /data-prime-knight-layout="native"[^{}]*\.prime-knight-background/);
  assert.doesNotMatch(cssText, /data-prime-knight-layout="native"[^{}]*\.prime-knight-readability-mask/);
});

test("background-only CSS reveals art through a controlled native surface tint", () => {
  const surfaceRule = cssText.match(/\[data-prime-knight-native-surface="true"\]\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(surfaceRule, /background-color:\s*rgb\([^)]*\/\s*0\.[0-9]+\)\s*!important/);
  assert.doesNotMatch(surfaceRule, /(?:padding|margin|transform|scale|position|z-index)\s*:/);
});

test("sidebar and composer tints preserve readability without layout overrides", () => {
  for (const attribute of ["data-prime-knight-native-sidebar", "data-prime-knight-native-composer-surface"]) {
    const rule = cssText.match(new RegExp(`\\[${attribute}="true"\\]\\s*\\{([^}]*)\\}`))?.[1] ?? "";
    assert.match(rule, /background-color:\s*rgb\([^)]*\/\s*0\.[0-9]+\)\s*!important/);
    assert.doesNotMatch(rule, /(?:padding|margin|transform|scale|position|z-index|width|height)\s*:/);
  }
});

test("composer surround CSS removes only the native gradient paint", () => {
  const rule = cssText.match(/\[data-prime-knight-native-composer-backdrop="true"\]\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(rule, /background-color:\s*transparent\s*!important/);
  assert.match(rule, /background-image:\s*none\s*!important/);
  assert.doesNotMatch(rule, /(?:padding|margin|transform|scale|position|z-index|width|height|display|opacity)\s*:/);
});

test("right side panel CSS changes only native background paint", () => {
  const panelRule = cssText.match(/\[data-prime-knight-native-side-panel="true"\]\s*\{([^}]*)\}/)?.[1] ?? "";
  const coverRule = cssText.match(/\[data-prime-knight-native-side-panel-cover="true"\]\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(panelRule, /background-color:\s*rgb\([^)]*\/\s*0\.[0-9]+\)\s*!important/);
  assert.match(coverRule, /background-color:\s*transparent\s*!important/);
  assert.match(coverRule, /--trees-bg-override:\s*transparent\s*!important/);
  for (const rule of [panelRule, coverRule]) {
    assert.doesNotMatch(rule, /(?:padding|margin|transform|scale|position|z-index|width|height|display|opacity|pointer-events)\s*:/);
  }
});

test("floating output popover CSS changes only its native background paint", () => {
  const rule = cssText.match(/\[data-prime-knight-native-output-popover="true"\]\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(rule, /background-color:\s*rgb\([^)]*\/\s*0\.[0-9]+\)\s*!important/);
  assert.doesNotMatch(rule, /(?:padding|margin|transform|scale|position|z-index|width|height|display|opacity|pointer-events)\s*:/);
});

test("floating output popover header CSS clears only duplicate header paint", () => {
  const headerRule = cssText.match(/\[data-prime-knight-native-output-popover-header="true"\]\s*\{([^}]*)\}/)?.[1] ?? "";
  const beforeRule = cssText.match(/\[data-prime-knight-native-output-popover-header="true"\]::before\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(headerRule, /background-color:\s*transparent\s*!important/);
  assert.match(beforeRule, /background-color:\s*transparent\s*!important/);
  for (const rule of [headerRule, beforeRule]) {
    assert.doesNotMatch(rule, /(?:padding|margin|transform|scale|position|z-index|width|height|display|opacity|pointer-events)\s*:/);
  }
});

test("writing block backdrop CSS changes only the opaque native card paint", () => {
  const rule = cssText.match(/\[data-prime-knight-native-writing-backdrop="true"\]\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(rule, /background-color:\s*rgb\([^)]*\/\s*0\.[0-9]+\)\s*!important/);
  assert.doesNotMatch(rule, /(?:padding|margin|transform|scale|position|z-index|width|height|display|opacity|pointer-events)\s*:/);
});

test("writing block action CSS changes only the opaque pill paint", () => {
  const rule = cssText.match(/\[data-prime-knight-native-writing-action="true"\]\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(rule, /background-color:\s*rgb\([^)]*\/\s*0\.[0-9]+\)\s*!important/);
  assert.doesNotMatch(rule, /(?:padding|margin|transform|scale|position|z-index|width|height|display|opacity|pointer-events|border-radius)\s*:/);
});

test("native code block CSS clears only the container paint", () => {
  const rule = cssText.match(/\[data-prime-knight-native-code-block="true"\]\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(rule, /background-color:\s*transparent\s*!important/);
  assert.doesNotMatch(rule, /(?:padding|margin|transform|scale|position|z-index|width|height|display|opacity|pointer-events)\s*:/);
});

test("native code block header CSS clears only its duplicate paint", () => {
  const rule = cssText.match(/\[data-prime-knight-native-code-block-header="true"\]\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(rule, /background-color:\s*transparent\s*!important/);
  assert.match(rule, /background-image:\s*none\s*!important/);
  assert.doesNotMatch(rule, /(?:padding|margin|transform|scale|position|z-index|width|height|display|opacity|pointer-events|border-radius)\s*:/);
});

test("hourly background covers the complete viewport instead of only the main chamber", () => {
  const backgroundRule = cssText.match(/\.prime-knight-background,\s*\.prime-knight-readability-mask\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(backgroundRule, /top:\s*0/);
  assert.match(backgroundRule, /right:\s*0/);
  assert.match(backgroundRule, /bottom:\s*0/);
  assert.match(backgroundRule, /left:\s*0/);
  assert.match(backgroundRule, /width:\s*100vw/);
  assert.match(backgroundRule, /height:\s*100vh/);
  assert.doesNotMatch(backgroundRule, /--prime-knight-(?:main|sidebar|composer)/);
});

test("window, resize, and SPA structure changes coalesce into one viewport refresh", () => {
  const { document, window, listeners, observers, mutationObservers, timers, nativeContent } = createFakeEnvironment();
  const theme = installTheme({
    document,
    window,
    manifest: [{ hour: "08", positionWide: "78% 48%", positionStandard: "72% 50%", positionCompact: "center top", overlayOpacity: 0.5 }],
    initialHour: "08",
    testMode: true,
    cssText
  });
  const before = theme.metrics.refreshCount;
  listeners.get("resize")();
  listeners.get("resize")();
  observers[0].callback();
  mutationObservers[0].callback();
  assert.equal(mutationObservers[0].target, nativeContent);
  assert.deepEqual(mutationObservers[0].options, { childList: true, subtree: true });
  assert.equal(theme.metrics.refreshCount, before);
  assert.equal(timers.size, 1);
  const [timer, callback] = [...timers.entries()][0];
  timers.delete(timer);
  callback();
  assert.equal(theme.metrics.refreshCount, before + 1);
  theme.destroy();
  assert.equal(timers.size, 0);
  assert.equal(mutationObservers[0].disconnected, true);
});
