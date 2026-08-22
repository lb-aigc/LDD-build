import { useState } from 'react'

import type { LddRendererApi } from '../main/ipc/contracts.ts'
import { PluginRiskDialog } from './confirm/PluginRiskDialog.tsx'
import { FailurePage } from './failure/FailurePage.tsx'
import { UpdatePanel } from './update/UpdatePanel.tsx'

export interface AppProps {
  readonly api: LddRendererApi
  readonly view?: 'update' | 'failure'
}

export function App({ api, view = routeFromLocation() }: AppProps) {
  const [showPluginRisk, setShowPluginRisk] = useState(pluginRiskFromLocation)

  if (view === 'failure') return <FailurePage api={api} />

  return (
    <div className="app-frame">
      <nav className="app-bar" aria-label="LDD 管理">
        <span className="brand">LDD</span>
        <button className="text-button" onClick={() => setShowPluginRisk(true)}>插件中心</button>
      </nav>
      <UpdatePanel api={api} />
      <PluginRiskDialog
        open={showPluginRisk}
        onCancel={() => setShowPluginRisk(false)}
        onConfirm={() => {
          setShowPluginRisk(false)
          void api.openPluginCenter()
        }}
      />
    </div>
  )
}

function pluginRiskFromLocation(): boolean {
  return new URLSearchParams(window.location.search).get('pluginRisk') === '1'
}

function routeFromLocation(): 'update' | 'failure' {
  return new URLSearchParams(window.location.search).get('view') === 'failure' ? 'failure' : 'update'
}
