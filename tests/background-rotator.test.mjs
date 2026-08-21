import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { createHourlyRotator } from "../src/background/rotator.mjs";
import { installTheme } from "../src/theme/install-theme.mjs";

const cssText = await fs.readFile("src/theme/prime-knight.css", "utf8");

function rows() {
  return Array.from({ length: 24 }, (_, hour) => {
    const key = String(hour).padStart(2, "0");
    return {
      hour: key,
      src: `assets/backgrounds/${key}.webp`,
      positionWide: `${70 + (hour % 10)}% 50%`,
      positionStandard: `${60 + (hour % 10)}% 50%`,
      positionCompact: "center top",
      overlayOpacity: 0.4
    };
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  assert.fail("condition did not become true");
}

test("start shows the system hour, preloads its successor, and schedules one buffered boundary", async () => {
  const current = new Date(2026, 7, 18, 5, 59, 59, 900);
  const loaded = [];
  const shown = [];
  const scheduled = [];
  const rotator = createHourlyRotator({
    now: () => current,
    schedule: (callback, delay) => {
      scheduled.push({ callback, delay });
      return `timer-${scheduled.length}`;
    },
    cancel: () => {},
    load: async (row) => {
      loaded.push(row.hour);
      return row.src;
    },
    show: async (row, context) => shown.push([row.hour, context.loaded]),
    manifest: rows()
  });

  await rotator.start();
  await Promise.resolve();

  assert.deepEqual(shown, [["05", "assets/backgrounds/05.webp"]]);
  assert.deepEqual(loaded, ["05", "06"]);
  assert.deepEqual(scheduled.map(({ delay }) => delay), [125]);
  assert.equal(rotator.getState().activeHour, "05");
  assert.equal(rotator.getState().pendingHour, null);
  assert.equal(rotator.getState().nextBoundaryAt, current.getTime() + 125);
});

test("wake resync jumps to system hour instead of replaying timers", async () => {
  let current = new Date(2026, 7, 18, 5, 59, 59, 900);
  const shown = [];
  const cancelled = [];
  const rotator = createHourlyRotator({
    now: () => current,
    schedule: () => "boundary",
    cancel: (timer) => cancelled.push(timer),
    load: async (row) => row.src,
    show: async (row) => shown.push(row.hour),
    manifest: rows()
  });
  await rotator.start();
  current = new Date(2026, 7, 18, 10, 3, 0, 0);

  await rotator.resync("visibilitychange");

  assert.deepEqual(shown, ["05", "10"]);
  assert.deepEqual(cancelled, ["boundary"]);
  assert.equal(rotator.getState().activeHour, "10");
});

test("same-hour resync does not mark a completed preload pending again", async () => {
  const current = new Date(2026, 7, 18, 5, 15, 0, 0);
  const rotator = createHourlyRotator({
    now: () => current,
    schedule: () => "boundary",
    cancel: () => {},
    load: async (row) => row.src,
    show: async () => {},
    manifest: rows()
  });
  await rotator.start();
  await Promise.resolve();
  assert.equal(rotator.getState().pendingHour, null);

  await rotator.resync("focus");

  assert.equal(rotator.getState().activeHour, "05");
  assert.equal(rotator.getState().pendingHour, null);
});

test("failed next image keeps the previous hour", async () => {
  let current = new Date(2026, 7, 18, 19, 59, 59, 900);
  const shown = [];
  const rotator = createHourlyRotator({
    now: () => current,
    schedule: () => "boundary",
    cancel: () => {},
    manifest: rows(),
    load: async (row) => {
      if (row.hour === "20") throw new Error("broken asset");
      return row.src;
    },
    show: async (row) => shown.push(row.hour)
  });
  await rotator.start();
  current = new Date(2026, 7, 18, 20, 0, 0, 25);

  await rotator.resync("hour-boundary");

  assert.deepEqual(shown, ["19"]);
  assert.equal(rotator.getState().activeHour, "19");
  assert.equal(rotator.getState().pendingHour, null);
  assert.match(rotator.getState().lastError, /broken asset/);
});

test("a boundary is scheduled before a slow load and a crossed-hour load cannot commit", async () => {
  let current = new Date(2026, 7, 18, 5, 59, 59, 900);
  const hour05 = deferred();
  const hour06Shown = deferred();
  const scheduled = [];
  const shown = [];
  const rotator = createHourlyRotator({
    now: () => current,
    schedule: (callback, delay) => {
      scheduled.push({ callback, delay });
      return `boundary-${scheduled.length}`;
    },
    cancel: () => {},
    manifest: rows(),
    load: (row) => row.hour === "05" ? hour05.promise : Promise.resolve(row.src),
    show: async (row) => {
      shown.push(row.hour);
      if (row.hour === "06") hour06Shown.resolve();
    }
  });
  const starting = rotator.start();
  assert.deepEqual(scheduled.map(({ delay }) => delay), [125]);
  current = new Date(2026, 7, 18, 6, 0, 0, 10);

  hour05.resolve("assets/backgrounds/05.webp");
  await starting;
  assert.deepEqual(shown, []);
  assert.equal(rotator.getState().activeHour, null);

  current = new Date(2026, 7, 18, 6, 0, 0, 25);
  scheduled[0].callback();
  await hour06Shown.promise;
  await waitFor(() => rotator.getState().activeHour === "06");

  assert.deepEqual(shown, ["06"]);
  assert.equal(rotator.getState().activeHour, "06");
});

test("a crossed-hour show cannot mutate presentation before the boundary resync", async () => {
  let current = new Date(2026, 7, 18, 5, 59, 59, 900);
  const hour05 = deferred();
  const hour05Entered = deferred();
  const hour06Shown = deferred();
  const scheduled = [];
  const presented = [];
  const rotator = createHourlyRotator({
    now: () => current,
    schedule: (callback) => {
      scheduled.push(callback);
      return `boundary-${scheduled.length}`;
    },
    cancel: () => {},
    manifest: rows(),
    load: async (row) => row.src,
    show: async (row, context) => {
      if (row.hour === "05") {
        hour05Entered.resolve();
        await hour05.promise;
      }
      if (context.signal.aborted || !context.isCurrent()) return;
      presented.push(row.hour);
      if (row.hour === "06") hour06Shown.resolve();
    }
  });
  const starting = rotator.start();
  await hour05Entered.promise;
  current = new Date(2026, 7, 18, 6, 0, 0, 10);

  hour05.resolve();
  await starting;
  assert.deepEqual(presented, []);
  assert.equal(rotator.getState().activeHour, null);

  current = new Date(2026, 7, 18, 6, 0, 0, 25);
  scheduled[0]();
  await hour06Shown.promise;
  await waitFor(() => rotator.getState().activeHour === "06");
  assert.deepEqual(presented, ["06"]);
  assert.equal(rotator.getState().activeHour, "06");
});

test("a newer resync aborts an older show before the new hour is presented", async () => {
  let current = new Date(2026, 7, 18, 5, 0, 0, 0);
  const hour05 = deferred();
  const hour05Entered = deferred();
  const presented = [];
  let oldSignal;
  const rotator = createHourlyRotator({
    now: () => current,
    schedule: () => "boundary",
    cancel: () => {},
    manifest: rows(),
    load: async (row) => row.src,
    show: async (row, context) => {
      if (row.hour === "05") {
        oldSignal = context.signal;
        hour05Entered.resolve();
        await hour05.promise;
      }
      if (context.signal.aborted || !context.isCurrent()) return;
      presented.push(row.hour);
    }
  });
  const starting = rotator.start();
  await hour05Entered.promise;
  current = new Date(2026, 7, 18, 10, 0, 0, 0);

  const resyncing = rotator.resync("focus");
  assert.equal(oldSignal.aborted, true);
  hour05.resolve();
  await Promise.all([starting, resyncing]);

  assert.deepEqual(presented, ["10"]);
  assert.equal(rotator.getState().activeHour, "10");
});

test("stop aborts a show that has already entered and prevents presentation mutation", async () => {
  const hour05 = deferred();
  const hour05Entered = deferred();
  const presented = [];
  const cancelled = [];
  let signal;
  const rotator = createHourlyRotator({
    now: () => new Date(2026, 7, 18, 5, 0, 0, 0),
    schedule: () => "boundary",
    cancel: (timer) => cancelled.push(timer),
    manifest: rows(),
    load: async (row) => row.src,
    show: async (row, context) => {
      signal = context.signal;
      hour05Entered.resolve();
      await hour05.promise;
      if (!context.signal.aborted && context.isCurrent()) presented.push(row.hour);
    }
  });
  const starting = rotator.start();
  await hour05Entered.promise;

  rotator.stop();
  assert.equal(signal.aborted, true);
  hour05.resolve();
  await starting;

  assert.deepEqual(presented, []);
  assert.equal(rotator.getState().activeHour, null);
  assert.equal(rotator.getState().pendingHour, null);
  assert.equal(rotator.getState().nextBoundaryAt, null);
  assert.deepEqual(cancelled, ["boundary"]);
});

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.attributes = new Map();
    this.childNodes = [];
    this.parentNode = null;
    this.className = "";
    this.id = "";
    const properties = new Map();
    this.style = {
      setProperty: (name, value) => properties.set(name, String(value)),
      getPropertyValue: (name) => properties.get(name) ?? "",
      removeProperty: (name) => properties.delete(name)
    };
    const classes = new Set();
    this.classList = {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name)
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

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  getAttributeNames() { return [...this.attributes.keys()]; }
  querySelector(selector) { return findAll(this, selector)[0] ?? null; }
}

function findAll(root, selector) {
  const match = selector.match(/^\[([^=]+)="([^"]+)"\]$/);
  const found = [];
  const visit = (node) => {
    if (match && node.getAttribute(match[1]) === match[2]) found.push(node);
    for (const child of node.childNodes) visit(child);
  };
  visit(root);
  return found;
}

function fakeThemeEnvironment({ reducedMotion = false } = {}) {
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
    querySelectorAll: (selector) => findAll(root, selector),
    getElementById: (id) => {
      const visit = (node) => {
        if (node.id === id) return node;
        for (const child of node.childNodes) {
          const match = visit(child);
          if (match) return match;
        }
        return null;
      };
      return visit(root);
    }
  };
  const images = [];
  const revoked = [];
  const timers = new Map();
  let nextTimer = 1;
  class FakeImage {
    constructor() { images.push(this); }
    set src(value) { this.currentSrc = value; }
    succeed() { this.onload?.(); }
    fail() { this.onerror?.(); }
  }
  const window = {
    innerWidth: 1440,
    innerHeight: 900,
    devicePixelRatio: 2,
    addEventListener() {},
    removeEventListener() {},
    setTimeout: (callback, delay) => {
      const id = nextTimer++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    matchMedia: () => ({ matches: reducedMotion }),
    Image: FakeImage,
    URL: { revokeObjectURL: (url) => revoked.push(url) }
  };
  return { document, window, images, timers, revoked };
}

test("setHour loads the inactive layer, crossfades for 1200ms, then releases the old layer", async () => {
  const { document, window, images, timers } = fakeThemeEnvironment();
  const manifest = rows();
  const theme = installTheme({ document, window, manifest, initialHour: "08", cssText });
  const layerA = document.querySelectorAll('[data-prime-knight-layer="background-a"]')[0];
  const layerB = document.querySelectorAll('[data-prime-knight-layer="background-b"]')[0];
  assert.equal(images[0].currentSrc, "assets/backgrounds/08.webp");
  images[0].succeed();
  await Promise.resolve();
  assert.equal(layerB.classList.contains("is-visible"), true);
  assert.match(layerB.style.getPropertyValue("--prime-knight-background-image"), /08\.webp/);

  const switching = theme.setHour("09");
  assert.equal(images[1].currentSrc, "assets/backgrounds/09.webp");
  assert.equal(layerB.classList.contains("is-visible"), true);
  images[1].succeed();
  await switching;

  assert.equal(layerA.classList.contains("is-visible"), true);
  assert.equal(layerB.classList.contains("is-visible"), false);
  assert.match(layerA.style.getPropertyValue("--prime-knight-background-image"), /09\.webp/);
  assert.equal(timers.size, 1);
  const [{ callback, delay }] = timers.values();
  assert.equal(delay, 1200);
  assert.match(layerB.style.getPropertyValue("--prime-knight-background-image"), /08\.webp/);

  callback();
  assert.equal(layerB.style.getPropertyValue("--prime-knight-background-image"), "");
});

test("reduced motion releases the prior layer immediately", async () => {
  const { document, window, images, timers } = fakeThemeEnvironment({ reducedMotion: true });
  const theme = installTheme({ document, window, manifest: rows(), initialHour: "08", cssText });
  const layerB = document.querySelectorAll('[data-prime-knight-layer="background-b"]')[0];
  images[0].succeed();
  await Promise.resolve();

  const switching = theme.setHour("09");
  images[1].succeed();
  await switching;

  assert.equal(timers.size, 0);
  assert.equal(layerB.style.getPropertyValue("--prime-knight-background-image"), "");
});

test("a failed background load preserves the active object URL", async () => {
  const { document, window, revoked } = fakeThemeEnvironment();
  const theme = installTheme({
    document,
    window,
    manifest: rows(),
    initialHour: "08",
    cssText,
    loadBackground: (row) => {
      if (row.hour === "09") throw new Error("broken object URL");
      return `blob:prime-knight-${row.hour}`;
    }
  });
  const active = document.querySelectorAll('[data-prime-knight-layer="background-b"]')[0];

  await assert.rejects(theme.setHour("09"), /broken object URL/);

  assert.equal(theme.metrics.hour, "08");
  assert.match(active.style.getPropertyValue("--prime-knight-background-image"), /blob:prime-knight-08/);
  assert.equal(active.classList.contains("is-visible"), true);
  assert.deepEqual(revoked, []);

  theme.destroy();
  assert.deepEqual(revoked, ["blob:prime-knight-08"]);
});

test("initial browser-image failure retains synchronous presentation metadata and navy fallback", async () => {
  const { document, window, images } = fakeThemeEnvironment();
  const theme = installTheme({ document, window, manifest: rows(), initialHour: "08", cssText });
  const shell = document.body.childNodes.find((node) => node.id === "prime-knight-shell");
  const layerA = document.querySelectorAll('[data-prime-knight-layer="background-a"]')[0];
  const layerB = document.querySelectorAll('[data-prime-knight-layer="background-b"]')[0];

  assert.equal(images[0].currentSrc, "assets/backgrounds/08.webp");
  assert.equal(document.documentElement.getAttribute("data-prime-knight-mode"), "standard");
  assert.equal(shell.style.getPropertyValue("--prime-knight-fit"), "cover");
  assert.equal(shell.style.getPropertyValue("--prime-knight-position"), "68% 50%");
  assert.equal(shell.style.getPropertyValue("--prime-knight-overlay"), "0.4");
  assert.equal(layerA.classList.contains("is-visible"), true);
  assert.equal(layerA.style.getPropertyValue("--prime-knight-background-image"), "");

  images[0].fail();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(theme.metrics.hour, "08");
  assert.equal(document.documentElement.getAttribute("data-prime-knight-mode"), "standard");
  assert.equal(shell.style.getPropertyValue("--prime-knight-position"), "68% 50%");
  assert.equal(layerA.classList.contains("is-visible"), true);
  assert.equal(layerB.classList.contains("is-visible"), false);
  assert.equal(layerA.style.getPropertyValue("--prime-knight-background-image"), "");
  assert.equal(layerB.style.getPropertyValue("--prime-knight-background-image"), "");
});

test("setHour honors an AbortSignal after browser image loading", async () => {
  const { document, window, images } = fakeThemeEnvironment();
  const theme = installTheme({ document, window, manifest: rows(), initialHour: "08", cssText });
  const layerB = document.querySelectorAll('[data-prime-knight-layer="background-b"]')[0];
  images[0].succeed();
  await Promise.resolve();
  const controller = new AbortController();

  const switching = theme.setHour("09", { signal: controller.signal });
  controller.abort();
  images[1].succeed();

  assert.equal(await switching, null);
  assert.equal(theme.metrics.hour, "08");
  assert.equal(layerB.classList.contains("is-visible"), true);
  assert.match(layerB.style.getPropertyValue("--prime-knight-background-image"), /08\.webp/);
});

test("default browser loading settles promptly on abort without image completion", async () => {
  const { document, window, images } = fakeThemeEnvironment();
  const theme = installTheme({ document, window, manifest: rows(), initialHour: "08", cssText });
  const layerB = document.querySelectorAll('[data-prime-knight-layer="background-b"]')[0];
  images[0].succeed();
  await Promise.resolve();
  const controller = new AbortController();
  let settled = false;
  let result;

  const switching = theme.setHour("09", { signal: controller.signal });
  const pendingImage = images[1];
  void switching.then((value) => {
    settled = true;
    result = value;
  });
  controller.abort();
  await waitFor(() => settled);

  assert.equal(result, null);
  assert.equal(pendingImage.currentSrc, "");
  assert.equal(pendingImage.onload, null);
  assert.equal(pendingImage.onerror, null);
  assert.equal(theme.metrics.hour, "08");
  assert.equal(layerB.classList.contains("is-visible"), true);
  assert.match(layerB.style.getPropertyValue("--prime-knight-background-image"), /08\.webp/);
});

test("setHour rechecks current-hour context after browser image loading", async () => {
  const { document, window, images } = fakeThemeEnvironment();
  const theme = installTheme({ document, window, manifest: rows(), initialHour: "08", cssText });
  const layerB = document.querySelectorAll('[data-prime-knight-layer="background-b"]')[0];
  images[0].succeed();
  await Promise.resolve();
  let current = true;

  const switching = theme.setHour("09", { isCurrent: () => current });
  current = false;
  images[1].succeed();

  assert.equal(await switching, null);
  assert.equal(theme.metrics.hour, "08");
  assert.equal(layerB.classList.contains("is-visible"), true);
  assert.match(layerB.style.getPropertyValue("--prime-knight-background-image"), /08\.webp/);
});

test("setHour revokes a blob resource that resolves after abort", async () => {
  const { document, window, revoked } = fakeThemeEnvironment();
  const lateBlob = deferred();
  const theme = installTheme({
    document,
    window,
    manifest: rows(),
    initialHour: "08",
    cssText,
    loadBackground: (row) => row.hour === "08" ? "blob:prime-knight-08" : lateBlob.promise
  });
  const controller = new AbortController();
  const switching = theme.setHour("09", { signal: controller.signal });

  controller.abort();
  lateBlob.resolve("blob:prime-knight-09");

  assert.equal(await switching, null);
  assert.equal(theme.metrics.hour, "08");
  assert.deepEqual(revoked, ["blob:prime-knight-09"]);
  theme.destroy();
  assert.deepEqual(revoked, ["blob:prime-knight-09", "blob:prime-knight-08"]);
});

test("a late setHour load cannot replace the newest layer or survive destroy", async () => {
  const { document, window, images } = fakeThemeEnvironment();
  const theme = installTheme({ document, window, manifest: rows(), initialHour: "08", cssText });
  const initial = images[0];
  const newest = theme.setHour("10");
  images[1].succeed();
  await newest;

  initial.succeed();
  await Promise.resolve();
  assert.equal(theme.metrics.hour, "10");

  const late = theme.setHour("11");
  theme.destroy();
  images[2].succeed();
  assert.equal(await late, null);
  assert.equal(document.querySelectorAll('[data-prime-knight-owned="true"]').length, 0);
});
