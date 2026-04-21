// ============================================================
// Electron Main Process
//
// 职责：
//   1. 创建 BrowserWindow（主窗口 + B站登录窗口）
//   2. 注册全部 IPC handlers（弹幕、关键词、配置、AI、Ollama）
//   3. 管理子模块生命周期（DanmakuService / AIRelay / QuickReply）
//   4. 进程退出清理（SIGINT / SIGTERM / window-all-closed）
// ============================================================

import { app, BrowserWindow, ipcMain, Menu, dialog, nativeTheme } from "electron";
import { join } from "path";
import { DanmakuService } from "./danmaku-service";
import { getConfig, setConfigPath, exportConfigToFile, importConfigFromFile, importConfigFromContent } from "./config-store";
import { AIRelayManager, type AIRelayStatus } from "./ai-relay";
import { QuickReplyEngine } from "./quick-reply-engine";
import { logger } from "./logger";

/** B站登录页地址，用于弹出独立登录窗口 */
const BILI_LOGIN_URL = "https://passport.bilibili.com/login";

/** B站登录子窗口引用（同一时刻只允许一个） */
let biliLoginWindow: BrowserWindow | null = null;

/**
 * 从 Electron session 中提取 B站登录 Cookie。
 * 在登录窗口 cookie 变更时调用，自动抓取 SESSDATA / bili_jct / buvid3。
 */
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


// ─── 全局状态 ──────────────────────────────────────────────

/** 主窗口引用 */
let mainWindow: BrowserWindow | null = null;
/** Python 弹幕子进程管理 */
let danmakuService: DanmakuService | null = null;
/** AI 大模型中继管理器 */
let aiRelay: AIRelayManager | null = null;
/** 固定回复引擎 */
let quickReplyEngine: QuickReplyEngine | null = null;

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

