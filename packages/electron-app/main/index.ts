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
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { spawn, spawnSync, type ChildProcess } from "child_process";
import {
  DanmakuService,
  cleanupBundledRunExeResidualsSync,
  warmupBundledDanmakuRuntime,
  verifyBundledRunExeResidualsAfterCleanup,
} from "./danmaku-service";
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
import { registerAppUtilityIpcHandlers } from "./app-utility-ipc";
import { createDashboardMetricsStore, type DashboardSnapshotPayload } from "./dashboard-metrics-store";
import {
  isAiEligible,
  isQuickReplyEligible,
  resolveMatchScope,
  type KeywordScope,
} from "./danmaku-routing";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================
// DevTools 快捷键开关（需要时可手动修改）
// true  = 允许 F12 / Ctrl+Shift+I / Cmd+Opt+I 打开控制台
// false = 禁用上述快捷键
// 如需关闭，直接把 true 改成 false 即可。
// ============================================================
const ENABLE_DEVTOOLS_SHORTCUT = true;

interface AnchorProfilePayload {
  room_id_input: number;
  room_id_real: number;
  anchor_uid: number;
  anchor_name: string;
  anchor_face: string;
  anchor_face_data: string;
  live_status: number;
  room_title: string;
  popularity: number;
  followers: number;
}

interface DashboardRoomProfilePayload {
  name: string;
  live: boolean;
  roomId: number;
  popularityText: string;
  followersText: string;
  avatar: string;
}

interface DashboardViewModelPayload {
  profile: DashboardRoomProfilePayload;
  snapshot: DashboardSnapshotPayload;
}

const DEFAULT_DASHBOARD_ROOM_PROFILE: DashboardRoomProfilePayload = {
  name: "BiliBili",
  live: false,
  roomId: 0,
  popularityText: "0",
  followersText: "0",
  avatar: "",
};

function formatDashboardCountText(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}亿`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)}万`;
  return value.toLocaleString("zh-CN");
}

function normalizeDashboardAvatarUrl(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("//")) return `https:${raw}`;
  if (raw.startsWith("http://")) return raw.replace(/^http:\/\//i, "https://");
  if (raw.startsWith("https://")) return raw;
  if (raw.startsWith("/")) return `https:${raw}`;
  return raw;
}


function resolveDanmakuCoreDir(): string {
  const isDevMode = Boolean(process.env.ELECTRON_RENDERER_URL || process.env.ELECTRON_RUN_AS_NODE);
  if (isDevMode) {
    return join(__dirname, "..", "..", "..", "..", "packages", "danmaku-core");
  }
  const resourcesPath = process.resourcesPath || app.getAppPath();
  return join(resourcesPath, "danmaku-core");
}

function resolvePythonPath(): string {
  const isWin = process.platform === "win32";
  const venvPython = isWin
    ? join(__dirname, "..", "..", "..", "..", ".venv", "Scripts", "python.exe")
    : join(__dirname, "..", "..", "..", "..", ".venv", "bin", "python");
  if (existsSync(venvPython)) return venvPython;
  return isWin ? "python" : "python3";
}

function resolveDanmakuRuntimePath(): string | null {
  const base = resolveDanmakuCoreDir();
  const isWin = process.platform === "win32";
  const candidates = isWin
    ? [
        join(base, "danmaku.exe"),
        join(base, "danmaku", "danmaku.exe"),
        join(base, "run.exe"),
        join(base, "run", "run.exe"),
      ]
    : [
        join(base, "danmaku"),
        join(base, "danmaku", "danmaku"),
        join(base, "run"),
        join(base, "run", "run"),
      ];
  return candidates.find((p) => existsSync(p)) || null;
}

function resolveAnchorScriptPath(): string {
  const base = resolveDanmakuCoreDir();
  const candidates = [
    join(base, "bilibili_core_api.py"),
  ];
  return candidates.find((p) => existsSync(p)) || candidates[0];
}

