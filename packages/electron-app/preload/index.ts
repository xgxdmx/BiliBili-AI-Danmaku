import { contextBridge, ipcRenderer } from "electron";

// ============================================================
// Preload - 安全暴露 IPC API 到渲染进程
// ============================================================

export interface Credentials {
  sessdata: string;
  biliJct: string;
  buvid3: string;
}

export interface KeywordRule {
  id: string;
  pattern: string;
  type: "keyword" | "regex";
  enabled: boolean;
  caseSensitive: boolean;
  scope: "both" | "quickReply" | "ai";
}

export interface QuickReplyRule {
  id: string;
  enabled: boolean;
  contains: string[];
  notContains: string[];
  regex: string;
  reply: string;
  caseSensitive: boolean;
  cooldownMs: number;
}

export interface RoomConfig {
  roomId: number;
  enabled: boolean;
  /** 弹幕捕捉总开关。关闭后弹幕仅显示，不触发匹配/AI/固定回复 */
  captureEnabled: boolean;
  minMedalLevel: number;
  sendOnDisconnect: boolean;
  disconnectMessage: string;
}

export interface OpenClawConfig {
  endpoint: string;
  token: string;
}

export interface ProviderConfig {
  modelId: string;
  apiKey: string;
  endpoint: string;
  ollamaBaseUrl?: string;
  maxTokens: number;
  temperature: number;
  topP: number;
  ollamaKeepAlive?: string;
  requestTimeoutMs: number;
}

export interface AIModelConfig {
  provider: string;
  prompt: string;
  sendIntervalMs: number;
  maxPending: number;
  ignoreUsernames: string[];
  skipReplies: string[];
  providers: Record<string, ProviderConfig>;
}

export interface AIConnectionStatus {
  connected: boolean;
  provider: string;
  modelId: string;
  connectedAt: number | null;
  queueLength: number;
  processing: boolean;
  sentCount: number;
  skippedCount: number;
  clearedCount: number;
  failedCount: number;
  lastError: string | null;
  sendIntervalMs: number;
  maxPending: number;
  recentDecisions: Array<{
    id: string;
    timestamp: number;
    input: string;
    output: string;
    action: "pending_send" | "sent" | "skipped" | "error" | "cleared";
    reason: string;
  }>;
}

export interface ConfigSchema {
  room: RoomConfig;
  credentials: Credentials;
  /** 固定回复全局开关 */
  quickReplyEnabled?: boolean;
  keywords: KeywordRule[];
  quickRepliesEnabled: boolean;
  quickReplies: QuickReplyRule[];
  openClaw: OpenClawConfig;
  aiModel: AIModelConfig;
  /** 主题模式：light / dark / system */
  theme: "light" | "dark" | "system";
  /** 点击窗口关闭按钮（X）时行为：询问 / 托盘后台 / 直接退出 */
  closeWindowBehavior?: "ask" | "tray" | "exit";
}

export interface DanmakuAPI {
  start: (config: unknown) => Promise<{ status: string }>;
  stop: (options?: { sendBeforeStop?: boolean; message?: string }) => Promise<{ status: string }>;
  send: (params: { msg: string; color?: number; mode?: number }) => Promise<unknown>;
  getStatus: () => Promise<{ connected: boolean; roomId: number | null }>;
  updateKeywords: (keywords: KeywordRule[]) => Promise<{ status: string }>;
  updateMinMedalLevel: (level: number) => Promise<{ status: string; minMedalLevel: number }>;
  updateQuickReplies: (rules: QuickReplyRule[]) => Promise<{ status: string }>;
  getConfig: () => Promise<ConfigSchema>;
  setConfig: (key: string, value: unknown) => Promise<{ status: string }>;
  exportConfig: (options?: { includeSensitive?: boolean }) => Promise<{ status: string; path?: string; error?: string }>;
  importConfig: (filePath: string) => Promise<{ status: string; error?: string }>;
  importConfigContent: (content: string) => Promise<{ status: string; error?: string }>;
  openBiliLogin: () => Promise<{ status: string; state?: "opened"; message?: string }>;
  onLoginStatus: (
    callback: (data: {
      state?: "opened" | "closed" | "confirmed";
      message?: string;
      credentials?: Credentials;
    }) => void
  ) => () => void;
  connectAI: () => Promise<{ status: string; message?: string }>;
  disconnectAI: () => Promise<{ status: string }>;
  getAIStatus: () => Promise<AIConnectionStatus>;
  clearAIQueue: () => Promise<{ status: string; cleared: number }>;
  clearAIPreview: () => Promise<{ status: string; cleared: number }>;
  onAIStatus: (callback: (data: AIConnectionStatus) => void) => () => void;
  fetchOllamaModels: (baseUrl: string) => Promise<{ status: string; models?: string[]; message?: string }>;
  fetchOpenCodeModels: () => Promise<{ status: string; models?: string[]; message?: string }>;
  onDanmaku: (callback: (data: unknown) => void) => () => void;
  onGift: (callback: (data: unknown) => void) => () => void;
  onSuperChat: (callback: (data: unknown) => void) => () => void;
  onConnected: (callback: (data: unknown) => void) => () => void;
  onDisconnected: (callback: (data: unknown) => void) => () => void;
  onError: (callback: (data: unknown) => void) => () => void;
  /** 获取当前主题模式设置 */
  getTheme: () => Promise<{ mode: "light" | "dark" | "system"; resolved: "light" | "dark" }>;
  /** 设置主题模式 */
  setTheme: (mode: "light" | "dark" | "system") => Promise<{ resolved: "light" | "dark" }>;
  /** 监听主题变更（系统主题变化或用户手动切换） */
  onThemeChanged: (callback: (resolved: "light" | "dark") => void) => () => void;
  /** 监听主进程发起的关闭确认请求（由渲染层展示主题化弹窗） */
  onCloseConfirmRequested: (callback: (data: { requestId: string; message: string; detail: string }) => void) => () => void;
  /** 向主进程回传关闭确认结果 */
  respondCloseConfirm: (payload: { requestId: string; action: "tray" | "exit" | "cancel"; remember: boolean }) => Promise<{ status: string }>;
}

