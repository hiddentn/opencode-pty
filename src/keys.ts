export const KEYS: Record<string, string> = {
  enter: "\r",
  return: "\r",
  tab: "\t",
  "shift+tab": "\x1b[Z",
  escape: "\x1b",
  esc: "\x1b",
  backspace: "\x7f",
  delete: "\x1b[3~",
  insert: "\x1b[2~",
  space: " ",
  up: "\x1b[A",
  down: "\x1b[B",
  right: "\x1b[C",
  left: "\x1b[D",
  home: "\x1b[H",
  end: "\x1b[F",
  pageup: "\x1b[5~",
  pagedown: "\x1b[6~",
}

const FUNCTION_KEYS: Record<string, string> = {
  f1: "\x1bOP",
  f2: "\x1bOQ",
  f3: "\x1bOR",
  f4: "\x1bOS",
  f5: "\x1b[15~",
  f6: "\x1b[17~",
  f7: "\x1b[18~",
  f8: "\x1b[19~",
  f9: "\x1b[20~",
  f10: "\x1b[21~",
  f11: "\x1b[23~",
  f12: "\x1b[24~",
}

const control = (char: string) => String.fromCharCode(char.toUpperCase().charCodeAt(0) & 0x1f)

/** Encodes a key name such as `enter`, `ctrl+c`, `alt+b`, or `f5` as the bytes a terminal would send. */
export function encodeKey(key: string): string {
  const name = key.trim().toLowerCase()
  const known = KEYS[name] ?? FUNCTION_KEYS[name]
  if (known) return known
  const ctrl = /^ctrl\+([a-z@\[\\\]^_])$/.exec(name)
  if (ctrl) return control(ctrl[1]!)
  const alt = /^alt\+(.)$/.exec(name)
  if (alt) return `\x1b${alt[1]}`
  throw new Error(`Unknown key "${key}". Use ${Object.keys(KEYS).join(", ")}, f1-f12, ctrl+<letter>, or alt+<key>.`)
}

export interface KeyLike {
  readonly name: string
  readonly sequence: string
  readonly ctrl: boolean
  readonly meta: boolean
  readonly shift: boolean
  readonly option?: boolean
}

/**
 * Translates a TUI key event back into legacy terminal input. The host may decode keys with the kitty keyboard
 * protocol, whose sequences programs in the PTY would not understand, so keys are rebuilt from their names.
 */
export function keyToBytes(key: KeyLike): string | undefined {
  const name = key.name?.toLowerCase() ?? ""
  const alt = key.meta || key.option
  if (key.ctrl && /^[a-z@\[\\\]^_]$/.test(name)) return (alt ? "\x1b" : "") + control(name)
  if (name === "tab" && key.shift) return KEYS["shift+tab"]
  const named = KEYS[name] ?? FUNCTION_KEYS[name]
  if (named && name !== "space") return (alt ? "\x1b" : "") + named
  const text = key.sequence && !key.sequence.startsWith("\x1b") ? key.sequence : name.length === 1 || name === "space" ? (name === "space" ? " " : key.shift ? name.toUpperCase() : name) : undefined
  if (!text) return undefined
  return (alt ? "\x1b" : "") + text
}
