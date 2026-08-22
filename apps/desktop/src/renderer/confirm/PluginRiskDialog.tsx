export interface PluginRiskDialogProps {
  readonly open: boolean
  readonly onCancel: () => void
  readonly onConfirm: () => void
}

export function PluginRiskDialog({ open, onCancel, onConfirm }: PluginRiskDialogProps) {
  if (!open) return null
  return (
    <div className="modal-backdrop">
      <section className="dialog risk-dialog" role="dialog" aria-modal="true" aria-labelledby="plugin-risk-title">
        <p className="eyebrow">THIRD-PARTY CODE</p>
        <h2 id="plugin-risk-title">打开第三方插件中心</h2>
        <p>
          Harness 插件将以当前 Windows 用户权限运行，可能读取你的文件、凭据并访问网络。
          插件中心由 GitHub 社区项目组成，LDD 不会自动安装其中任何插件。
        </p>
        <div className="risk-note">仅审查并安装你信任的来源。安装前请确认仓库作者、代码和版本。</div>
        <div className="button-row end">
          <button className="button secondary" onClick={onCancel}>取消</button>
          <button className="button primary" onClick={onConfirm}>了解风险，继续</button>
        </div>
      </section>
    </div>
  )
}
