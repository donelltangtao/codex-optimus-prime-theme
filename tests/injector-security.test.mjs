import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

import {
  CdpSession,
  applyPayload,
  cockpitVerificationSummary,
  discoverTarget,
  earlyPayloadFor,
  removePayload,
  verifyPayload,
  watchPayload,
  validatedDebuggerUrl
} from "../src/runtime/injector.mjs";

function appTarget(overrides = {}) {
  return {
    type: "page",
    url: "app://codex/",
    id: "abc",
    webSocketDebuggerUrl: "ws://127.0.0.1:9341/devtools/page/abc",
    ...overrides
  };
}

test("accepts only a loopback app page target", () => {
  assert.equal(validatedDebuggerUrl(appTarget(), 9341), "ws://127.0.0.1:9341/devtools/page/abc");
  assert.throws(
    () => validatedDebuggerUrl(appTarget({ webSocketDebuggerUrl: "ws://192.168.1.2:9341/devtools/page/abc" }), 9341),
    /loopback/
  );
  assert.throws(
    () => validatedDebuggerUrl(appTarget({ url: "https://example.com" }), 9341),
    /app page/
  );
});

test("requires the exact app://codex/ target URL", () => {
  for (const url of [
    "app://user@codex/",
    "app://@codex/",
    "app://codex/settings",
    "app://codex//",
    "app://codex:9341/",
    "app://codex/?debug=true",
    "app://codex/#settings"
  ]) {
    assert.throws(() => validatedDebuggerUrl(appTarget({ url }), 9341), /app page/);
  }
});

test("accepts the current ChatGPT-style app target URL", () => {
  assert.equal(
    validatedDebuggerUrl(appTarget({ url: "app://-/index.html" }), 9341),
    "ws://127.0.0.1:9341/devtools/page/abc"
  );
  assert.throws(
    () => validatedDebuggerUrl(appTarget({ url: "app://-/index.html?initialRoute=%2Favatar-overlay" }), 9341),
    /app page/
  );
});

test("rejects debugger URLs with credentials, query strings, or fragments", () => {
  for (const webSocketDebuggerUrl of [
    "ws://user@127.0.0.1:9341/devtools/page/abc",
    "ws://127.0.0.1:9341/devtools/page/abc?token=secret",
    "ws://127.0.0.1:9341/devtools/page/abc#fragment"
  ]) {
    assert.throws(() => validatedDebuggerUrl(appTarget({ webSocketDebuggerUrl }), 9341), /debugger URL/);
  }
});

test("rejects debugger endpoints on the wrong port, protocol, or page id", () => {
  assert.throws(
    () => validatedDebuggerUrl(appTarget({ webSocketDebuggerUrl: "ws://127.0.0.1:9342/devtools/page/abc" }), 9341),
    /port/
  );
  assert.throws(
    () => validatedDebuggerUrl(appTarget({ webSocketDebuggerUrl: "wss://127.0.0.1:9341/devtools/page/abc" }), 9341),
    /debugger URL/
  );
  assert.throws(
    () => validatedDebuggerUrl(appTarget({ webSocketDebuggerUrl: "ws://127.0.0.1:9341/devtools/page/other" }), 9341),
    /debugger URL/
  );
  assert.throws(() => validatedDebuggerUrl(appTarget({ type: "worker" }), 9341), /app page/);
});

test("discovers a validated target through the fixed loopback list endpoint", async () => {
  const requested = [];
  const target = appTarget();
  const result = await discoverTarget({
    port: 9341,
    fetch: async (url, options) => {
      requested.push({ url, options });
      return { ok: true, json: async () => [appTarget({ type: "worker" }), target] };
    }
  });

  assert.deepEqual(result, { target, debuggerUrl: target.webSocketDebuggerUrl });
  assert.deepEqual(requested, [{
    url: "http://127.0.0.1:9341/json/list",
    options: { redirect: "error" }
  }]);
});

