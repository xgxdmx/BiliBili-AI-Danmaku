// ============================================================
// Electron Main Process
// ============================================================

import { app, BrowserWindow, ipcMain, Menu, dialog } from "electron";
import { join } from "path";
import { DanmakuService } from "./danmaku-service";
import { getConfig, setConfig, setConfigPath, exportConfigToFile, importConfigFromFile, importConfigFromContent } from "./config-store";
import { AIRelayManager, type AIRelayStatus } from "./ai-relay";
import { QuickReplyEngine } from "./quick-reply-engine";
import { logger } from "./logger";

const BILI_LOGIN_URL = "https://passport.bilibili.com/login";

let biliLoginWindow: BrowserWindow | null = null;

async function getCredentialCookiesFromElectronSession(targetWin: BrowserWindow): Promise<{
  sessdata: string;
  biliJct: string;
  buvid3: string;
}> {
  const cookieStore = targetWin.webContents.session.cookies;
  const allCookies = await cookieStore.get({});
  const getCookie = (name: string): string => allCookies.find((c) => c.name === name)?.value || "";
  return {
    sessdata: getCookie("SESSDATA"),
    biliJct: getCookie("bili_jct"),
    buvid3: getCookie("buvid3"),
  };
}


let mainWindow: BrowserWindow | null = null;
let danmakuService: DanmakuService | null = null;
let aiRelay: AIRelayManager | null = null;
let quickReplyEngine: QuickReplyEngine | null = null;
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

let isCleanupRunning = false;

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
    if (biliLoginWindow && !biliLoginWindow.isDestroyed()) {
      try {
        biliLoginWindow.close();
      } catch {
        // ignore
      }
      biliLoginWindow = null;
    }
  } finally {
    isCleanupRunning = false;
  }
}

function createWindow(): void {
  logger.log("Creating window, dev:", logger.isDev);

  const iconPath = app.isPackaged
    ? join(process.resourcesPath, "resources", "icon.ico")
    : join(__dirname, "../../build/icon.ico");
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 700,
    minHeight: 500,
    title: "BiliBili弹幕Claw",
    icon: iconPath,
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
}

