import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const rendererRoot = new URL('../src/renderer/', import.meta.url)

test('renderer recovery and plugin-risk copy stays complete and unprivileged', async () => {
  const [failure, risk, app] = await Promise.all([
    readFile(new URL('failure/FailurePage.tsx', rendererRoot), 'utf8'),
    readFile(new URL('confirm/PluginRiskDialog.tsx', rendererRoot), 'utf8'),
    readFile(new URL('App.tsx', rendererRoot), 'utf8'),
  ])

  for (const label of ['重试启动', '回滚到上一内核', '导入离线内核包', '打开日志目录']) {
    assert.match(failure, new RegExp(label))
  }
  for (const warning of ['当前 Windows 用户权限', '文件', '凭据', '网络']) {
    assert.match(risk, new RegExp(warning))
  }
  for (const source of [failure, risk, app]) {
    assert.doesNotMatch(source, /node:fs|node:child_process|from ['"]electron['"]|ipcRenderer/)
  }
})

test('renderer styling uses the neutral LDD palette', async () => {
  const styles = await readFile(new URL('styles.css', rendererRoot), 'utf8')
  assert.doesNotMatch(styles, /purple|violet|indigo|blueviolet/i)
  assert.match(styles, /--ink:\s*#171717/)
  assert.match(styles, /--paper:\s*#ffffff/)
  assert.match(styles, /--soft:\s*#ebebe7/)
})