test("discovery skips avatar overlays and selects the exact ChatGPT workspace target", async () => {
  const overlay = appTarget({
    id: "overlay",
    url: "app://-/index.html?initialRoute=%2Favatar-overlay",
    webSocketDebuggerUrl: "ws://127.0.0.1:9341/devtools/page/overlay"
  });
  const workspace = appTarget({
    id: "workspace",
    url: "app://-/index.html",
    webSocketDebuggerUrl: "ws://127.0.0.1:9341/devtools/page/workspace"
  });
  const result = await discoverTarget({
    port: 9341,
    fetch: async () => ({ ok: true, json: async () => [overlay, workspace] })
  });
  assert.deepEqual(result, { target: workspace, debuggerUrl: workspace.webSocketDebuggerUrl });
});

test("discovery rejects malformed responses instead of following alternate endpoints", async () => {
  await assert.rejects(
    discoverTarget({ port: 9341, fetch: async () => ({ ok: false, status: 503 }) }),
    /503/
  );
  await assert.rejects(
    discoverTarget({ port: 9341, fetch: async () => ({ ok: true, json: async () => ({}) }) }),
    /target list/
  );
  await assert.rejects(
    discoverTarget({ port: 9341, fetch: async () => ({ ok: true, json: async () => [appTarget({ url: "https://example.com" })] }) }),
    /app page/
  );
});

test("CDP session ignores stray ids and resolves out-of-order responses correctly", async () => {
  let socket;
  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.listeners = new Map();
      this.requests = [];
      socket = this;
      queueMicrotask(() => this.emit("open", {}));
    }

    addEventListener(name, listener) {
      const listeners = this.listeners.get(name) ?? [];
      listeners.push(listener);
      this.listeners.set(name, listeners);
    }

    send(frame) {
      const request = JSON.parse(frame);
      this.requests.push(request);
      if (request.method === "Runtime.enable" || request.method === "Page.enable") {
        queueMicrotask(() => this.respond(request.id, { enabled: request.method }));
      }
    }

    close() {
      this.emit("close", {});
    }

    emit(name, event) {
      for (const listener of this.listeners.get(name) ?? []) listener(event);
    }

    respond(id, result) {
      this.emit("message", { data: JSON.stringify({ id, result }) });
    }
  }

  const session = await new CdpSession(appTarget(), 9341, { WebSocket: FakeWebSocket }).open();
  const first = session.send("Runtime.evaluate", { expression: "1 + 1" });
  const second = session.send("Runtime.evaluate", { expression: "2 + 2" });
  const [firstRequest, secondRequest] = socket.requests.slice(-2);
  socket.respond(9999, { stray: true });
  socket.respond(secondRequest.id, { value: 4 });
  socket.respond(firstRequest.id, { value: 2 });

  assert.deepEqual(await first, { value: 2 });
  assert.deepEqual(await second, { value: 4 });
  session.close();
});

test("CDP bootstrap closes on a protocol error", async () => {
  let socket;
  class ProtocolErrorWebSocket {
    constructor() {
      socket = this;
      this.listeners = new Map();
      this.closeCount = 0;
      queueMicrotask(() => this.emit("open", {}));
    }
    addEventListener(name, listener) {
      const listeners = this.listeners.get(name) ?? [];
      listeners.push(listener);
      this.listeners.set(name, listeners);
    }
    send(frame) {
      const request = JSON.parse(frame);
      queueMicrotask(() => this.emit("message", {
        data: JSON.stringify({ id: request.id, error: { code: -32000, message: "denied" } })
      }));
    }
    close() { this.closeCount += 1; this.emit("close", {}); }
    emit(name, event) { for (const listener of this.listeners.get(name) ?? []) listener(event); }
  }

  const session = new CdpSession(appTarget(), 9341, { WebSocket: ProtocolErrorWebSocket });
  await assert.rejects(session.open(), /denied/);
  assert.equal(session.closed, true);
  assert.equal(socket.closeCount, 1);
  assert.equal(session.pending.size, 0);
});

