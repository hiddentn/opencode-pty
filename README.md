# opencode-pty

An OpenCode V2 plugin that gives the agent interactive terminals, with a live terminal panel in the TUI.

OpenCode's built-in `shell` tool already runs long commands in the background and tells the agent when they finish.
This plugin covers what it can't do:

- **Interactive input.** The agent can type into REPLs, answer prompts, drive installers, and press keys like
  Ctrl+C, arrows, or Tab.
- **A real TTY.** Programs see a terminal, so prompts, colors, progress bars, and full-screen apps behave normally.
- **Control.** The agent can list, read, search, and stop the processes it started.
- **Visibility.** You can watch every terminal from the TUI, type into it yourself, and stop or remove it.

No native addon is needed: on Bun, which OpenCode runs on, terminals use the built-in `Bun.Terminal` on Linux,
macOS, and Windows. On Node it falls back to `node-pty` if that is installed. Output is rendered by a headless
terminal emulator, so the agent reads what you would see on screen, without escape codes.

## Install

```sh
opencode plugin add github:hiddentn/opencode-pty
```

The TUI panel loads automatically with the server plugin. Pin a release by adding a tag, for example
`github:hiddentn/opencode-pty#v0.1.0`.

## Agent tools

| Tool        | What it does                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------ |
| `pty_spawn` | Start a command in a new terminal and return its first output                                    |
| `pty_write` | Type text and press keys (`enter`, `ctrl+c`, `up`, `tab`, `f1`-`f12`, …), then return new output |
| `pty_read`  | Read output by line range, search it with a regular expression, or get the visible screen        |
| `pty_list`  | List the terminals in this session                                                               |
| `pty_kill`  | Stop a process, optionally discarding its terminal                                               |

Starting a command and submitting input both go through your `shell` [permission rules](https://opencode.ai/v2/docs/permissions),
the same as the built-in shell tool.

When a process exits on its own, the session is woken with its exit status and last lines of output, so the agent
doesn't need to poll. Exits the agent already saw in a tool result, and stops you make from the TUI, don't wake it.

Terminals belong to the session that started them and are removed when that session is deleted or OpenCode stops.

## TUI

- **Sidebar:** a **Terminals** list for the current session, with live status. Click a row to open it.
- **Panel:** run `/terminals` (or `/pty`), or click a sidebar row, to open the terminal panel.

Keys in the panel:

| Key      | Action                                                     |
| -------- | ---------------------------------------------------------- |
| `i`      | Type into the terminal. Every key goes to the process      |
| `ctrl+]` | Stop typing                                                |
| `n`, `p` | Next or previous terminal                                  |
| `k`      | Stop the process                                           |
| `x`      | Remove the terminal                                        |
| `f`      | Toggle full screen                                         |

## Options

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "github:hiddentn/opencode-pty",
      "options": { "cols": 120, "rows": 30, "scrollback": 10000 },
    },
  ],
}
```

| Option       | Default        | Meaning                                         |
| ------------ | -------------- | ----------------------------------------------- |
| `cols`       | `120`          | Terminal width                                  |
| `rows`       | `30`           | Terminal height                                 |
| `scrollback` | `10000`        | Lines kept per terminal                         |
| `shell`      | `$SHELL`       | Shell used to run commands (`cmd.exe` on Windows) |

## Other clients

The server plugin exposes its terminals over [plugin RPC](https://opencode.ai/v2/docs/build/plugins/rpc) as `pty`,
with `list`, `screen`, `write`, `kill`, and `remove` methods and `changed` and `removed` events. Import the contract
from `@hiddentn/opencode-pty/rpc`.

## Development

```sh
git clone https://github.com/hiddentn/opencode-pty
cd opencode-pty
npm install
npm run build
npm run typecheck
npm test
```

OpenCode compiles Solid JSX only for plugin files outside `node_modules`, so the TUI is shipped precompiled in
`dist/tui.js`. Run `npm run build` after changing `src/tui.tsx` and commit the result; a test fails when `dist/` is
out of date.

To try local changes, add the clone's absolute path to a project's `plugins`.

## License

MIT
