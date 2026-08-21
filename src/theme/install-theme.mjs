import { presentationFor } from "../background/presentation.mjs";
import {
  calculateCockpitLayout,
  cockpitCssVariables,
  discoverCockpitAnchors,
  discoverSidebarAnchor
} from "./cockpit-layout.mjs";

const OWNED_ATTRIBUTE = "data-prime-knight-owned";
const ROOT_MODE_ATTRIBUTE = "data-prime-knight-mode";
const CONTENT_LAYER_ATTRIBUTE = "data-prime-knight-content-layer";
const NATIVE_SURFACE_ATTRIBUTE = "data-prime-knight-native-surface";
const NATIVE_SIDEBAR_ATTRIBUTE = "data-prime-knight-native-sidebar";
const NATIVE_COMPOSER_SURFACE_ATTRIBUTE = "data-prime-knight-native-composer-surface";
const NATIVE_COMPOSER_BACKDROP_ATTRIBUTE = "data-prime-knight-native-composer-backdrop";
const NATIVE_SIDE_PANEL_ATTRIBUTE = "data-prime-knight-native-side-panel";
const NATIVE_SIDE_PANEL_COVER_ATTRIBUTE = "data-prime-knight-native-side-panel-cover";
const NATIVE_OUTPUT_POPOVER_ATTRIBUTE = "data-prime-knight-native-output-popover";
const NATIVE_OUTPUT_POPOVER_HEADER_ATTRIBUTE = "data-prime-knight-native-output-popover-header";
const NATIVE_WRITING_BACKDROP_ATTRIBUTE = "data-prime-knight-native-writing-backdrop";
const NATIVE_WRITING_ACTION_ATTRIBUTE = "data-prime-knight-native-writing-action";
const NATIVE_CODE_BLOCK_ATTRIBUTE = "data-prime-knight-native-code-block";
const NATIVE_CODE_BLOCK_HEADER_ATTRIBUTE = "data-prime-knight-native-code-block-header";
const SHELL_ID = "prime-knight-shell";
const STYLE_ID = "prime-knight-theme-style";
const ACTIVE_THEMES = new WeakMap();
const FALLBACK_BACKGROUND = Object.freeze({
  positionWide: "center center",
  positionStandard: "center center",
  positionCompact: "center top",
  overlayOpacity: 0.48
});

function assertEnvironment(document, window) {
  if (!document?.createElement || !document.documentElement || !document.body) {
    throw new TypeError("installTheme requires a browser document");
  }
  if (!window?.addEventListener || !window?.removeEventListener) {
    throw new TypeError("installTheme requires a browser window");
  }
}

function normalizeHour(hour) {
  const normalized = String(hour).padStart(2, "0");
  if (!/^(?:[01][0-9]|2[0-3])$/.test(normalized)) {
    throw new TypeError("Invalid theme hour");
  }
  return normalized;
}

function numberOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function removeOwned(document) {
  for (const node of document.querySelectorAll(`[${OWNED_ATTRIBUTE}="true"]`)) {
    node.remove();
  }
}

function removeRootThemeAttributes(root) {
  for (const name of root.getAttributeNames()) {
    if (name.startsWith("data-prime-knight-")) root.removeAttribute(name);
  }
}

function clearNativeSurfaceMarkers(document) {
  for (const attribute of [
    NATIVE_SURFACE_ATTRIBUTE,
    NATIVE_SIDEBAR_ATTRIBUTE,
    NATIVE_COMPOSER_SURFACE_ATTRIBUTE,
    NATIVE_COMPOSER_BACKDROP_ATTRIBUTE,
    NATIVE_SIDE_PANEL_ATTRIBUTE,
    NATIVE_SIDE_PANEL_COVER_ATTRIBUTE,
    NATIVE_OUTPUT_POPOVER_ATTRIBUTE,
    NATIVE_OUTPUT_POPOVER_HEADER_ATTRIBUTE,
    NATIVE_WRITING_BACKDROP_ATTRIBUTE,
    NATIVE_WRITING_ACTION_ATTRIBUTE,
    NATIVE_CODE_BLOCK_ATTRIBUTE,
    NATIVE_CODE_BLOCK_HEADER_ATTRIBUTE
  ]) {
    for (const node of document.querySelectorAll(`[${attribute}="true"]`)) {
      node.removeAttribute(attribute);
    }
  }
}

function isDescendantOf(element, ancestor) {
  for (let current = element; current; current = current.parentElement) {
    if (current === ancestor) return true;
  }
  return false;
}

function hasVisibleBackground(style) {
  const value = String(style?.backgroundColor ?? "").trim().toLowerCase();
  if (!value || value === "transparent") return false;
  if (/^rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/.test(value)) return false;
  if (/\/\s*0(?:\.0+)?\s*\)$/.test(value)) return false;
  return true;
}

