// ============================================================
// App Shell - 主窗口外壳 / 托盘 / 关闭行为控制器
//
// 职责：
//   1. 管理主窗口显示、隐藏、聚焦与托盘交互
//   2. 统一处理关闭确认与应用退出入口
//   3. 提供窗口图标路径解析与托盘初始化能力
// ============================================================

import { app, BrowserWindow, Menu, Tray } from "electron";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { MainAppContext } from "./app-context";
import { logger } from "./logger";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** 关闭确认弹窗动作 */
export type CloseWindowDialogAction = "tray" | "exit" | "cancel";

/** 统一应用图标路径（窗口图标 + 托盘图标） */
export function getAppIconPath(): string {
  const candidates = app.isPackaged
    ? [
        // 旧逻辑路径（extraResources: resources -> resources）
        join(process.resourcesPath, "resources", "icon.ico"),
        // 常见打包路径（icon 直接位于 resources 根）
        join(process.resourcesPath, "icon.ico"),
        // 开发环境打包脚本偶发路径差异兜底
        join(process.resourcesPath, "build", "icon.ico"),
      ]
    : [join(__dirname, "../../build/icon.ico")];

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }

  // 最终兜底：使用主程序 exe 图标，避免 Tray 因图标路径不存在直接抛错
  return process.execPath;
}

/**
 * 主窗口显示/托盘/关闭行为控制器。
 * 将 index.ts 里高耦合的窗口外壳逻辑单独收拢，方便后续继续拆 IPC 和生命周期。
 */
export function createAppShellController(context: MainAppContext) {
  const showMainWindow = (): void => {
    const mainWindow = context.getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  };

  const hideMainWindowToTray = (): void => {
    const mainWindow = context.getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.hide();
  };

  const requestAppQuit = (): void => {
    if (context.getIsAppQuitting()) return;
    context.setIsAppQuitting(true);
    app.quit();
  };

  const requestCloseDecisionFromRenderer = (): void => {
    const mainWindow = context.getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    // 避免并发弹多个确认框
    if (context.getPendingCloseDecisionRequestId()) return;

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    context.setPendingCloseDecisionRequestId(requestId);

    mainWindow.webContents.send("window:closeConfirmRequested", {
      requestId,
      message: "关闭窗口时你希望如何处理？",
      detail:
        "选择“最小化到托盘后台运行”后，弹幕接收、匹配、过滤、固定回复与 AI 回复会继续运行，可通过托盘图标恢复到前台。",
    });

    // 兜底：若渲染层未回传（窗口隐藏/时序中断），自动清理 pending，避免后续点击 X 被吞。
    setTimeout(() => {
      if (context.getPendingCloseDecisionRequestId() === requestId) {
        context.setPendingCloseDecisionRequestId(null);
      }
    }, 5000).unref?.();
  };

  const applyCloseDecision = (action: CloseWindowDialogAction, remember: boolean): void => {
    if (action === "tray") {
      if (remember) {
        context.setCloseWindowBehavior("tray");
      }
      hideMainWindowToTray();
      return;
    }

    if (action === "exit") {
      if (remember) {
        context.setCloseWindowBehavior("exit");
      }
      requestAppQuit();
    }
  };

  const ensureTray = (): void => {
    if (context.getAppTray()) return;
    const trayIconPath = getAppIconPath();
    logger.log("Attempting tray init", { trayIconPath, exists: existsSync(trayIconPath) });

    let tray: Tray;
    try {
      tray = new Tray(trayIconPath);
    } catch (err) {
      // 关键：托盘创建失败不能阻断主进程后续 IPC 注册，否则会导致“点击 X 后按钮失效”
      const e = err as Error;
      logger.error("Failed to create tray icon:", {
        name: e?.name,
        message: e?.message,
        stack: e?.stack,
        trayIconPath,
      });
      context.setAppTray(null);
      return;
    }

    tray.setToolTip("BiliBili AI弹幕姬");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: "显示主界面",
          click: () => showMainWindow(),
        },
        {
          label: "隐藏到后台",
          click: () => hideMainWindowToTray(),
        },
        { type: "separator" },
        {
          label: "退出",
          click: () => {
            requestAppQuit();
          },
        },
      ]),
    );

    // 单击托盘图标：切换显示/隐藏
    tray.on("click", () => {
      const mainWindow = context.getMainWindow();
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (mainWindow.isVisible()) {
        hideMainWindowToTray();
      } else {
        showMainWindow();
      }
    });

    // 双击托盘图标：总是显示主界面
    tray.on("double-click", () => {
      showMainWindow();
    });

    context.setAppTray(tray);
  };

  const handleMainWindowCloseRequest = (): void => {
    const mainWindow = context.getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;

    const currentBehavior = context.getCloseWindowBehavior();
    if (currentBehavior === "tray") {
      hideMainWindowToTray();
      return;
    }
    if (currentBehavior === "exit") {
      requestAppQuit();
      return;
    }

    requestCloseDecisionFromRenderer();
  };

  return {
    requestAppQuit,
    applyCloseDecision,
    ensureTray,
    handleMainWindowCloseRequest,
  };
}
