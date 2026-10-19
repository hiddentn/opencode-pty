import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { buildTui } from "../scripts/build-tui.ts"

test("dist/tui.js is up to date with src/tui.tsx (run npm run build:tui)", async () => {
  const committed = await readFile(new URL("../dist/tui.js", import.meta.url), "utf8")
  expect(committed).toBe(await buildTui())
})
