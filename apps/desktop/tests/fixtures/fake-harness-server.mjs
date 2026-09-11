import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { createServer } from 'node:http'

const portIndex = process.argv.indexOf('--port')
const port = Number(process.argv[portIndex + 1])
const nonce = process.env.LDD_IDENTITY_NONCE
const token = 'test-launch-token'
if (process.env.LDD_TEST_LOG_SECRET) console.log(`DEEPSEEK_API_KEY=${process.env.LDD_TEST_LOG_SECRET}`)
const server = createServer((request, response) => {
  if (request.url === '/__ldd/identity') {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ product: 'LDD-Harness', nonce, pid: process.pid }))
    return
  }
  // 0.1.5 BrowserAuth：根路径无 token 无 cookie 即 401；带 token 即 200。
  const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
  if (requestUrl.pathname === '/' && requestUrl.searchParams.get('token') !== token) {
    response.statusCode = 401
    response.end('dsh web authentication required')
    return
  }
  response.statusCode = 200
  response.end('<!doctype html><title>Harness</title>')
})

let child
if (process.env.LDD_TEST_CHILD_PID_FILE) {
  child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
  })
  writeFileSync(process.env.LDD_TEST_CHILD_PID_FILE, String(child.pid))
}

server.listen(port, '127.0.0.1', () => {
  // 模拟 0.1.5 的 dsh web URL 行（带 BrowserAuth launch token）。
  console.log(`dsh web: http://127.0.0.1:${port}/?token=${token}`)
})
process.on('SIGTERM', () => {
  if (process.env.LDD_TEST_IGNORE_TERM === '1') return
  child?.kill('SIGTERM')
  server.close(() => process.exit(0))
})
