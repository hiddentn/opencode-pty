import { Rpc } from "@opencode/plugin/rpc"

const id = { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false } as const

const info = {
  type: "object",
  properties: {
    id: { type: "string" },
    sessionID: { type: "string" },
    title: { type: "string" },
    command: { type: "string" },
    cwd: { type: "string" },
    pid: { type: "number" },
    status: { enum: ["running", "exited"] },
    exitCode: { type: ["number", "null"] },
    signal: { type: ["string", "null"] },
    startedAt: { type: "number" },
    endedAt: { type: ["number", "null"] },
    lines: { type: "number" },
  },
  required: ["id", "sessionID", "title", "command", "cwd", "pid", "status", "startedAt", "lines"],
} as const

const done = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] } as const

const missing = {
  not_found: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
} as const

/** Shared contract between the server plugin, which owns the terminals, and the TUI plugin. */
export const Pty = Rpc.define({
  id: "pty",
  methods: {
    list: {
      input: { type: "object", properties: { sessionID: { type: "string" } }, additionalProperties: false },
      output: {
        type: "object",
        properties: { terminals: { type: "array", items: info } },
        required: ["terminals"],
      },
    },
    screen: {
      input: {
        type: "object",
        properties: { id: { type: "string" }, limit: { type: "number" } },
        required: ["id"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          info,
          lines: { type: "array", items: { type: "string" } },
          cursor: {
            type: "object",
            properties: { x: { type: "number" }, y: { type: "number" } },
            required: ["x", "y"],
          },
        },
        required: ["info", "lines", "cursor"],
      },
      errors: missing,
    },
    write: {
      input: {
        type: "object",
        properties: { id: { type: "string" }, data: { type: "string" } },
        required: ["id", "data"],
        additionalProperties: false,
      },
      output: done,
      errors: { ...missing, exited: missing.not_found },
    },
    kill: { input: id, output: done, errors: missing },
    remove: { input: id, output: done, errors: missing },
  },
  events: {
    changed: { schema: { type: "object", properties: { id: { type: "string" }, sessionID: { type: "string" } }, required: ["id", "sessionID"] } },
    removed: { schema: { type: "object", properties: { id: { type: "string" }, sessionID: { type: "string" } }, required: ["id", "sessionID"] } },
  },
})

export interface TerminalInfo {
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
