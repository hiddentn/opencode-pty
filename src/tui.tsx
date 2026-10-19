import { Plugin, usePlugin } from "@opencode/plugin/tui"
import type { PanelInput } from "@opencode/plugin/tui/context"
import type { KeyEvent, PasteEvent } from "@opentui/core"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { keyToBytes } from "./keys.ts"
import { Pty, type TerminalInfo } from "./rpc.ts"

const PANEL = "pty.terminal"
const REFRESH_MS = 150
const SCREEN_LINES = 500
const STOP_TYPING = "\x1d" // ctrl+]

type Context = Parameters<Parameters<typeof Plugin.define>[0]["setup"]>[0]

function createTerminals(context: Context) {
  const pty = context.client.rpc(Pty)
  const [state, setState] = createStore<{
    bySession: Record<string, TerminalInfo[]>
    selected: Record<string, string | undefined>
    version: Record<string, number>
  }>({ bySession: {}, selected: {}, version: {} })
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  const location = (sessionID: string) => {
    const directory = context.data.session.get(sessionID)?.location.directory
    return directory ? { location: { directory } } : undefined
  }

  const refresh = async (sessionID: string) => {
    const result = await pty.list({ sessionID }, location(sessionID)).catch(() => undefined)
    if (!result) return
    setState("bySession", sessionID, reconcile((result as { terminals: TerminalInfo[] }).terminals))
  }

  const schedule = (sessionID: string) => {
    if (timers.has(sessionID)) return
    timers.set(
      sessionID,
      setTimeout(() => {
        timers.delete(sessionID)
        void refresh(sessionID)
      }, REFRESH_MS),
    )
  }

  const bump = (id: string) => setState("version", id, (version) => (version ?? 0) + 1)
  const offChanged = pty.events.on("changed", (event) => {
    const data = event.data as { id: string; sessionID: string }
    bump(data.id)
    schedule(data.sessionID)
  })
  const offRemoved = pty.events.on("removed", (event) => {
    const data = event.data as { id: string; sessionID: string }
    if (state.selected[data.sessionID] === data.id) setState("selected", data.sessionID, undefined)
    schedule(data.sessionID)
  })

  return {
    state,
    refresh,
    list: (sessionID: string) => state.bySession[sessionID] ?? [],
    select: (sessionID: string, id: string) => setState("selected", sessionID, id),
    screen: (sessionID: string, id: string) =>
      pty.screen({ id, limit: SCREEN_LINES }, location(sessionID)) as Promise<{
        info: TerminalInfo
        lines: string[]
      }>,
    write: (sessionID: string, id: string, data: string) => pty.write({ id, data }, location(sessionID)),
    kill: (sessionID: string, id: string) => pty.kill({ id }, location(sessionID)),
    remove: (sessionID: string, id: string) => pty.remove({ id }, location(sessionID)),
    dispose: () => {
      offChanged()
      offRemoved()
      for (const timer of timers.values()) clearTimeout(timer)
    },
  }
}

type Terminals = ReturnType<typeof createTerminals>

function statusLabel(info: TerminalInfo) {
  if (info.status === "running") return "running"
  if (info.signal) return info.signal
  return `exit ${info.exitCode}`
}

function useTone(info: () => TerminalInfo) {
  const context = usePlugin()
  return () => {
    const feedback = context.theme.text.feedback
    if (info().status === "running") return feedback.success.base
    return info().exitCode === 0 ? context.theme.text.muted : feedback.error.base
  }
}

function Row(props: { info: TerminalInfo; onSelect: () => void }) {
  const context = usePlugin()
  const tone = useTone(() => props.info)
  return (
    <box flexDirection="row" gap={1} onMouseUp={props.onSelect}>
      <text fg={tone()}>●</text>
      <text fg={context.theme.text.base} wrapMode="none" truncate flexGrow={1} flexShrink={1}>
        {props.info.title}
      </text>
      <text fg={context.theme.text.muted}>{statusLabel(props.info)}</text>
    </box>
  )
}

