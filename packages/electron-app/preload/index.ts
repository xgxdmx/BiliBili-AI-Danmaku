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
  minMedalLevel: number;
  sendOnDisconnect: boolean;
  disconnectMessage: string;
}

export interface OpenClawConfig {
  endpoint: string;
  token: string;
}

export interface AIModelConfig {
  provider: string;
  apiKey: string;
  modelId: string;
  endpoint: string;
  prompt: string;
  sendIntervalMs: number;
  maxPending: number;
  ignoreUsernames: string[];
  skipReplies: string[];
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
  keywords: KeywordRule[];
  quickReplies: QuickReplyRule[];
  openClaw: OpenClawConfig;
  aiModel: AIModelConfig;
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
  exportConfig: () => Promise<{ status: string; path?: string; error?: string }>;
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
  onDanmaku: (callback: (data: unknown) => void) => () => void;
  onGift: (callback: (data: unknown) => void) => () => void;
  onSuperChat: (callback: (data: unknown) => void) => () => void;
  onConnected: (callback: (data: unknown) => void) => () => void;
  onDisconnected: (callback: (data: unknown) => void) => () => void;
  onError: (callback: (data: unknown) => void) => () => void;
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
  exportConfig: () => ipcRenderer.invoke("config:export"),
  importConfig: (filePath) => ipcRenderer.invoke("config:import", filePath),
  importConfigContent: (content) => ipcRenderer.invoke("config:importContent", content),
  openBiliLogin: () => ipcRenderer.invoke("auth:openLoginWindow"),
  onLoginStatus: (callback) => {
    const handler = (_event: unknown, data: { state?: string; message?: string; credentials?: Credentials }) => callback(data);
    ipcRenderer.on("auth:loginStatus", handler);
    return () => ipcRenderer.removeListener("auth:loginStatus", handler);
  },
  connectAI: () => ipcRenderer.invoke("ai:connect"),
  disconnectAI: () => ipcRenderer.invoke("ai:disconnect"),
  getAIStatus: () => ipcRenderer.invoke("ai:getStatus"),
  clearAIQueue: () => ipcRenderer.invoke("ai:clearQueue"),
  clearAIPreview: () => ipcRenderer.invoke("ai:clearPreview"),
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
};

contextBridge.exposeInMainWorld("danmakuAPI", api);
