// ============================================================
// Electron Main Process
//
// 职责：
//   1. 创建 BrowserWindow（主窗口 + B站登录窗口）
//   2. 注册全部 IPC handlers（弹幕、关键词、配置、AI、Ollama）
//   3. 管理子模块生命周期（DanmakuService / AIRelay / QuickReply）
//   4. 进程退出清理（SIGINT / SIGTERM / window-all-closed）
// ============================================================

import { app, BrowserWindow, ipcMain, Menu, Tray } from "electron";
import { join } from "path";
import { DanmakuService } from "./danmaku-service";
import { getConfig, setConfigPath, type CloseWindowBehavior } from "./config-store";
import { AIRelayManager, type AIRelayStatus } from "./ai-relay";
import { QuickReplyEngine } from "./quick-reply-engine";
import type { MainAppContext } from "./app-context";
import { logger } from "./logger";
import { createAppShellController, getAppIconPath } from "./app-shell";
import { clearElectronRuntimeCachesOnExit } from "./runtime-cache";
import { registerAuthIpcHandlers } from "./auth-window";
import { registerConfigIpcHandlers } from "./config-ipc";
import { registerAiIpcHandlers } from "./ai-ipc";

/** B站登录子窗口引用（同一时刻只允许一个） */
let biliLoginWindow: BrowserWindow | null = null;


// ─── 全局状态 ──────────────────────────────────────────────

/** 主窗口引用 */
let mainWindow: BrowserWindow | null = null;
/** Python 弹幕子进程管理 */
let danmakuService: DanmakuService | null = null;
/** AI 大模型中继管理器 */
let aiRelay: AIRelayManager | null = null;
/** 固定回复引擎 */
let quickReplyEngine: QuickReplyEngine | null = null;
/** 系统托盘图标 */
let appTray: Tray | null = null;
/** 是否进入退出流程（用于区分“关闭窗口”与“真正退出应用”） */
let isAppQuitting = false;
/** 当前关闭确认请求 ID */
let pendingCloseDecisionRequestId: string | null = null;

/** AI 连接状态缓存（窗口未创建时 IPC 仍可返回） */
let latestAIStatus: AIRelayStatus = {
  connected: false,
  provider: "",
  modelId: "",
  connectedAt: null,
  queueLength: 0,
  processing: false,
  sentCount: 0,
  skippedCount: 0,
  clearedCount: 0,
  failedCount: 0,
  lastError: null,
  sendIntervalMs: 1800,
  maxPending: 100,
  recentDecisions: [],
};

/** 防止重复清理（cleanupBeforeExit 可能被多个退出信号同时触发） */
let isCleanupRunning = false;

const appContext: MainAppContext = {
  getMainWindow: () => mainWindow,
  setMainWindow: (window) => {
    mainWindow = window;
  },
  getBiliLoginWindow: () => biliLoginWindow,
  setBiliLoginWindow: (window) => {
    biliLoginWindow = window;
  },
  getDanmakuService: () => danmakuService,
  setDanmakuService: (service) => {
    danmakuService = service;
  },
  getAIRelay: () => aiRelay,
  setAIRelay: (relay) => {
    aiRelay = relay;
  },
  getQuickReplyEngine: () => quickReplyEngine,
  setQuickReplyEngine: (engine) => {
    quickReplyEngine = engine;
  },
  getAppTray: () => appTray,
  setAppTray: (tray) => {
    appTray = tray;
  },
  getIsAppQuitting: () => isAppQuitting,
  setIsAppQuitting: (value) => {
    isAppQuitting = value;
  },
  getPendingCloseDecisionRequestId: () => pendingCloseDecisionRequestId,
  setPendingCloseDecisionRequestId: (value) => {
    pendingCloseDecisionRequestId = value;
  },
  getLatestAIStatus: () => latestAIStatus,
  setLatestAIStatus: (status) => {
    latestAIStatus = status;
  },
  getCloseWindowBehavior: () => (getConfig().closeWindowBehavior || "ask") as CloseWindowBehavior,
  setCloseWindowBehavior: (value) => {
    setConfigPath("closeWindowBehavior", value);
  },
  applyCloseDecision: () => {
    throw new Error("applyCloseDecision is not ready before appShell initialization");
  },
};

