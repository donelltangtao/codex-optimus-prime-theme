// Target filtering and CDP lifecycle mechanics are adapted from
// Kerwin0624/codex-black-hole-skin (MIT); see THIRD_PARTY_NOTICES.md.

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const CDP_ID_PATTERN = /^[A-Za-z0-9._-]{1,200}$/;
const APP_HOST = "codex";
const APP_HOST_ALTERNATE = "-";
const GLOBAL_KEY = "__CODEX_PRIME_KNIGHT_THEME__";
const VERIFICATION_MODE_FLAG = "--verify";
const HOURS_REGEX = /^(?:[01][0-9]|2[0-3])$/;
const VIEWPORT_REGEX = /^(\d+)x(\d+)$/i;

function validPort(port) {
  return Number.isInteger(port) && port >= 1024 && port <= 65535;
}

function parseViewport(value) {
  const match = String(value ?? "").match(VIEWPORT_REGEX);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return null;
  return { width, height, devicePixelRatio: 1 };
}

export function parseArgs(argv = process.argv.slice(2)) {
  if (!Array.isArray(argv)) throw new TypeError("parseArgs requires an argv array");

  let verifyMode = false;
  let verifyHour = null;
  let viewport = null;
  let outputDirectory = "artifacts/theme-matrix";

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === VERIFICATION_MODE_FLAG) {
      verifyMode = true;
      continue;
    }

    if (arg === "--verify-hour" || arg === "--hour") {
      const value = argv[i + 1];
      if (value == null) throw new Error("--verify-hour requires an hour value");
      if (!HOURS_REGEX.test(String(value))) throw new Error("--verify-hour must be 00-23");
      verifyHour = String(value);
      i += 1;
      continue;
    }

    if (arg === "--viewport") {
      const value = argv[i + 1];
      if (value == null) throw new Error("--viewport requires WIDTHxHEIGHT");
      viewport = parseViewport(value);
      if (!viewport) throw new Error("--viewport must be WIDTHxHEIGHT with positive integers");
      i += 1;
      continue;
    }

    if (arg === "--out-dir") {
      const value = argv[i + 1];
      if (value == null || String(value).trim() === "") {
        throw new Error("--out-dir requires a non-empty directory path");
      }
      outputDirectory = String(value);
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

    if (!verifyMode && (verifyHour !== null || viewport !== null || outputDirectory !== "artifacts/theme-matrix")) {
      throw new Error("verification mode is required for --verify-hour, --viewport, or --out-dir");
    }

  if (!verifyMode) return { verifyMode: false, verifyHour: null, viewport: null, outputDirectory: null };
  return { verifyMode: true, verifyHour, viewport, outputDirectory };
}

function assertAppTarget(target) {
  let appUrl;
  try {
    appUrl = new URL(target?.url);
  } catch {
    throw new Error("Rejected a non-app page target");
  }
  const isAlternateHost = appUrl.hostname === APP_HOST_ALTERNATE;
  if (!isAlternateHost && appUrl.hostname !== APP_HOST) {
    throw new Error("Rejected a non-app page target");
  }
  if (appUrl.protocol !== "app:"
    || appUrl.port
    || appUrl.username
    || appUrl.password
    || appUrl.hash) {
    throw new Error("Rejected a non-app page target");
  }
  if (!isAlternateHost && (appUrl.pathname !== "/" || appUrl.search || target.url !== "app://codex/")) {
    throw new Error("Rejected a non-app page target");
  }
  if (isAlternateHost) {
    if (appUrl.pathname !== "/index.html" || appUrl.search || target.url !== "app://-/index.html") {
      throw new Error("Rejected a non-app page target");
    }
  }
  if (
    target?.type !== "page"
    || typeof target.id !== "string"
    || !CDP_ID_PATTERN.test(target.id)
  ) {
    throw new Error("Rejected a non-app page target");
  }
}