function nativeComposerSurface(document, composerElement, viewport) {
  const candidates = [...document.querySelectorAll('[role="presentation"]')].filter((element) => {
    const sharesComposerAncestry = isDescendantOf(element, composerElement)
      || isDescendantOf(composerElement, element);
    if (!sharesComposerAncestry || typeof element?.getBoundingClientRect !== "function") return false;
    let style;
    try {
      style = document.defaultView?.getComputedStyle?.(element);
    } catch {
      return false;
    }
    if (style?.display === "none" || style?.visibility === "hidden" || Number(style?.opacity) === 0 || !hasVisibleBackground(style)) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return Number.isFinite(rect?.left)
      && Number.isFinite(rect?.top)
      && Number.isFinite(rect?.right)
      && Number.isFinite(rect?.bottom)
      && rect.left >= -4
      && rect.right <= viewport.width + 24
      && rect.top >= 160
      && rect.bottom >= viewport.height - 72
      && rect.bottom <= viewport.height + 24
      && rect.width >= 320
      && rect.height >= 40
      && rect.height <= viewport.height * 0.4;
  });
  return candidates.length === 1 ? candidates[0] : null;
}

function nativeComposerBackdrop(document, composerElement, viewport) {
  if (typeof composerElement?.getBoundingClientRect !== "function") return null;
  const composerRect = composerElement.getBoundingClientRect();
  const candidates = [...document.querySelectorAll("div")].filter((element) => {
    if (typeof element?.getBoundingClientRect !== "function") return false;
    let style;
    try {
      style = document.defaultView?.getComputedStyle?.(element);
    } catch {
      return false;
    }
    if (style?.display === "none"
      || style?.visibility === "hidden"
      || Number(style?.opacity) === 0
      || style?.pointerEvents !== "none"
      || style?.position !== "absolute"
      || !style?.backgroundImage
      || style.backgroundImage === "none") return false;
    const rect = element.getBoundingClientRect();
    return Number.isFinite(rect?.left)
      && Number.isFinite(rect?.top)
      && Number.isFinite(rect?.right)
      && Number.isFinite(rect?.bottom)
      && rect.left <= composerRect.left + 24
      && rect.right >= composerRect.right - 24
      && rect.top <= composerRect.bottom + 4
      && rect.bottom >= viewport.height - 24
      && rect.bottom <= viewport.height + 24
      && rect.width >= viewport.width * 0.45
      && rect.height >= 32
      && rect.height <= viewport.height * 0.4;
  });
  return candidates.length === 1 ? candidates[0] : null;
}