const appShell = createAppShellController(appContext);
appContext.applyCloseDecision = (action, remember) => {
  appShell.applyCloseDecision(action, remember);
};

/** 应用退出前清理：停止弹幕服务 → 断开 AI → 关闭登录窗口 */
async function cleanupBeforeExit(): Promise<void> {
  if (isCleanupRunning) return;
  isCleanupRunning = true;
  try {
    if (danmakuService) {
      try {
        await danmakuService.stop();
      } catch (e) {
        console.error("Error stopping danmaku service:", e);
      }
    }
    aiRelay?.disconnect();

    // 退出时清理部分 Electron 运行缓存，减少 Roaming 目录冗余文件
    await clearElectronRuntimeCachesOnExit({ mainWindow, biliLoginWindow });

    if (biliLoginWindow && !biliLoginWindow.isDestroyed()) {
      try {
        biliLoginWindow.close();
      } catch {
        // ignore
      }
      biliLoginWindow = null;
    }
    if (appTray) {
      appTray.destroy();
      appTray = null;
    }
  } finally {
    isCleanupRunning = false;
  }
}

/** 创建主 BrowserWindow，配置预加载脚本和安全策略 */
function createWindow(): void {
  logger.log("Creating window, dev:", logger.isDev);

  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 700,
    minHeight: 500,
    title: "BiliBili弹幕Claw",
    icon: getAppIconPath(),
    frame: true,
    backgroundColor: "#1a1b26",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    logger.log("Loading URL:", process.env.ELECTRON_RENDERER_URL);
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    const htmlPath = join(__dirname, "../renderer/index.html");
    logger.log("Loading file:", htmlPath);
    mainWindow.loadFile(htmlPath);
  }

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
    console.error("[Main] Failed to load:", errorCode, errorDescription);
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("[Main] Renderer process gone:", details.reason);
  });

  // 禁用开发者工具快捷键（F12 / Ctrl+Shift+I / Cmd+Opt+I）
  mainWindow.webContents.on("before-input-event", (event, input) => {
    const isF12 = input.key === "F12";
    const isToggleDevtoolsCombo =
      (input.control || input.meta) && input.shift && input.key.toUpperCase() === "I";
    if (isF12 || isToggleDevtoolsCombo) {
      event.preventDefault();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.on("close", (event) => {
    if (isAppQuitting) return;
    event.preventDefault();
    void appShell.handleMainWindowCloseRequest();
  });
}

/**
 * 注册全部 IPC handlers。
 * 按功能分为：弹幕服务 / 关键词 / 固定回复 / 配置 / 登录 / AI / Ollama。
 */
function registerIpcHandlers(): void {
  // ─── 工具函数 ──────────────────────────────────────────────

  /** 统一用户名归一化（trim + lowercase），用于忽略列表匹配 */
  const normalizeUsername = (name: string): string =>
    String(name || "")
      .trim()
      .toLowerCase();

  /** 检查用户名是否在 AI 忽略列表中 */
  const shouldIgnoreByUsername = (username: string): boolean => {
    const list = getConfig().aiModel?.ignoreUsernames || [];
    const normalized = normalizeUsername(username);
    if (!normalized) return false;
    return list.some((item) => normalizeUsername(item) === normalized);
  };

  /** 弹幕连接断开时同步断开 AI 中继 */
  const disconnectAIWhenDanmakuStops = (): void => {
    if (!aiRelay) return;
    if (!aiRelay.getStatus().connected) return;
    aiRelay.disconnect();
    latestAIStatus = aiRelay.getStatus();
  };

  // ─── 初始化子模块 ─────────────────────────────────────────

  /** AI 中继管理器：连接大模型供应商，管理回复队列 */
  if (!aiRelay) {
    aiRelay = new AIRelayManager(async (msg: string) => {
      if (!danmakuService) {
        throw new Error("Danmaku service not started");
      }
      return danmakuService.sendDanmaku({ msg });
    });
    aiRelay.on("status", (status: AIRelayStatus) => {
      latestAIStatus = status;
      mainWindow?.webContents.send("ai:status", status);
    });
  }

  /** 固定回复引擎：关键词命中后直接发送预设文本 */
  if (!quickReplyEngine) {
    quickReplyEngine = new QuickReplyEngine();
    const initialConfig = getConfig();
    quickReplyEngine.setEnabled(initialConfig.quickReplyEnabled);
    if (initialConfig.quickReplies) {
      quickReplyEngine.updateRules(initialConfig.quickReplies);
    }
  }

  // ─── 弹幕服务 IPC ─────────────────────────────────────────

  /** 启动弹幕监听：创建 DanmakuService 并绑定全部事件处理器 */
  ipcMain.handle("danmaku:start", async (_event, config) => {
    if (!danmakuService) {
      danmakuService = new DanmakuService();
danmakuService.on("danmaku", (data) => {
         mainWindow?.webContents.send("danmaku:received", data);
         const username = data?.sender?.username || "";
         if (shouldIgnoreByUsername(username)) return;

         // ── 捕捉开关 ──
         // 关闭后弹幕仅显示，不进入关键词匹配 / 固定回复 / AI 回复流程
         if (getConfig().room?.captureEnabled === false) return;

         const matchScope = (data?.match?.rule?.scope as "both" | "quickReply" | "ai") || "both";
        const hasKeywordMatch = !!data?.match;
        const content = data?.content || "";
        const activeScopes = danmakuService?.getKeywordFilterScopes() ?? new Set<"both" | "quickReply" | "ai">();

        // ── 固定回复路由 ──
        // scope=both/quickReply: 关键词过滤控制固定回复，只处理命中弹幕
        // scope=ai: 固定回复绕过关键词过滤，处理所有弹幕
        // 未命中弹幕：如果存在 scope=ai 关键词，固定回复也处理（绕过过滤）
        let quickReplyEligible = false;
        if (matchScope === "ai") {
          quickReplyEligible = true;
        } else if (hasKeywordMatch) {
          quickReplyEligible = true;
        } else if (activeScopes.has("ai")) {
          // 存在 scope=ai 的关键词且当前弹幕未命中 → 固定回复绕过过滤
          quickReplyEligible = true;
        }

        // 固定回复全局开关：关闭时完全不触发固定回复
        const quickReplyEnabled = getConfig().quickReplyEnabled;
        const quickMatch = quickReplyEligible && quickReplyEnabled
          ? (quickReplyEngine?.match(content) ?? null)
          : null;
        const quickReplyHandled = Boolean(quickMatch && danmakuService);

        if (quickMatch && danmakuService) {
          danmakuService.sendDanmaku({ msg: quickMatch.reply }).catch(() => {});
        }

        // ── AI 回复路由 ──
        // scope=both/ai: 关键词过滤控制 AI，只处理命中弹幕
        // scope=quickReply: AI 绕过关键词过滤，处理所有弹幕
        // 未命中弹幕：如果存在 scope=quickReply 关键词，AI 也处理（绕过过滤）
        let aiEligible = false;
        if (matchScope === "quickReply") {
          aiEligible = true;
        } else if (hasKeywordMatch) {
          aiEligible = true;
        } else if (activeScopes.has("quickReply")) {
          // 存在 scope=quickReply 的关键词且当前弹幕未命中 → AI 绕过过滤
          aiEligible = true;
        }

        // 固定回复优先级高于 AI：一旦命中固定回复，本条弹幕不再进入 AI 队列。
        if (!quickReplyHandled && aiEligible && aiRelay && !aiRelay.shouldIgnoreIncoming(data)) {
          aiRelay.enqueue(data);
        }
      });
      danmakuService.on("gift", (data) => {
        mainWindow?.webContents.send("danmaku:gift", data);
        const username = data?.sender?.username || "";
        if (aiRelay && !shouldIgnoreByUsername(username)) {
          aiRelay.enqueue({
            id: Number(data?.giftId || Date.now()),
            content: `🎁 ${username || "用户"} 送出 ${data?.giftName || "礼物"} x${Number(data?.count || 1)}`,
            sender: {
              uid: Number(data?.sender?.uid || 0),
              username: username || "用户",
              medal: data?.sender?.medal || null,
            },
            timestamp: Number(data?.timestamp || Date.now()),
            roomId: Number(data?.roomId || 0),
            match: {
              rule: { id: "_gift_auto", type: "event" },
            },
          });
        }
      });
      danmakuService.on("superchat", (data) => {
        mainWindow?.webContents.send("danmaku:superchat", data);
      });
      danmakuService.on("connected", (data) => {
        mainWindow?.webContents.send("danmaku:connected", data);
      });
      danmakuService.on("disconnected", (data) => {
        mainWindow?.webContents.send("danmaku:disconnected", data);
        disconnectAIWhenDanmakuStops();
      });
      danmakuService.on("error", (data) => {
        mainWindow?.webContents.send("danmaku:error", data);
      });
    }
    await danmakuService.start(config);
    return { status: "ok" };
  });

  /** 停止弹幕监听，可选在停止前发送告别消息 */
  ipcMain.handle("danmaku:stop", async (_event, options?: { sendBeforeStop?: boolean; message?: string }) => {
    if (danmakuService) {
      const shouldSend = Boolean(options?.sendBeforeStop);
      const message = String(options?.message || "").trim();
      if (shouldSend && message) {
        try {
          await danmakuService.sendDanmaku({ msg: message });
          await new Promise((resolve) => setTimeout(resolve, 120));
        } catch {
          // 发送断开消息失败时静默处理
        }
      }
      await danmakuService.stop();
    }
    disconnectAIWhenDanmakuStops();
    return { status: "ok" };
  });

  /** 手动发送弹幕（通过 Python sender） */
  ipcMain.handle("danmaku:send", async (_event, params) => {
    if (!danmakuService) throw new Error("Danmaku service not started");
    return danmakuService.sendDanmaku(params);
  });

  /** 查询弹幕服务连接状态 */
  ipcMain.handle("danmaku:getStatus", async () => {
    if (!danmakuService) return { connected: false, roomId: null };
    return danmakuService.getStatus();
  });

  // ─── 关键词 & 固定回复 IPC ─────────────────────────────────

  /** 更新关键词过滤规则 */
  ipcMain.handle("keywords:update", async (_event, keywords) => {
    if (danmakuService) {
      danmakuService.updateKeywords(keywords);
    }
    return { status: "ok" };
  });

  /** 更新最低粉丝牌等级过滤阈值 */
  ipcMain.handle("keywords:updateMinMedalLevel", async (_event, level) => {
    const normalized = Math.max(0, Number(level || 0));
    setConfigPath("room.minMedalLevel", normalized);
    if (danmakuService) {
      danmakuService.updateMinMedalLevel(normalized);
    }
    return { status: "ok", minMedalLevel: normalized };
  });

  /** 更新固定回复规则列表 */
  ipcMain.handle("quickReplies:update", async (_event, rules) => {
    setConfigPath("quickReplies", rules);
    if (quickReplyEngine) {
      quickReplyEngine.updateRules(rules);
    }
    return { status: "ok" };
  });

  registerConfigIpcHandlers(appContext);
  registerAuthIpcHandlers(appContext);
  registerAiIpcHandlers(appContext);
}

// ─── 应用生命周期 ──────────────────────────────────────────

/** 应用就绪：隐藏菜单栏 → 创建窗口 → 注册 IPC */
app.whenReady().then(() => {
  // 关闭应用菜单栏（去掉"查看"等菜单）
  Menu.setApplicationMenu(null);
  
  createWindow();
  registerIpcHandlers();
  // 托盘初始化放在 IPC 注册之后，避免托盘异常影响主流程
  appShell.ensureTray();
});

/** 所有窗口关闭 → 清理 → 延迟退出（macOS 需要显式 quit） */
app.on("window-all-closed", async () => {
  await cleanupBeforeExit();
  // 若是主动退出流程，直接结束；否则保持历史行为尝试退出应用
  if (isAppQuitting) {
    app.exit(0);
    return;
  }
  appShell.requestAppQuit();
});

/** 退出前清理（防止资源泄露） */
app.on("before-quit", async () => {
  isAppQuitting = true;
  await cleanupBeforeExit();
});

/** 进程信号处理（Ctrl+C / kill） */
process.on("SIGINT", () => {
  isAppQuitting = true;
  void cleanupBeforeExit().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  isAppQuitting = true;
  void cleanupBeforeExit().finally(() => process.exit(0));
});

/** 未捕获异常 → 记录日志 → 清理 → 非零退出 */
process.on("uncaughtException", (err) => {
  console.error("[Main] uncaughtException:", err);
  isAppQuitting = true;
  void cleanupBeforeExit().finally(() => process.exit(1));
});

/** macOS dock 点击事件：无窗口时重新创建 */
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
