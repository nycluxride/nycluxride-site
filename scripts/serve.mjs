import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.argv[2]) || 4173

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
}

function resolve(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]).replace(/\/+$/, '') || '/'
  const candidates = clean === '/' ? ['index.html'] : [`${clean.slice(1)}.html`, clean.slice(1), join(clean.slice(1), 'index.html')]
  for (const c of candidates) {
    const full = join(ROOT, c)
    if (existsSync(full) && statSync(full).isFile()) return full
  }
  return null
}

createServer((req, res) => {
  const file = resolve(req.url)
  if (!file) {
    const notFound = join(ROOT, '404.html')
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' })
    res.end(existsSync(notFound) ? readFileSync(notFound) : '<!doctype html><title>404</title>404 Not Found')
    return
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' })
  res.end(readFileSync(file))
}).listen(PORT, '127.0.0.1', () => {
  console.log(`\n  nycluxride dev server  http://127.0.0.1:${PORT}\n`)
  for (const p of ['/', '/services', '/fleet', '/locations', '/locations/manhattan', '/about', '/contact', '/faq', '/blog']) {
    console.log(`    http://127.0.0.1:${PORT}${p}`)
  }
  console.log('')
})