function Sidebar(props: { sessionID: string; terminals: Terminals }) {
  const context = usePlugin()
  onMount(() => void props.terminals.refresh(props.sessionID))
  createEffect(() => void props.terminals.refresh(props.sessionID))
  const list = () => props.terminals.list(props.sessionID)
  return (
    <Show when={list().length > 0}>
      <box flexDirection="column">
        <text fg={context.theme.text.base}>
          <b>Terminals</b>
        </text>
        <For each={list()}>
          {(info) => (
            <Row
              info={info}
              onSelect={() => {
                props.terminals.select(props.sessionID, info.id)
                context.ui.panel.open(PANEL)
              }}
            />
          )}
        </For>
      </box>
    </Show>
  )
}

function TerminalPanel(props: { panel: PanelInput; terminals: Terminals }) {
  const context = usePlugin()
  const sessionID = () => props.panel.sessionID
  const list = () => props.terminals.list(sessionID())
  const current = createMemo(() => {
    const selected = props.terminals.state.selected[sessionID()]
    return list().find((t) => t.id === selected) ?? list()[0]
  })
  const [lines, setLines] = createSignal<string[]>([])
  const [typing, setTyping] = createSignal(false)

  onMount(() => void props.terminals.refresh(sessionID()))

  createEffect(() => {
    const info = current()
    if (!info) return setLines([])
    void props.terminals.state.version[info.id]
    void props.terminals.screen(sessionID(), info.id).then(
      (screen) => current()?.id === info.id && setLines(screen.lines),
      () => {},
    )
  })

  let stopTyping: (() => void) | undefined
  const startTyping = () => {
    const info = current()
    if (!info || info.status !== "running" || stopTyping) return
    props.panel.focus()
    const popMode = context.keymap.mode.push("pty.typing")
    const send = (data: string) => void props.terminals.write(sessionID(), info.id, data).catch(() => stop())
    const onKey = (key: KeyEvent) => {
      if (key.eventType === "release") return
      key.preventDefault()
      key.stopPropagation()
      if (key.sequence === STOP_TYPING || (key.ctrl && key.name === "]")) return stop()
      const bytes = keyToBytes(key)
      if (bytes) send(bytes)
    }
    const onPaste = (event: PasteEvent) => {
      event.preventDefault()
      event.stopPropagation()
      send(new TextDecoder().decode(event.bytes))
    }
    const input = context.renderer.keyInput
    input.prependListener("keypress", onKey)
    input.prependListener("paste", onPaste)
    const stop = () => {
      input.off("keypress", onKey)
      input.off("paste", onPaste)
      popMode()
      stopTyping = undefined
      setTyping(false)
    }
    stopTyping = stop
    setTyping(true)
  }
  onCleanup(() => stopTyping?.())
  createEffect(() => {
    if (current()?.status !== "running" || !props.panel.focused) stopTyping?.()
  })

  const cycle = (step: number) => {
    const all = list()
    if (all.length < 2) return
    const index = all.findIndex((t) => t.id === current()?.id)
    props.terminals.select(sessionID(), all[(index + step + all.length) % all.length]!.id)
  }

  context.keymap.layer(() => ({
    enabled: () => props.panel.focused && !typing(),
    priority: 20,
    commands: [
      { id: "pty.panel.type", title: "Type into terminal", bind: "i", run: startTyping },
      { id: "pty.panel.next", title: "Next terminal", bind: "n", run: () => cycle(1) },
      { id: "pty.panel.previous", title: "Previous terminal", bind: "p", run: () => cycle(-1) },
      { id: "pty.panel.fullscreen", title: "Toggle full screen", bind: "f", run: () => props.panel.toggleFullscreen() },
      {
        id: "pty.panel.kill",
        title: "Stop terminal",
        bind: "k",
        run: async () => {
          const info = current()
          if (!info || info.status !== "running") return
          const ok = await context.ui.dialog.confirm({ title: "Stop terminal", message: `Stop "${info.title}"?` })
          if (ok) await props.terminals.kill(sessionID(), info.id).catch(() => {})
        },
      },
      {
        id: "pty.panel.remove",
        title: "Remove terminal",
        bind: "x",
        run: async () => {
          const info = current()
          if (!info) return
          if (info.status === "running") {
            const ok = await context.ui.dialog.confirm({
              title: "Remove terminal",
              message: `"${info.title}" is still running. Stop and remove it?`,
            })
            if (!ok) return
          }
          await props.terminals.remove(sessionID(), info.id).catch(() => {})
        },
      },
    ],
  }))

  const tone = useTone(() => current()!)
  const hint = () =>
    typing()
      ? "typing into the terminal · ctrl+] to stop"
      : current()?.status === "running"
        ? "i type · n/p switch · k stop · x remove · f full screen"
        : "n/p switch · x remove · f full screen"

  return (
    <box flexDirection="column" flexGrow={1} paddingLeft={1} paddingRight={1}>
      <Show
        when={current()}
        fallback={<text fg={context.theme.text.muted}>No terminals in this session.</text>}
      >
        {(info) => (
          <>
            <box flexDirection="row" gap={1} flexShrink={0}>
              <text fg={tone()}>●</text>
              <text fg={context.theme.text.base} wrapMode="none" truncate flexGrow={1} flexShrink={1}>
                <b>{info().title}</b>
              </text>
              <text fg={context.theme.text.muted}>
                {statusLabel(info())} · pid {info().pid}
                {list().length > 1 ? ` · ${list().findIndex((t) => t.id === info().id) + 1}/${list().length}` : ""}
              </text>
            </box>
            <text fg={context.theme.text.faint} wrapMode="none" truncate flexShrink={0}>
              {context.ui.format.path(info().cwd)} $ {info().command}
            </text>
            <scrollbox flexGrow={1} flexShrink={1} minHeight={0} stickyScroll stickyStart="bottom" marginTop={1}>
              <text fg={context.theme.text.base} wrapMode="char">
                {lines().join("\n") || " "}
              </text>
            </scrollbox>
            <text fg={typing() ? context.theme.text.feedback.warning.base : context.theme.text.muted} flexShrink={0}>
              {hint()}
            </text>
          </>
        )}
      </Show>
    </box>
  )
}

