import { constants } from "node:os"

export interface SpawnOptions {
  readonly cwd: string
  readonly env: Record<string, string>
  readonly cols: number
  readonly rows: number
}

export interface Exit {
  readonly code: number | null
  readonly signal: string | null
}

export interface Process {
  readonly pid: number
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: NodeJS.Signals): void
  /** Resolves once the process has exited and its output has been delivered. */
  readonly exited: Promise<Exit>
}

export interface Backend {
  readonly name: string
  spawn(argv: readonly string[], options: SpawnOptions, onData: (data: string) => void): Process
}

const Bun = (globalThis as { Bun?: any }).Bun

/** Bun ships a PTY (`Bun.Terminal`, Bun 1.3.5+) on Linux, macOS, and Windows, so no native addon is needed. */
function bunBackend(): Backend | undefined {
  if (typeof Bun?.Terminal !== "function") return undefined
  return {
    name: `bun ${Bun.version}`,
    spawn(argv, options, onData) {
      const decoder = new TextDecoder()
      const proc = Bun.spawn([...argv], {
        cwd: options.cwd,
        env: options.env,
        terminal: {
          cols: options.cols,
          rows: options.rows,
          data: (_terminal: unknown, chunk: Uint8Array) => onData(decoder.decode(chunk, { stream: true })),
        },
      })
      const exited = (proc.exited as Promise<number>).then((code) => {
        proc.terminal?.close()
        return { code: proc.signalCode ? null : code, signal: proc.signalCode ?? null }
      })
      return {
        pid: proc.pid,
        write: (data) => proc.terminal?.write(data),
        resize: (cols, rows) => proc.terminal?.resize(cols, rows),
        kill: (signal = "SIGTERM") => proc.kill(signal),
        exited,
      }
    },
  }
}

/** Fallback for Node hosts: `node-pty` is an optional peer dependency because it is a native addon. */
async function nodeBackend(): Promise<Backend | undefined> {
  let pty: typeof import("node-pty")
  try {
    pty = await import("node-pty")
  } catch {
    return undefined
  }
  return {
    name: "node-pty",
    spawn(argv, options, onData) {
      const [file, ...args] = argv
      const child = pty.spawn(file!, args, {
        name: "xterm-256color",
        cwd: options.cwd,
        env: options.env,
        cols: options.cols,
        rows: options.rows,
      })
      child.onData(onData)
      const exited = new Promise<Exit>((resolve) =>
        child.onExit(({ exitCode, signal }) =>
          resolve(signal ? { code: null, signal: signalName(signal) } : { code: exitCode, signal: null }),
        ),
      )
      return {
        pid: child.pid,
        write: (data) => child.write(data),
        resize: (cols, rows) => child.resize(cols, rows),
        kill: (signal = "SIGTERM") => child.kill(process.platform === "win32" ? undefined : signal),
        exited,
      }
    },
  }
}

function signalName(signal: number) {
  const signals = constants.signals as Record<string, number>
  return Object.keys(signals).find((name) => signals[name] === signal) ?? String(signal)
}

let selected: Promise<Backend | undefined> | undefined

export function loadBackend() {
  selected ??= Promise.resolve(bunBackend() ?? nodeBackend())
  return selected
}
