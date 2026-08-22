export interface TrayLike {
  on(event: 'click', listener: () => void): void
  setContextMenu(menu: unknown): void
  setToolTip(toolTip: string): void
  destroy(): void
}

export interface TrayWindowLike {
  show(): void
  focus(): void
}

export function configureTray(
  tray: TrayLike,
  window: TrayWindowLike,
  contextMenu: unknown,
): () => void {
  const show = () => {
    window.show()
    window.focus()
  }
  tray.setToolTip('LDD · DeepSeek Harness')
  tray.setContextMenu(contextMenu)
  tray.on('click', show)
  return () => tray.destroy()
}
