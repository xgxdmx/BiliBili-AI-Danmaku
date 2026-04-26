!include "LogicLib.nsh"

; Roaming 目录名（旧版/新版）
!define ROAMING_DIR_OLD "bilibili-danmu-claw"
!define ROAMING_DIR_NEW "BiliBiliDanmuClaw"

; 卸载前先关闭主程序与 Python runtime 相关进程，避免 userData/缓存目录中的文件被占用，
; 导致“选择不保留配置后仍有残留文件”问题。
!macro customUnInit
  nsExec::ExecToLog '"$SYSDIR\\taskkill.exe" /F /T /IM "${APP_EXECUTABLE_FILENAME}"'
  nsExec::ExecToLog '"$SYSDIR\\taskkill.exe" /F /T /IM "BiliBili弹幕Claw.exe"'
  nsExec::ExecToLog '"$SYSDIR\\taskkill.exe" /F /T /IM "BiliBili AI弹幕姬.exe"'
  nsExec::ExecToLog '"$SYSDIR\\taskkill.exe" /F /T /IM "bilibili-danmu-claw.exe"'
  nsExec::ExecToLog '"$SYSDIR\\taskkill.exe" /F /T /IM "bilibili-danmu-claw-electron-app.exe"'
  nsExec::ExecToLog '"$SYSDIR\\taskkill.exe" /F /T /IM "run.exe"'
  nsExec::ExecToLog '"$SYSDIR\\taskkill.exe" /F /T /IM "danmaku.exe"'
  nsExec::ExecToLog '"$SYSDIR\\taskkill.exe" /F /T /IM "receiver.exe"'
  nsExec::ExecToLog '"$SYSDIR\\taskkill.exe" /F /T /IM "sender.exe"'
  Sleep 1500
!macroend

; 安装启动时尝试关闭旧进程，避免“无法关闭程序”阻塞安装。
; /T 会结束子进程树，避免子进程继续占用安装目录文件。
!macro customInit
  nsExec::ExecToLog '"$SYSDIR\\taskkill.exe" /F /T /IM "${APP_EXECUTABLE_FILENAME}"'

  ; 兼容历史版本：旧版可执行名与新版本不一致时，升级安装前一并尝试结束。
  ; 这些命令失败不会中断安装（进程不存在时 taskkill 会返回非零）。
  nsExec::ExecToLog '"$SYSDIR\\taskkill.exe" /F /T /IM "BiliBili弹幕Claw.exe"'
  nsExec::ExecToLog '"$SYSDIR\\taskkill.exe" /F /T /IM "BiliBili AI弹幕姬.exe"'
  nsExec::ExecToLog '"$SYSDIR\\taskkill.exe" /F /T /IM "bilibili-danmu-claw.exe"'
  nsExec::ExecToLog '"$SYSDIR\\taskkill.exe" /F /T /IM "bilibili-danmu-claw-electron-app.exe"'
!macroend

; 覆盖 electron-builder 默认的进程检测/关闭逻辑：
; 老版本覆盖安装时，旧进程名可能不同，默认逻辑会弹“无法关闭”导致安装中断。
; 这里按安装目录路径 + 历史进程名双保险强制结束，再继续安装。
!macro customCheckAppRunning
  ; 兼容旧版本可执行名：覆盖安装前一并强制结束
  nsExec::ExecToLog '"$SYSDIR\\taskkill.exe" /F /T /IM "${APP_EXECUTABLE_FILENAME}"'
  nsExec::ExecToLog '"$SYSDIR\\taskkill.exe" /F /T /IM "BiliBili弹幕Claw.exe"'
  nsExec::ExecToLog '"$SYSDIR\\taskkill.exe" /F /T /IM "BiliBili AI弹幕姬.exe"'
  nsExec::ExecToLog '"$SYSDIR\\taskkill.exe" /F /T /IM "bilibili-danmu-claw.exe"'
  nsExec::ExecToLog '"$SYSDIR\\taskkill.exe" /F /T /IM "bilibili-danmu-claw-electron-app.exe"'

  ; 等待文件锁释放
  Sleep 1200
!macroend

