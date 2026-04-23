// ============================================================
// Config IPC - 配置 / 主题 / 关闭确认相关主进程 IPC
//
// 职责：
//   1. 提供配置读取、写入、导入、导出入口
//   2. 处理主题切换与主窗口关闭确认回调
//   3. 在配置变更后同步运行时引擎状态
// ============================================================

import { app, dialog, ipcMain, nativeTheme } from "electron";
import { join } from "path";
import type { MainAppContext } from "./app-context";
import {
  exportConfigToFile,
  getConfig,
  importConfigFromContent,
  importConfigFromFile,
  setConfigPath,
} from "./config-store";
import { logger } from "./logger";
import type { CloseWindowDialogAction } from "./app-shell";

/**
 * 注册配置/主题/关闭确认相关 IPC。
 * 这部分只依赖主窗口与运行时引擎引用，适合从 index.ts 独立出来。
 */
export function registerConfigIpcHandlers(context: MainAppContext): void {
  /** 渲染进程返回关闭确认弹窗结果 */
  ipcMain.handle(
    "window:closeConfirmRespond",
    async (
      _event,
      payload: { requestId?: string; action?: CloseWindowDialogAction; remember?: boolean },
    ) => {
      const requestId = String(payload?.requestId || "");
      const action = payload?.action;
      const remember = Boolean(payload?.remember);

      if (action !== "tray" && action !== "exit" && action !== "cancel") {
        return { status: "ignored" };
      }

      const pendingRequestId = context.getPendingCloseDecisionRequestId();
      // 容错处理：若 requestId 因时序漂移不一致，但当前确有待处理弹窗，也接受本次动作。
      if (pendingRequestId && requestId && requestId !== pendingRequestId) {
        logger.log("closeConfirm requestId mismatch, accept action with tolerance", {
          expected: pendingRequestId,
          actual: requestId,
          action,
        });
      }

      context.setPendingCloseDecisionRequestId(null);
      context.applyCloseDecision(action, remember);
      return { status: "ok" };
    },
  );

  /**
   * 关闭确认动作直达通道（不依赖 requestId）。
   * 用于兜底渲染层 requestId 丢失/时序异常，保证按钮动作必达。
   */
  ipcMain.handle(
    "window:closeConfirmAction",
    async (
      _event,
      payload: { action?: CloseWindowDialogAction; remember?: boolean },
    ) => {
      const action = payload?.action;
      const remember = Boolean(payload?.remember);
      if (action !== "tray" && action !== "exit" && action !== "cancel") {
        return { status: "ignored" };
      }

      context.setPendingCloseDecisionRequestId(null);
      context.applyCloseDecision(action, remember);
      return { status: "ok" };
    },
  );

  /** 导入配置后同步到运行时引擎 */
  const syncConfigToEngines = (): void => {
    const danmakuService = context.getDanmakuService();
    if (danmakuService) {
      danmakuService.updateKeywords(getConfig().keywords);
      danmakuService.updateMinMedalLevel(getConfig().room?.minMedalLevel || 0);
    }

    const quickReplyEngine = context.getQuickReplyEngine();
    if (quickReplyEngine) {
      quickReplyEngine.setEnabled(getConfig().quickReplyEnabled);
      quickReplyEngine.updateRules(getConfig().quickReplies || []);
    }
  };

  /** 读取完整配置 */
  ipcMain.handle("config:get", async () => {
    return getConfig();
  });

  /** 按路径设置配置值（如 "aiModel.prompt"） */
  ipcMain.handle("config:set", async (_event, key: string, value: unknown) => {
    try {
      setConfigPath(key, value);

      if (key === "quickReplyEnabled" || key === "quickReplies" || key === "keywords" || key === "room.minMedalLevel") {
        syncConfigToEngines();
      }

      return { status: "ok" };
    } catch (e: unknown) {
      return { status: "error", message: String(e) };
    }
  });

  /** 弹出文件对话框导出配置到 JSON（可选是否包含敏感信息） */
  ipcMain.handle("config:export", async (_event, exportOptions?: { includeSensitive?: boolean }) => {
    const defaultPath = app.isPackaged
      ? join(app.getPath("documents"), "config-export.json")
      : join(process.cwd(), "config-export.json");
    const mainWindow = context.getMainWindow();
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, {
          title: "导出配置",
          defaultPath,
          filters: [{ name: "JSON 文件", extensions: ["json"] }],
          properties: ["createDirectory", "showOverwriteConfirmation"],
        })
      : await dialog.showSaveDialog({
          title: "导出配置",
          defaultPath,
          filters: [{ name: "JSON 文件", extensions: ["json"] }],
          properties: ["createDirectory", "showOverwriteConfirmation"],
        });

    if (result.canceled || !result.filePath) {
      return { status: "cancelled" };
    }
    return exportConfigToFile(result.filePath, exportOptions);
  });

  /** 从文件路径导入配置 */
  ipcMain.handle("config:import", async (_event, filePath: string) => {
    const result = importConfigFromFile(filePath);
    if (result.status === "ok") syncConfigToEngines();
    return result;
  });

  /** 从 JSON 字符串导入配置（用于剪贴板粘贴） */
  ipcMain.handle("config:importContent", async (_event, content: string) => {
    const result = importConfigFromContent(content);
    if (result.status === "ok") syncConfigToEngines();
    return result;
  });

  /** 根据配置模式解析实际主题（system → 读取操作系统偏好） */
  const resolveTheme = (mode: "light" | "dark" | "system"): "light" | "dark" => {
    if (mode === "system") return nativeTheme.shouldUseDarkColors ? "dark" : "light";
    return mode;
  };

  /** 将解析后的主题通知渲染进程 */
  const notifyThemeChange = (resolved: "light" | "dark"): void => {
    context.getMainWindow()?.webContents.send("theme:changed", resolved);
  };

  /** 获取当前主题配置和解析结果 */
  ipcMain.handle("theme:get", async () => {
    const mode = getConfig().theme || "system";
    return { mode, resolved: resolveTheme(mode) };
  });

  /** 设置主题模式并通知渲染进程 */
  ipcMain.handle("theme:set", async (_event, mode: "light" | "dark" | "system") => {
    setConfigPath("theme", mode);
    const resolved = resolveTheme(mode);
    notifyThemeChange(resolved);
    return { resolved };
  });

  /** 监听操作系统主题变化，当配置为 system 时自动切换 */
  nativeTheme.on("updated", () => {
    const mode = getConfig().theme || "system";
    if (mode === "system") {
      notifyThemeChange(resolveTheme("system"));
    }
  });
}
