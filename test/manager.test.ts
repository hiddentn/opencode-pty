import { describe, expect, test } from "bun:test"
import { loadBackend } from "../src/backend.ts"
import { Manager, type Terminal } from "../src/manager.ts"
import { encodeKey, keyToBytes } from "../src/keys.ts"
import { settle } from "../src/tools.ts"

const exits: Terminal[] = []
const manager = new Manager({
  backend: (await loadBackend())!,
  cols: 80,
  rows: 24,
  scrollback: 1000,
  shell: "/bin/sh",
  onChange: () => {},
  onExit: (terminal) => exits.push(terminal),
})

const spawn = (command: string) => manager.spawn({ sessionID: "ses_test", command, cwd: process.cwd() })

const waitFor = async (terminal: Terminal, text: string, ms = 5000) => {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    await terminal.screen.flush()
    if (terminal.screen.lines().join("\n").includes(text)) return
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error(`Timed out waiting for "${text}". Got:\n${terminal.screen.lines().join("\n")}`)
}

describe("manager", () => {
  test("runs a command in a real TTY and reports the exit code", async () => {
    const terminal = spawn("tty; exit 3")
    const exit = await terminal.process.exited
    await settle(terminal, 1000)
    expect(exit.code).toBe(3)
    expect(terminal.screen.lines()[0]).toMatch(/^\/dev\/(pts|ttys)/)
    expect(exits).toContain(terminal)
  })

  test("accepts interactive input", async () => {
    const terminal = spawn('printf "name? "; read name; echo "hello $name"')
    await waitFor(terminal, "name?")
    manager.write(terminal.id, "opencode\r")
    await waitFor(terminal, "hello opencode")
    expect((await terminal.process.exited).code).toBe(0)
  })

  test("renders carriage-return progress output as the final state", async () => {
    const terminal = spawn('printf "progress 10%%\\rprogress 99%%\\ndone\\n"')
    await terminal.process.exited
    await settle(terminal, 1000)
    expect(terminal.screen.lines()).toEqual(["progress 99%", "done"])
  })

  test("interrupts with ctrl+c and kills with a signal", async () => {
    const interrupted = spawn("sleep 30")
    await new Promise((r) => setTimeout(r, 200))
    manager.write(interrupted.id, encodeKey("ctrl+c"))
    expect((await interrupted.process.exited).signal ?? "").not.toBe("")

    const killed = spawn("sleep 30")
    manager.kill(killed.id)
    expect((await killed.process.exited).signal).toBe("SIGTERM")
  })

  test("removes terminals and lists by session", async () => {
    const terminal = spawn("sleep 30")
    expect(manager.list("ses_test").map((t) => t.id)).toContain(terminal.id)
    expect(manager.list("ses_other")).toEqual([])
    manager.remove(terminal.id)
    expect(manager.get(terminal.id)).toBeUndefined()
    manager.removeAll()
  })
})

describe("encodeKey", () => {
  test("maps named and control keys", () => {
    expect(encodeKey("enter")).toBe("\r")
    expect(encodeKey("Ctrl+C")).toBe("\x03")
    expect(encodeKey("ctrl+d")).toBe("\x04")
    expect(encodeKey("up")).toBe("\x1b[A")
    expect(encodeKey("alt+b")).toBe("\x1bb")
    expect(() => encodeKey("hyper+x")).toThrow()
  })

  test("rebuilds terminal input from TUI key events", () => {
    const key = (name: string, sequence = "", mods: Partial<{ ctrl: boolean; meta: boolean; shift: boolean }> = {}) =>
      keyToBytes({ name, sequence, ctrl: false, meta: false, shift: false, ...mods })
    expect(key("c", "\x1b[99;5u", { ctrl: true })).toBe("\x03")
    expect(key("return", "\r")).toBe("\r")
    expect(key("a", "a")).toBe("a")
    expect(key("a", "\x1b[97;2u", { shift: true })).toBe("A")
    expect(key("up", "\x1b[A")).toBe("\x1b[A")
    expect(key("b", "b", { meta: true })).toBe("\x1bb")
    expect(key("space", " ")).toBe(" ")
  })
})
