import { hourKey, millisecondsToNextHour, nextHourKey } from "./clock.mjs";

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function assertFunction(value, name) {
  if (typeof value !== "function") throw new TypeError(`createHourlyRotator requires ${name}`);
}

function releaseLoaded(value) {
  if (typeof value?.release === "function") value.release();
}

/**
 * Rotates a validated hourly manifest from the injected system clock.
 * Loading and presentation stay injected so this module remains offline and
 * deterministic under tests.
 */
export function createHourlyRotator({ now, schedule, cancel, load, show, manifest } = {}) {
  assertFunction(now, "now");
  assertFunction(schedule, "schedule");
  assertFunction(cancel, "cancel");
  assertFunction(load, "load");
  assertFunction(show, "show");
  if (!Array.isArray(manifest)) throw new TypeError("createHourlyRotator requires manifest");

  const rowsByHour = new Map(manifest.map((row) => [row.hour, row]));
  let activeHour = null;
  let pendingHour = null;
  let pendingLoad = null;
  let lastError = null;
  let nextBoundaryAt = null;
  let boundaryTimer = null;
  let generation = 0;
  let running = false;
  let activeController = null;
  let preload = null;
  let showQueue = Promise.resolve();

  function getState() {
    return Object.freeze({ activeHour, pendingHour, lastError, nextBoundaryAt });
  }

  function clearBoundary() {
    if (boundaryTimer !== null) cancel(boundaryTimer);
    boundaryTimer = null;
    nextBoundaryAt = null;
  }

  function beginLoad(row, controller) {
    let loading;
    try {
      loading = load(row, { signal: controller.signal });
    } catch (error) {
      loading = Promise.reject(error);
    }
    const request = {
      controller,
      discarded: false,
      hour: row.hour,
      promise: null,
      settled: false
    };
    request.promise = Promise.resolve(loading)
      .then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }))
      .then((result) => {
        request.settled = true;
        return result;
      });
    pendingLoad = request;
    pendingHour = row.hour;
    return request;
  }

  function finishPending(request) {
    if (pendingLoad !== request) return;
    pendingLoad = null;
    pendingHour = null;
  }

  function discardPreload() {
    if (preload === null) return;
    const discarded = preload;
    preload = null;
    discarded.discarded = true;
    discarded.controller.abort();
    finishPending(discarded);
    void discarded.promise.then((result) => {
      if (result.ok) releaseLoaded(result.value);
    });
  }

  function operationIsCurrent(token, desiredHour, controller) {
    return running
      && generation === token
      && activeController === controller
      && !controller.signal.aborted
      && hourKey(now()) === desiredHour;
  }

  function preloadNext(token, hour, operationController) {
    if (!operationIsCurrent(token, hour, operationController)) return;
    const next = nextHourKey(hour);
    const row = rowsByHour.get(next);
    if (!row || preload?.hour === next) return;

    discardPreload();
    const request = beginLoad(row, new AbortController());
    preload = request;
    void request.promise.then((result) => {
      finishPending(request);
      if (request.discarded || preload !== request) return;
      if (!operationIsCurrent(token, hour, operationController)) return;
      if (!result.ok && !request.controller.signal.aborted) lastError = errorMessage(result.error);
    });
  }

  async function queuedShow(token, desiredHour, row, loaded, controller) {
    const isCurrent = () => operationIsCurrent(token, desiredHour, controller);
    const turn = showQueue.then(async () => {
      if (!isCurrent()) {
        releaseLoaded(loaded);
        return false;
      }
      await show(row, Object.freeze({ signal: controller.signal, loaded, isCurrent }));
      return isCurrent();
    });
    showQueue = turn.catch(() => {});
    return turn;
  }

  async function switchTo(token, desiredHour, controller) {
    const row = rowsByHour.get(desiredHour);
    if (!row) {
      if (operationIsCurrent(token, desiredHour, controller)) lastError = `Missing manifest hour ${desiredHour}`;
      return;
    }

    const request = preload?.hour === desiredHour ? preload : beginLoad(row, controller);
    if (request === preload) {
      pendingLoad = request;
      pendingHour = desiredHour;
      preload = null;
      controller.signal.addEventListener("abort", () => request.controller.abort(), { once: true });
    }
    const result = await request.promise;
    finishPending(request);
    if (!operationIsCurrent(token, desiredHour, controller)) {
      if (result.ok) releaseLoaded(result.value);
      return;
    }
    if (!result.ok) {
      if (!controller.signal.aborted) lastError = errorMessage(result.error);
      return;
    }

    try {
      const shown = await queuedShow(token, desiredHour, row, result.value, controller);
      if (!shown || !operationIsCurrent(token, desiredHour, controller)) return;
      activeHour = desiredHour;
      lastError = null;
      preloadNext(token, desiredHour, controller);
    } catch (error) {
      if (operationIsCurrent(token, desiredHour, controller)) lastError = errorMessage(error);
    }
  }

  function scheduleBoundary(token, sampledAt) {
    if (!running || token !== generation) return;
    const delay = millisecondsToNextHour(sampledAt) + 25;
    nextBoundaryAt = sampledAt.getTime() + delay;
    let timer;
    timer = schedule(() => {
      if (boundaryTimer !== timer || token !== generation || !running) return;
      boundaryTimer = null;
      nextBoundaryAt = null;
      void resync("hour-boundary");
    }, delay);
    boundaryTimer = timer;
  }

  async function resync(_reason = "manual") {
    if (!running) return getState();
    const token = ++generation;
    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;
    clearBoundary();
    pendingLoad = null;
    pendingHour = null;

    const sampledAt = now();
    const desiredHour = hourKey(sampledAt);
    const usefulPreload = preload?.hour === desiredHour
      || (desiredHour === activeHour && preload?.hour === nextHourKey(desiredHour));
    if (!usefulPreload) discardPreload();
    else if (preload?.hour !== desiredHour && !preload?.settled) {
      pendingLoad = preload;
      pendingHour = preload.hour;
    }
    scheduleBoundary(token, sampledAt);

    if (desiredHour !== activeHour) await switchTo(token, desiredHour, controller);
    else preloadNext(token, desiredHour, controller);
    return getState();
  }

  async function start() {
    if (running) return getState();
    running = true;
    return resync("start");
  }

  function stop() {
    if (!running) return;
    running = false;
    generation += 1;
    activeController?.abort();
    activeController = null;
    discardPreload();
    clearBoundary();
    pendingLoad = null;
    pendingHour = null;
  }

  return Object.freeze({ start, resync, stop, getState });
}