test("CDP bootstrap closes when Page.enable times out", async () => {
  let socket;
  class TimeoutWebSocket {
    constructor() {
      socket = this;
      this.listeners = new Map();
      this.closeCount = 0;
      queueMicrotask(() => this.emit("open", {}));
    }
    addEventListener(name, listener) {
      const listeners = this.listeners.get(name) ?? [];
      listeners.push(listener);
      this.listeners.set(name, listeners);
    }
    send(frame) {
      const request = JSON.parse(frame);
      if (request.method === "Runtime.enable") {
        queueMicrotask(() => this.emit("message", { data: JSON.stringify({ id: request.id, result: {} }) }));
      }
    }
    close() { this.closeCount += 1; this.emit("close", {}); }
    emit(name, event) { for (const listener of this.listeners.get(name) ?? []) listener(event); }
  }

  const session = new CdpSession(appTarget(), 9341, {
    WebSocket: TimeoutWebSocket,
    commandTimeoutMs: 5
  });
  await assert.rejects(session.open(), /Page\.enable/);
  assert.equal(session.closed, true);
  assert.equal(socket.closeCount, 1);
  assert.equal(session.pending.size, 0);
});

test("CDP bootstrap rejects pending commands when the socket closes", async () => {
  class ClosingWebSocket {
    constructor() {
      this.listeners = new Map();
      queueMicrotask(() => this.emit("open", {}));
    }
    addEventListener(name, listener) {
      const listeners = this.listeners.get(name) ?? [];
      listeners.push(listener);
      this.listeners.set(name, listeners);
    }
    send() { queueMicrotask(() => this.emit("close", {})); }
    close() { this.emit("close", {}); }
    emit(name, event) { for (const listener of this.listeners.get(name) ?? []) listener(event); }
  }

  const session = new CdpSession(appTarget(), 9341, { WebSocket: ClosingWebSocket });
  await assert.rejects(session.open(), /socket closed/);
  assert.equal(session.closed, true);
  assert.equal(session.pending.size, 0);
});

test("CDP bootstrap closes when the WebSocket open times out", async () => {
  let socket;
  class NeverOpenWebSocket {
    constructor() { socket = this; this.listeners = new Map(); this.closeCount = 0; }
    addEventListener(name, listener) {
      const listeners = this.listeners.get(name) ?? [];
      listeners.push(listener);
      this.listeners.set(name, listeners);
    }
    send() {}
    close() { this.closeCount += 1; }
  }

  const session = new CdpSession(appTarget(), 9341, { WebSocket: NeverOpenWebSocket, openTimeoutMs: 5 });
  await assert.rejects(session.open(), /open timed out/);
  assert.equal(session.closed, true);
  assert.equal(socket.closeCount, 1);
});

test("apply, verify, and remove use renderer evaluation without widening ownership", async () => {
  const expressions = [];
  const session = {
    async evaluate(expression) {
      expressions.push(expression);
      if (expression === "payload-source") return { installed: true };
      if (expression.includes("ownedNodeCount")) {
        return {
          active: true,
          ownedNodeCount: 2,
          background: {
            left: 0,
            top: 0,
            width: 1586,
            height: 992,
            viewportWidth: 1586,
            viewportHeight: 992,
            visible: true
          },
          metrics: {
            hour: "08",
            layoutStatus: "anchored",
            sidebar: { left: 0, top: 0, width: 252, height: 992 },
            main: { left: 252, top: 0, width: 1334, height: 800 },
            composer: { left: 252, top: 800, width: 1334, height: 192 }
          }
        };
      }
      return true;
    }
  };

  assert.deepEqual(await applyPayload(session, "payload-source"), { installed: true });
  assert.deepEqual(await verifyPayload(session), {
    active: true,
    ownedNodeCount: 2,
    background: {
      left: 0,
      top: 0,
      width: 1586,
      height: 992,
      viewportWidth: 1586,
      viewportHeight: 992,
      visible: true
    },
    metrics: {
      hour: "08",
      layoutStatus: "anchored",
      sidebar: { left: 0, top: 0, width: 252, height: 992 },
      main: { left: 252, top: 0, width: 1334, height: 800 },
      composer: { left: 252, top: 800, width: 1334, height: 192 }
    },
    runtimePass: true,
    pass: true
  });
  assert.equal(await removePayload(session), true);
  assert.equal(expressions.length, 3);
  assert.match(expressions[2], /__CODEX_PRIME_KNIGHT_THEME__/);
  assert.match(expressions[2], /destroy/);
  assert.doesNotMatch(expressions[2], /DREAM_SKIN/);
});

