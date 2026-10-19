import xterm from "@xterm/headless"

export interface Viewport {
  readonly text: string
  readonly cols: number
  readonly rows: number
  readonly cursor: { readonly x: number; readonly y: number }
}

/**
 * A headless terminal emulator fed with the process output. Reading from it gives what a person would see:
 * carriage-return progress bars collapse to their final state, cursor movement and clears are applied, and
 * escape sequences are gone.
 */
export class Screen {
  readonly #terminal: InstanceType<typeof xterm.Terminal>
  #pending: Promise<void> = Promise.resolve()

  constructor(cols: number, rows: number, scrollback: number, reply: (data: string) => void) {
    this.#terminal = new xterm.Terminal({ cols, rows, scrollback, allowProposedApi: true })
    // Answers terminal queries such as cursor-position reports, which some programs wait for.
    this.#terminal.onData(reply)
  }

  write(data: string) {
    this.#pending = new Promise((resolve) => this.#terminal.write(data, resolve))
  }

  /** Waits until every chunk written so far has been parsed. */
  flush() {
    return this.#pending
  }

  resize(cols: number, rows: number) {
    this.#terminal.resize(cols, rows)
  }

  /** Scrollback plus the visible screen as logical lines: soft-wrapped rows are joined, trailing blanks dropped. */
  lines(): string[] {
    const buffer = this.#terminal.buffer.active
    const lines: string[] = []
    for (let i = 0; i < buffer.length; i++) {
      const line = buffer.getLine(i)
      if (!line) continue
      const text = line.translateToString(true)
      if (line.isWrapped && lines.length > 0) lines[lines.length - 1] += text
      else lines.push(text)
    }
    while (lines.length > 0 && lines.at(-1)!.trim() === "") lines.pop()
    return lines
  }

  /** The visible screen only, row for row. Best for full-screen programs such as editors or `top`. */
  viewport(): Viewport {
    const buffer = this.#terminal.buffer.active
    const rows: string[] = []
    for (let i = 0; i < this.#terminal.rows; i++) {
      rows.push(buffer.getLine(buffer.viewportY + i)?.translateToString(true) ?? "")
    }
    return {
      text: rows.join("\n"),
      cols: this.#terminal.cols,
      rows: this.#terminal.rows,
      cursor: { x: buffer.cursorX, y: buffer.cursorY },
    }
  }

  dispose() {
    this.#terminal.dispose()
  }
}
