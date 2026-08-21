const SIDEBAR_SELECTORS = Object.freeze([
  '[data-testid*="sidebar"]',
  '[role="navigation"]',
  "nav",
  "aside"
]);

const COMPOSER_SELECTORS = Object.freeze([
  '[data-testid*="composer"]',
  "textarea",
  '[contenteditable="true"]'
]);

function finite(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function normalizeViewport(viewport) {
  const width = finite(viewport?.width);
  const height = finite(viewport?.height);
  if (width === null || height === null || width <= 0 || height <= 0) return null;
  return { width, height };
}

function normalizeRect(value) {
  const left = finite(value?.left);
  const top = finite(value?.top);
  const width = finite(value?.width);
  const height = finite(value?.height);
  if ([left, top, width, height].includes(null) || width <= 0 || height <= 0) return null;
  const right = finite(value?.right) ?? left + width;
  const bottom = finite(value?.bottom) ?? top + height;
  if (Math.abs(right - (left + width)) > 2 || Math.abs(bottom - (top + height)) > 2) return null;
  return { left, top, right, bottom, width, height };
}

function box(left, top, width, height) {
  return { left: Math.round(left), top: Math.round(top), width: Math.round(width), height: Math.round(height) };
}

function validSidebar(rect, viewport) {
  return rect.left >= -4
    && rect.left <= 24
    && rect.top >= -4
    && rect.top <= 24
    && rect.width >= 160
    && rect.width <= viewport.width * 0.38
    && rect.height >= viewport.height * 0.7
    && rect.right <= viewport.width
    && rect.bottom <= viewport.height + 24;
}

function validComposer(rect, viewport, sidebarRight) {
  return rect.left >= sidebarRight - 4
    && rect.top >= 160
    && rect.right <= viewport.width + 24
    && rect.bottom <= viewport.height + 24
    && rect.bottom >= viewport.height - 72
    && rect.width >= viewport.width * 0.45
    && rect.height >= 40
    && rect.height <= viewport.height * 0.4;
}

function visibleRect(document, element) {
  if (!element || typeof element.getBoundingClientRect !== "function") return null;
  let style;
  try {
    style = document.defaultView?.getComputedStyle?.(element);
  } catch {
    return null;
  }
  if (style?.display === "none" || style?.visibility === "hidden" || Number(style?.opacity) === 0) return null;
  return normalizeRect(element.getBoundingClientRect());
}

function candidatesFor(document, selector) {
  try {
    return [...document.querySelectorAll(selector)];
  } catch {
    return [];
  }
}

function unique(values) {
  return [...new Set(values)];
}

function selectSidebar(document, viewport) {
  for (const selector of SIDEBAR_SELECTORS) {
    const candidates = unique(candidatesFor(document, selector))
      .filter((candidate) => {
        const rect = visibleRect(document, candidate);
        return rect !== null && validSidebar(rect, viewport);
      });
    if (candidates.length > 1) return null;
    if (candidates.length === 1) return candidates[0];
  }
  return null;
}

export function discoverSidebarAnchor(document, viewportValue) {
  const viewport = normalizeViewport(viewportValue);
  if (!viewport || !document || typeof document.querySelectorAll !== "function") return null;
  return selectSidebar(document, viewport);
}

function composerContainer(document, candidate, viewport, sidebarRight) {
  let current = candidate;
  let selected = null;
  let selectedArea = -1;
  for (let depth = 0; current && depth <= 8; depth += 1, current = current.parentElement) {
    const rect = visibleRect(document, current);
    if (!rect || !validComposer(rect, viewport, sidebarRight)) continue;
    const area = rect.width * rect.height;
    if (area > selectedArea) {
      selected = current;
      selectedArea = area;
    }
  }
  return selected;
}

function selectComposer(document, viewport, sidebarRight) {
  for (const selector of COMPOSER_SELECTORS) {
    const candidates = unique(candidatesFor(document, selector)
      .map((candidate) => composerContainer(document, candidate, viewport, sidebarRight))
      .filter(Boolean));
    if (candidates.length > 1) return null;
    if (candidates.length === 1) return candidates[0];
  }
  return null;
}

export function discoverCockpitAnchors(document, viewportValue) {
  const viewport = normalizeViewport(viewportValue);
  if (!viewport || !document || typeof document.querySelectorAll !== "function") return null;
  const sidebarElement = discoverSidebarAnchor(document, viewport);
  if (!sidebarElement) return null;
  const sidebarRect = visibleRect(document, sidebarElement);
  if (!sidebarRect) return null;
  const composerElement = selectComposer(document, viewport, sidebarRect.right);
  if (!composerElement) return null;
  return { sidebarElement, composerElement };
}

export function calculateCockpitLayout({ viewport: viewportValue, sidebarRect: sidebarValue, composerRect: composerValue, density = "full" } = {}) {
  const viewport = normalizeViewport(viewportValue);
  const sidebarRect = normalizeRect(sidebarValue);
  const composerRect = normalizeRect(composerValue);
  if (!viewport || !sidebarRect || !composerRect) return null;
  if (!validSidebar(sidebarRect, viewport) || !validComposer(composerRect, viewport, sidebarRect.right)) return null;

  const splitX = Math.round(sidebarRect.right);
  const splitY = Math.round(composerRect.top);
  if (splitX <= 0 || splitX >= viewport.width || splitY <= 0 || splitY >= viewport.height) return null;
  return {
    status: "anchored",
    density: density === "minimal" ? "minimal" : "full",
    sidebar: box(0, 0, splitX, viewport.height),
    main: box(splitX, 0, viewport.width - splitX, splitY),
    composer: box(splitX, splitY, viewport.width - splitX, viewport.height - splitY)
  };
}

export function cockpitCssVariables(layout) {
  if (!layout || layout.status !== "anchored") return {};
  return {
    "--prime-knight-sidebar-right": `${Math.round(layout.sidebar.left + layout.sidebar.width)}px`,
    "--prime-knight-composer-top": `${Math.round(layout.composer.top)}px`,
    "--prime-knight-main-left": `${Math.round(layout.main.left)}px`,
    "--prime-knight-main-width": `${Math.round(layout.main.width)}px`,
    "--prime-knight-main-height": `${Math.round(layout.main.height)}px`
  };
}
