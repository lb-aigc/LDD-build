import type { MenuItemConstructorOptions } from 'electron'

export interface FileMenuActions {
  newWindow(): void | Promise<void>
  exit(): void | Promise<void>
}

/** 「文件」菜单：主进程能力（新建窗口 / 退出）。 */
export function createFileMenu(actions: FileMenuActions): MenuItemConstructorOptions {
  return {
    label: '文件',
    submenu: [
      { label: '新建窗口', accelerator: 'CmdOrCtrl+Shift+N', click: () => void actions.newWindow() },
      { type: 'separator' },
      { label: '退出', accelerator: 'CmdOrCtrl+Q', click: () => void actions.exit() },
    ],
  }
}

/**
 * 「编辑」菜单：全部用 Electron 内置 role，自动作用于当前聚焦的输入框
 * （聊天输入、重命名、设置字段等），无需任何 renderer 桥接。
 */
export function createEditMenu(): MenuItemConstructorOptions {
  return {
    label: '编辑',
    submenu: [
      { role: 'undo', label: '撤销' },
      { role: 'redo', label: '重做' },
      { type: 'separator' },
      { role: 'cut', label: '剪切' },
      { role: 'copy', label: '复制' },
      { role: 'paste', label: '粘贴' },
      { role: 'delete', label: '删除' },
      { type: 'separator' },
      { role: 'selectAll', label: '全选' },
    ],
  }
}

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
