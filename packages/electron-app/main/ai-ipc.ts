// ============================================================
// AI IPC - 注册 AI / Ollama / OpenCode 相关主进程 IPC
//
// 职责：
//   1. 处理 AI 连接、断开、状态查询与队列清理
//   2. 提供 Ollama / OpenCode 模型列表查询入口
//   3. 作为渲染进程访问 AI 能力的主进程入口层
// ============================================================

import { ipcMain } from "electron";
import type { MainAppContext } from "./app-context";
import { getConfig } from "./config-store";
import { logger } from "./logger";

/**
 * 注册 AI / Ollama / OpenCode 相关 IPC。
 * 这些 handler 只依赖 aiRelay 和配置读取，适合从 index.ts 独立出来。
 */
export function registerAiIpcHandlers(context: MainAppContext): void {
  /** 连接 AI 供应商：合并共享配置 + 当前供应商独立配置 → 传入 AIRelayManager.connect() */
  ipcMain.handle("ai:connect", async () => {
    const aiRelay = context.getAIRelay();
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
    context.setLatestAIStatus(status);

    logger.log("AI connected:", { provider: status.provider, modelId: status.modelId });

    return { status: "ok", message: "连接成功，系统提示词已注入会话上下文" };
  });

  /** 断开 AI 连接 */
  ipcMain.handle("ai:disconnect", async () => {
    const aiRelay = context.getAIRelay();
    aiRelay?.disconnect();
    context.setLatestAIStatus(aiRelay?.getStatus() || context.getLatestAIStatus());
    return { status: "ok" };
  });

  /** 查询 AI 连接状态（队列长度、处理数、发送/跳过/失败计数等） */
  ipcMain.handle("ai:getStatus", async () => {
    return context.getAIRelay()?.getStatus() || context.getLatestAIStatus();
  });

  /** 清空 AI 待发送队列 */
  ipcMain.handle("ai:clearQueue", async () => {
    const aiRelay = context.getAIRelay();
    if (!aiRelay) {
      return { status: "ok", cleared: 0 };
    }
    const result = aiRelay.clearQueue();
    context.setLatestAIStatus(aiRelay.getStatus());
    return { status: "ok", ...result };
  });

  /** 清空 AI 返回预览记录 */
  ipcMain.handle("ai:clearPreview", async () => {
    const aiRelay = context.getAIRelay();
    if (!aiRelay) {
      return { status: "ok", cleared: 0 };
    }
    const result = aiRelay.clearDecisionHistory();
    context.setLatestAIStatus(aiRelay.getStatus());
    return { status: "ok", ...result };
  });

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
}
