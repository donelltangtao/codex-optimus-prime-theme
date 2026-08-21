import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateCockpitLayout,
  cockpitCssVariables,
  discoverCockpitAnchors
} from "../src/theme/cockpit-layout.mjs";

function rect(left, top, width, height) {
  return { left, top, right: left + width, bottom: top + height, width, height };
}

function element(box, { parentElement = null, visible = true } = {}) {
  return {
    parentElement,
    getBoundingClientRect: () => box,
    __visible: visible
  };
}

function discoveryDocument(entries) {
  return {
    defaultView: {
      getComputedStyle(node) {
        return {
          display: node.__visible === false ? "none" : "block",
          visibility: node.__visible === false ? "hidden" : "visible",
          opacity: node.__visible === false ? "0" : "1"
        };
      }
    },
    querySelectorAll(selector) {
      return entries.get(selector) ?? [];
    }
  };
}

test("calculates native sidebar, main, and composer chambers without changing their rectangles", () => {
  const layout = calculateCockpitLayout({
    viewport: { width: 1586, height: 992 },
    sidebarRect: rect(0, 0, 252, 992),
    composerRect: rect(252, 800, 1334, 192),
    density: "full"
  });

  assert.deepEqual(layout, {
    status: "anchored",
    density: "full",
    sidebar: { left: 0, top: 0, width: 252, height: 992 },
    main: { left: 252, top: 0, width: 1334, height: 800 },
    composer: { left: 252, top: 800, width: 1334, height: 192 }
  });
});

test("rejects overlapping, offscreen, tiny, or missing chamber anchors", () => {
  const viewport = { width: 1586, height: 992 };
  const validSidebar = rect(0, 0, 252, 992);
  const validComposer = rect(252, 800, 1334, 192);

  assert.equal(calculateCockpitLayout({ viewport, composerRect: validComposer }), null);
  assert.equal(calculateCockpitLayout({ viewport, sidebarRect: validSidebar }), null);
  assert.equal(calculateCockpitLayout({ viewport, sidebarRect: rect(40, 0, 80, 992), composerRect: validComposer }), null);
  assert.equal(calculateCockpitLayout({ viewport, sidebarRect: validSidebar, composerRect: rect(0, 100, 100, 100) }), null);
  assert.equal(calculateCockpitLayout({ viewport, sidebarRect: validSidebar, composerRect: rect(252, 400, 1334, 500) }), null);
});

test("serializes only anchored chamber geometry into shell-owned CSS variables", () => {
  const variables = cockpitCssVariables(calculateCockpitLayout({
    viewport: { width: 1586, height: 992 },
    sidebarRect: rect(0, 0, 252, 992),
    composerRect: rect(252, 800, 1334, 192),
    density: "full"
  }));

  assert.deepEqual(variables, {
    "--prime-knight-sidebar-right": "252px",
    "--prime-knight-composer-top": "800px",
    "--prime-knight-main-left": "252px",
    "--prime-knight-main-width": "1334px",
    "--prime-knight-main-height": "800px"
  });
  assert.deepEqual(cockpitCssVariables(null), {});
});

test("discovers one visible structural sidebar and the lowest valid composer ancestor", () => {
  const sidebar = element(rect(0, 0, 252, 992));
  const composerShell = element(rect(252, 800, 1334, 192));
  const composerMid = element(rect(280, 830, 1280, 120), { parentElement: composerShell });
  const textarea = element(rect(310, 870, 1180, 64), { parentElement: composerMid });
  const hiddenNavigation = element(rect(0, 0, 252, 992), { visible: false });
  const document = discoveryDocument(new Map([
    ['[data-testid*="sidebar"]', [sidebar]],
    ['[role="navigation"]', [hiddenNavigation]],
    ["nav", []],
    ["aside", []],
    ['[data-testid*="composer"]', []],
    ["textarea", [textarea]],
    ['[contenteditable="true"]', []]
  ]));

  assert.deepEqual(discoverCockpitAnchors(document, { width: 1586, height: 992 }), {
    sidebarElement: sidebar,
    composerElement: composerShell
  });
});

test("fails closed when equally ranked sidebar or composer candidates are ambiguous", () => {
  const sidebarA = element(rect(0, 0, 252, 992));
  const sidebarB = element(rect(0, 0, 252, 992));
  const composerA = element(rect(252, 800, 1334, 192));
  const composerB = element(rect(252, 800, 1334, 192));
  const textareaA = element(rect(310, 870, 1180, 64), { parentElement: composerA });
  const textareaB = element(rect(310, 870, 1180, 64), { parentElement: composerB });

  const ambiguousSidebar = discoveryDocument(new Map([
    ['[data-testid*="sidebar"]', [sidebarA, sidebarB]],
    ['[role="navigation"]', []], ["nav", []], ["aside", []],
    ['[data-testid*="composer"]', [composerA]], ["textarea", []], ['[contenteditable="true"]', []]
  ]));
  assert.equal(discoverCockpitAnchors(ambiguousSidebar, { width: 1586, height: 992 }), null);

  const ambiguousComposer = discoveryDocument(new Map([
    ['[data-testid*="sidebar"]', [sidebarA]],
    ['[role="navigation"]', []], ["nav", []], ["aside", []],
    ['[data-testid*="composer"]', []], ["textarea", [textareaA, textareaB]], ['[contenteditable="true"]', []]
  ]));
  assert.equal(discoverCockpitAnchors(ambiguousComposer, { width: 1586, height: 992 }), null);
});
