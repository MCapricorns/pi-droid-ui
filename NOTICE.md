# Notice

This package redistributes and combines two MIT-licensed projects by sting8k.

Thank you to sting8k for the original layout extension and theme collection.

## pi-droid-styling

- Source: https://github.com/sting8k/pi-droid-styling
- Copyright (c) 2026 sting8k
- License: MIT
- Upstream commit: 902b06e2484c1a18207a4dbca9f92ddd0f481a53

The gradient startup header in the upstream project was inspired by
https://github.com/EnderLiquid/pi-startup-header.

## pi-themes

- Source: https://github.com/sting8k/pi-themes
- Copyright (c) 2026 sting8k
- License: MIT
- Upstream commit: cde2ff476631e62b549eee195275f21522a953a4

## Why this package exists

Pi paints its native TUI before extensions run. Installing the two upstream
packages separately meant two git clones, dozens of TypeScript modules loaded
on `session_start`, and a late `resources_discover` patch for bundled themes.
That stretch is what you see as: native layout first, then the droid skin.

This package does not change Pi itself. It ships one npm/git package that:

1. Registers layout and themes together (`pi.extensions` + `pi.themes`).
2. Statically imports the session UI modules instead of lazy `import()`.
3. Bundles the extension to a single `dist/index.js` so Pi does not parse a
   tree of source files after the first frame.
4. Uses `~/.pi/agent/pi-droid-ui.json` with the defaults we actually run.