export function validatedDebuggerUrl(target, port) {
  if (!validPort(port)) throw new TypeError("Invalid debugger port");
  assertAppTarget(target);

  let debuggerUrl;
  try {
    debuggerUrl = new URL(target.webSocketDebuggerUrl);
  } catch {
    throw new Error("Rejected an invalid debugger URL");
  }
  if (!LOOPBACK_HOSTS.has(debuggerUrl.hostname)) {
    throw new Error("Rejected a debugger URL outside loopback");
  }
  if (Number(debuggerUrl.port) !== port) {
    throw new Error("Rejected a debugger URL on the wrong port");
  }
  if (
    debuggerUrl.protocol !== "ws:"
    || debuggerUrl.username
    || debuggerUrl.password
    || debuggerUrl.search
    || debuggerUrl.hash
    || debuggerUrl.pathname !== `/devtools/page/${target.id}`
  ) {
    throw new Error("Rejected an invalid debugger URL");
  }
  return debuggerUrl.href;
}

export async function discoverTarget({ port, fetch: fetchImpl = globalThis.fetch } = {}) {
  if (!validPort(port)) throw new TypeError("Invalid debugger port");
  if (typeof fetchImpl !== "function") throw new TypeError("discoverTarget requires fetch");

  const response = await fetchImpl(`http://127.0.0.1:${port}/json/list`, { redirect: "error" });
  if (!response?.ok) throw new Error(`CDP target discovery failed with HTTP ${response?.status ?? "unknown"}`);
  const targets = await response.json();
  if (!Array.isArray(targets)) throw new Error("CDP target list was not an array");

  let rejection = null;
  for (const target of targets) {
    try {
      const debuggerUrl = validatedDebuggerUrl(target, port);
      return { target, debuggerUrl };
    } catch (error) {
      rejection = error;
    }
  }
  throw rejection ?? new Error("No loopback Codex app page target was found");
}

export class CdpSession {
  constructor(target, port, {
    WebSocket: WebSocketImpl = globalThis.WebSocket,
    commandTimeoutMs = 10_000,
    openTimeoutMs = 5_000
  } = {}) {
    if (typeof WebSocketImpl !== "function") throw new TypeError("A WebSocket implementation is required");
    this.target = target;
    this.commandTimeoutMs = commandTimeoutMs;
    this.openTimeoutMs = openTimeoutMs;
    this.ws = new WebSocketImpl(validatedDebuggerUrl(target, port));
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.closed = false;
  }

  async open() {
    this.ws.addEventListener("message", (event) => this.onMessage(event));
    this.ws.addEventListener("close", () => this.finishClose("CDP socket closed"));
    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("CDP WebSocket open timed out")), this.openTimeoutMs);
        this.ws.addEventListener("open", () => {
          clearTimeout(timeout);
          resolve();
        }, { once: true });
        this.ws.addEventListener("error", () => {
          clearTimeout(timeout);
          reject(new Error("CDP WebSocket open failed"));
        }, { once: true });
        this.ws.addEventListener("close", () => {
          clearTimeout(timeout);
          reject(new Error("CDP socket closed during bootstrap"));
        }, { once: true });
      });
      this.ws.addEventListener("error", () => this.close());
      await this.send("Runtime.enable");
      await this.send("Page.enable");
      return this;
    } catch (error) {
      this.close();
      throw error;
    }
  }

  finishClose(message) {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error(message));
    }
    this.pending.clear();
  }

  onMessage(event) {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      this.close();
      return;
    }
    if (message === null || typeof message !== "object" || Array.isArray(message)) {
      this.close();
      return;
    }
    if (Number.isInteger(message.id)) {
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      clearTimeout(waiter.timeout);
      this.pending.delete(message.id);
      if (message.error) {
        waiter.reject(new Error(`${message.error.message ?? "CDP command failed"} (${message.error.code ?? "unknown"})`));
      } else {
        waiter.resolve(message.result);
      }
      return;
    }
    if (typeof message.method !== "string") return;
    for (const listener of this.listeners.get(message.method) ?? []) {
      try { listener(message.params ?? {}); } catch {}
    }
  }

  on(method, listener) {
    if (typeof method !== "string" || typeof listener !== "function") {
      throw new TypeError("Invalid CDP event listener");
    }
    const listeners = this.listeners.get(method) ?? new Set();
    listeners.add(listener);
    this.listeners.set(method, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(method);
    };
  }

  send(method, params = {}, timeoutMs = this.commandTimeoutMs) {
    if (this.closed) return Promise.reject(new Error("CDP session is closed"));
    if (typeof method !== "string" || method.length === 0) {
      return Promise.reject(new TypeError("Invalid CDP method"));
    }
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async evaluate(expression, timeoutMs = this.commandTimeoutMs) {
    if (typeof expression !== "string" || expression.length === 0) {
      throw new TypeError("Renderer expression must be non-empty");
    }
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: false
    }, timeoutMs);
    if (result?.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "unknown error";
      throw new Error(`Renderer evaluation failed: ${detail}`);
    }
    return result?.result?.value;
  }

  close() {
    this.finishClose("CDP session closed");
    try { this.ws.close(); } catch {}
  }
}

