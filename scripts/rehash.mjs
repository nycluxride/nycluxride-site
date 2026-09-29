import { readFileSync, writeFileSync, readdirSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ASSETS = join(ROOT, 'assets')
const FONTS = join(ASSETS, 'fonts')
const HASHED = /^(.+)\.([A-Za-z0-9_-]{6,})\.(js|css|webp|webmanifest|woff2)$/
const REFERRERS = /\.(css|js|webmanifest)$/
const MAX_PASSES = 10

function token(buf) {
  return createHash('sha256').update(buf).digest('base64url').replace(/[-_]/g, '').slice(0, 8)
}

function htmlFiles(dir) {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const full = join(dir, e.name)
    if (e.isDirectory()) out.push(...htmlFiles(full))
    else if (e.name.endsWith('.html')) out.push(full)
  }
  return out
}

function outdated() {
  const fonts = []
  for (const name of readdirSync(FONTS).filter((n) => n.endsWith('.woff2'))) {
    const m = HASHED.exec(name)
    const want = token(readFileSync(join(FONTS, name)))
    if (!m || m[2] !== want) fonts.push([FONTS, name, `${m ? m[1] : name.slice(0, -6)}.${want}.woff2`])
  }
  if (fonts.length) return fonts
  const assets = []
  for (const name of readdirSync(ASSETS)) {
    const m = HASHED.exec(name)
    if (!m) continue
    const want = token(readFileSync(join(ASSETS, name)))
    if (m[2] !== want) assets.push([ASSETS, name, `${m[1]}.${want}.${m[3]}`])
  }
  return assets
}

const pages = htmlFiles(ROOT)
const first = new Map()
const touched = new Set()
for (let pass = 1; ; pass++) {
  const due = outdated()
  if (!due.length) break
  if (pass > MAX_PASSES) {
    console.error(`  hashes did not settle after ${MAX_PASSES} passes: ${due.map(([, from]) => from).join(', ')}`)
    process.exit(1)
  }
  for (const [dir, from, to] of due) {
    renameSync(join(dir, from), join(dir, to))
    first.set(to, first.get(from) || from)
    first.delete(from)
  }
  const files = [...pages, ...readdirSync(ASSETS).filter((n) => REFERRERS.test(n)).map((n) => join(ASSETS, n))]
  for (const file of files) {
    const before = readFileSync(file, 'utf8')
    let after = before
    for (const [, from, to] of due) after = after.split(from).join(to)
    if (after !== before) {
      writeFileSync(file, after)
      touched.add(file)
    }
  }
}

if (!first.size) {
  console.log('  every hashed asset already matches its content')
} else {
  for (const [to, from] of first) console.log(`  ${from} -> ${to}`)
  console.log(`  rewrote references in ${touched.size} files`)
}
