// Generated from src/tui.tsx by scripts/build-tui.ts. Do not edit.
import { memo as _$memo } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { Plugin, usePlugin } from "@opencode/plugin/tui";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { keyToBytes } from "../src/keys.ts";
import { Pty } from "../src/rpc.ts";
const PANEL = "pty.terminal";
const REFRESH_MS = 150;
const SCREEN_LINES = 500;
const STOP_TYPING = "\x1d"; // ctrl+]

function createTerminals(context) {
  const pty = context.client.rpc(Pty);
  const [state, setState] = createStore({
    bySession: {},
    selected: {},
    version: {}
  });
  const timers = new Map();
  const location = sessionID => {
    const directory = context.data.session.get(sessionID)?.location.directory;
    return directory ? {
      location: {
        directory
      }
    } : undefined;
  };
  const refresh = async sessionID => {
    const result = await pty.list({
      sessionID
    }, location(sessionID)).catch(() => undefined);
    if (!result) return;
    setState("bySession", sessionID, reconcile(result.terminals));
  };
  const schedule = sessionID => {
    if (timers.has(sessionID)) return;
    timers.set(sessionID, setTimeout(() => {
      timers.delete(sessionID);
      void refresh(sessionID);
    }, REFRESH_MS));
  };
  const bump = id => setState("version", id, version => (version ?? 0) + 1);
  const offChanged = pty.events.on("changed", event => {
    const data = event.data;
    bump(data.id);
    schedule(data.sessionID);
  });
  const offRemoved = pty.events.on("removed", event => {
    const data = event.data;
    if (state.selected[data.sessionID] === data.id) setState("selected", data.sessionID, undefined);
    schedule(data.sessionID);
  });
  return {
    state,
    refresh,
    list: sessionID => state.bySession[sessionID] ?? [],
    select: (sessionID, id) => setState("selected", sessionID, id),
    screen: (sessionID, id) => pty.screen({
      id,
      limit: SCREEN_LINES
    }, location(sessionID)),
    write: (sessionID, id, data) => pty.write({
      id,
      data
    }, location(sessionID)),
    kill: (sessionID, id) => pty.kill({
      id
    }, location(sessionID)),
    remove: (sessionID, id) => pty.remove({
      id
    }, location(sessionID)),
    dispose: () => {
      offChanged();
      offRemoved();
      for (const timer of timers.values()) clearTimeout(timer);
    }
  };
}
function statusLabel(info) {
  if (info.status === "running") return "running";
  if (info.signal) return info.signal;
  return `exit ${info.exitCode}`;
}
function useTone(info) {
  const context = usePlugin();
  return () => {
    const feedback = context.theme.text.feedback;
    if (info().status === "running") return feedback.success.base;
    return info().exitCode === 0 ? context.theme.text.muted : feedback.error.base;
  };
}
function Row(props) {
  const context = usePlugin();
  const tone = useTone(() => props.info);
  return (() => {
    var _el$ = _$createElement("box"),
      _el$2 = _$createElement("text"),
      _el$4 = _$createElement("text"),
      _el$5 = _$createElement("text");
    _$insertNode(_el$, _el$2);
    _$insertNode(_el$, _el$4);
    _$insertNode(_el$, _el$5);
    _$setProp(_el$, "flexDirection", "row");
    _$setProp(_el$, "gap", 1);
    _$insertNode(_el$2, _$createTextNode(`●`));
    _$setProp(_el$4, "wrapMode", "none");
    _$setProp(_el$4, "truncate", true);
    _$setProp(_el$4, "flexGrow", 1);
    _$setProp(_el$4, "flexShrink", 1);
    _$insert(_el$4, () => props.info.title);
    _$insert(_el$5, () => statusLabel(props.info));
    _$effect(_p$ => {
      var _v$ = props.onSelect,
        _v$2 = tone(),
        _v$3 = context.theme.text.base,
        _v$4 = context.theme.text.muted;
      _v$ !== _p$.e && (_p$.e = _$setProp(_el$, "onMouseUp", _v$, _p$.e));
      _v$2 !== _p$.t && (_p$.t = _$setProp(_el$2, "fg", _v$2, _p$.t));
      _v$3 !== _p$.a && (_p$.a = _$setProp(_el$4, "fg", _v$3, _p$.a));
      _v$4 !== _p$.o && (_p$.o = _$setProp(_el$5, "fg", _v$4, _p$.o));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined
    });
    return _el$;
  })();
}
function Sidebar(props) {
  const context = usePlugin();
  onMount(() => void props.terminals.refresh(props.sessionID));
  createEffect(() => void props.terminals.refresh(props.sessionID));
  const list = () => props.terminals.list(props.sessionID);
  return _$createComponent(Show, {
    get when() {
      return list().length > 0;
    },
    get children() {
      var _el$6 = _$createElement("box"),
        _el$7 = _$createElement("text"),
        _el$8 = _$createElement("b");
      _$insertNode(_el$6, _el$7);
      _$setProp(_el$6, "flexDirection", "column");
      _$insertNode(_el$7, _el$8);
      _$insertNode(_el$8, _$createTextNode(`Terminals`));
      _$insert(_el$6, _$createComponent(For, {
        get each() {
          return list();
        },
        children: info => _$createComponent(Row, {
          info: info,
          onSelect: () => {
            props.terminals.select(props.sessionID, info.id);
            context.ui.panel.open(PANEL);
          }
        })
      }), null);
      _$effect(_$p => _$setProp(_el$7, "fg", context.theme.text.base, _$p));
      return _el$6;
    }
  });
}
function TerminalPanel(props) {
  const context = usePlugin();
  const sessionID = () => props.panel.sessionID;
  const list = () => props.terminals.list(sessionID());
  const current = createMemo(() => {
    const selected = props.terminals.state.selected[sessionID()];
    return list().find(t => t.id === selected) ?? list()[0];
  });
  const [lines, setLines] = createSignal([]);
  const [typing, setTyping] = createSignal(false);
  onMount(() => void props.terminals.refresh(sessionID()));
  createEffect(() => {
    const info = current();
    if (!info) return setLines([]);
    void props.terminals.state.version[info.id];
    void props.terminals.screen(sessionID(), info.id).then(screen => current()?.id === info.id && setLines(screen.lines), () => {});
  });
  let stopTyping;
  const startTyping = () => {
    const info = current();
    if (!info || info.status !== "running" || stopTyping) return;
    props.panel.focus();
    const popMode = context.keymap.mode.push("pty.typing");
    const send = data => void props.terminals.write(sessionID(), info.id, data).catch(() => stop());
    const onKey = key => {
      if (key.eventType === "release") return;
      key.preventDefault();
      key.stopPropagation();
      if (key.sequence === STOP_TYPING || key.ctrl && key.name === "]") return stop();
      const bytes = keyToBytes(key);
      if (bytes) send(bytes);
    };
    const onPaste = event => {
      event.preventDefault();
      event.stopPropagation();
      send(new TextDecoder().decode(event.bytes));
    };
    const input = context.renderer.keyInput;
    input.prependListener("keypress", onKey);
    input.prependListener("paste", onPaste);
    const stop = () => {
      input.off("keypress", onKey);
      input.off("paste", onPaste);
      popMode();
      stopTyping = undefined;
      setTyping(false);
    };
    stopTyping = stop;
    setTyping(true);
  };
  onCleanup(() => stopTyping?.());
  createEffect(() => {
    if (current()?.status !== "running" || !props.panel.focused) stopTyping?.();
  });
  const cycle = step => {
    const all = list();
    if (all.length < 2) return;
    const index = all.findIndex(t => t.id === current()?.id);
    props.terminals.select(sessionID(), all[(index + step + all.length) % all.length].id);
  };
  context.keymap.layer(() => ({
    enabled: () => props.panel.focused && !typing(),
    priority: 20,
    commands: [{
      id: "pty.panel.type",
      title: "Type into terminal",
      bind: "i",
      run: startTyping
    }, {
      id: "pty.panel.next",
      title: "Next terminal",
      bind: "n",
      run: () => cycle(1)
    }, {
      id: "pty.panel.previous",
      title: "Previous terminal",
      bind: "p",
      run: () => cycle(-1)
    }, {
      id: "pty.panel.fullscreen",
      title: "Toggle full screen",
      bind: "f",
      run: () => props.panel.toggleFullscreen()
    }, {
      id: "pty.panel.kill",
      title: "Stop terminal",
      bind: "k",
      run: async () => {
        const info = current();
        if (!info || info.status !== "running") return;
        const ok = await context.ui.dialog.confirm({
          title: "Stop terminal",
          message: `Stop "${info.title}"?`
        });
        if (ok) await props.terminals.kill(sessionID(), info.id).catch(() => {});
      }
    }, {
      id: "pty.panel.remove",
      title: "Remove terminal",
      bind: "x",
      run: async () => {
        const info = current();
        if (!info) return;
        if (info.status === "running") {
          const ok = await context.ui.dialog.confirm({
            title: "Remove terminal",
            message: `"${info.title}" is still running. Stop and remove it?`
          });
          if (!ok) return;
        }
        await props.terminals.remove(sessionID(), info.id).catch(() => {});
      }
    }]
  }));
  const tone = useTone(() => current());
  const hint = () => typing() ? "typing into the terminal · ctrl+] to stop" : current()?.status === "running" ? "i type · n/p switch · k stop · x remove · f full screen" : "n/p switch · x remove · f full screen";
  return (() => {
    var _el$0 = _$createElement("box");
    _$setProp(_el$0, "flexDirection", "column");
    _$setProp(_el$0, "flexGrow", 1);
    _$setProp(_el$0, "paddingLeft", 1);
    _$setProp(_el$0, "paddingRight", 1);
    _$insert(_el$0, _$createComponent(Show, {
      get when() {
        return current();
      },
      get fallback() {
        return (() => {
          var _el$1 = _$createElement("text");
          _$insertNode(_el$1, _$createTextNode(`No terminals in this session.`));
          _$effect(_$p => _$setProp(_el$1, "fg", context.theme.text.muted, _$p));
          return _el$1;
        })();
      },
      children: info => [(() => {
        var _el$11 = _$createElement("box"),
          _el$12 = _$createElement("text"),
          _el$14 = _$createElement("text"),
          _el$15 = _$createElement("b"),
          _el$16 = _$createElement("text"),
          _el$17 = _$createTextNode(` · pid `);
        _$insertNode(_el$11, _el$12);
        _$insertNode(_el$11, _el$14);
        _$insertNode(_el$11, _el$16);
        _$setProp(_el$11, "flexDirection", "row");
        _$setProp(_el$11, "gap", 1);
        _$setProp(_el$11, "flexShrink", 0);
        _$insertNode(_el$12, _$createTextNode(`●`));
        _$insertNode(_el$14, _el$15);
        _$setProp(_el$14, "wrapMode", "none");
        _$setProp(_el$14, "truncate", true);
        _$setProp(_el$14, "flexGrow", 1);
        _$setProp(_el$14, "flexShrink", 1);
        _$insert(_el$15, () => info().title);
        _$insertNode(_el$16, _el$17);
        _$insert(_el$16, () => statusLabel(info()), _el$17);
        _$insert(_el$16, () => info().pid, null);
        _$insert(_el$16, (() => {
          var _c$ = _$memo(() => list().length > 1);
          return () => _c$() ? ` · ${list().findIndex(t => t.id === info().id) + 1}/${list().length}` : "";
        })(), null);
        _$effect(_p$ => {
          var _v$5 = tone(),
            _v$6 = context.theme.text.base,
            _v$7 = context.theme.text.muted;
          _v$5 !== _p$.e && (_p$.e = _$setProp(_el$12, "fg", _v$5, _p$.e));
          _v$6 !== _p$.t && (_p$.t = _$setProp(_el$14, "fg", _v$6, _p$.t));
          _v$7 !== _p$.a && (_p$.a = _$setProp(_el$16, "fg", _v$7, _p$.a));
          return _p$;
        }, {
          e: undefined,
          t: undefined,
          a: undefined
        });
        return _el$11;
      })(), (() => {
        var _el$18 = _$createElement("text"),
          _el$19 = _$createTextNode(` $ `);
        _$insertNode(_el$18, _el$19);
        _$setProp(_el$18, "wrapMode", "none");
        _$setProp(_el$18, "truncate", true);
        _$setProp(_el$18, "flexShrink", 0);
        _$insert(_el$18, () => context.ui.format.path(info().cwd), _el$19);
        _$insert(_el$18, () => info().command, null);
        _$effect(_$p => _$setProp(_el$18, "fg", context.theme.text.faint, _$p));
        return _el$18;
      })(), (() => {
        var _el$20 = _$createElement("scrollbox"),
          _el$21 = _$createElement("text");
        _$insertNode(_el$20, _el$21);
        _$setProp(_el$20, "flexGrow", 1);
        _$setProp(_el$20, "flexShrink", 1);
        _$setProp(_el$20, "minHeight", 0);
        _$setProp(_el$20, "stickyScroll", true);
        _$setProp(_el$20, "stickyStart", "bottom");
        _$setProp(_el$20, "marginTop", 1);
        _$setProp(_el$21, "wrapMode", "char");
        _$insert(_el$21, () => lines().join("\n") || " ");
        _$effect(_$p => _$setProp(_el$21, "fg", context.theme.text.base, _$p));
        return _el$20;
      })(), (() => {
        var _el$22 = _$createElement("text");
        _$setProp(_el$22, "flexShrink", 0);
        _$insert(_el$22, hint);
        _$effect(_$p => _$setProp(_el$22, "fg", typing() ? context.theme.text.feedback.warning.base : context.theme.text.muted, _$p));
        return _el$22;
      })()]
    }));
    return _el$0;
  })();
}
export default Plugin.define({
  id: "pty.tui",
  setup(context) {
    const terminals = createTerminals(context);
    const disposers = [context.ui.slot({
      append: "sidebar.content",
      render: input => _$createComponent(Sidebar, {
        get sessionID() {
          return input.sessionID;
        },
        terminals: terminals
      })
    }), context.ui.slot({
      append: "session.panel",
      render: panel => _$createComponent(Show, {
        get when() {
          return panel.name === PANEL;
        },
        get children() {
          return _$createComponent(TerminalPanel, {
            panel: panel,
            terminals: terminals
          });
        }
      })
    })];
    context.keymap.layer(() => ({
      mode: "global",
      commands: [{
        id: "pty.terminals",
        title: "Show terminals",
        group: "Terminals",
        palette: true,
        slash: {
          name: "terminals",
          aliases: ["pty"]
        },
        run: async () => {
          const route = context.ui.router.current();
          if (route.type !== "session") {
            context.ui.toast.show({
              message: "Open a session to see its terminals",
              variant: "info"
            });
            return;
          }
          await terminals.refresh(route.sessionID);
          const list = terminals.list(route.sessionID);
          if (list.length === 0) {
            context.ui.toast.show({
              message: "No terminals in this session",
              variant: "info"
            });
            return;
          }
          const id = list.length === 1 ? list[0].id : await context.ui.dialog.select({
            title: "Terminals",
            options: list.map(info => ({
              title: info.title,
              value: info.id,
              description: `${statusLabel(info)} · ${info.command}`
            }))
          });
          if (!id) return;
          terminals.select(route.sessionID, id);
          context.ui.panel.open(PANEL);
        }
      }]
    }));
    return () => {
      for (const dispose of disposers) dispose();
      terminals.dispose();
    };
  }
});
