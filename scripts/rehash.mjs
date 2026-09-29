import { readFileSync, writeFileSync, readdirSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ASSETS = join(ROOT, 'assets')
const HASHED = /^(.+)\.([A-Za-z0-9_-]{6,})\.(js|css|webp|webmanifest)$/

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

const renames = []
for (const name of readdirSync(ASSETS)) {
  const m = HASHED.exec(name)
  if (!m) continue
  const [, base, hash, ext] = m
  const want = token(readFileSync(join(ASSETS, name)))
  if (hash === want) continue
  const next = `${base}.${want}.${ext}`
  renameSync(join(ASSETS, name), join(ASSETS, next))
  renames.push([name, next])
}

if (!renames.length) {
  console.log('  every hashed asset already matches its content')
} else {
  const pages = htmlFiles(ROOT)
  let touched = 0
  for (const file of pages) {
    const before = readFileSync(file, 'utf8')
    let after = before
    for (const [from, to] of renames) after = after.split(from).join(to)
    if (after !== before) {
      writeFileSync(file, after)
      touched++
    }
  }
  for (const [from, to] of renames) console.log(`  ${from} -> ${to}`)
  console.log(`  rewrote references in ${touched} of ${pages.length} html files`)
}

const lock = {}
for (const name of readdirSync(ASSETS)) {
  if (!HASHED.test(name)) continue
  lock[name] = createHash('sha256').update(readFileSync(join(ASSETS, name))).digest('hex').slice(0, 16)
}
writeFileSync(join(ROOT, 'test', 'asset-hashes.json'), `${JSON.stringify(lock, null, 2)}\n`)
console.log(`  lockfile now holds ${Object.keys(lock).length} entries`)
