import { useState } from 'react'

import type { LddRendererApi } from '../../main/ipc/contracts.ts'

export interface FailurePageProps {
  readonly api: LddRendererApi
  readonly diagnostics?: readonly string[]
}

export function FailurePage({ api, diagnostics = [] }: FailurePageProps) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async (name: string, action: () => Promise<unknown>) => {
    setBusy(name)
    setError(null)
    try {
      await action()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '恢复操作未完成。')
    } finally {
      setBusy(null)
    }
  }

  return (
    <main className="page-shell failure-shell">
      <div className="failure-mark" aria-hidden="true">!</div>
      <p className="eyebrow">SAFE RECOVERY</p>
      <h1>Harness 内核未能启动</h1>
      <p className="failure-copy">
        LDD 没有连接到未经验证的本地服务。你可以重试、回滚，或导入已校验的离线内核包。
      </p>

      <div className="recovery-grid">
        <button className="recovery-action" disabled={busy !== null} onClick={() => void run('retry', () => api.retryBoot())}>
          <strong>{busy === 'retry' ? '正在重试…' : '重试启动'}</strong>
          <span>再次选择安全内核并验证身份</span>
        </button>
        <button className="recovery-action" disabled={busy !== null} onClick={() => void run('rollback', () => api.rollback())}>
          <strong>{busy === 'rollback' ? '正在回滚…' : '回滚到上一内核'}</strong>
          <span>恢复 last-known-good 版本</span>
        </button>
        <button className="recovery-action" disabled={busy !== null} onClick={() => void run('import', () => api.importOfflineRuntime())}>
          <strong>{busy === 'import' ? '正在导入…' : '导入离线内核包'}</strong>
          <span>由 LDD 选择文件并完成验证</span>
        </button>
        <button className="recovery-action" disabled={busy !== null} onClick={() => void run('logs', () => api.openLogDirectory())}>
          <strong>{busy === 'logs' ? '正在打开…' : '打开日志目录'}</strong>
          <span>查看已脱敏的启动和更新日志</span>
        </button>
      </div>

      {diagnostics.length > 0 ? (
        <section className="diagnostics" aria-label="故障诊断">
          <h2>故障诊断</h2>
          <ul>{diagnostics.map((item) => <li key={item}>{item}</li>)}</ul>
        </section>
      ) : null}
      {error !== null ? <p className="error-banner" role="alert">{error}</p> : null}
    </main>
  )
}
