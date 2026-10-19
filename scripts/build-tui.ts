// OpenCode applies its Solid JSX transform only to files outside node_modules, so an installed package has to ship
// the TUI already compiled. This uses the same Babel presets as that transform.
import { transformAsync } from "@babel/core"
// @ts-expect-error untyped
import typescript from "@babel/preset-typescript"
// @ts-expect-error untyped
import solid from "babel-preset-solid"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const source = `${root}src/tui.tsx`
const output = `${root}dist/tui.js`

export async function buildTui() {
  const result = await transformAsync(await readFile(source, "utf8"), {
    filename: source,
    configFile: false,
    babelrc: false,
    presets: [[solid, { moduleName: "@opentui/solid", generate: "universal" }], [typescript]],
  })
  if (!result?.code) throw new Error("Solid transform produced no output")
  // dist/ sits beside src/, so sibling imports move up one level.
  const code = result.code.replace(/from "\.\/([^"]+)"/g, 'from "../src/$1"')
  return `// Generated from src/tui.tsx by scripts/build-tui.ts. Do not edit.\n${code}\n`
}

if (import.meta.main) {
  await mkdir(`${root}dist`, { recursive: true })
  await writeFile(output, await buildTui())
  console.log(`wrote ${output}`)
}