test("renderer verification accepts background-only pages and rejects an absent or partial background", async () => {
  const metrics = { hour: "20", layoutStatus: "native", sidebar: null, main: null, composer: null };
  const backgrounds = [
    {
      left: 0,
      top: 0,
      width: 1586,
      height: 992,
      viewportWidth: 1586,
      viewportHeight: 992,
      visible: true,
      expected: true
    },
    null,
    {
      left: 240,
      top: 0,
      width: 1346,
      height: 992,
      viewportWidth: 1586,
      viewportHeight: 992,
      visible: true
    }
  ];
  for (const background of backgrounds) {
    const session = {
      async evaluate() {
        return { active: true, ownedNodeCount: 2, metrics, background };
      }
    };
    const result = await verifyPayload(session);
    assert.equal(result.runtimePass, true);
    assert.equal(result.pass, background?.expected === true);
  }
});

test("watcher diagnostics expose only numeric cockpit state and no renderer content", () => {
  const summary = cockpitVerificationSummary({
    active: true,
    ownedNodeCount: 2,
    background: {
      left: 0,
      top: 0,
      width: 1586,
      height: 992,
      viewportWidth: 1586,
      viewportHeight: 992,
      visible: true
    },
    pass: false,
    metrics: {
      hour: "20",
      layoutStatus: "native",
      sidebar: null,
      main: null,
      composer: null,
      secret: "private chat text"
    },
    documentText: "private project name"
  });
  assert.deepEqual(summary, {
    active: true,
    ownedNodeCount: 2,
    runtimePass: false,
    pass: false,
    backgroundVisible: true,
    layoutStatus: "native",
    sidebar: null,
    main: null,
    composer: null
  });
  assert.doesNotMatch(JSON.stringify(summary), /private|secret|project/i);
});

test("watch registers the payload for navigation and removes only its registration", async () => {
  const sent = [];
  const evaluated = [];
  const listeners = new Map();
  const session = {
    closed: false,
    on(method, listener) {
      listeners.set(method, listener);
      return () => listeners.delete(method);
    },
    async send(method, params) {
      sent.push({ method, params });
      if (method === "Page.addScriptToEvaluateOnNewDocument") return { identifier: "prime-knight-script" };
      return {};
    },
    async evaluate(expression) {
      evaluated.push(expression);
      return true;
    }
  };

  const stop = await watchPayload(session, "payload-source");
  listeners.get("Page.loadEventFired")?.({});
  await stop();

  assert.deepEqual(evaluated, [sent[0].params.source]);
  assert.notEqual(evaluated[0], "payload-source");
  assert.match(evaluated[0], /document\.getElementById\('root'\)/);
  assert.deepEqual(sent, [
    {
      method: "Page.addScriptToEvaluateOnNewDocument",
      params: { source: earlyPayloadFor("payload-source", "watch") }
    },
    { method: "Page.removeScriptToEvaluateOnNewDocument", params: { identifier: "prime-knight-script" } }
  ]);
  assert.equal(listeners.has("Page.loadEventFired"), false);
});

