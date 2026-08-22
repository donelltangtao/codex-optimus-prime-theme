# Changelog

## 1.0.2 — 2026-08-22

Launcher and installation-discovery patch.

- Includes the dedicated `Codex 擎天柱主题.app` in the public release ZIP.
- Installs the launcher in `~/Applications`, creates a desktop shortcut, and
  starts the themed window directly after installation.
- Preserves unrelated applications or desktop items instead of overwriting
  them, using a theme-specific ownership marker before any replacement.
- Documents the one-time macOS Control-click procedure for the locally signed
  launcher without weakening Gatekeeper.
- Resolves Node.js for Finder and LaunchServices launches.
- Safely recovers a closed themed Codex runtime on the next launch.
- Leaves the accepted theme surfaces and all 24 hourly backgrounds unchanged.

## 1.0.1 — 2026-08-21

Visual compatibility patch for current Codex and ChatGPT desktop layouts.

- Reveals the background through home-mode toggles, the four Codex suggestion
  cards, and both compact and expanded composers.
- Handles collapsed sidebars, project file trees, output/source popovers,
  writing cards, action pills, and code-block headers that enter the viewport
  after scrolling.
- Preserves all native text, controls, geometry, click regions, and the locked
  set of 24 hourly backgrounds.
- Retains the v1 safety boundary: no app-bundle modification and exact
  theme-process recovery.

## 1.0.0 — 2026-08-21

First complete public release of **codex擎天柱主题 v1** for macOS.

- Includes 24 unique 2560×1440 hourly backgrounds.
- Covers the complete window across compact, standard, wide, and ultrawide sizes.
- Preserves native Codex layout, controls, input geometry, and click regions.
- Improves background visibility through the sidebar, composer, output/source
  popovers, writing cards, and code blocks.
- Provides double-click install, start, verify, and native-restore commands.
- Keeps the official application bundle and signature unchanged.
- Excludes the experimental Prime Knight pet and all local test evidence.
