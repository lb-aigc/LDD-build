export interface HelpMenuActions {
  openUpdate(): void | Promise<void>
  showCurrentRuntime(): void | Promise<void>
  rollback(): void | Promise<void>
  openPluginCenter(): void | Promise<void>
  openLogs(): void | Promise<void>
}

export interface HelpMenuItem {
  readonly id:
    | 'harness-update'
    | 'current-runtime'
    | 'rollback-runtime'
    | 'plugin-center'
    | 'open-logs'
  readonly label: string
  readonly activate: () => void | Promise<void>
}

export function createHelpMenu(actions: HelpMenuActions): readonly HelpMenuItem[] {
  return [
    { id: 'harness-update', label: 'Harness 内核更新…', activate: actions.openUpdate },
    { id: 'current-runtime', label: '当前内核信息', activate: actions.showCurrentRuntime },
    { id: 'rollback-runtime', label: '回滚到上一内核…', activate: actions.rollback },
    { id: 'plugin-center', label: '插件中心…', activate: actions.openPluginCenter },
    { id: 'open-logs', label: '打开日志目录', activate: actions.openLogs },
  ]
}