function assertSession(session) {
  if (!session || typeof session.evaluate !== "function") {
    throw new TypeError("A CDP session with evaluate() is required");
  }
}

export async function applyPayload(session, payload) {
  assertSession(session);
  if (typeof payload !== "string" || payload.trim().length === 0) {
    throw new TypeError("Payload must be a non-empty string");
  }
  return session.evaluate(payload);
}

function isFiniteChamberBox(box) {
  return Boolean(
    box &&
    Number.isFinite(box.left) && box.left >= 0 &&
    Number.isFinite(box.top) && box.top >= 0 &&
    Number.isFinite(box.width) && box.width > 0 &&
    Number.isFinite(box.height) && box.height > 0
  );
}

export function hasAnchoredCockpitMetrics(metrics) {
  return Boolean(
    metrics?.layoutStatus === "anchored" &&
    isFiniteChamberBox(metrics.sidebar) &&
    isFiniteChamberBox(metrics.main) &&
    isFiniteChamberBox(metrics.composer)
  );
}

function safeChamberBox(box) {
  if (!box || typeof box !== "object") return null;
  const values = [box.left, box.top, box.width, box.height];
  if (!values.every(Number.isFinite)) return null;
  return { left: box.left, top: box.top, width: box.width, height: box.height };
}

export function hasFullWindowBackground(background) {
  if (!background || background.visible !== true) return false;
  const values = [
    background.left,
    background.top,
    background.width,
    background.height,
    background.viewportWidth,
    background.viewportHeight
  ];
  if (!values.every(Number.isFinite)) return false;
  return Math.abs(background.left) <= 2
    && Math.abs(background.top) <= 2
    && Math.abs(background.width - background.viewportWidth) <= 2
    && Math.abs(background.height - background.viewportHeight) <= 2;
}

export function cockpitVerificationSummary(result) {
  return {
    active: result?.active === true,
    ownedNodeCount: Number.isInteger(result?.ownedNodeCount) ? result.ownedNodeCount : null,
    runtimePass: result?.runtimePass === true,
    pass: result?.pass === true,
    backgroundVisible: hasFullWindowBackground(result?.background),
    layoutStatus: result?.metrics?.layoutStatus === "anchored" ? "anchored" : "native",
    sidebar: safeChamberBox(result?.metrics?.sidebar),
    main: safeChamberBox(result?.metrics?.main),
    composer: safeChamberBox(result?.metrics?.composer)
  };
}

export async function verifyPayload(session) {
  assertSession(session);
  const result = await session.evaluate(`(() => {
    const theme = window.${GLOBAL_KEY};
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
      active: Boolean(theme && typeof theme.destroy === "function" && theme.metrics),
      ownedNodeCount: document.querySelectorAll('[data-prime-knight-owned="true"]').length,
      background,
      metrics: theme?.metrics ?? null
    };
  })()`);
  const runtimePass = Boolean(result?.active && result?.ownedNodeCount === 2 && result?.metrics);
  const pass = Boolean(runtimePass && hasFullWindowBackground(result?.background));
  return { ...result, runtimePass, pass };
}

