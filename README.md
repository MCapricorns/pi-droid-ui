# @ferris1225/pi-droid-ui

One Pi package for **droid layout** and **sting8k themes**.

This is a combined, bundled redistribution of:

- [`sting8k/pi-droid-styling`](https://github.com/sting8k/pi-droid-styling)
- [`sting8k/pi-themes`](https://github.com/sting8k/pi-themes)

Both are MIT. See [LICENSE](./LICENSE) and [NOTICE.md](./NOTICE.md). Thank you to sting8k.

## Why

Pi starts its native TUI **before** extensions bind. The original split (`pi-themes` + `pi-droid-styling`) then loaded many TypeScript modules and registered themes late, so startup showed the stock layout first and swapped after.

This package keeps the same look without patching Pi:

- One install instead of two git clones
- Themes declared on the package (`pi.themes`), not injected after discovery
- Session UI modules are static imports, bundled to `dist/index.js`

You will still get a short native first frame (that is Pi’s `ui.start()` order). The swap should be much shorter.

## Install

```sh
pi install npm:@ferris1225/pi-droid-ui
```

Or from Git:

```sh
pi install git:github.com/MCapricorns/pi-droid-ui
```

Do not install `git:github.com/sting8k/pi-themes` or `git:github.com/sting8k/pi-droid-styling` alongside this package.

## Config

User overrides live at `~/.pi/agent/pi-droid-ui.json`. Missing file is created from these defaults:

```json
{
  "alwaysExpanded": false,
  "maxExpandedLines": 50,
  "dimToolOutput": true,
  "customWorkingMessage": {
    "working": "Working",
    "thinking": "DeepThinking",
    "answering": "Answering",
    "running": "Cooking"
  },
  "presentationStyle": "droid",
  "userZoneStyle": "gemini",
  "inputBox": {
    "style": "auto"
  },
  "tasksWidgetStyle": "compact",
  "forceOSC11": false,
  "visibleChatTail": 30
}
```

| Setting | Options | Default | What it does |
| --- | --- | --- | --- |
| `alwaysExpanded` | `true`, `false` | `false` | Open tool output by default. `Ctrl+O` still toggles it. |
| `maxExpandedLines` | `0`–`1000` | `50` | Limit expanded tool output. Use `0` for no limit. |
| `dimToolOutput` | `true`, `false` | `true` | Dim tool output so the conversation stands out. |
| `customWorkingMessage` | Custom text | See example | Rename working / thinking / answering / running labels. |
| `presentationStyle` | `droid`, `reasonix` | `droid` | Conversation layout. |
| `userZoneStyle` | `gemini`, `droid`, `cli-dock`, `nvim` | `gemini` | Prompt, status rows, and footer. |
| `inputBox.style` | `auto`, `halfblock`, `line`, `solid` | `auto` | Input-box frame. |
| `tasksWidgetStyle` | `compact`, `default` | `compact` | Compact one-line tasks widget, or leave `pi-tasks` unchanged. |
| `forceOSC11` | `true`, `false` | `false` | Force terminal background sync on Windows/WSL. |
| `visibleChatTail` | `0` or more | `30` | Render only the newest N chat items. `0` renders everything. |

Select a theme with `/settings` or `settings.json`. Included names include `qoder-cli`, `neapple`, `onedark-pro`, `catppuccin`, and the rest of the upstream `pi-themes` set.

## Develop

```sh
npm install
npm run check
```

`npm run build` writes `dist/index.js`. Git and npm both ship that file so Pi does not compile sources at startup.

## Publish

Later releases use GitHub Actions OIDC (npm Trusted Publisher):

1. On npmjs.com → `@ferris1225/pi-droid-ui` → **Trusted Publisher**
2. GitHub org/user: `MCapricorns`
3. Repository: `pi-droid-ui`
4. Workflow: `publish.yml`
5. Leave Environment empty (same as our other packages).

Then bump `version` in `package.json`, tag/release or run **Publish npm**.

## License

MIT. Original work Copyright (c) 2026 sting8k. Modifications Copyright (c) 2026 MaMy.