async function fetchAnchorProfileByPython(roomId: number): Promise<AnchorProfilePayload> {
  const isDevMode = Boolean(process.env.ELECTRON_RENDERER_URL || process.env.ELECTRON_RUN_AS_NODE);
  const scriptPath = resolveAnchorScriptPath();
  const pythonPath = resolvePythonPath();
  const runtimePath = resolveDanmakuRuntimePath();
  const credentials = getConfig().credentials;

  const command = !isDevMode && runtimePath ? runtimePath : pythonPath;
  const args = !isDevMode && runtimePath
    ? ["anchor", String(roomId)]
    : ["-X", "utf8", scriptPath, String(roomId)];
  if (credentials?.sessdata) args.push("--sessdata", credentials.sessdata);
  if (credentials?.biliJct) args.push("--bili-jct", credentials.biliJct);
  if (credentials?.buvid3) args.push("--buvid3", credentials.buvid3);

  return await new Promise<AnchorProfilePayload>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
      },
    });
    anchorProfileChildren.add(child);

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      forceKillChildProcessTree(child);
      anchorProfileChildren.delete(child);
      reject(new Error("主播信息查询超时"));
    }, 15000);

    child.stdout?.on("data", (buf: Buffer) => {
      stdout += buf.toString("utf-8");
    });
    child.stderr?.on("data", (buf: Buffer) => {
      stderr += buf.toString("utf-8");
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      anchorProfileChildren.delete(child);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      anchorProfileChildren.delete(child);
      if (code !== 0) {
        reject(new Error(`主播信息脚本退出异常(code=${code}): ${stderr.trim() || "unknown error"}`));
        return;
      }
      const text = stdout.trim();
      if (!text) {
        reject(new Error("主播信息脚本无输出"));
        return;
      }
      try {
        const parsed = JSON.parse(text) as AnchorProfilePayload;
        resolve(parsed);
      } catch (e) {
        reject(new Error(`主播信息解析失败: ${String(e)} | output=${text}`));
      }
    });
  });
}

function resolvePreloadScriptPath(): string {
  const candidates = [
    join(__dirname, "../preload/index.mjs"),
    join(__dirname, "../preload/index.js"),
  ];
  return candidates.find((p) => existsSync(p)) || candidates[0];
}

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
/** 主播资料查询临时子进程集合（退出时兜底清理） */
const anchorProfileChildren = new Set<ChildProcess>();

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

let cachedDashboardRoomProfile: DashboardRoomProfilePayload | null = null;
let cachedDashboardRoomProfileRoomId = 0;
let danmakuRuntimeWarmed = false;

/**
 * 主进程统一生成 dashboard 房间资料：
 * - 统一 profile 字段口径，减少 renderer 侧拼装逻辑
 * - 带 roomId 粒度缓存，避免高频重复查询主播信息
 */
async function buildDashboardRoomProfile(): Promise<DashboardRoomProfilePayload> {
  const status = danmakuService?.getStatus?.() || { connected: false, roomId: null };
  const connected = Boolean(status.connected);
  const currentRoomId = Number(status.roomId || 0);

  if (!connected || currentRoomId <= 0) {
    cachedDashboardRoomProfile = { ...DEFAULT_DASHBOARD_ROOM_PROFILE };
    cachedDashboardRoomProfileRoomId = 0;
    return { ...DEFAULT_DASHBOARD_ROOM_PROFILE };
  }

  if (
    cachedDashboardRoomProfile &&
    cachedDashboardRoomProfileRoomId === currentRoomId &&
    cachedDashboardRoomProfile.name !== DEFAULT_DASHBOARD_ROOM_PROFILE.name
  ) {
    return { ...cachedDashboardRoomProfile };
  }

  try {
    const data = await fetchAnchorProfileByPython(currentRoomId);
    const avatarDataUrl = String(data.anchor_face_data || "");
    const avatarUrl = normalizeDashboardAvatarUrl(String(data.anchor_face || ""));

    const profile: DashboardRoomProfilePayload = {
      name: data.anchor_name || DEFAULT_DASHBOARD_ROOM_PROFILE.name,
      live: Number(data.live_status || 0) === 1,
      roomId: Number(data.room_id_real || currentRoomId),
      popularityText: formatDashboardCountText(Number(data.popularity || 0)),
      followersText: formatDashboardCountText(Number(data.followers || 0)),
      avatar: avatarDataUrl || avatarUrl,
    };

    cachedDashboardRoomProfile = { ...profile };
    cachedDashboardRoomProfileRoomId = currentRoomId;
    return profile;
  } catch (e) {
    logger.warn("[Dashboard] anchor profile fetch failed, fallback to cached/default", {
      roomId: currentRoomId,
      error: e instanceof Error ? e.message : String(e),
    });

    if (cachedDashboardRoomProfile && cachedDashboardRoomProfileRoomId === currentRoomId) {
      return { ...cachedDashboardRoomProfile };
    }

    return {
      ...DEFAULT_DASHBOARD_ROOM_PROFILE,
      roomId: currentRoomId,
    };
  }
}

const dashboardMetricsStore = createDashboardMetricsStore();

/** 防止重复清理（cleanupBeforeExit 可能被多个退出信号同时触发） */
let isCleanupRunning = false;
/** 是否允许本次 quit 直接放行（清理完成后置 true） */
let allowNativeQuit = false;
/** 退出栅栏 Promise（确保只执行一次） */
let quitBarrierPromise: Promise<void> | null = null;

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
      } finally {
        // 退出阶段释放服务引用，阻断晚到的 start IPC 复用已停止实例
        danmakuService = null;
      }
    }
    // 兜底再清理一次 run.exe，覆盖退出流程 race 或实例状态丢失场景
    cleanupBundledRunExeResidualsSync();
    // 退出后 1s 再检测一次是否仍有 run.exe 残留，并上报日志（不阻塞退出流程）
    void verifyBundledRunExeResidualsAfterCleanup(1000);
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

    // 兜底：清理主播资料查询临时子进程，避免退出后残留
    for (const child of anchorProfileChildren) {
      forceKillChildProcessTree(child);
    }
    anchorProfileChildren.clear();
  } finally {
    isCleanupRunning = false;
  }
}

