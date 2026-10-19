import type { Plugin } from "@opencode/plugin"
import { isAbsolute, resolve } from "node:path"
import { encodeKey, KEYS } from "./keys.ts"
import type { Manager, Terminal } from "./manager.ts"

type Context = Parameters<Plugin.Plugin["setup"]>[0]
type Editor = Parameters<Parameters<Context["tool"]["transform"]>[0]>[0]
type ToolContext = { readonly sessionID: string; readonly messageID: string; readonly id: string; readonly agent: string }

const MAX_LINES = 200
const QUIET_MS = 250

/** Resolves once output has been quiet for a moment, the process exited, or the wait budget ran out. */
export async function settle(terminal: Terminal, maxMs: number) {
  terminal.watchers++
  try {
    const deadline = Date.now() + maxMs
    while (Date.now() < deadline && !terminal.exit) {
      if (Date.now() - terminal.lastOutputAt >= QUIET_MS) break
      await new Promise((r) => setTimeout(r, Math.min(50, deadline - Date.now())))
    }
    await terminal.screen.flush()
  } finally {
    terminal.watchers--
  }
}

function status(terminal: Terminal) {
  if (!terminal.exit) return `running (pid ${terminal.process.pid})`
  if (terminal.exit.signal) return `exited by signal ${terminal.exit.signal}`
  return `exited with code ${terminal.exit.code}`
}

function numbered(lines: readonly string[], start: number) {
  const width = String(start + lines.length).length
  return lines.map((line, i) => `${String(start + i + 1).padStart(width)}| ${line}`).join("\n")
}

/** Output the agent has not seen yet. The last seen line is repeated because prompts and progress bars redraw it. */
function fresh(terminal: Terminal) {
  const lines = terminal.screen.lines()
  let start = terminal.seen > lines.length ? 0 : Math.max(0, terminal.seen - 1)
  let note = ""
  if (lines.length - start > MAX_LINES) {
    note = `[${lines.length - start - MAX_LINES} earlier lines omitted; use pty_read to page through them]\n`
    start = lines.length - MAX_LINES
  }
  terminal.seen = lines.length
  const body = lines.slice(start)
  return body.length ? `${note}${numbered(body, start)}` : "(no new output)"
}

