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
- Four double-click macOS entry points for install, start, verify, and restore.
- Loopback-only runtime injection. The official app bundle and signature are
  never modified.

The optional Prime Knight pet experiment is not part of v1.

## Requirements

- macOS on Apple silicon or Intel.
- The official Codex or ChatGPT desktop app whose bundle identifier is
  `com.openai.codex`.
- Node.js 20.10 or newer.

## Install

1. Download and unzip
   `codex-optimus-prime-theme-v1.0.0-macos.zip` from the GitHub Release.
2. Double-click `Install Prime Knight Theme.command`.
3. Double-click `Start Prime Knight Theme.command`.
4. Double-click `Verify Prime Knight Theme.command` to confirm the theme is
   healthy.

If macOS blocks a downloaded `.command` file, Control-click it, choose
**Open**, and confirm once.

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