/** 强制结束子进程（Windows 下结束整棵进程树） */
function forceKillChildProcessTree(child: ChildProcess): void {
  const pid = child.pid;
  if (!pid) return;

  if (process.platform === "win32") {
    try {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      return;
    } catch {
      // 回退到普通 kill
    }
  }

  try {
    child.kill("SIGKILL");
  } catch {
    // ignore
  }
}

/**
 * 单一退出栅栏：只执行一次清理，清理完成后再放行 Electron 退出。
 */
function runQuitBarrier(): Promise<void> {
  if (quitBarrierPromise) return quitBarrierPromise;
  isAppQuitting = true;

  mainWindow?.webContents.send("app:quitting", {
    message: "正在退出程序，请稍候…",
  });

  quitBarrierPromise = (async () => {
    await cleanupBeforeExit();
    allowNativeQuit = true;
    app.quit();
  })().catch((e) => {
    console.error("[Main] quit barrier failed:", e);
    allowNativeQuit = true;
    app.exit(1);
  });

  return quitBarrierPromise;
}

/** 创建主 BrowserWindow，配置预加载脚本和安全策略 */
function createWindow(): void {
  logger.log("Creating window, dev:", logger.isDev);

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 670,
    minWidth: 1200,
    minHeight: 670,
    title: "BiliBili AI弹幕姬",
    icon: getAppIconPath(),
    frame: true,
    backgroundColor: "#1a1b26",
    webPreferences: {
      preload: resolvePreloadScriptPath(),
      sandbox: false,
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

  // 按开关控制开发者工具快捷键（F12 / Ctrl+Shift+I / Cmd+Opt+I）
  mainWindow.webContents.on("before-input-event", (event, input) => {
    const isF12 = input.key === "F12";
    const isToggleDevtoolsCombo =
      (input.control || input.meta) && input.shift && input.key.toUpperCase() === "I";

    if (ENABLE_DEVTOOLS_SHORTCUT && input.type === "keyDown" && (isF12 || isToggleDevtoolsCombo)) {
      event.preventDefault();
      mainWindow?.webContents.toggleDevTools();
      return;
    }

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

  // 标题栏“最小化”按钮：直接最小化到托盘后台运行（若托盘可用）。
  // @ts-ignore
  mainWindow.on("minimize", (event) => {
    if (isAppQuitting) return;
    if (!appTray) return; // 托盘初始化失败时保持系统默认最小化行为
    event.preventDefault();
    mainWindow?.hide();
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
    if (isAppQuitting || isCleanupRunning) {
      return {
        status: "error",
        message: "应用正在退出，已拒绝新的启动请求",
      };
    }

    if (!danmakuService) {
      danmakuService = new DanmakuService();
      danmakuService.on("danmaku", (data) => {
          dashboardMetricsStore.ingestDanmaku(data);
          mainWindow?.webContents.send("danmaku:received", data);
          const username = data?.sender?.username || "";
          if (shouldIgnoreByUsername(username)) return;

         // ── 捕捉开关 ──
         // 该开关仅控制“关键词匹配/固定回复”链路，不应误伤 AI 自动回复。
         // 关闭时：跳过关键词匹配与固定回复，但 AI 仍可接收弹幕。
         const captureEnabled = getConfig().room?.captureEnabled !== false;

          const matchScope = captureEnabled
            ? resolveMatchScope(data?.match?.rule?.scope)
            : resolveMatchScope(undefined);
          const hasKeywordMatch = captureEnabled ? Boolean(data?.match) : false;
          const content = data?.content || "";
          const activeScopes = captureEnabled
            ? (danmakuService?.getKeywordFilterScopes() ?? new Set<KeywordScope>())
            : new Set<KeywordScope>();
          const routeContext = { matchScope, hasKeywordMatch, activeScopes };

        // ── 固定回复路由 ──
        // scope=both/quickReply: 关键词过滤控制固定回复，只处理命中弹幕
        // scope=ai: 固定回复绕过关键词过滤，处理所有弹幕
        // 未命中弹幕：如果存在 scope=ai 关键词，固定回复也处理（绕过过滤）
          const quickReplyEligible = captureEnabled && isQuickReplyEligible(routeContext);

        // 固定回复全局开关：关闭时完全不触发固定回复
          const quickReplyEnabled = getConfig().quickReplyEnabled;
          const quickMatch =
            quickReplyEligible && quickReplyEnabled
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
          const aiEligible = captureEnabled ? isAiEligible(routeContext) : true;

        // 固定回复优先级高于 AI：一旦命中固定回复，本条弹幕不再进入 AI 队列。
          if (!quickReplyHandled && aiEligible && aiRelay && !aiRelay.shouldIgnoreIncoming(data)) {
            aiRelay.enqueue(data);
          }
        });
      danmakuService.on("gift", (data) => {
        dashboardMetricsStore.ingestGift(data);
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
        dashboardMetricsStore.ingestSuperChat(data);
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
  ipcMain.handle("danmaku:stop", async (_event, options?: { sendBeforeStop?: boolean; message?: string; cancelStart?: boolean }) => {
    if (danmakuService) {
      if (options?.cancelStart && danmakuService.isStartInProgress()) {
        danmakuService.abortStart("用户取消连接");
        return { status: "ok", cancelled: true };
      }

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

  /**
   * Dashboard 组合视图模型：
   * - 一次 IPC 同时返回 roomProfile + snapshot
   * - 减少 renderer 双请求的耦合与抖动窗口
   */
  ipcMain.handle("dashboard:getViewModel", async (): Promise<{ status: string; data?: DashboardViewModelPayload; message?: string }> => {
    try {
      const profile = await buildDashboardRoomProfile();
      const snapshot = dashboardMetricsStore.buildSnapshot(latestAIStatus);
      return { status: "ok", data: { profile, snapshot } };
    } catch (e) {
      return { status: "error", message: e instanceof Error ? e.message : String(e) };
    }
  });

  /** 查询直播间主播资料（独立 Python 脚本，不影响现有弹幕链路） */
  ipcMain.handle("room:getAnchorProfile", async (_event, roomId: number) => {
    const normalizedRoomId = Math.max(0, Number(roomId || 0));
    if (!normalizedRoomId) {
      return { status: "error", message: "roomId 无效" };
    }
    try {
      const data = await fetchAnchorProfileByPython(normalizedRoomId);
      return { status: "ok", data };
    } catch (e) {
      return { status: "error", message: e instanceof Error ? e.message : String(e) };
    }
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
  registerAppUtilityIpcHandlers();
}

// ─── 单实例限制 ────────────────────────────────────────────
// 必须在 app.whenReady() 之前调用 requestSingleInstanceLock()。
// 返回 false 表示已有实例在运行，当前进程应立即退出，避免多实例并发导致资源冲突。

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  // 第二个实例：直接退出，不初始化任何资源
  app.quit();
} else {
  // 已有实例收到第二个实例的启动请求 → 聚焦/恢复主窗口
  app.on("second-instance", () => {
    if (isAppQuitting || isCleanupRunning) return;
    const win = mainWindow;
    if (!win || win.isDestroyed()) {
      // 窗口不存在（可能被关到托盘后窗口已销毁），重新创建
      createWindow();
      registerIpcHandlers();
      return;
    }
    // 窗口存在：从最小化/隐藏状态恢复并聚焦到前台
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    win.focus();
  });

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

  /** 延后预热 danmaku runtime（仅触发一次），用于降低首次连接冷启动卡顿。 */
  ipcMain.handle("app:warmupDanmakuRuntime", async () => {
    if (danmakuRuntimeWarmed) {
      return { status: "ok", warmed: true, skipped: true };
    }
    danmakuRuntimeWarmed = true;
    warmupBundledDanmakuRuntime();
    return { status: "ok", warmed: true, skipped: false };
  });

  /** 所有窗口关闭 → 清理 → 延迟退出（macOS 需要显式 quit） */
  app.on("window-all-closed", () => {
    if (allowNativeQuit) return;
    void runQuitBarrier();
  });

  /** 退出前清理（防止资源泄露） */
  app.on("before-quit", (event) => {
    if (allowNativeQuit) return;
    event.preventDefault();
    void runQuitBarrier();
  });

  /** 进程信号处理（Ctrl+C / kill） */
  process.on("SIGINT", () => {
    void runQuitBarrier().finally(() => process.exit(0));
  });

  process.on("SIGTERM", () => {
    void runQuitBarrier().finally(() => process.exit(0));
  });

  // Node 进程退出前的最后兜底（同步）
  process.on("exit", () => {
    cleanupBundledRunExeResidualsSync();
  });

  /** 未捕获异常 → 记录日志 → 清理 → 非零退出 */
  process.on("uncaughtException", (err) => {
    console.error("[Main] uncaughtException:", err);
    void runQuitBarrier().finally(() => process.exit(1));
  });

  /** macOS dock 点击事件：无窗口时重新创建 */
  app.on("activate", () => {
    if (isAppQuitting || isCleanupRunning) return;
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}
