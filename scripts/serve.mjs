import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer } from 'node:http'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.argv[2]) || 4173
const API_NAME = /^\/api\/([a-z][a-z0-9-]*)$/
const API_BODY_LIMIT = 65536
const PAGE_HEADERS = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')).headers.filter((rule) => /^\/[a-z0-9/-]+$/.test(rule.source))

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

async function api(req, res) {
  const match = API_NAME.exec(req.url.split('?')[0])
  const file = match && join(ROOT, 'api', `${match[1]}.mjs`)
  if (!file || !existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('Not Found')
    return
  }
  const handler = (await import(`${pathToFileURL(file).href}?v=${statSync(file).mtimeMs}`))[req.method]
  if (typeof handler !== 'function') {
    res.writeHead(405, { allow: 'GET, POST' })
    res.end()
    return
  }
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size <= API_BODY_LIMIT) chunks.push(chunk)
  }
  if (size > API_BODY_LIMIT) {
    res.writeHead(413)
    res.end()
    return
  }
  const headers = new Headers()
  for (const [name, value] of Object.entries(req.headers)) headers.set(name, Array.isArray(value) ? value.join(', ') : value)
  const url = new URL(req.url, `http://${req.headers.host || `127.0.0.1:${PORT}`}`)
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks)
  const response = await handler(new Request(url, { method: req.method, headers, body }))
  res.writeHead(response.status, Object.fromEntries(response.headers))
  res.end(Buffer.from(await response.arrayBuffer()))
}

createServer((req, res) => {
  const path = req.url.split('?')[0]
  if (path === '/api' || path.startsWith('/api/')) {
    api(req, res).catch((err) => {
      console.error(err)
      if (!res.headersSent) res.writeHead(500)
      res.end()
    })
    return
  }
  const file = resolve(req.url)
  if (!file) {
    const notFound = join(ROOT, '404.html')
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' })
    res.end(existsSync(notFound) ? readFileSync(notFound) : '<!doctype html><title>404</title>404 Not Found')
    return
  }
  const page = {}
  for (const rule of PAGE_HEADERS) if (rule.source === path) for (const { key, value } of rule.headers) page[key] = value
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', ...page })
  res.end(readFileSync(file))
}).listen(PORT, '127.0.0.1', () => {
  console.log(`\n  nycluxride dev server  http://127.0.0.1:${PORT}\n`)
  for (const p of ['/', '/services', '/fleet', '/locations', '/locations/manhattan', '/about', '/contact', '/faq', '/blog']) {
    console.log(`    http://127.0.0.1:${PORT}${p}`)
  }
  console.log('')
})