export function registerTools(editor: Editor, ctx: Context, manager: Manager) {
  const require = (id: string) => {
    const terminal = manager.get(id)
    if (!terminal) throw new Error(`No terminal with ID ${id}. Use pty_list to see the available terminals.`)
    return terminal
  }

  const assertShell = (context: ToolContext, command: string) =>
    ctx.permission.assert({
      sessionID: context.sessionID,
      agent: context.agent,
      source: { type: "tool", messageID: context.messageID, id: context.id },
      action: "shell",
      resources: [command],
      save: [command],
    } as Parameters<Context["permission"]["assert"]>[0])

  const sessionDirectory = async (sessionID: string) => {
    try {
      return (await ctx.session.get({ sessionID })).location.directory
    } catch {
      return ctx.location.directory
    }
  }

  editor.add({
    name: "pty_spawn",
    description: [
      "Start a command in a new pseudo-terminal that keeps running in the background.",
      "Use this instead of shell when the program is interactive (REPLs, prompts, installers, ssh, full-screen apps),",
      "needs a real TTY, or when you need to send it input or stop it later. For a plain long-running command whose",
      "output you only need at the end, the shell tool with background=true is enough.",
      "Returns the terminal ID and the first output. You are notified when the process exits unless notifyOnExit is false.",
    ].join(" "),
    input: {
      type: "object",
      properties: {
        command: { type: "string", description: "Command line, run through the user's shell" },
        workdir: { type: "string", description: "Working directory. Defaults to the session directory" },
        title: { type: "string", description: "Short label shown in the terminal list" },
        env: { type: "object", additionalProperties: { type: "string" }, description: "Extra environment variables" },
        timeoutSeconds: { type: "integer", minimum: 1, description: "Kill the process after this many seconds" },
        notifyOnExit: { type: "boolean", description: "Wake this session when the process exits. Defaults to true" },
        wait: {
          type: "integer",
          minimum: 0,
          maximum: 30000,
          description: "Milliseconds to wait for initial output before returning. Defaults to 1000",
        },
      },
      required: ["command"],
      additionalProperties: false,
    },
    options: { codemode: false },
    async execute(raw, context) {
      const input = raw as {
        command: string
        workdir?: string
        title?: string
        env?: Record<string, string>
        timeoutSeconds?: number
        notifyOnExit?: boolean
        wait?: number
      }
      await assertShell(context, input.command)
      const base = await sessionDirectory(context.sessionID)
      const cwd = input.workdir ? (isAbsolute(input.workdir) ? input.workdir : resolve(base, input.workdir)) : base
      const terminal = manager.spawn({ ...input, sessionID: context.sessionID, cwd })
      await settle(terminal, input.wait ?? 1000)
      return {
        content: `Terminal ${terminal.id} "${terminal.title}" is ${status(terminal)}.\n\n${fresh(terminal)}`,
        metadata: { id: terminal.id, pid: terminal.process.pid },
      }
    },
  })

  editor.add({
    name: "pty_write",
    description: [
      "Send input to a terminal started with pty_spawn, then return the output that followed.",
      "Use text for characters and keys for special keys, which are sent after the text.",
      'For example text="npm init" with keys=["enter"], or keys=["ctrl+c"] to interrupt.',
      `Keys: ${Object.keys(KEYS).join(", ")}, f1-f12, ctrl+<letter>, alt+<key>.`,
    ].join(" "),
    input: {
      type: "object",
      properties: {
        id: { type: "string", description: "Terminal ID" },
        text: { type: "string", description: "Text to type. A newline is sent as Enter" },
        keys: { type: "array", items: { type: "string" }, description: "Special keys to press after the text" },
        wait: {
          type: "integer",
          minimum: 0,
          maximum: 30000,
          description: "Milliseconds to wait for output before returning. Defaults to 1000",
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
    options: { codemode: false },
    async execute(raw, context) {
      const input = raw as { id: string; text?: string; keys?: string[]; wait?: number }
      const terminal = require(input.id)
      const text = (input.text ?? "").replace(/\r?\n/g, "\r")
      const keys = (input.keys ?? []).map(encodeKey).join("")
      if (!text && !keys) throw new Error("Provide text, keys, or both.")
      // Anything submitted to a terminal can run a command, so it goes through the shell permission rules.
      const submitted = text.includes("\r") || keys.includes("\r")
      if (submitted && text.trim()) await assertShell(context, text.trim())
      await terminal.screen.flush()
      fresh(terminal)
      manager.write(terminal.id, text + keys)
      terminal.lastOutputAt = Date.now()
      await settle(terminal, input.wait ?? 1000)
      return { content: `Terminal ${terminal.id} is ${status(terminal)}.\n\n${fresh(terminal)}` }
    },
  })

  editor.add({
    name: "pty_read",
    description: [
      "Read a terminal's output as rendered text, without escape codes. By default returns the last 100 lines.",
      "Use offset and limit to page, pattern to search with a regular expression,",
      "or screen=true to get exactly what is visible, for full-screen programs.",
    ].join(" "),
    input: {
      type: "object",
      properties: {
        id: { type: "string", description: "Terminal ID" },
        offset: { type: "integer", minimum: 0, description: "Zero-based line to start from" },
        limit: { type: "integer", minimum: 1, maximum: 2000, description: "Maximum lines to return. Defaults to 100" },
        pattern: { type: "string", description: "Only return lines matching this regular expression" },
        ignoreCase: { type: "boolean", description: "Match pattern case-insensitively" },
        screen: { type: "boolean", description: "Return the visible screen with the cursor position" },
      },
      required: ["id"],
      additionalProperties: false,
    },
    options: { codemode: false },
    async execute(raw) {
      const input = raw as {
        id: string
        offset?: number
        limit?: number
        pattern?: string
        ignoreCase?: boolean
        screen?: boolean
      }
      const terminal = require(input.id)
      await terminal.screen.flush()
      const header = `Terminal ${terminal.id} "${terminal.title}" is ${status(terminal)}.`

      if (input.screen) {
        const view = terminal.screen.viewport()
        return {
          content: `${header} Screen ${view.cols}x${view.rows}, cursor at column ${view.cursor.x + 1}, row ${view.cursor.y + 1}.\n\n${view.text}`,
        }
      }

      const lines = terminal.screen.lines()
      terminal.seen = lines.length
      const limit = input.limit ?? 100
      if (input.pattern) {
        const regex = new RegExp(input.pattern, input.ignoreCase ? "i" : "")
        const matches = lines.flatMap((line, i) => (regex.test(line) ? [[i, line] as const] : []))
        const shown = matches.slice(input.offset ?? 0, (input.offset ?? 0) + limit)
        const width = String(lines.length).length
        const body = shown.map(([i, line]) => `${String(i + 1).padStart(width)}| ${line}`).join("\n")
        return { content: `${header} ${matches.length} of ${lines.length} lines match.\n\n${body || "(no matches)"}` }
      }

      const start = input.offset ?? Math.max(0, lines.length - limit)
      const body = lines.slice(start, start + limit)
      return {
        content: `${header} Lines ${body.length ? start + 1 : 0}-${start + body.length} of ${lines.length}.\n\n${numbered(body, start) || "(no output)"}`,
      }
    },
  })

  editor.add({
    name: "pty_list",
    description: "List the terminals started with pty_spawn in this session, with their status.",
    input: {
      type: "object",
      properties: { all: { type: "boolean", description: "Include terminals from every session" } },
      additionalProperties: false,
    },
    options: { codemode: false },
    async execute(raw, context) {
      const input = raw as { all?: boolean }
      const terminals = manager.list(input.all ? undefined : context.sessionID)
      if (!terminals.length) return { content: "No terminals." }
      return {
        content: terminals
          .map((t) => `${t.id}  ${status(t)}  "${t.title}"  in ${t.cwd}  (${t.screen.lines().length} lines)`)
          .join("\n"),
      }
    },
  })

  editor.add({
    name: "pty_kill",
    description: "Stop a terminal's process. Sends SIGTERM by default and SIGKILL if it is still running 3 seconds later.",
    input: {
      type: "object",
      properties: {
        id: { type: "string", description: "Terminal ID" },
        signal: { enum: ["SIGTERM", "SIGINT", "SIGHUP", "SIGKILL"], description: "Signal to send" },
        remove: { type: "boolean", description: "Also discard the terminal and its output" },
      },
      required: ["id"],
      additionalProperties: false,
    },
    options: { codemode: false },
    async execute(raw) {
      const input = raw as { id: string; signal?: NodeJS.Signals; remove?: boolean }
      const terminal = require(input.id)
      terminal.notifyOnExit = false
      manager.kill(terminal.id, input.signal)
      await Promise.race([terminal.process.exited, new Promise((r) => setTimeout(r, 3500))])
      await settle(terminal, 0)
      const tail = fresh(terminal)
      if (input.remove) manager.remove(terminal.id)
      return { content: `Terminal ${terminal.id} is ${status(terminal)}${input.remove ? " and was removed" : ""}.\n\n${tail}` }
    },
  })
}