export function earlyPayloadFor(payload, generation) {
  if (typeof payload !== "string" || payload.trim().length === 0) {
    throw new TypeError("Payload must be a non-empty string");
  }
  if (typeof generation !== "string" || generation.length === 0) {
    throw new TypeError("Early payload generation must be non-empty");
  }
  return `(() => {
    const globalKey = "${GLOBAL_KEY}";
    const generation = ${JSON.stringify(generation)};
    window[globalKey]?.destroy?.();
    let observer = null;
    let timeout = null;
    let active = true;
    let api = null;
    const detach = () => {
      observer?.disconnect();
      observer = null;
      document.removeEventListener?.('DOMContentLoaded', install);
      if (timeout !== null) clearTimeout(timeout);
      timeout = null;
    };
    const metrics = Object.freeze({ phase: "waiting", generation });
    const destroy = () => {
      if (!active) return;
      active = false;
      detach();
      if (window[globalKey] === api) delete window[globalKey];
    };
    api = {};
    Object.defineProperties(api, {
      destroy: { enumerable: true, value: destroy },
      metrics: { enumerable: true, value: metrics }
    });
    Object.freeze(api);
    Object.defineProperty(window, globalKey, {
      configurable: true,
      enumerable: false,
      writable: false,
      value: api
    });
    const install = () => {
      if (!active || window[globalKey] !== api) { destroy(); return true; }
      if (!document.documentElement || !document.body || !document.getElementById('root')) return false;
      destroy();
      ${payload};
      return true;
    };
    if (install()) return;
    document.addEventListener?.('DOMContentLoaded', install, { once: true });
    if (typeof MutationObserver === "function" && document.documentElement) {
      observer = new MutationObserver(install);
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
    timeout = setTimeout(destroy, 10000);
  })()`;
}

export async function watchPayload(session, payload) {
  assertSession(session);
  if (typeof session.send !== "function" || typeof session.on !== "function") {
    throw new TypeError("A watchable CDP session is required");
  }
  if (typeof payload !== "string" || payload.trim().length === 0) {
    throw new TypeError("Payload must be a non-empty string");
  }

  const earlyPayload = earlyPayloadFor(payload, "watch");
  let identifier = null;
  let unsubscribe = null;
  let currentApplyAttempted = false;
  try {
    const registration = await session.send("Page.addScriptToEvaluateOnNewDocument", { source: earlyPayload });
    identifier = registration?.identifier ?? null;
    unsubscribe = session.on("Page.loadEventFired", () => {
      if (identifier || session.closed) return;
      void applyPayload(session, earlyPayload).catch(() => {});
    });
    currentApplyAttempted = true;
    await applyPayload(session, earlyPayload);
  } catch (error) {
    if (currentApplyAttempted) await removePayload(session).catch(() => {});
    try { unsubscribe?.(); } catch {}
    if (identifier && !session.closed) {
      await session.send("Page.removeScriptToEvaluateOnNewDocument", { identifier }).catch(() => {});
    }
    throw error;
  }

  let stopped = false;
  return async () => {
    if (stopped) return;
    stopped = true;
    unsubscribe?.();
    if (identifier && !session.closed) {
      await session.send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
    }
  };
}

export async function removePayload(session) {
  assertSession(session);
  return session.evaluate(`(() => {
    const theme = window.${GLOBAL_KEY};
    if (typeof theme?.destroy === "function") theme.destroy();
    document.querySelectorAll('[data-prime-knight-owned="true"]').forEach((node) => node.remove());
    document.getElementById('root')?.removeAttribute('data-prime-knight-content-layer');
    for (const name of document.documentElement?.getAttributeNames?.() ?? []) {
      if (name.startsWith('data-prime-knight-')) document.documentElement.removeAttribute(name);
    }
    delete window.${GLOBAL_KEY};
    return !window.${GLOBAL_KEY}
      && document.querySelectorAll('[data-prime-knight-owned="true"]').length === 0;
  })()`);
}
