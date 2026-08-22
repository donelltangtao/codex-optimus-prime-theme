# codex擎天柱主题 v1

[中文安装说明](README.zh-CN.md) · [Troubleshooting](docs/TROUBLESHOOTING.md)

An unofficial macOS theme for the Codex desktop app, featuring 24 hourly
Optimus Prime-inspired backgrounds. It preserves the native Codex layout,
automatically adapts to window size, and can restore the official interface at
any time.

![codex擎天柱主题 v1 preview](assets/backgrounds/20.webp)

## What v1 includes

- 24 locked 2560×1440 WebP backgrounds, one for each local hour.
- Full-window responsive cover on standard, compact, wide, and ultrawide
  windows.
- Readability treatments for the sidebar, composer, output/source popovers,
  writing cards, and code blocks without moving native controls.
- A dedicated `Codex 擎天柱主题.app`, installed into the current user's
  Applications folder with a desktop shortcut.
- Four double-click macOS command entry points for install, fallback start,
  verify, and restore.
- Loopback-only runtime injection. The official app bundle and signature are
  never modified.

The optional Prime Knight pet experiment is not part of v1.

## v1.0.1 patch

- Reveals the hourly background through Codex and ChatGPT home-mode controls.
- Fixes remaining opaque suggestion cards, composers, output/source panels,
  writing cards, and code-block headers.
- Keeps native text, controls, geometry, click regions, and all 24 backgrounds
  unchanged.

## v1.0.2 patch

- Bundles the dedicated `Codex 擎天柱主题.app` launcher in the public ZIP.
- Installs the launcher into `~/Applications` and creates a desktop shortcut.
- Opens the themed Codex window automatically when installation finishes.
- Fixes Finder launches when Node.js is installed outside Finder's default
  PATH, and safely recovers a theme window that was previously closed.

## Requirements

- macOS on Apple silicon or Intel.
- The official Codex or ChatGPT desktop app whose bundle identifier is
  `com.openai.codex`.
- Node.js 20.10 or newer.

## Install

1. Download and unzip
   `codex-optimus-prime-theme-v1.0.2-macos.zip` from the GitHub Release.
2. Double-click `Install Prime Knight Theme.command`.
3. The installer places `Codex 擎天柱主题.app` in your user Applications
   folder (`~/Applications`), creates a desktop shortcut, and starts the
   themed window directly.
4. From then on, double-click the desktop `Codex 擎天柱主题.app`. If the
   desktop name was already occupied, choose Finder → Go → Home, open the
   `Applications` folder, and launch it there.
5. Double-click `Verify Prime Knight Theme.command` to confirm the theme is
   healthy.

`Start Prime Knight Theme.command` remains available in the unzipped folder as
a fallback launcher.

If macOS blocks a downloaded `.command` file, Control-click it, choose
**Open**, and confirm once.

The launcher App uses a local ad-hoc signature because this fan project is not
distributed through the Mac App Store. If macOS blocks the App the first time,
Control-click the installed App or desktop shortcut, choose **Open**, and
confirm once. Do not disable Gatekeeper or remove quarantine attributes.

## Restore the official interface

Double-click `Restore Native Codex.command`. This removes only the theme's
owned runtime state, closes the separately launched themed instance, and opens
the official app without theme arguments.

## Safety model

- No edits are made inside `Codex.app` or `ChatGPT.app`.
- Debugging listens only on `127.0.0.1` and uses a dynamically selected port.
- The launcher records and stops only the exact process it created.
- The app signature, publisher identity, and Gatekeeper status are checked
  before theme installation and startup.
- The isolated theme profile is stored under the current macOS user's Library.

## License and fan-art notice

The MIT License covers the software source and original documentation only.
The included backgrounds are unofficial AI-generated fan art and are not
licensed under MIT for separate reuse. This project is not affiliated with or
endorsed by OpenAI, Hasbro, Paramount, or any other rights holder. No rights in
Codex, ChatGPT, Transformers, Optimus Prime, film designs, trademarks, or
character likenesses are claimed or granted.

See [NOTICE.md](NOTICE.md), [ASSET_PROVENANCE.md](ASSET_PROVENANCE.md), and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Verify from source

```bash
npm test
npm run verify:backgrounds
npm run privacy
```

For common installation problems, see
[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).
