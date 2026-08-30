; LDD installer customizations.
;
;   customPageAfterChangeDir — a "data directory" page inserted after the
;     install-directory page and before the install step. The user may pick a
;     non-system-drive location for sessions/attachments/kernels/logs; leaving
;     it blank keeps the built-in system-drive default.
;
;   customInstall — writes the chosen data directory (bare path) to
;     %APPDATA%\LDD\location.json, and clears any prior API key so a fresh or
;     overwrite install forces the user to re-enter keys (the installer ships
;     ZERO keys).

; Data-directory page state (declared at top level so both the page and the
; install section see them, regardless of macro-expansion order). Guarded by
; !ifndef BUILD_UNINSTALLER so the uninstaller build (which skips the page via
; its own guard below) does not emit NSIS warning 6001 "variable not referenced",
; which electron-builder treats as a hard error.
!ifndef BUILD_UNINSTALLER
  Var /GLOBAL LddDataDir
  Var /GLOBAL LddDataDirPage
  Var /GLOBAL LddDataDirInput
!endif

!macro customPageAfterChangeDir
  !insertmacro MUI_PAGE_INIT

  !ifndef BUILD_UNINSTALLER
    Function LddDataDirPageCreate_${MUI_UNIQUEID}
      !insertmacro MUI_HEADER_TEXT "选择数据目录" "留空则数据保存在系统盘；可输入其他盘符路径。"
      nsDialogs::Create 1018
      Pop $LddDataDirPage
      ${If} $LddDataDirPage == error
        Abort
      ${EndIf}

      ${NSD_CreateLabel} 0 0 100% 40u "数据目录用于保存会话记录、图片附件、内核与日志。留空则继续使用系统盘默认位置；输入 D:\LDD 等路径可将数据保存到其他盘（目标须为空目录或新目录）。"
      Pop $0

      ${NSD_CreateText} 0 44u 75% 13u "$LddDataDir"
      Pop $LddDataDirInput

      ${NSD_CreateButton} 78% 42u 22% 15u "浏览..."
      Pop $0
      ${NSD_OnClick} $0 LddDataDirBrowse_${MUI_UNIQUEID}

      nsDialogs::Show
    FunctionEnd

    Function LddDataDirBrowse_${MUI_UNIQUEID}
      ${NSD_GetText} $LddDataDirInput $0
      nsDialogs::SelectFolderDialog "选择数据目录" "$0"
      Pop $0
      ${If} $0 != error
        ${NSD_SetText} $LddDataDirInput $0
      ${EndIf}
    FunctionEnd

    Function LddDataDirPageLeave_${MUI_UNIQUEID}
      ${NSD_GetText} $LddDataDirInput $LddDataDir
    FunctionEnd

    PageEx custom
      PageCallbacks LddDataDirPageCreate_${MUI_UNIQUEID} LddDataDirPageLeave_${MUI_UNIQUEID}
      Caption " "
    PageExEnd
  !endif
!macroend

!macro customInstall
  ; The installer ships ZERO API keys. Model keys are only ever entered by the
  ; user at runtime (settings UI -> harness credentials store, persisted under
  ; %APPDATA%\LDD\harness\.credentials.yaml). A fresh or overwrite install
  ; therefore clears any previously-configured key so the user re-enters it.
  Delete "$APPDATA\LDD\harness\.credentials.yaml"

  ; Persist a data directory chosen on the installer's data-location page.
  ; Written as a bare path (the desktop parses a `{`-prefixed line as JSON and
  ; any other line as the directory), avoiding JSON backslash escaping here.
  ${If} $LddDataDir != ""
    CreateDirectory "$APPDATA\LDD"
    FileOpen $0 "$APPDATA\LDD\location.json" w
    FileWrite $0 "$LddDataDir"
    FileClose $0
  ${EndIf}
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