function nativeSidePanel(document, viewport) {
  const candidates = [...document.querySelectorAll("aside")].filter((element) => {
    if (typeof element?.getBoundingClientRect !== "function") return false;
    let style;
    try {
      style = document.defaultView?.getComputedStyle?.(element);
    } catch {
      return false;
    }
    if (style?.display === "none" || style?.visibility === "hidden" || Number(style?.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    return Number.isFinite(rect?.left)
      && Number.isFinite(rect?.top)
      && Number.isFinite(rect?.right)
      && Number.isFinite(rect?.bottom)
      && rect.left >= viewport.width * 0.35
      && rect.right >= viewport.width - 4
      && rect.right <= viewport.width + 4
      && rect.top >= -4
      && rect.top <= 4
      && rect.bottom >= viewport.height - 4
      && rect.bottom <= viewport.height + 4
      && rect.width >= viewport.width * 0.25
      && rect.width <= viewport.width * 0.65
      && rect.height >= viewport.height * 0.9;
  });
  return candidates.length === 1 ? candidates[0] : null;
}

function nativeSidePanelCovers(document, panelElement) {
  const panelRect = panelElement?.getBoundingClientRect?.();
  if (!panelRect) return [];
  const nativeButtons = [...document.querySelectorAll("button")];
  const candidates = [
    ...document.querySelectorAll("div"),
    ...document.querySelectorAll("file-tree-container")
  ];
  return [...new Set(candidates)].filter((element) => {
    if (!isDescendantOf(element, panelElement) || typeof element?.getBoundingClientRect !== "function") return false;
    let style;
    try {
      style = document.defaultView?.getComputedStyle?.(element);
    } catch {
      return false;
    }
    if (style?.display === "none"
      || style?.visibility === "hidden"
      || Number(style?.opacity) === 0
      || !hasVisibleBackground(style)) return false;
    const rect = element.getBoundingClientRect();
    if (!Number.isFinite(rect?.left)
      || !Number.isFinite(rect?.top)
      || !Number.isFinite(rect?.right)
      || !Number.isFinite(rect?.bottom)) return false;
    const spansPanelWidth = rect.left <= panelRect.left + 8
      && rect.right >= panelRect.right - 8
      && rect.width >= panelRect.width * 0.94;
    const fullCover = spansPanelWidth
      && rect.top >= panelRect.top - 4
      && rect.top <= panelRect.top + 56
      && rect.bottom >= panelRect.bottom - 8
      && rect.bottom <= panelRect.bottom + 4
      && rect.height >= panelRect.height * 0.9;
    const topToolbar = spansPanelWidth
      && rect.top >= panelRect.top - 4
      && rect.top <= panelRect.top + 4
      && rect.height >= 32
      && rect.height <= 64;
    const shortcutShelf = rect.left <= panelRect.left + 16
      && rect.right >= panelRect.right - 16
      && rect.width >= panelRect.width * 0.9
      && rect.height >= 64
      && rect.height <= 160
      && style.position === "sticky"
      && nativeButtons.filter((button) => isDescendantOf(button, element)).length >= 2;
    const fileTreePartition = String(element.tagName).toLowerCase() === "file-tree-container"
      && rect.left >= panelRect.left + 32
      && rect.right >= panelRect.right - 16
      && rect.right <= panelRect.right + 4
      && rect.top >= panelRect.top + 32
      && rect.bottom >= panelRect.bottom - 16
      && rect.bottom <= panelRect.bottom + 4
      && rect.width >= 160
      && rect.width <= panelRect.width * 0.55
      && rect.height >= panelRect.height * 0.55;
    return fullCover || topToolbar || shortcutShelf || fileTreePartition;
  });
}

function nativeOutputPopover(document, viewport) {
  const nativeButtons = [...document.querySelectorAll("button")];
  const candidates = [...document.querySelectorAll("div")].filter((element) => {
    if (typeof element?.getBoundingClientRect !== "function") return false;
    let style;
    try {
      style = document.defaultView?.getComputedStyle?.(element);
    } catch {
      return false;
    }
    if (style?.display === "none"
      || style?.visibility === "hidden"
      || Number(style?.opacity) === 0
      || !hasVisibleBackground(style)
      || style?.position !== "relative"
      || style?.overflow !== "hidden"
      || Number.parseFloat(style?.borderRadius) < 16) return false;
    const rect = element.getBoundingClientRect();
    if (!Number.isFinite(rect?.left)
      || !Number.isFinite(rect?.top)
      || !Number.isFinite(rect?.right)
      || !Number.isFinite(rect?.bottom)
      || rect.left < viewport.width * 0.65
      || rect.right < viewport.width - 24
      || rect.right > viewport.width - 4
      || rect.top < 32
      || rect.top > viewport.height * 0.35
      || rect.bottom > viewport.height - 12
      || rect.width < 260
      || rect.width > 420
      || rect.height < 64
      || rect.height > viewport.height * 0.9
      || nativeButtons.filter((button) => isDescendantOf(button, element)).length < 1
      || !element.querySelector?.('[role="presentation"]')) return false;
    for (let ancestor = element.parentElement, depth = 0; ancestor && depth < 6; ancestor = ancestor.parentElement, depth += 1) {
      let ancestorStyle;
      try {
        ancestorStyle = document.defaultView?.getComputedStyle?.(ancestor);
      } catch {
        continue;
      }
      if (ancestorStyle?.pointerEvents !== "none" || typeof ancestor?.getBoundingClientRect !== "function") continue;
      const ancestorRect = ancestor.getBoundingClientRect();
      if (Number.isFinite(ancestorRect?.top)
        && Number.isFinite(ancestorRect?.bottom)
        && Math.abs(ancestorRect.top - rect.top) <= 4
        && Math.abs(ancestorRect.bottom - rect.bottom) <= 4
        && ancestorRect.left <= rect.left + 4
        && ancestorRect.right >= rect.right - 4) return true;
    }
    return false;
  });
  return candidates.length === 1 ? candidates[0] : null;
}

function nativeOutputPopoverHeaders(document, popover) {
  if (!popover || typeof popover.getBoundingClientRect !== "function") return [];
  const popoverRect = popover.getBoundingClientRect();
  return [...document.querySelectorAll("header")].filter((element) => {
    if (!isDescendantOf(element, popover) || typeof element?.getBoundingClientRect !== "function") return false;
    let presentationAncestor = null;
    for (let ancestor = element.parentElement; ancestor && ancestor !== popover; ancestor = ancestor.parentElement) {
      if (ancestor.getAttribute?.("role") === "presentation") {
        presentationAncestor = ancestor;
        break;
      }
    }
    if (!presentationAncestor) return false;
    let style;
    try {
      style = document.defaultView?.getComputedStyle?.(element);
    } catch {
      return false;
    }
    if (style?.display === "none"
      || style?.visibility === "hidden"
      || Number(style?.opacity) === 0
      || style?.position !== "sticky"
      || !hasVisibleBackground(style)
      || !element.querySelector?.("button")) return false;
    const rect = element.getBoundingClientRect();
    return Number.isFinite(rect?.left)
      && Number.isFinite(rect?.top)
      && Number.isFinite(rect?.right)
      && Number.isFinite(rect?.bottom)
      && Math.abs(rect.left - popoverRect.left) <= 4
      && Math.abs(rect.right - popoverRect.right) <= 4
      && rect.top >= popoverRect.top - 1
      && rect.bottom <= popoverRect.bottom + 1
      && rect.width >= popoverRect.width * 0.9
      && rect.height >= 20
      && rect.height <= 44;
  });
}

function hasFiniteRect(rect) {
  return Number.isFinite(rect?.left)
    && Number.isFinite(rect?.top)
    && Number.isFinite(rect?.right)
    && Number.isFinite(rect?.bottom)
    && Number.isFinite(rect?.width)
    && Number.isFinite(rect?.height);
}

function rectsMatch(first, second, tolerance = 2) {
  return hasFiniteRect(first)
    && hasFiniteRect(second)
    && Math.abs(first.left - second.left) <= tolerance
    && Math.abs(first.top - second.top) <= tolerance
    && Math.abs(first.right - second.right) <= tolerance
    && Math.abs(first.bottom - second.bottom) <= tolerance;
}

function nativeWritingBlockBackdrops(document, viewport, mainSurface, sidebarRight) {
  if (!mainSurface) return [];
  return [...document.querySelectorAll("div")].filter((element) => {
    if (!isDescendantOf(element, mainSurface)
      || typeof element?.getBoundingClientRect !== "function"
      || (element.childNodes?.length ?? element.children?.length ?? 0) !== 0) return false;
    const surface = element.parentElement;
    if (!surface || typeof surface?.getBoundingClientRect !== "function") return false;
    let style;
    let surfaceStyle;
    try {
      style = document.defaultView?.getComputedStyle?.(element);
      surfaceStyle = document.defaultView?.getComputedStyle?.(surface);
    } catch {
      return false;
    }
    const rect = element.getBoundingClientRect();
    const surfaceRect = surface.getBoundingClientRect();
    const directChildren = [...(surface.children ?? surface.childNodes ?? [])];
    const fullSizePassiveLayers = directChildren.filter((child) => {
      if (typeof child?.getBoundingClientRect !== "function") return false;
      try {
        const childStyle = document.defaultView?.getComputedStyle?.(child);
        return childStyle?.position === "absolute"
          && childStyle?.pointerEvents === "none"
          && rectsMatch(child.getBoundingClientRect(), surfaceRect);
      } catch {
        return false;
      }
    });
    const hasEditableContent = Boolean(surface.querySelector?.('[contenteditable="true"]'));
    const isCompactActionCard = !hasEditableContent
      && !surface.querySelector?.("code")
      && (surface.querySelectorAll?.("button")?.length ?? 0) === 2
      && directChildren.length === 3
      && fullSizePassiveLayers.length === 2
      && surfaceRect.height >= 72
      && surfaceRect.height <= 160;
    if (style?.display === "none"
      || style?.visibility === "hidden"
      || Number(style?.opacity) === 0
      || style?.position !== "absolute"
      || style?.pointerEvents !== "none"
      || !hasVisibleBackground(style)
      || surfaceStyle?.position !== "relative"
      || !["clip", "hidden"].includes(surfaceStyle?.overflow)
      || Number.parseFloat(surfaceStyle?.borderRadius) < 16
      || (!hasEditableContent && !isCompactActionCard)
      || !surface.querySelector?.("button")) return false;
    return rectsMatch(rect, surfaceRect)
      && rect.left >= sidebarRight + 24
      && rect.right <= viewport.width - 16
      && rect.bottom >= 72
      && rect.top <= viewport.height - 72
      && rect.width >= 360
      && rect.height >= 72
      && rect.height <= viewport.height * 0.65;
  });
}

function nativeWritingBlockActions(document, backdrop) {
  const surface = backdrop?.parentElement;
  const surfaceRect = surface?.getBoundingClientRect?.();
  if (!surface || !hasFiniteRect(surfaceRect) || !surface.querySelector?.('[contenteditable="true"]')) return [];
  const buttons = [...(surface.querySelectorAll?.("button") ?? [])];
  if (buttons.length !== 2) return [];
  const rows = buttons.map((button) => {
    if (typeof button?.getBoundingClientRect !== "function") return null;
    try {
      return {
        button,
        rect: button.getBoundingClientRect(),
        style: document.defaultView?.getComputedStyle?.(button)
      };
    } catch {
      return null;
    }
  }).filter((row) => row && hasFiniteRect(row.rect));
  const topControls = rows.filter(({ rect, style }) => style?.display !== "none"
    && style?.visibility !== "hidden"
    && Number(style?.opacity) !== 0
    && rect.top >= surfaceRect.top + 4
    && rect.top <= surfaceRect.top + 16
    && rect.height >= 28
    && rect.height <= 44);
  const leftActions = topControls.filter(({ rect, style }) => hasVisibleBackground(style)
    && Number.parseFloat(style?.borderRadius) >= 18
    && rect.left >= surfaceRect.left + 4
    && rect.left <= surfaceRect.left + 16
    && rect.width >= 56
    && rect.width <= 160);
  const hasRightControl = topControls.some(({ rect, style }) => !hasVisibleBackground(style)
    && rect.right >= surfaceRect.right - 16
    && rect.right <= surfaceRect.right - 4
    && rect.width >= 28
    && rect.width <= 48);
  return leftActions.length === 1 && hasRightControl ? [leftActions[0].button] : [];
}

function nativeCodeBlocks(document, viewport, mainSurface, sidebarRight) {
  if (!mainSurface) return [];
  return [...document.querySelectorAll("div")].filter((element) => {
    if (!isDescendantOf(element, mainSurface) || typeof element?.getBoundingClientRect !== "function") return false;
    let style;
    try {
      style = document.defaultView?.getComputedStyle?.(element);
    } catch {
      return false;
    }
    if (style?.display === "none"
      || style?.visibility === "hidden"
      || Number(style?.opacity) === 0
      || style?.position !== "relative"
      || !["clip", "hidden"].includes(style?.overflow)
      || Number.parseFloat(style?.borderRadius) < 8
      || !hasVisibleBackground(style)
      || !element.querySelector?.("code")
      || !element.querySelector?.("button")) return false;
    const rect = element.getBoundingClientRect();
    return hasFiniteRect(rect)
      && rect.left >= sidebarRight + 24
      && rect.right <= viewport.width - 16
      && rect.bottom >= 72
      && rect.top <= viewport.height - 40
      && rect.width >= 320
      && rect.height >= 40
      && rect.height <= viewport.height * 0.65;
  });
}

function nativeCodeBlockHeaders(document, block) {
  const blockRect = block?.getBoundingClientRect?.();
  if (!hasFiniteRect(blockRect)) return [];
  return [...(block.childNodes ?? block.children ?? [])].filter((element) => {
    if (typeof element?.getBoundingClientRect !== "function") return false;
    let style;
    try {
      style = document.defaultView?.getComputedStyle?.(element);
    } catch {
      return false;
    }
    if (style?.display === "none"
      || style?.visibility === "hidden"
      || Number(style?.opacity) === 0
      || style?.position !== "sticky"
      || (!hasVisibleBackground(style) && (!style?.backgroundImage || style.backgroundImage === "none"))
      || !element.querySelector?.("button")
      || element.querySelector?.("code")) return false;
    const rect = element.getBoundingClientRect();
    return hasFiniteRect(rect)
      && Math.abs(rect.left - blockRect.left) <= 2
      && Math.abs(rect.right - blockRect.right) <= 2
      && Math.abs(rect.top - blockRect.top) <= 2
      && rect.width >= blockRect.width * 0.9
      && rect.height >= 20
      && rect.height <= 48;
  });
}

function nativeMainSurface(document, viewport, sidebarRight) {
  const candidates = [...document.querySelectorAll("main")].filter((element) => {
    if (typeof element?.getBoundingClientRect !== "function") return false;
    let style;
    try {
      style = document.defaultView?.getComputedStyle?.(element);
    } catch {
      return false;
    }
    if (style?.display === "none" || style?.visibility === "hidden" || Number(style?.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    return Number.isFinite(rect?.left)
      && Number.isFinite(rect?.top)
      && Number.isFinite(rect?.right)
      && Number.isFinite(rect?.bottom)
      && rect.left >= sidebarRight - 8
      && rect.left <= sidebarRight + 32
      && rect.top >= -48
      && rect.top <= 48
      && rect.right >= viewport.width - 24
      && rect.right <= viewport.width + 24
      && rect.bottom >= viewport.height - 48
      && rect.bottom <= viewport.height + 48
      && rect.width >= viewport.width * 0.5
      && rect.height >= viewport.height * 0.7;
  });
  return candidates.length === 1 ? candidates[0] : null;
}

function nativeContentRoot(document) {
  const contentRoot = document.getElementById?.("root") ?? document.querySelector?.("#root");
  if (!contentRoot || contentRoot.parentNode !== document.body) {
    throw new Error("installTheme requires a safe native content root");
  }
  return contentRoot;
}

function assertCssText(cssText) {
  if (typeof cssText !== "string" || cssText.trim().length === 0) {
    throw new TypeError("installTheme requires non-empty cssText");
  }
}

export function createResourceRegistry({ clearTimeout = () => {}, revokeObjectURL = () => {} } = {}) {
  const timeouts = new Set();
  const objectUrls = new Set();
  let cleared = false;

  return Object.freeze({
    trackTimeout(timeout) {
      if (cleared) clearTimeout(timeout);
      else timeouts.add(timeout);
      return timeout;
    },
    releaseTimeout(timeout) {
      if (!timeouts.delete(timeout)) return;
      clearTimeout(timeout);
    },
    trackObjectUrl(url) {
      if (cleared) revokeObjectURL(url);
      else objectUrls.add(url);
      return url;
    },
    releaseObjectUrl(url) {
      if (!objectUrls.delete(url)) return;
      revokeObjectURL(url);
    },
    clear() {
      if (cleared) return;
      cleared = true;
      for (const timeout of timeouts) clearTimeout(timeout);
      timeouts.clear();
      for (const url of objectUrls) revokeObjectURL(url);
      objectUrls.clear();
    }
  });
}

function buildShell(document) {
  const shell = document.createElement("div");
  shell.id = SHELL_ID;
  shell.setAttribute(OWNED_ATTRIBUTE, "true");
  shell.setAttribute("aria-hidden", "true");

  for (const name of ["background-a", "background-b", "readability-mask"]) {
    const layer = document.createElement("div");
    layer.id = `prime-knight-${name}`;
    layer.className = name.startsWith("background")
      ? "prime-knight-background"
      : "prime-knight-readability-mask";
    layer.setAttribute("data-prime-knight-layer", name);
    shell.append(layer);
  }
  return shell;
}

function styleElement(document, cssText) {
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.setAttribute(OWNED_ATTRIBUTE, "true");
  style.textContent = cssText;
  return style;
}

function viewportFor(document, window) {
  const root = document.documentElement;
  return {
    width: numberOr(window.innerWidth, numberOr(root.clientWidth, 1)) || 1,
    height: numberOr(window.innerHeight, numberOr(root.clientHeight, 1)) || 1,
    devicePixelRatio: numberOr(window.devicePixelRatio, 1) || 1
  };
}

function abortError() {
  const error = new Error("Background load aborted");
  error.name = "AbortError";
  return error;
}

function loadBrowserImage(window, row, { signal } = {}) {
  if (typeof row?.src !== "string" || row.src.length === 0) return null;
  if (typeof window.Image !== "function") {
    throw new TypeError("installTheme requires window.Image to load backgrounds");
  }
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      signal?.removeEventListener?.("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      image.src = "";
      reject(abortError());
    };
    image.onload = () => {
      cleanup();
      resolve(row.src);
    };
    image.onerror = () => {
      cleanup();
      reject(new Error(`Unable to load background ${row.hour}`));
    };
    signal?.addEventListener?.("abort", onAbort, { once: true });
    image.src = row.src;
  });
}

function backgroundUrl(loaded, row) {
  const value = typeof loaded === "string" ? loaded : loaded?.url ?? row?.src;
  if (typeof value !== "string" || value.length === 0) return null;
  return value;
}

function cssUrl(url) {
  return `url(${JSON.stringify(url)})`;
}

/**
 * Installs only theme-owned decoration. The local payload builder must provide
 * the exact stylesheet text; this module never falls back to partial styling.
 */
export function installTheme({
  document,
  window,
  manifest = [],
  initialHour = "00",
  verificationMode = false,
  testMode = false,
  cssText,
  loadBackground
} = {}) {
  assertEnvironment(document, window);
  assertCssText(cssText);
  if (!Array.isArray(manifest)) throw new TypeError("Invalid theme manifest");
  const contentRoot = nativeContentRoot(document);

  ACTIVE_THEMES.get(document)?.destroy();
  removeOwned(document);
  clearNativeSurfaceMarkers(document);
  const root = document.documentElement;
  removeRootThemeAttributes(root);
  const style = styleElement(document, cssText);
  const shell = buildShell(document);
  const layerA = shell.querySelector('[data-prime-knight-layer="background-a"]');
  const layerB = shell.querySelector('[data-prime-knight-layer="background-b"]');
  const rowsByHour = new Map(manifest.map((row) => [row.hour, row]));
  const resources = createResourceRegistry({
    clearTimeout: window.clearTimeout.bind(window),
    revokeObjectURL: window.URL?.revokeObjectURL?.bind(window.URL)
  });
  let activeLayer = layerA;
  let currentHour = normalizeHour(initialHour);
  let resizeObserver = null;
  let mutationObserver = null;
  let resizeTimer = null;
  let destroyed = false;
  let refreshCount = 0;
  let currentPresentation = null;
  let currentLayout = null;
  let setHourGeneration = 0;
  const layerResources = new Map([
    [layerA, { url: null, releaseTimer: null }],
    [layerB, { url: null, releaseTimer: null }]
  ]);
  const backgroundLoader = loadBackground ?? ((row, context) => loadBrowserImage(window, row, context));
  if (typeof backgroundLoader !== "function") throw new TypeError("Invalid background loader");

  function applyVerificationMarker(hour) {
    if (!verificationMode) return;
    shell.setAttribute("data-prime-knight-verification", normalizeHour(hour));
  }

  document.head.append(style);
  contentRoot.setAttribute(CONTENT_LAYER_ATTRIBUTE, "true");
  document.body.append(shell);
  activeLayer.classList.add("is-visible");

  const metrics = {};
  Object.defineProperties(metrics, {
    hour: { enumerable: true, get: () => currentHour },
    mode: { enumerable: true, get: () => currentPresentation?.mode ?? null },
    fit: { enumerable: true, get: () => currentPresentation?.fit ?? null },
    position: { enumerable: true, get: () => currentPresentation?.position ?? null },
    checksum: { enumerable: true, get: () => rowsByHour.get(currentHour)?.checksum ?? null },
    refreshCount: { enumerable: true, get: () => refreshCount },
    testMode: { enumerable: true, get: () => Boolean(testMode) },
    layoutStatus: { enumerable: true, get: () => currentLayout?.status ?? "native" },
    sidebar: { enumerable: true, get: () => currentLayout?.sidebar ?? null },
    main: { enumerable: true, get: () => currentLayout?.main ?? null },
    composer: { enumerable: true, get: () => currentLayout?.composer ?? null }
  });
  Object.freeze(metrics);

  function clearCockpitVariables() {
    for (const name of [
      "--prime-knight-sidebar-right",
      "--prime-knight-composer-top",
      "--prime-knight-main-left",
      "--prime-knight-main-width",
      "--prime-knight-main-height"
    ]) shell.style.setProperty(name, "");
  }

  function applyCockpitLayout(viewport, density) {
    clearNativeSurfaceMarkers(document);
    const outputPopover = nativeOutputPopover(document, viewport);
    if (outputPopover) {
      outputPopover.setAttribute(NATIVE_OUTPUT_POPOVER_ATTRIBUTE, "true");
      for (const header of nativeOutputPopoverHeaders(document, outputPopover)) {
        header.setAttribute(NATIVE_OUTPUT_POPOVER_HEADER_ATTRIBUTE, "true");
      }
    }
    const sidePanel = nativeSidePanel(document, viewport);
    const sidePanelRect = sidePanel?.getBoundingClientRect?.();
    const workspaceViewport = sidePanelRect
      ? { ...viewport, width: Math.max(1, Math.min(viewport.width, sidePanelRect.left)) }
      : viewport;
    if (sidePanel) {
      sidePanel.setAttribute(NATIVE_SIDE_PANEL_ATTRIBUTE, "true");
      for (const cover of nativeSidePanelCovers(document, sidePanel)) {
        cover.setAttribute(NATIVE_SIDE_PANEL_COVER_ATTRIBUTE, "true");
      }
    }
    const sidebarElement = discoverSidebarAnchor(document, viewport);
    const sidebarRect = sidebarElement?.getBoundingClientRect?.();
    const mainSurface = sidebarRect && nativeMainSurface(document, viewport, sidebarRect.right);
    if (sidebarElement && mainSurface) {
      mainSurface.setAttribute(NATIVE_SURFACE_ATTRIBUTE, "true");
      sidebarElement.setAttribute(NATIVE_SIDEBAR_ATTRIBUTE, "true");
    }
    const anchors = discoverCockpitAnchors(document, workspaceViewport);
    for (const backdrop of nativeWritingBlockBackdrops(document, workspaceViewport, mainSurface, sidebarRect?.right ?? 0)) {
      backdrop.setAttribute(NATIVE_WRITING_BACKDROP_ATTRIBUTE, "true");
      for (const action of nativeWritingBlockActions(document, backdrop)) {
        action.setAttribute(NATIVE_WRITING_ACTION_ATTRIBUTE, "true");
      }
    }
    for (const block of nativeCodeBlocks(document, workspaceViewport, mainSurface, sidebarRect?.right ?? 0)) {
      block.setAttribute(NATIVE_CODE_BLOCK_ATTRIBUTE, "true");
      for (const header of nativeCodeBlockHeaders(document, block)) {
        header.setAttribute(NATIVE_CODE_BLOCK_HEADER_ATTRIBUTE, "true");
      }
    }
    const layout = anchors && calculateCockpitLayout({
      viewport: workspaceViewport,
      sidebarRect: anchors.sidebarElement.getBoundingClientRect(),
      composerRect: anchors.composerElement.getBoundingClientRect(),
      density
    });
    const composerSurface = layout && nativeComposerSurface(document, anchors.composerElement, workspaceViewport);
    const composerBackdrop = layout && nativeComposerBackdrop(document, anchors.composerElement, workspaceViewport);
    if (!layout || !mainSurface) {
      currentLayout = null;
      clearCockpitVariables();
      shell.setAttribute("data-prime-knight-layout", "native");
      return null;
    }
    composerSurface?.setAttribute(NATIVE_COMPOSER_SURFACE_ATTRIBUTE, "true");
    composerBackdrop?.setAttribute(NATIVE_COMPOSER_BACKDROP_ATTRIBUTE, "true");
    currentLayout = layout;
    for (const [name, value] of Object.entries(cockpitCssVariables(layout))) {
      shell.style.setProperty(name, value);
    }
    shell.setAttribute("data-prime-knight-layout", "anchored");
    return layout;
  }

  function applyPresentation(background = rowsByHour.get(currentHour) ?? FALLBACK_BACKGROUND, layer = activeLayer) {
    const viewport = viewportFor(document, window);
    const presentation = presentationFor(viewport, background);
    currentPresentation = presentation;
    root.setAttribute(ROOT_MODE_ATTRIBUTE, presentation.mode);
    shell.setAttribute("data-prime-knight-density", presentation.chromeDensity);
    shell.style.setProperty("--prime-knight-fit", presentation.fit);
    shell.style.setProperty("--prime-knight-position", presentation.position);
    shell.style.setProperty("--prime-knight-overlay", String(numberOr(background.overlayOpacity, FALLBACK_BACKGROUND.overlayOpacity)));
    shell.style.setProperty("--prime-knight-chrome-density", presentation.chromeDensity);
    shell.style.setProperty("--prime-knight-top-chrome-px", `${presentation.topChromePx}px`);
    shell.style.setProperty("--prime-knight-bottom-chrome-px", `${presentation.bottomChromePx}px`);
    layer?.style.setProperty("--prime-knight-fit", presentation.fit);
    layer?.style.setProperty("--prime-knight-position", presentation.position);
    applyCockpitLayout(viewport, presentation.chromeDensity);
    refreshCount += 1;
    applyVerificationMarker(currentHour);
    return presentation;
  }

  function refreshViewport() {
    if (destroyed) return null;
    return applyPresentation();
  }

  function releaseLayer(layer) {
    const resource = layerResources.get(layer);
    if (!resource) return;
    if (resource.releaseTimer !== null) {
      resources.releaseTimeout(resource.releaseTimer);
      resource.releaseTimer = null;
    }
    layer.style.setProperty("--prime-knight-background-image", "");
    if (resource.url?.startsWith("blob:")) resources.releaseObjectUrl(resource.url);
    resource.url = null;
  }

  function contextAllowsCommit(request, { signal, isCurrent } = {}) {
    if (destroyed || request !== setHourGeneration || signal?.aborted) return false;
    if (typeof isCurrent !== "function") return true;
    try {
      return Boolean(isCurrent());
    } catch {
      return false;
    }
  }

  function discardLoaded(loaded, background) {
    if (typeof loaded?.release === "function") {
      loaded.release();
      return;
    }
    const url = backgroundUrl(loaded, background);
    if (!url?.startsWith("blob:")) return;
    if ([...layerResources.values()].some((resource) => resource.url === url)) return;
    resources.trackObjectUrl(url);
    resources.releaseObjectUrl(url);
  }

  function commitHour(hour, background, loaded, request, context) {
    const url = backgroundUrl(loaded, background);
    if (!contextAllowsCommit(request, context)) {
      discardLoaded(loaded, background);
      return null;
    }

    const nextLayer = activeLayer === layerA ? layerB : layerA;
    if (!contextAllowsCommit(request, context)) {
      discardLoaded(loaded, background);
      return null;
    }
    releaseLayer(nextLayer);
    if (!contextAllowsCommit(request, context)) {
      discardLoaded(loaded, background);
      return null;
    }
    if (url !== null) {
      nextLayer.style.setProperty("--prime-knight-background-image", cssUrl(url));
      layerResources.get(nextLayer).url = url;
      if (url.startsWith("blob:")) resources.trackObjectUrl(url);
    }
    if (!contextAllowsCommit(request, context)) {
      releaseLayer(nextLayer);
      return null;
    }
    currentHour = hour;
    shell.setAttribute("data-prime-knight-hour", currentHour);
    const presentation = applyPresentation(background, nextLayer);
    if (!contextAllowsCommit(request, context)) {
      releaseLayer(nextLayer);
      return null;
    }
    const previousLayer = activeLayer;
    previousLayer.classList.remove("is-visible");
    nextLayer.classList.add("is-visible");
    activeLayer = nextLayer;

    const previousResource = layerResources.get(previousLayer);
    if (previousResource.url !== null) {
      const reducedMotion = Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
      if (reducedMotion) {
        releaseLayer(previousLayer);
      } else {
        const timeout = resources.trackTimeout(window.setTimeout(() => {
          resources.releaseTimeout(timeout);
          previousResource.releaseTimer = null;
          releaseLayer(previousLayer);
        }, 1200));
        previousResource.releaseTimer = timeout;
      }
    }
    return presentation;
  }

  function setHour(hour, context = {}) {
    if (destroyed) return null;
    context ??= {};
    const normalized = normalizeHour(hour);
    const background = rowsByHour.get(normalized) ?? FALLBACK_BACKGROUND;
    const request = ++setHourGeneration;
    const hasLoaded = Object.prototype.hasOwnProperty.call(context, "loaded");
    if (!contextAllowsCommit(request, context)) {
      if (hasLoaded) discardLoaded(context.loaded, background);
      return null;
    }
    let loading;
    try {
      loading = hasLoaded ? context.loaded : backgroundLoader(background, { signal: context.signal });
    } catch (error) {
      return Promise.reject(error);
    }
    if (loading === null || loading === undefined) return commitHour(normalized, background, null, request, context);
    if (typeof loading?.then !== "function") return commitHour(normalized, background, loading, request, context);
    return Promise.resolve(loading).then(
      (loaded) => commitHour(normalized, background, loaded, request, context),
      (error) => {
        if (!contextAllowsCommit(request, context)) return null;
        throw error;
      }
    );
  }

  function onResize() {
    if (resizeTimer !== null) resources.releaseTimeout(resizeTimer);
    const timeout = window.setTimeout(() => {
      resources.releaseTimeout(timeout);
      if (resizeTimer === timeout) resizeTimer = null;
      refreshViewport();
    }, 120);
    resizeTimer = resources.trackTimeout(timeout);
  }

  window.addEventListener("resize", onResize, { passive: true });
  window.addEventListener("scroll", onResize, { passive: true, capture: true });
  if (typeof window.ResizeObserver === "function") {
    resizeObserver = new window.ResizeObserver(onResize);
    resizeObserver.observe(root);
  }
  if (typeof window.MutationObserver === "function") {
    mutationObserver = new window.MutationObserver(onResize);
    mutationObserver.observe(contentRoot, { childList: true, subtree: true });
  }
  const initialBackground = rowsByHour.get(currentHour) ?? FALLBACK_BACKGROUND;
  applyVerificationMarker(currentHour);
  shell.setAttribute("data-prime-knight-hour", currentHour);
  applyPresentation(initialBackground, activeLayer);
  Promise.resolve(setHour(currentHour)).catch(() => {});

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    setHourGeneration += 1;
    window.removeEventListener("resize", onResize);
    window.removeEventListener("scroll", onResize, true);
    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
    releaseLayer(layerA);
    releaseLayer(layerB);
    resources.clear();
    resizeTimer = null;
    style.remove();
    shell.remove();
    contentRoot.removeAttribute(CONTENT_LAYER_ATTRIBUTE);
    clearNativeSurfaceMarkers(document);
    removeRootThemeAttributes(root);
    if (ACTIVE_THEMES.get(document)?.destroy === destroy) ACTIVE_THEMES.delete(document);
  }

  const theme = { setHour, refreshViewport, destroy, metrics };
  ACTIVE_THEMES.set(document, theme);
  return theme;
}