const api: DanmakuAPI = {
  start: (config) => ipcRenderer.invoke("danmaku:start", config),
  stop: (options) => ipcRenderer.invoke("danmaku:stop", options),
  send: (params) => ipcRenderer.invoke("danmaku:send", params),
  getStatus: () => ipcRenderer.invoke("danmaku:getStatus"),
  updateKeywords: (keywords) => ipcRenderer.invoke("keywords:update", keywords),
  updateMinMedalLevel: (level) => ipcRenderer.invoke("keywords:updateMinMedalLevel", level),
  updateQuickReplies: (rules) => ipcRenderer.invoke("quickReplies:update", rules),
  getConfig: () => ipcRenderer.invoke("config:get"),
  setConfig: (key, value) => ipcRenderer.invoke("config:set", key, value),
  exportConfig: (options) => ipcRenderer.invoke("config:export", options),
  importConfig: (filePath) => ipcRenderer.invoke("config:import", filePath),
  importConfigContent: (content) => ipcRenderer.invoke("config:importContent", content),
  openBiliLogin: () => ipcRenderer.invoke("auth:openLoginWindow"),
  onLoginStatus: (callback) => {
    const handler = (_event: unknown, data: { state?: "opened" | "closed" | "confirmed"; message?: string; credentials?: Credentials }) => callback(data);
    ipcRenderer.on("auth:loginStatus", handler);
    return () => ipcRenderer.removeListener("auth:loginStatus", handler);
  },
  connectAI: () => ipcRenderer.invoke("ai:connect"),
  disconnectAI: () => ipcRenderer.invoke("ai:disconnect"),
  getAIStatus: () => ipcRenderer.invoke("ai:getStatus"),
  clearAIQueue: () => ipcRenderer.invoke("ai:clearQueue"),
  clearAIPreview: () => ipcRenderer.invoke("ai:clearPreview"),
  fetchOllamaModels: (baseUrl: string) => ipcRenderer.invoke("ollama:listModels", baseUrl),
  fetchOpenCodeModels: () => ipcRenderer.invoke("opencode:listModels"),
  onAIStatus: (callback) => {
    const handler = (_event: unknown, data: AIConnectionStatus) => callback(data);
    ipcRenderer.on("ai:status", handler);
    return () => ipcRenderer.removeListener("ai:status", handler);
  },

  onDanmaku: (callback) => {
    const handler = (_event: unknown, data: unknown) => callback(data);
    ipcRenderer.on("danmaku:received", handler);
    return () => ipcRenderer.removeListener("danmaku:received", handler);
  },
  onGift: (callback) => {
    const handler = (_event: unknown, data: unknown) => callback(data);
    ipcRenderer.on("danmaku:gift", handler);
    return () => ipcRenderer.removeListener("danmaku:gift", handler);
  },
  onSuperChat: (callback) => {
    const handler = (_event: unknown, data: unknown) => callback(data);
    ipcRenderer.on("danmaku:superchat", handler);
    return () => ipcRenderer.removeListener("danmaku:superchat", handler);
  },
  onConnected: (callback) => {
    const handler = (_event: unknown, data: unknown) => callback(data);
    ipcRenderer.on("danmaku:connected", handler);
    return () => ipcRenderer.removeListener("danmaku:connected", handler);
  },
  onDisconnected: (callback) => {
    const handler = (_event: unknown, data: unknown) => callback(data);
    ipcRenderer.on("danmaku:disconnected", handler);
    return () => ipcRenderer.removeListener("danmaku:disconnected", handler);
  },
  onError: (callback) => {
    const handler = (_event: unknown, data: unknown) => callback(data);
    ipcRenderer.on("danmaku:error", handler);
    return () => ipcRenderer.removeListener("danmaku:error", handler);
  },

  getTheme: () => ipcRenderer.invoke("theme:get"),
  setTheme: (mode) => ipcRenderer.invoke("theme:set", mode),
  onThemeChanged: (callback) => {
    const handler = (_event: unknown, resolved: "light" | "dark") => callback(resolved);
    ipcRenderer.on("theme:changed", handler);
    return () => ipcRenderer.removeListener("theme:changed", handler);
  },
  onCloseConfirmRequested: (callback) => {
    const handler = (
      _event: unknown,
      data: { requestId: string; message: string; detail: string },
    ) => callback(data);
    ipcRenderer.on("window:closeConfirmRequested", handler);
    return () => ipcRenderer.removeListener("window:closeConfirmRequested", handler);
  },
  respondCloseConfirm: (payload) => ipcRenderer.invoke("window:closeConfirmRespond", payload),
};

contextBridge.exposeInMainWorld("danmakuAPI", api);
