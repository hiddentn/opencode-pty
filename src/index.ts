import { Plugin } from "@opencode/plugin"
import { loadBackend } from "./backend.ts"
import { Manager, type Terminal } from "./manager.ts"
import { Pty } from "./rpc.ts"
import { registerTools } from "./tools.ts"

const NOTIFY_TAIL_LINES = 20
const SCREEN_LIMIT = 500

const positiveInt = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback

export default Plugin.define({
  id: "pty",
  async setup(ctx) {
    const backend = await loadBackend()
    if (!backend) {
      console.warn("[pty] No PTY backend: run OpenCode on Bun 1.3.5+ or install node-pty. Terminal tools are disabled.")
      return
    }

    let rpc: Awaited<ReturnType<typeof ctx.rpc.register<typeof Pty>>> | undefined
    const emit = (event: "changed" | "removed", terminal: Terminal) =>
      void rpc?.events.emit(event, { id: terminal.id, sessionID: terminal.sessionID }).catch(() => {})

    const notify = async (terminal: Terminal) => {
      if (!terminal.notifyOnExit || terminal.watchers > 0) return
      const exit = terminal.exit!
      const how = terminal.stoppedByUser
        ? "was stopped by the user"
        : exit.signal
          ? `was stopped by ${exit.signal}`
          : `exited with code ${exit.code}`
      const tail = terminal.screen.lines().slice(-NOTIFY_TAIL_LINES).join("\n")
      await ctx.session
        .synthetic({
          sessionID: terminal.sessionID,
          text: `Terminal ${terminal.id} "${terminal.title}" ${how}. Last output:\n\n${tail || "(no output)"}`,
          // The user already knows about a stop they made, so the note waits for the next turn.
          resume: !terminal.stoppedByUser,
        })
        .catch((error) => console.warn(`[pty] Could not notify session ${terminal.sessionID}: ${String(error)}`))
    }

    const manager = new Manager({
      backend,
      cols: positiveInt(ctx.options.cols, 120),
      rows: positiveInt(ctx.options.rows, 30),
      scrollback: positiveInt(ctx.options.scrollback, 10_000),
      shell: typeof ctx.options.shell === "string" ? ctx.options.shell : undefined,
      onChange: (terminal) => emit("changed", terminal),
      onExit: (terminal) => void notify(terminal),
    })

    const find = (id: string) => manager.get(id)

    rpc = await ctx.rpc.register(Pty, {
      list: async (input) => {
        const { sessionID } = input as { sessionID?: string }
        return { terminals: manager.list(sessionID).map((t) => manager.info(t)) }
      },
      screen: async (input, context) => {
        const { id, limit } = input as { id: string; limit?: number }
        const terminal = find(id)
        if (!terminal) return context.error("not_found", `No terminal with ID ${id}`, { id })
        await terminal.screen.flush()
        const view = terminal.screen.viewport()
        return {
          info: manager.info(terminal),
          lines: terminal.screen.lines().slice(-positiveInt(limit, SCREEN_LIMIT)),
          cursor: view.cursor,
        }
      },
      write: async (input, context) => {
        const { id, data } = input as { id: string; data: string }
        const terminal = find(id)
        if (!terminal) return context.error("not_found", `No terminal with ID ${id}`, { id })
        if (terminal.exit) return context.error("exited", `Terminal ${id} has exited`, { id })
        manager.write(id, data)
        return { ok: true }
      },
      kill: async (input, context) => {
        const { id } = input as { id: string }
        const terminal = find(id)
        if (!terminal) return context.error("not_found", `No terminal with ID ${id}`, { id })
        terminal.stoppedByUser = true
        manager.kill(id)
        return { ok: true }
      },
      remove: async (input, context) => {
        const { id } = input as { id: string }
        const terminal = find(id)
        if (!terminal) return context.error("not_found", `No terminal with ID ${id}`, { id })
        manager.remove(id)
        emit("removed", terminal)
        return { ok: true }
      },
    })

    await ctx.tool.transform((editor) => registerTools(editor, ctx, manager))

    const controller = new AbortController()
    void (async () => {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        if (event.type !== "session.deleted") continue
        for (const terminal of manager.list(event.data.sessionID)) {
          manager.remove(terminal.id)
          emit("removed", terminal)
        }
      }
    })().catch(() => {})

    return () => {
      controller.abort()
      manager.removeAll()
    }
  },
})
