; LDD installer customizations.
;
;   customInstall — clears any prior API key so a fresh or overwrite install
;     forces the user to re-enter keys (the installer ships ZERO keys).
;
;   The "选择数据目录" installer page was REMOVED (2026-09-13). The NSIS page
;   never reliably wrote %APPDATA%\LDD\location.json (its macro could not be
;   locally verified and left the value empty at install time), so the data
;   directory is now managed from the in-app management panel instead
;   (menu 帮助 → Harness 内核更新… → 数据目录 → 更改数据目录), which is
;   Electron-backed, tested, and reliable. See data-directory-relocation.md.

!macro customInstall
  ; The installer ships ZERO API keys. Model keys are only ever entered by the
  ; user at runtime (settings UI -> harness credentials store, persisted under
  ; %APPDATA%\LDD\harness\.credentials.yaml). A fresh or overwrite install
  ; therefore clears any previously-configured key so the user re-enters it.
  Delete "$APPDATA\LDD\harness\.credentials.yaml"
!macroend

!macro customUnInstall
  ; Runtime updates reuse the uninstaller internally and must never prompt or
  ; remove user state. Only a manual uninstall offers the destructive choice.
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_DEFBUTTON2|MB_ICONQUESTION "是否同时删除 LDD 的 Harness 配置、会话、已下载内核与备份？选择“否”将保留这些数据（推荐）。" IDNO ldd_keep_user_data
    RMDir /r "$LOCALAPPDATA\LDD"
    RMDir /r "$APPDATA\LDD"
    ldd_keep_user_data:
  ${endIf}
!macroend
