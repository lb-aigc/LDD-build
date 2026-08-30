import { useEffect, useState } from 'react'

import type {
  LddRendererApi,
  RuntimeProgressEvent,
  RuntimeStatusView,
} from '../../main/ipc/contracts.ts'
import {
  cancelActivation,
  completeDownload,
  confirmActivation,
  createUpdateFlow,
  requestActivation,
  setCandidate,
  type UpdateFlow,
} from './model.ts'
import { RuntimeProgress } from './RuntimeProgress.tsx'

export interface UpdatePanelProps {
  readonly api: LddRendererApi
}

export function UpdatePanel({ api }: UpdatePanelProps) {
  const [status, setStatus] = useState<RuntimeStatusView | null>(null)
  const [flow, setFlow] = useState<UpdateFlow>(() => createUpdateFlow(null))
  const [progress, setProgress] = useState<RuntimeProgressEvent | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dataDirectory, setDataDirectoryState] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const unsubscribe = api.subscribeProgress((event) => {
      if (active) setProgress(event)
    })
    void api
      .getStatus()
      .then((next) => {
        if (!active) return
        setStatus(next)
        setFlow(createUpdateFlow(next.availableVersion))
      })
      .catch((cause: unknown) => {
        if (active) setError(errorMessage(cause))
      })
    void api
      .getDataDirectory()
      .then((result) => {
        if (active) setDataDirectoryState(result.dataDirectory)
      })
      .catch(() => undefined)
    return () => {
      active = false
      unsubscribe()
    }
  }, [api])

  const check = async () => {
    await runAction('check', async () => {
      const result = await api.checkForUpdates()
      const availableVersion = readAvailableVersion(result)
      if (availableVersion !== null) {
        setFlow((current) => setCandidate(current, availableVersion))
        setStatus((current) =>
          current === null ? current : { ...current, availableVersion },
        )
      } else {
        const refreshed = await api.getStatus()
        setStatus(refreshed)
        setFlow((current) => setCandidate(current, refreshed.availableVersion))
      }
    })
  }

  const download = async () => {
    if (flow.candidateVersion === null) return
    const version = flow.candidateVersion
    await runAction('download', async () => {
      await api.downloadUpdate(version)
      setFlow((current) => {
        if (current.candidateVersion !== version) return current
        return completeDownload(current)
      })
    })
  }

  const activate = async () => {
    const confirmed = confirmActivation(flow)
    setFlow(confirmed.next)
    await runAction('activate', async () => {
      await api.activateVersion(confirmed.version)
      const refreshed = await api.getStatus()
      setStatus(refreshed)
      setFlow(createUpdateFlow(refreshed.availableVersion))
    })
  }

  const setImageMode = async (mode: 'standard' | 'large') => {
    await runAction('image-mode', async () => {
      await api.setImageMode(mode)
      setStatus((current) => (current === null ? current : { ...current, imageMode: mode }))
    })
  }

  const changeDataDirectory = async () => {
    await runAction('data-directory', async () => {
      const result = await api.setDataDirectory()
      if (!result.cancelled) setDataDirectoryState(result.dataDirectory)
    })
  }

  const runAction = async (name: string, action: () => Promise<void>) => {
    setBusy(name)
    setError(null)
    try {
      await action()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(null)
    }
  }

  if (status === null) {
    return (
      <main className="page-shell centered" aria-busy="true">
        <div className="spinner" aria-hidden="true" />
        <p>{error ?? '正在读取内核状态…'}</p>
      </main>
    )
  }

  return (
    <main className="page-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">HARNESS RUNTIME</p>
          <h1>内核更新</h1>
          <p className="hero-copy">更新 DeepSeek Harness，不替换 LDD 桌面外壳。</p>
        </div>
        <span className={`channel-badge ${status.channel}`}>{channelLabel(status.channel)}</span>
      </header>

      <section className="status-grid" aria-label="版本状态">
        <VersionCard label="LDD 桌面端" value={status.desktopVersion} />
        <VersionCard label="当前内核" value={status.activeVersion ?? 'Fallback'} />
        <VersionCard label="上一可用" value={status.lastKnownGoodVersion ?? '尚未记录'} />
        <VersionCard label="可用更新" value={flow.candidateVersion ?? '已是最新'} accent />
      </section>

      <section className="action-card">
        <div>
          <h2>{flow.candidateVersion === null ? '当前无需更新' : `Harness ${flow.candidateVersion}`}</h2>
          <p>
            下载会在独立目录完成校验和健康检查；只有你确认后，LDD 才会重启并切换内核。
          </p>
        </div>
        <div className="button-row">
          <button className="button secondary" disabled={busy !== null} onClick={() => void check()}>
            {busy === 'check' ? '正在检查…' : '检查更新'}
          </button>
          {flow.candidateVersion !== null && flow.downloadedVersion === null ? (
            <button className="button primary" disabled={busy !== null} onClick={() => void download()}>
              {busy === 'download' ? '正在下载…' : '下载新内核'}
            </button>
          ) : null}
          {flow.downloadedVersion !== null ? (
            <button
              className="button primary"
              disabled={busy !== null}
              onClick={() => setFlow((current) => requestActivation(current))}
            >
              切换到新内核
            </button>
          ) : null}
        </div>
      </section>

      <RuntimeProgress progress={progress} />

      <section className="settings-card">
        <div>
          <h2>图片输入模式</h2>
          <p>普通模式单图最高 20 MiB；高级模式单图最高 64 MiB，并保持像素与总量防护。</p>
        </div>
        <select
          aria-label="图片输入模式"
          disabled={busy !== null}
          value={status.imageMode}
          onChange={(event) => void setImageMode(event.target.value as 'standard' | 'large')}
        >
          <option value="standard">普通 · 20 MiB</option>
          <option value="large">高级 · 64 MiB</option>
        </select>
      </section>

      <section className="settings-card">
        <div>
          <h2>数据目录</h2>
          <p>
            会话、图片附件、内核与日志的存放位置。
            {dataDirectory === null
              ? '当前使用系统盘默认位置。'
              : `当前：${dataDirectory}`}
          </p>
        </div>
        <button
          className="button secondary"
          disabled={busy !== null}
          onClick={() => void changeDataDirectory()}
        >
          {busy === 'data-directory' ? '正在迁移…' : '更改数据目录'}
        </button>
      </section>

      {status.diagnostics.length > 0 ? (
        <section className="diagnostics" aria-label="诊断信息">
          <h2>诊断信息</h2>
          <ul>{status.diagnostics.map((item) => <li key={item}>{item}</li>)}</ul>
        </section>
      ) : null}
      {error !== null ? <p className="error-banner" role="alert">{error}</p> : null}

      {flow.confirmingActivation ? (
        <div className="modal-backdrop">
          <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="activate-title">
            <p className="eyebrow">FINAL CONFIRMATION</p>
            <h2 id="activate-title">确认切换 Harness 内核？</h2>
            <p>
              LDD 将停止当前 Harness，切换到 {flow.downloadedVersion} 并重新启动。启动失败会自动回滚。
            </p>
            <div className="button-row end">
              <button className="button secondary" onClick={() => setFlow((current) => cancelActivation(current))}>
                暂不切换
              </button>
              <button className="button primary" onClick={() => void activate()}>
                确认并重启
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  )
}

function VersionCard({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <article className={`version-card${accent ? ' accent' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  )
}

function channelLabel(channel: RuntimeStatusView['channel']): string {
  return channel === 'stable' ? 'Stable' : 'Prerelease'
}

function readAvailableVersion(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record.kind !== 'available') return null
  if (typeof record.release !== 'object' || record.release === null || Array.isArray(record.release)) return null
  const version = (record.release as Record<string, unknown>).version
  return typeof version === 'string' ? version : null
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : '操作未完成，请查看日志后重试。'
}