test("watch rolls back registration and listeners if setup fails", async () => {
  for (const failure of ["add", "listener", "apply"]) {
    const sent = [];
    let unsubscribed = 0;
    const session = {
      closed: false,
      on() {
        if (failure === "listener") throw new Error("listener failed");
        return () => { unsubscribed += 1; };
      },
      async send(method, params) {
        sent.push({ method, params });
        if (failure === "add" && method === "Page.addScriptToEvaluateOnNewDocument") {
          throw new Error("add failed");
        }
        return method === "Page.addScriptToEvaluateOnNewDocument" ? { identifier: `id-${failure}` } : {};
      },
      async evaluate() {
        if (failure === "apply") throw new Error("apply failed");
        return true;
      }
    };

    await assert.rejects(watchPayload(session, "payload-source"), new RegExp(`${failure} failed`));
    const removals = sent.filter(({ method }) => method === "Page.removeScriptToEvaluateOnNewDocument");
    assert.equal(removals.length, failure === "add" ? 0 : 1, `${failure} rollback registration`);
    assert.equal(unsubscribed, failure === "apply" ? 1 : 0, `${failure} rollback listener`);
  }
});

test("watch compensates renderer state when the current apply response is lost", async () => {
  for (const state of ["early", "installed"]) {
    const rootAttributes = new Set();
    const nativeAttributes = new Set();
    const ownedNodes = [];
    const documentListeners = new Map();
    const document = {
      documentElement: {
        getAttributeNames: () => [...rootAttributes],
        removeAttribute: (name) => rootAttributes.delete(name)
      },
      body: state === "installed" ? {} : null,
      nativeRoot: state === "installed" ? {
        setAttribute: (name) => nativeAttributes.add(name),
        removeAttribute: (name) => nativeAttributes.delete(name)
      } : null,
      __owned: ownedNodes,
      getElementById(id) { return id === "root" ? this.nativeRoot : null; },
      querySelectorAll() { return ownedNodes.filter((node) => !node.removed); },
      addEventListener(name, listener) { documentListeners.set(name, listener); },
      removeEventListener(name, listener) {
        if (documentListeners.get(name) === listener) documentListeners.delete(name);
      }
    };
    const window = {};
    const context = vm.createContext({
      window,
      document,
      MutationObserver: class { observe() {} disconnect() {} },
      setTimeout: () => 1,
      clearTimeout() {}
    });
    const installedPayload = `(() => {
      const owned = { removed: false, remove() { this.removed = true; } };
      document.__owned.push(owned);
      document.documentElement.__unused = true;
      document.documentElement.getAttributeNames = () => ["data-prime-knight-mode"];
      document.documentElement.removeAttribute = (name) => {
        if (name === "data-prime-knight-mode") document.documentElement.getAttributeNames = () => [];
      };
      document.getElementById("root").setAttribute("data-prime-knight-content-layer", "true");
      const metrics = Object.freeze({ phase: "installed" });
      const api = Object.freeze({
        destroy() { window.__destroyCalled = true; },
        metrics
      });
      Object.defineProperty(window, "__CODEX_PRIME_KNIGHT_THEME__", {
        configurable: true, value: api
      });
    })()`;
    const sent = [];
    let listenerActive = false;
    let evaluations = 0;
    const session = {
      closed: false,
      on() {
        listenerActive = true;
        return () => { listenerActive = false; };
      },
      async send(method, params) {
        sent.push({ method, params });
        return method === "Page.addScriptToEvaluateOnNewDocument" ? { identifier: `lost-${state}` } : {};
      },
      async evaluate(expression) {
        evaluations += 1;
        const result = vm.runInContext(expression, context);
        if (evaluations === 1) throw new Error(`${state} response lost`);
        return result;
      }
    };

    await assert.rejects(watchPayload(session, installedPayload), new RegExp(`${state} response lost`));
    assert.equal(evaluations, 2, `${state} cleanup evaluation`);
    assert.equal("__CODEX_PRIME_KNIGHT_THEME__" in window, false, `${state} global cleanup`);
    assert.equal(document.querySelectorAll('[data-prime-knight-owned="true"]').length, 0, `${state} DOM cleanup`);
    assert.equal(nativeAttributes.has("data-prime-knight-content-layer"), false, `${state} content attribute cleanup`);
    assert.equal(document.documentElement.getAttributeNames().some((name) => name.startsWith("data-prime-knight-")), false);
    assert.equal(listenerActive, false, `${state} listener rollback`);
    assert.deepEqual(sent.map(({ method }) => method), [
      "Page.addScriptToEvaluateOnNewDocument",
      "Page.removeScriptToEvaluateOnNewDocument"
    ]);
    if (state === "installed") assert.equal(window.__destroyCalled, true);
  }
});

