import { randomUUID } from "node:crypto"
import type { Backend, Exit, Process } from "./backend.ts"
import { Screen } from "./screen.ts"

export interface Info {
  readonly id: string
  readonly sessionID: string
  readonly title: string
  readonly command: string
  readonly cwd: string
  readonly pid: number
  readonly status: "running" | "exited"
  readonly exitCode: number | null
  readonly signal: string | null
  readonly startedAt: number
  readonly endedAt: number | null
  readonly lines: number
}

export interface SpawnInput {
  readonly sessionID: string
  readonly command: string
  readonly cwd: string
  readonly title?: string
  readonly env?: Record<string, string>
  readonly cols?: number
  readonly rows?: number
  readonly timeoutSeconds?: number
  readonly notifyOnExit?: boolean
}

export interface Terminal {
  readonly id: string
  readonly sessionID: string
  readonly title: string
  readonly command: string
  readonly cwd: string
  notifyOnExit: boolean
  readonly screen: Screen
  readonly process: Process
  readonly startedAt: number
  exit?: Exit & { readonly at: number }
  /** Number of logical lines the agent has already been shown, used to return only new output. */
  seen: number
  lastOutputAt: number
  /** Set when the user stopped the process from the TUI. */
  stoppedByUser?: boolean
  /** Tool calls currently waiting on this terminal. Their results already report an exit, so no notice is sent. */
  watchers: number
}

export interface ManagerOptions {
  readonly backend: Backend
  readonly cols: number
  readonly rows: number
  readonly scrollback: number
  readonly shell?: string
  readonly onChange: (terminal: Terminal) => void
  readonly onExit: (terminal: Terminal) => void
}

const CHANGE_INTERVAL_MS = 100
const KILL_GRACE_MS = 3000

export function shellArgv(command: string, shell?: string): string[] {
  if (process.platform === "win32") return [shell ?? process.env.ComSpec ?? "cmd.exe", "/d", "/s", "/c", command]
  return [shell ?? process.env.SHELL ?? "/bin/sh", "-c", command]
}

export class Manager {
  readonly #terminals = new Map<string, Terminal>()
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>()
  readonly #options: ManagerOptions

  constructor(options: ManagerOptions) {
    this.#options = options
  }

  spawn(input: SpawnInput): Terminal {
    const id = `pty_${randomUUID().replaceAll("-", "").slice(0, 10)}`
    const cols = input.cols ?? this.#options.cols
    const rows = input.rows ?? this.#options.rows
    let process!: Process
    const screen = new Screen(cols, rows, this.#options.scrollback, (reply) => process?.write(reply))
    process = this.#options.backend.spawn(
      shellArgv(input.command, this.#options.shell),
      {
        cwd: input.cwd,
        env: { ...(globalThis.process.env as Record<string, string>), TERM: "xterm-256color", ...input.env },
        cols,
        rows,
      },
      (data) => {
        screen.write(data)
        terminal.lastOutputAt = Date.now()
        this.#changed(terminal)
      },
    )
    const terminal: Terminal = {
      id,
      sessionID: input.sessionID,
      title: input.title?.trim() || input.command,
      command: input.command,
      cwd: input.cwd,
      notifyOnExit: input.notifyOnExit ?? true,
      screen,
      process,
      startedAt: Date.now(),
      seen: 0,
      lastOutputAt: Date.now(),
      watchers: 0,
    }
    this.#terminals.set(id, terminal)

    const timeout = input.timeoutSeconds
      ? setTimeout(() => this.kill(id), input.timeoutSeconds * 1000)
      : undefined
    process.exited.then(async (exit) => {
      clearTimeout(timeout)
      await screen.flush()
      terminal.exit = { ...exit, at: Date.now() }
      if (!this.#terminals.has(id)) return
      this.#options.onChange(terminal)
      this.#options.onExit(terminal)
    })
    this.#options.onChange(terminal)
    return terminal
  }

  get(id: string) {
    return this.#terminals.get(id)
  }

  list(sessionID?: string) {
    return [...this.#terminals.values()].filter((terminal) => !sessionID || terminal.sessionID === sessionID)
  }

  write(id: string, data: string) {
    const terminal = this.#require(id)
    if (terminal.exit) throw new Error(`Terminal ${id} has exited`)
    terminal.process.write(data)
  }

  kill(id: string, signal: NodeJS.Signals = "SIGTERM") {
    const terminal = this.#require(id)
    if (terminal.exit) return
    terminal.process.kill(signal)
    if (signal === "SIGKILL") return
    const escalate = setTimeout(() => terminal.exit || terminal.process.kill("SIGKILL"), KILL_GRACE_MS)
    terminal.process.exited.then(() => clearTimeout(escalate))
  }

  remove(id: string) {
    const terminal = this.#terminals.get(id)
    if (!terminal) return false
    this.#terminals.delete(id)
    clearTimeout(this.#timers.get(id))
    this.#timers.delete(id)
    if (!terminal.exit) terminal.process.kill("SIGKILL")
    terminal.screen.dispose()
    return true
  }

  removeAll(sessionID?: string) {
    for (const terminal of this.list(sessionID)) this.remove(terminal.id)
  }

  info(terminal: Terminal): Info {
    return {
      id: terminal.id,
      sessionID: terminal.sessionID,
      title: terminal.title,
      command: terminal.command,
      cwd: terminal.cwd,
      pid: terminal.process.pid,
      status: terminal.exit ? "exited" : "running",
      exitCode: terminal.exit?.code ?? null,
      signal: terminal.exit?.signal ?? null,
      startedAt: terminal.startedAt,
      endedAt: terminal.exit?.at ?? null,
      lines: terminal.screen.lines().length,
    }
  }

  #require(id: string) {
    const terminal = this.#terminals.get(id)
    if (!terminal) throw new Error(`No terminal with ID ${id}`)
    return terminal
  }

  #changed(terminal: Terminal) {
    if (this.#timers.has(terminal.id)) return
    this.#timers.set(
      terminal.id,
      setTimeout(() => {
        this.#timers.delete(terminal.id)
        if (this.#terminals.has(terminal.id)) this.#options.onChange(terminal)
      }, CHANGE_INTERVAL_MS),
    )
  }
}