export default Plugin.define({
  id: "pty.tui",
  setup(context) {
    const terminals = createTerminals(context)

    const disposers = [
      context.ui.slot({
        append: "sidebar.content",
        render: (input) => <Sidebar sessionID={input.sessionID} terminals={terminals} />,
      }),
      context.ui.slot({
        append: "session.panel",
        render: (panel) => (
          <Show when={panel.name === PANEL}>
            <TerminalPanel panel={panel} terminals={terminals} />
          </Show>
        ),
      }),
    ]

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "pty.terminals",
          title: "Show terminals",
          group: "Terminals",
          palette: true,
          slash: { name: "terminals", aliases: ["pty"] },
          run: async () => {
            const route = context.ui.router.current()
            if (route.type !== "session") {
              context.ui.toast.show({ message: "Open a session to see its terminals", variant: "info" })
              return
            }
            await terminals.refresh(route.sessionID)
            const list = terminals.list(route.sessionID)
            if (list.length === 0) {
              context.ui.toast.show({ message: "No terminals in this session", variant: "info" })
              return
            }
            const id =
              list.length === 1
                ? list[0]!.id
                : await context.ui.dialog.select({
                    title: "Terminals",
                    options: list.map((info) => ({
                      title: info.title,
                      value: info.id,
                      description: `${statusLabel(info)} · ${info.command}`,
                    })),
                  })
            if (!id) return
            terminals.select(route.sessionID, id)
            context.ui.panel.open(PANEL)
          },
        },
      ],
    }))

    return () => {
      for (const dispose of disposers) dispose()
      terminals.dispose()
    }
  },
})