; customRemoveFiles 宏会 **完全替代** electron-builder 默认的文件删除逻辑
; （包括默认的 $INSTDIR 清理），因此必须在这里自行处理所有清理工作。
!macro customRemoveFiles
  ; ===== 步骤 1：询问用户是否保留配置 =====
  MessageBox MB_ICONQUESTION|MB_YESNO|MB_SETFOREGROUND "是否保留配置文件？$\r$\n$\r$\n选择[是]：仅保留配置文件（config.json 等），其余缓存与运行数据会清理。$\r$\n选择[否]：删除本程序全部数据（含配置、缓存、安装文件）。" IDYES keep_config IDNO remove_all

  ; ===== 分支：不保留配置（全部删除） =====
  remove_all:

  ; Electron 始终把 userData 放在"当前用户"上下文。
  ; 若当前卸载运行在 all-users 模式，必须先切回 current，
  ; 否则 $APPDATA / $LOCALAPPDATA 会指向 C:\ProgramData 而非用户目录。
  ${if} $installMode == "all"
    SetShellVarContext current
  ${endif}

  ; 删除 Roaming 下的程序数据目录（含配置与缓存）
  RMDir /r "$APPDATA\\${APP_PACKAGE_NAME}"
  RMDir /r "$APPDATA\\${ROAMING_DIR_OLD}"
  RMDir /r "$APPDATA\\${ROAMING_DIR_NEW}"
  ; 清理 LocalAppData 下的 Electron/Chromium 缓存残留
  RMDir /r "$LOCALAPPDATA\\${APP_PACKAGE_NAME}"
  RMDir /r "$LOCALAPPDATA\\${ROAMING_DIR_OLD}"
  RMDir /r "$LOCALAPPDATA\\${ROAMING_DIR_NEW}"

  ; 恢复 shell 上下文
  ${if} $installMode == "all"
    SetShellVarContext all
  ${endif}

  ; 删除安装目录（customRemoveFiles 替代了默认的 $INSTDIR 清理）
  SetOutPath $TEMP
  RMDir /r "$INSTDIR"
  Goto done

  ; ===== 分支：保留配置 =====
  keep_config:
  ; 策略：用 Rename（原子移动）把配置文件暂存到 $PLUGINSDIR，
  ; 再 RMDir /r 清空整个目录（含 Electron 缓存/Session 等），
  ; 最后把配置文件 Rename 回来。Rename 比 CopyFiles 更可靠。

  InitPluginsDir

  ; 切换到 current 用户上下文（Electron 始终使用当前用户目录）
  ${if} $installMode == "all"
    SetShellVarContext current
  ${endif}

  ; ----- 暂存：遍历所有可能的配置目录，把配置文件移到 $PLUGINSDIR -----
  ; 目录 1：${APP_PACKAGE_NAME}（electron-builder 内部名）
  IfFileExists "$APPDATA\\${APP_PACKAGE_NAME}\\config.json" 0 +2
    Rename "$APPDATA\\${APP_PACKAGE_NAME}\\config.json" "$PLUGINSDIR\\a_config.json"
  IfFileExists "$APPDATA\\${APP_PACKAGE_NAME}\\config.json.legacy.bak" 0 +2
    Rename "$APPDATA\\${APP_PACKAGE_NAME}\\config.json.legacy.bak" "$PLUGINSDIR\\a_legacy.bak"
  IfFileExists "$APPDATA\\${APP_PACKAGE_NAME}\\config-export.json" 0 +2
    Rename "$APPDATA\\${APP_PACKAGE_NAME}\\config-export.json" "$PLUGINSDIR\\a_export.json"

  ; 目录 2：${ROAMING_DIR_OLD}（实际 Electron userData 目录名）
  IfFileExists "$APPDATA\\${ROAMING_DIR_OLD}\\config.json" 0 +2
    Rename "$APPDATA\\${ROAMING_DIR_OLD}\\config.json" "$PLUGINSDIR\\o_config.json"
  IfFileExists "$APPDATA\\${ROAMING_DIR_OLD}\\config.json.legacy.bak" 0 +2
    Rename "$APPDATA\\${ROAMING_DIR_OLD}\\config.json.legacy.bak" "$PLUGINSDIR\\o_legacy.bak"
  IfFileExists "$APPDATA\\${ROAMING_DIR_OLD}\\config-export.json" 0 +2
    Rename "$APPDATA\\${ROAMING_DIR_OLD}\\config-export.json" "$PLUGINSDIR\\o_export.json"

  ; 目录 3：${ROAMING_DIR_NEW}（历史兼容）
  IfFileExists "$APPDATA\\${ROAMING_DIR_NEW}\\config.json" 0 +2
    Rename "$APPDATA\\${ROAMING_DIR_NEW}\\config.json" "$PLUGINSDIR\\n_config.json"
  IfFileExists "$APPDATA\\${ROAMING_DIR_NEW}\\config.json.legacy.bak" 0 +2
    Rename "$APPDATA\\${ROAMING_DIR_NEW}\\config.json.legacy.bak" "$PLUGINSDIR\\n_legacy.bak"
  IfFileExists "$APPDATA\\${ROAMING_DIR_NEW}\\config-export.json" 0 +2
    Rename "$APPDATA\\${ROAMING_DIR_NEW}\\config-export.json" "$PLUGINSDIR\\n_export.json"

  ; ----- 清理：删除 Roaming 目录（Electron 缓存全部清除）-----
  RMDir /r "$APPDATA\\${APP_PACKAGE_NAME}"
  RMDir /r "$APPDATA\\${ROAMING_DIR_OLD}"
  RMDir /r "$APPDATA\\${ROAMING_DIR_NEW}"
  ; LocalAppData 缓存也清理
  RMDir /r "$LOCALAPPDATA\\${APP_PACKAGE_NAME}"
  RMDir /r "$LOCALAPPDATA\\${ROAMING_DIR_OLD}"
  RMDir /r "$LOCALAPPDATA\\${ROAMING_DIR_NEW}"

  ; ----- 恢复：把暂存的配置文件移回原目录 -----
  ; 目录 1 恢复
  IfFileExists "$PLUGINSDIR\\a_config.json" 0 +3
    CreateDirectory "$APPDATA\\${APP_PACKAGE_NAME}"
    Rename "$PLUGINSDIR\\a_config.json" "$APPDATA\\${APP_PACKAGE_NAME}\\config.json"
  IfFileExists "$PLUGINSDIR\\a_legacy.bak" 0 +2
    Rename "$PLUGINSDIR\\a_legacy.bak" "$APPDATA\\${APP_PACKAGE_NAME}\\config.json.legacy.bak"
  IfFileExists "$PLUGINSDIR\\a_export.json" 0 +2
    Rename "$PLUGINSDIR\\a_export.json" "$APPDATA\\${APP_PACKAGE_NAME}\\config-export.json"

  ; 目录 2 恢复
  IfFileExists "$PLUGINSDIR\\o_config.json" 0 +3
    CreateDirectory "$APPDATA\\${ROAMING_DIR_OLD}"
    Rename "$PLUGINSDIR\\o_config.json" "$APPDATA\\${ROAMING_DIR_OLD}\\config.json"
  IfFileExists "$PLUGINSDIR\\o_legacy.bak" 0 +2
    Rename "$PLUGINSDIR\\o_legacy.bak" "$APPDATA\\${ROAMING_DIR_OLD}\\config.json.legacy.bak"
  IfFileExists "$PLUGINSDIR\\o_export.json" 0 +2
    Rename "$PLUGINSDIR\\o_export.json" "$APPDATA\\${ROAMING_DIR_OLD}\\config-export.json"

  ; 目录 3 恢复
  IfFileExists "$PLUGINSDIR\\n_config.json" 0 +3
    CreateDirectory "$APPDATA\\${ROAMING_DIR_NEW}"
    Rename "$PLUGINSDIR\\n_config.json" "$APPDATA\\${ROAMING_DIR_NEW}\\config.json"
  IfFileExists "$PLUGINSDIR\\n_legacy.bak" 0 +2
    Rename "$PLUGINSDIR\\n_legacy.bak" "$APPDATA\\${ROAMING_DIR_NEW}\\config.json.legacy.bak"
  IfFileExists "$PLUGINSDIR\\n_export.json" 0 +2
    Rename "$PLUGINSDIR\\n_export.json" "$APPDATA\\${ROAMING_DIR_NEW}\\config-export.json"

  ; 恢复 shell 上下文
  ${if} $installMode == "all"
    SetShellVarContext all
  ${endif}

  ; 删除安装目录（customRemoveFiles 替代了默认的 $INSTDIR 清理）
  SetOutPath $TEMP
  RMDir /r "$INSTDIR"

  done:
!macroend