/** 创建主 BrowserWindow，配置预加载脚本和安全策略 */
function createWindow(): void {
  logger.log("Creating window, dev:", logger.isDev);

  const iconPath = app.isPackaged
    ? join(process.resourcesPath, "resources", "icon.ico")
    : join(__dirname, "../../resources/icon.ico");
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

  // ─── 配置 IPC ─────────────────────────────────────────────

  /** 导入配置后同步到运行时引擎 */
  const syncConfigToEngines = (): void => {
    if (danmakuService) {
      danmakuService.updateKeywords(getConfig().keywords);
      danmakuService.updateMinMedalLevel(getConfig().room?.minMedalLevel || 0);
    }
    if (quickReplyEngine) {
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
      return { status: "ok" };
    } catch (e: unknown) {
      return { status: "error", message: String(e) };
    }
  });

  /** 弹出文件对话框导出配置到 JSON（可选是否包含敏感信息） */
  ipcMain.handle("config:export", async (_event, options?: { includeSensitive?: boolean }) => {
    const defaultPath = app.isPackaged
      ? join(app.getPath("documents"), "config-export.json")
      : join(process.cwd(), "config-export.json");
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
    return exportConfigToFile(result.filePath, options);
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

  // ─── B站登录 IPC ─────────────────────────────────────────

  /**
   * 打开 B站登录窗口。窗口内嵌到 passport.bilibili.com，
   * 监听 cookie 变化自动提取 SESSDATA / bili_jct / buvid3，
   * 成功后自动关闭窗口并持久化凭证。
   */
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

  // ─── AI 中继 IPC ─────────────────────────────────────────

  /** 连接 AI 供应商：合并共享配置 + 当前供应商独立配置 → 传入 AIRelayManager.connect() */
  ipcMain.handle("ai:connect", async () => {
    if (!aiRelay) {
      throw new Error("AI relay not ready");
    }
    const cfg = getConfig();
    const aiModel = cfg.aiModel;
    const providerName = aiModel.provider;
    const providerCfg = aiModel.providers?.[providerName];

    if (!providerCfg) {
      throw new Error(`未找到供应商 "${providerName}" 的配置`);
    }

    await aiRelay.connect({
      provider: providerName,
      apiKey: providerCfg.apiKey,
      modelId: providerCfg.modelId,
      endpoint: providerCfg.endpoint,
      prompt: aiModel.prompt,
      sendIntervalMs: aiModel.sendIntervalMs,
      maxPending: aiModel.maxPending,
      skipReplies: Array.isArray(aiModel.skipReplies) ? aiModel.skipReplies : [],
      ollamaBaseUrl: providerCfg.ollamaBaseUrl,
      maxTokens: providerCfg.maxTokens,
      temperature: providerCfg.temperature,
      topP: providerCfg.topP,
      ollamaKeepAlive: providerCfg.ollamaKeepAlive,
      requestTimeoutMs: providerCfg.requestTimeoutMs,
    });

    const status = aiRelay.getStatus();
    latestAIStatus = status;

    logger.log("AI connected:", { provider: status.provider, modelId: status.modelId });

    return { status: "ok", message: "连接成功，系统提示词已注入会话上下文" };
  });

  /** 断开 AI 连接 */
  ipcMain.handle("ai:disconnect", async () => {
    aiRelay?.disconnect();
    latestAIStatus = aiRelay?.getStatus() || latestAIStatus;
    return { status: "ok" };
  });

  /** 查询 AI 连接状态（队列长度、处理数、发送/跳过/失败计数等） */
  ipcMain.handle("ai:getStatus", async () => {
    return aiRelay?.getStatus() || latestAIStatus;
  });

  /** 清空 AI 待发送队列 */
  ipcMain.handle("ai:clearQueue", async () => {
    if (!aiRelay) {
      return { status: "ok", cleared: 0 };
    }
    const result = aiRelay.clearQueue();
    latestAIStatus = aiRelay.getStatus();
    return { status: "ok", ...result };
  });

  /** 清空 AI 返回预览记录 */
  ipcMain.handle("ai:clearPreview", async () => {
    if (!aiRelay) {
      return { status: "ok", cleared: 0 };
    }
    const result = aiRelay.clearDecisionHistory();
    latestAIStatus = aiRelay.getStatus();
    return { status: "ok", ...result };
  });

  // ─── Ollama IPC ────────────────────────────────────────────

  /**
   * 获取 Ollama 本地模型列表。
   * 调用 GET /api/tags，5 秒超时，返回模型名数组。
   */
  ipcMain.handle("ollama:listModels", async (_event, baseUrl: string) => {
    try {
      const url = baseUrl.replace(/\/+$/, "") + "/api/tags";
      const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!resp.ok) {
        return { status: "error", message: `Ollama 返回 ${resp.status}` };
      }
      const data = await resp.json();
      const models = Array.isArray(data?.models)
        ? data.models.map((m: any) => m.name || m.model || String(m))
        : [];
      return { status: "ok", models };
    } catch (err: any) {
      return { status: "error", message: err?.message || "无法连接 Ollama" };
    }
  });

  // ─── OpenCode IPC ─────────────────────────────────────────

  /**
   * 获取 OpenCode Zen 可用模型列表。
   * 调用 GET /zen/v1/models，10 秒超时，返回模型 ID 数组。
   * 用于前端动态刷新模型下拉框。
   */
  ipcMain.handle("opencode:listModels", async () => {
    try {
      const resp = await fetch("https://opencode.ai/zen/v1/models", {
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) {
        return { status: "error", message: `OpenCode 返回 ${resp.status}` };
      }
      const data = await resp.json();
      const models: string[] = Array.isArray(data?.data)
        ? data.data.map((m: any) => String(m.id || ""))
        : [];
      return { status: "ok", models };
    } catch (err: any) {
      return { status: "error", message: err?.message || "无法连接 OpenCode" };
    }
  });

  // ─── 主题 IPC ──────────────────────────────────────────────

  /** 根据配置模式解析实际主题（system → 读取操作系统偏好） */
  const resolveTheme = (mode: "light" | "dark" | "system"): "light" | "dark" => {
    if (mode === "system") return nativeTheme.shouldUseDarkColors ? "dark" : "light";
    return mode;
  };

  /** 将解析后的主题通知渲染进程 */
  const notifyThemeChange = (resolved: "light" | "dark"): void => {
    mainWindow?.webContents.send("theme:changed", resolved);
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

// ─── 应用生命周期 ──────────────────────────────────────────

/** 应用就绪：隐藏菜单栏 → 创建窗口 → 注册 IPC */
app.whenReady().then(() => {
  // 关闭应用菜单栏（去掉"查看"等菜单）
  Menu.setApplicationMenu(null);
  
  createWindow();
  registerIpcHandlers();
});

/** 所有窗口关闭 → 清理 → 延迟退出（macOS 需要显式 quit） */
app.on("window-all-closed", async () => {
  await cleanupBeforeExit();
  // 给一点时间让进程退出
  await new Promise(r => setTimeout(r, 1000));
  app.quit();
});

/** 退出前清理（防止资源泄露） */
app.on("before-quit", async () => {
  await cleanupBeforeExit();
});

/** 进程信号处理（Ctrl+C / kill） */
process.on("SIGINT", () => {
  void cleanupBeforeExit().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void cleanupBeforeExit().finally(() => process.exit(0));
});

/** 未捕获异常 → 记录日志 → 清理 → 非零退出 */
process.on("uncaughtException", (err) => {
  console.error("[Main] uncaughtException:", err);
  void cleanupBeforeExit().finally(() => process.exit(1));
});

/** macOS dock 点击事件：无窗口时重新创建 */
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