test("watch leaves a no-root current document with only its self-cleaning API global", async () => {
  let observerCallback = null;
  const listeners = new Map();
  const rootAttributes = new Map();
  const document = {
    documentElement: {
      getAttributeNames: () => [...rootAttributes.keys()],
      removeAttribute: (name) => rootAttributes.delete(name)
    },
    body: null,
    nativeRoot: null,
    getElementById(id) { return id === "root" ? this.nativeRoot : null; },
    querySelectorAll() { return []; },
    addEventListener(name, listener) { listeners.set(name, listener); },
    removeEventListener(name, listener) {
      if (listeners.get(name) === listener) listeners.delete(name);
    }
  };
  const window = {};
  const context = vm.createContext({
    window,
    document,
    MutationObserver: class {
      constructor(callback) { observerCallback = callback; }
      observe() {}
      disconnect() {}
    },
    setTimeout: () => 1,
    clearTimeout() {}
  });
  const installedPayload = `(() => {
    window.__payloadRuns = (window.__payloadRuns || 0) + 1;
    const metrics = Object.freeze({ phase: "installed" });
    let api;
    api = Object.freeze({
      destroy() { if (window.__CODEX_PRIME_KNIGHT_THEME__ === api) delete window.__CODEX_PRIME_KNIGHT_THEME__; },
      metrics
    });
    Object.defineProperty(window, "__CODEX_PRIME_KNIGHT_THEME__", {
      configurable: true, value: api
    });
  })()`;
  const watchSession = {
    closed: false,
    on() { return () => {}; },
    async send(method) {
      return method === "Page.addScriptToEvaluateOnNewDocument" ? { identifier: "vm-watch" } : {};
    },
    async evaluate(expression) { return vm.runInContext(expression, context); }
  };
  const stopWatch = await watchPayload(watchSession, installedPayload);
  const globalsBefore = Object.getOwnPropertyNames(window).filter((name) => name.includes("PRIME_KNIGHT"));
  assert.deepEqual(globalsBefore, ["__CODEX_PRIME_KNIGHT_THEME__"]);
  assert.deepEqual(Object.keys(window.__CODEX_PRIME_KNIGHT_THEME__).sort(), ["destroy", "metrics"]);
  assert.equal(Object.isFrozen(window.__CODEX_PRIME_KNIGHT_THEME__), true);
  assert.equal(Object.isFrozen(window.__CODEX_PRIME_KNIGHT_THEME__.metrics), true);
  assert.equal(window.__payloadRuns, undefined);

  document.body = {};
  document.nativeRoot = { removeAttribute() {} };
  observerCallback();
  assert.equal(window.__payloadRuns, 1);
  assert.deepEqual(
    Object.getOwnPropertyNames(window).filter((name) => name.includes("PRIME_KNIGHT")),
    ["__CODEX_PRIME_KNIGHT_THEME__"]
  );
  assert.equal(window.__CODEX_PRIME_KNIGHT_THEME__.metrics.phase, "installed");

  await removePayload({ evaluate: async (expression) => vm.runInContext(expression, context) });
  await stopWatch();
  assert.equal(Object.getOwnPropertyNames(window).some((name) => name.includes("PRIME_KNIGHT")), false);
});

test("early navigation payload waits for the native root without an extra state key", () => {
  const source = earlyPayloadFor("payload-source", "fixture-generation");

  assert.match(source, /document\.getElementById\('root'\)/);
  assert.match(source, /MutationObserver/);
  assert.match(source, /payload-source/);
  assert.match(source, /__CODEX_PRIME_KNIGHT_THEME__/);
  assert.doesNotMatch(source, /__CODEX_PRIME_KNIGHT_EARLY_GENERATION__/);
  assert.doesNotMatch(source, /DREAM_SKIN/);
});