function registerIpcHandlers(): void {
  const normalizeUsername = (name: string): string =>
    String(name || "")
      .trim()
      .toLowerCase();

  const shouldIgnoreByUsername = (username: string): boolean => {
    const list = getConfig().aiModel?.ignoreUsernames || [];
    const normalized = normalizeUsername(username);
    if (!normalized) return false;
    return list.some((item) => normalizeUsername(item) === normalized);
  };

  const disconnectAIWhenDanmakuStops = (reason: string): void => {
    if (!aiRelay) return;
    const status = aiRelay.getStatus();
    if (!status.connected) return;
    aiRelay.disconnect();
    latestAIStatus = aiRelay.getStatus();
  };

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

  if (!quickReplyEngine) {
    quickReplyEngine = new QuickReplyEngine();
    const initialConfig = getConfig();
    if (initialConfig.quickReplies) {
      quickReplyEngine.updateRules(initialConfig.quickReplies);
    }
  }

  ipcMain.handle("danmaku:start", async (_event, config) => {
    if (!danmakuService) {
      danmakuService = new DanmakuService();
danmakuService.on("danmaku", (data) => {
        mainWindow?.webContents.send("danmaku:received", data);
        const username = data?.sender?.username || "";
        if (shouldIgnoreByUsername(username)) return;

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

        if (quickReplyEligible) {
          const quickMatch = quickReplyEngine?.match(content);
          if (quickMatch && danmakuService) {
            danmakuService.sendDanmaku({ msg: quickMatch.reply }).catch(() => {});
          }
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

        if (aiEligible && aiRelay && !aiRelay.shouldIgnoreIncoming(data)) {
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
        disconnectAIWhenDanmakuStops("danmaku service disconnected");
      });
      danmakuService.on("error", (data) => {
        mainWindow?.webContents.send("danmaku:error", data);
      });
    }
    await danmakuService.start(config);
    return { status: "ok" };
  });

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
    disconnectAIWhenDanmakuStops("manual danmaku stop");
    return { status: "ok" };
  });

  ipcMain.handle("danmaku:send", async (_event, params) => {
    if (!danmakuService) throw new Error("Danmaku service not started");
    return danmakuService.sendDanmaku(params);
  });

  ipcMain.handle("danmaku:getStatus", async () => {
    if (!danmakuService) return { connected: false, roomId: null };
    return danmakuService.getStatus();
  });

  ipcMain.handle("keywords:update", async (_event, keywords) => {
    if (danmakuService) {
      danmakuService.updateKeywords(keywords);
    }
    return { status: "ok" };
  });

  ipcMain.handle("keywords:updateMinMedalLevel", async (_event, level) => {
    const normalized = Math.max(0, Number(level || 0));
    setConfigPath("room.minMedalLevel", normalized);
    if (danmakuService) {
      danmakuService.updateMinMedalLevel(normalized);
    }
    return { status: "ok", minMedalLevel: normalized };
  });

  ipcMain.handle("quickReplies:update", async (_event, rules) => {
    setConfigPath("quickReplies", rules);
    if (quickReplyEngine) {
      quickReplyEngine.updateRules(rules);
    }
    return { status: "ok" };
  });

  // Config IPC handlers
  ipcMain.handle("config:get", async () => {
    return getConfig();
  });

  ipcMain.handle("config:set", async (_event, key: string, value: unknown) => {
    try {
      setConfigPath(key, value);
      return { status: "ok" };
    } catch (e: unknown) {
      return { status: "error", message: String(e) };
    }
  });

  ipcMain.handle("config:export", async () => {
    const defaultPath = app.isPackaged
      ? join(app.getPath("documents"), "config-export.json")
      : join(process.cwd(), "config-export.json");
    const result = await dialog.showSaveDialog(mainWindow || undefined, {
      title: "导出配置",
      defaultPath,
      filters: [{ name: "JSON 文件", extensions: ["json"] }],
      properties: ["createDirectory", "showOverwriteConfirmation"],
    });

    if (result.canceled || !result.filePath) {
      return { status: "cancelled" };
    }
    return exportConfigToFile(result.filePath);
  });

  ipcMain.handle("config:import", async (_event, filePath: string) => {
    const result = importConfigFromFile(filePath);
    if (result.status === "ok") {
      if (danmakuService) {
        danmakuService.updateKeywords(getConfig().keywords);
        danmakuService.updateMinMedalLevel(getConfig().room?.minMedalLevel || 0);
      }
      if (quickReplyEngine) {
        quickReplyEngine.updateRules(getConfig().quickReplies || []);
      }
    }
    return result;
  });

  ipcMain.handle("config:importContent", async (_event, content: string) => {
    const result = importConfigFromContent(content);
    if (result.status === "ok") {
      if (danmakuService) {
        danmakuService.updateKeywords(getConfig().keywords);
        danmakuService.updateMinMedalLevel(getConfig().room?.minMedalLevel || 0);
      }
      if (quickReplyEngine) {
        quickReplyEngine.updateRules(getConfig().quickReplies || []);
      }
    }
    return result;
  });

  ipcMain.handle("auth:openLoginWindow", async () => {
    if (biliLoginWindow && !biliLoginWindow.isDestroyed()) {
      biliLoginWindow.focus();
      return { status: "ok", state: "opened" as const, message: "登录窗口已打开" };
    }

    const parent = mainWindow || undefined;
    biliLoginWindow = new BrowserWindow({
      width: 980,
      height: 760,
      parent,
      modal: false,
      autoHideMenuBar: true,
      title: "B站登录",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    const win = biliLoginWindow;
    const sendLoginStatus = (payload: Record<string, unknown>) => {
      mainWindow?.webContents.send("auth:loginStatus", payload);
    };

    const checkAndPersistCookies = async () => {
      if (!win || win.isDestroyed()) return;
      try {
        const creds = await getCredentialCookiesFromElectronSession(win);
        if (creds.sessdata && creds.biliJct) {
          setConfigPath("credentials", creds);
          sendLoginStatus({
            state: "confirmed",
            message: "登录成功，已抓取 Cookie",
            credentials: creds,
          });
          try {
            win.close();
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore intermittent cookie-read failures
      }
    };

    // 始终允许检查 cookie（窗口关闭时触发）
    const onCookieChanged = () => {
      void checkAndPersistCookies();
    };

    win.webContents.session.cookies.on("changed", onCookieChanged);

    win.webContents.on("did-finish-load", () => {
      sendLoginStatus({ state: "opened", message: "请在登录窗口扫码或登录" });
    });

    // 用户关闭登录窗口时保存 cookie
    win.on("close", () => {
      // 尝试保存当前登录的 cookie
      void checkAndPersistCookies();
    });

    win.on("closed", () => {
      try {
        win.webContents.session.cookies.removeListener("changed", onCookieChanged);
      } catch {
        // ignore
      }
      if (biliLoginWindow === win) {
        biliLoginWindow = null;
      }
      sendLoginStatus({ state: "closed", message: "登录窗口已关闭" });
    });

    await win.loadURL(BILI_LOGIN_URL);
    sendLoginStatus({ state: "opened", message: "登录窗口已打开" });
    return { status: "ok", state: "opened" as const, message: "登录窗口已打开" };
  });

  ipcMain.handle("ai:connect", async () => {
    if (!aiRelay) {
      throw new Error("AI relay not ready");
    }
    const cfg = getConfig();
    const aiModel = cfg.aiModel;
    await aiRelay.connect({
      provider: aiModel.provider,
      apiKey: aiModel.apiKey,
      modelId: aiModel.modelId,
      endpoint: aiModel.endpoint,
      prompt: aiModel.prompt,
      sendIntervalMs: aiModel.sendIntervalMs,
      maxPending: aiModel.maxPending,
      skipReplies: Array.isArray(aiModel.skipReplies) ? aiModel.skipReplies : [],
    });

    const status = aiRelay.getStatus();
    latestAIStatus = status;

    logger.log("AI connected:", { provider: status.provider, modelId: status.modelId });

    return { status: "ok", message: "连接成功，系统提示词已注入会话上下文" };
  });

  ipcMain.handle("ai:disconnect", async () => {
    aiRelay?.disconnect();
    latestAIStatus = aiRelay?.getStatus() || latestAIStatus;
    return { status: "ok" };
  });

  ipcMain.handle("ai:getStatus", async () => {
    return aiRelay?.getStatus() || latestAIStatus;
  });

  ipcMain.handle("ai:clearQueue", async () => {
    if (!aiRelay) {
      return { status: "ok", cleared: 0 };
    }
    const result = aiRelay.clearQueue();
    latestAIStatus = aiRelay.getStatus();
    return { status: "ok", ...result };
  });

  ipcMain.handle("ai:clearPreview", async () => {
    if (!aiRelay) {
      return { status: "ok", cleared: 0 };
    }
    const result = aiRelay.clearDecisionHistory();
    latestAIStatus = aiRelay.getStatus();
    return { status: "ok", ...result };
  });
}

app.whenReady().then(() => {
  // 关闭应用菜单栏（去掉“查看”等菜单）
  Menu.setApplicationMenu(null);
  
  createWindow();
  registerIpcHandlers();
});

app.on("window-all-closed", async () => {
  await cleanupBeforeExit();
  // 给一点时间让进程退出
  await new Promise(r => setTimeout(r, 1000));
  app.quit();
});

app.on("before-quit", async () => {
  await cleanupBeforeExit();
  // 关闭前清空本地存储的弹幕缓存
  const { session } = require("electron");
  // 这里不需要主动清空，下次启动会自动加载空数据
});

process.on("SIGINT", () => {
  void cleanupBeforeExit().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void cleanupBeforeExit().finally(() => process.exit(0));
});

process.on("uncaughtException", (err) => {
  console.error("[Main] uncaughtException:", err);
  void cleanupBeforeExit().finally(() => process.exit(1));
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
