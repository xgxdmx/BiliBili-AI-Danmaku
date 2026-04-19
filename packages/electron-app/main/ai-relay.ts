// ============================================================
// AI 弹幕中继管理器
// 接收弹幕 → 调用 AI 模型 → 回复到直播间
// 支持 OpenCode（云端）和 Ollama（本地）供应商
// ============================================================

import { EventEmitter } from "events";

// ─── 类型定义 ─────────────────────────────────────────────

export interface RelaySender {
  uid: number;
  username: string;
  /** 大航海等级 (0=无, 1=总督, 2=提督, 3=舰长) */
  guard_level?: number;
  /** 大航海称号 (总督/提督/舰长) */
  guard_title?: string;
  medal?: { name: string; level: number; color: number } | null;
}

export interface RelayDanmaku {
  id: number;
  content: string;
  sender: RelaySender;
  timestamp: number;
  roomId: number;
  match?: unknown;
}

export interface AIRelayConfig {
  provider: string;
  apiKey: string;
  modelId: string;
  endpoint: string;
  prompt: string;
  sendIntervalMs: number;
  maxPending: number;
  skipReplies: string[];
  ollamaBaseUrl?: string;
  /** 最大输出 token 数（含 thinking）。Ollama thinking 模型建议 ≥ 2048，其他 256 即可 */
  maxTokens?: number;
  /** 回复温度 (0~2)。越高越随机，越低越确定 */
  temperature?: number;
  /** 核采样概率累积截断 (0~1)。与温度互补，1=不截断 */
  topP?: number;
  /** Ollama 模型保活时间，如 "5m"、"30m"。避免每次请求重新加载模型 */
  ollamaKeepAlive?: string;
  /** 单次请求超时(ms)。Ollama 本地推理较慢建议 ≥ 120000，云端 API 30000 即可 */
  requestTimeoutMs?: number;
}

/** 编译后的跳过规则：纯文本或正则 */
interface SkipRule {
  /** 纯文本标记（normalized，用于前缀/精确匹配） */
  literal: string;
  /** 编译后的正则（/pattern/flags 语法时生成） */
  regex: RegExp | null;
  /** 原始输入文本（用于 reason 报告） */
  raw: string;
}

interface QueueItem {
  seq: number;
  danmaku: RelayDanmaku;
  attempts: number;
}

export interface AIRelayStatus {
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
  recentDecisions: AIReplyDecision[];
}

export interface AIReplyDecision {
  id: string;
  timestamp: number;
  input: string;
  output: string;
  action: "pending_send" | "sent" | "skipped" | "error" | "cleared";
  reason: string;
}

// ─── 跳过规则引擎 ──────────────────────────────────────────

const DEFAULT_SKIP_REPLIES = [
  "NO_REPLY",
  "无需回复",
  "不需要回复",
  "不用回复",
  "不回复",
  "忽略",
  "skip",
  "pass",
];

/** 解析 /pattern/flags 语法为 RegExp */
function parseSkipRegex(entry: string): RegExp | null {
  const match = /^\/(.+)\/([gimsuy]*)$/.exec(entry);
  if (!match) return null;
  try {
    return new RegExp(match[1], match[2]);
  } catch {
    return null;
  }
}

/** 从字符串数组编译为 SkipRule 列表 */
function compileSkipRules(entries: string[]): SkipRule[] {
  const rules: SkipRule[] = [];
  for (const raw of entries) {
    const trimmed = String(raw || "").trim();
    if (!trimmed) continue;
    const regex = parseSkipRegex(trimmed);
    // 去空白防止"无 需 回 复"等拆字绕过
    const literal = trimmed.replace(/\s+/g, "").toLowerCase();
    rules.push({ literal, regex: regex ?? null, raw: trimmed });
  }
  return rules;
}

// ─── 工具函数 ──────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampText(text: string, maxLen = 40): string {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  return normalized.length <= maxLen ? normalized : normalized.slice(0, maxLen);
}

function normalizeAnyText(value: unknown): string | null {
  if (typeof value === "string") {
    const t = value.trim();
    return t ? t : null;
  }
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const item of value) {
      const t = normalizeAnyText(item);
      if (t) parts.push(t);
    }
    return parts.length > 0 ? parts.join(" ").trim() : null;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const candidate of [obj.text, obj.output_text, obj.content, obj.value]) {
      const t = normalizeAnyText(candidate);
      if (t) return t;
    }
  }
  return null;
}

function responsePreview(data: unknown): string {
  try {
    return JSON.stringify(data);
  } catch {
    return "[unserializable response]";
  }
}

/** AI 响应的宽松类型，兼容各 provider */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AIResponseData = any;

// ─── 响应文本提取 ──────────────────────────────────────────

/**
 * 从 AI 响应中提取最终回复文本。
 * Ollama 的 content 可能包含 <think/> 标签，需清理。
 */
function extractReplyText(data: AIResponseData, provider: string): string | null {
  const choiceText = normalizeAnyText(data?.choices?.[0]?.message?.content);
  if (choiceText) {
    if (provider === "ollama") {
      // Ollama content 可能混入 <think/</think 标签
      const cleaned = choiceText
        .replace(/<think[\s\S]*?<\/think>/gi, "")
        .replace(/<thinking[\s\S]*?<\/thinking>/gi, "")
        .replace(/\n+/g, " ")
        .trim();
      if (cleaned) return cleaned;
    } else {
      return choiceText;
    }
  }

  // 多级 fallback
  const fallbacks = [
    normalizeAnyText(data?.choices?.[0]?.text),
    normalizeAnyText(data?.output_text),
    normalizeAnyText(data?.response?.output_text),
  ];
  for (const fb of fallbacks) {
    if (fb) return fb;
  }

  // output 数组
  const output = Array.isArray(data?.output) ? data.output : [];
  for (const item of output) {
    const text = normalizeAnyText(item?.content) || normalizeAnyText(item?.text) || normalizeAnyText(item?.output_text);
    if (text) return text;
  }

  return normalizeAnyText(data?.content);
}

function extractAnthropicText(data: AIResponseData): string | null {
  const contentText = normalizeAnyText(data?.content);
  if (contentText) return contentText;
  return normalizeAnyText(data?.output_text) || normalizeAnyText(data?.completion);
}

/** 单条弹幕最大重试次数，超过后丢弃（防毒弹幕阻塞队列） */
const MAX_RETRIES = 3;

// ─── AIRelayManager ────────────────────────────────────────

/**
 * AI 弹幕中继管理器。
 * 接收弹幕 → 调用 AI 模型 → 将回复发送到直播间。
 * 支持 OpenCode（云端）和 Ollama（本地）两种供应商。
 */
export class AIRelayManager extends EventEmitter {
  private config: AIRelayConfig | null = null;
  private compiledSkipRules: SkipRule[] = compileSkipRules(DEFAULT_SKIP_REPLIES);
  private queue: QueueItem[] = [];
  private processing = false;
  private connected = false;
  private connectedAt: number | null = null;
  private seq = 0;
  private lastSendAt = 0;
  private sentCount = 0;
  private skippedCount = 0;
  private clearedCount = 0;
  private failedCount = 0;
  private lastError: string | null = null;

  /** 追踪最近发送的消息，避免 AI 回复自己的消息（防 echo 循环） */
  private readonly echoGuards: Array<{ text: string; expiresAt: number; remaining: number }> = [];
  /** 最近决策记录，环形缓冲区（max 50），供 UI 预览 */
  private readonly recentDecisions: AIReplyDecision[] = [];

  constructor(private readonly sendDanmaku: (msg: string) => Promise<unknown>) {
    super();
  }

  /** 连接 AI 模型，验证可用性后开始处理队列 */
  async connect(config: AIRelayConfig): Promise<void> {
    // 先断开旧连接，让 processQueue 的 while 循环自然退出
    if (this.connected || this.processing) {
      this.disconnect();
      for (let i = 0; i < 50 && this.processing; i += 1) {
        await sleep(100);
      }
    }

    const rawInterval = Number(config.sendIntervalMs) || 1800;
    const rawMaxPending = Number(config.maxPending) || 100;

    const normalized: AIRelayConfig = {
      ...config,
      sendIntervalMs: Math.max(500, Number.isFinite(rawInterval) ? rawInterval : 1800),
      maxPending: Math.max(10, Number.isFinite(rawMaxPending) ? rawMaxPending : 100),
      prompt: String(config.prompt || "").trim(),
      apiKey: String(config.apiKey || "").trim(),
      skipReplies: Array.isArray(config.skipReplies)
        ? config.skipReplies.map((x) => String(x ?? "").trim()).filter(Boolean)
        : [...DEFAULT_SKIP_REPLIES],
    };

    if (normalized.skipReplies.length === 0) {
      normalized.skipReplies = [...DEFAULT_SKIP_REPLIES];
    }

    this.compiledSkipRules = compileSkipRules(normalized.skipReplies);

    if (!normalized.provider || !normalized.modelId || !normalized.endpoint) {
      throw new Error("请先完整保存模型供应商配置");
    }
    if (!normalized.apiKey && !this.isOllamaProvider(normalized.provider)) {
      throw new Error("请先填写 API Key 并保存");
    }
    if (!normalized.prompt) {
      throw new Error("请先填写提示词");
    }

    // 重置会话状态
    this.queue = [];
    this.recentDecisions.length = 0;
    this.echoGuards.length = 0;
    this.seq = 0;
    this.lastSendAt = 0;
    this.sentCount = 0;
    this.skippedCount = 0;
    this.clearedCount = 0;
    this.failedCount = 0;
    this.lastError = null;
    this.processing = false;

    await this.verifyConnection(normalized);

    this.config = normalized;
    this.connected = true;
    this.connectedAt = Date.now();
    this.emitStatus();
  }

  /** 断开 AI 连接，清空队列 */
  disconnect(): void {
    this.connected = false;
    this.connectedAt = null;
    this.processing = false;
    this.queue = [];
    this.echoGuards.length = 0;
    this.lastSendAt = 0;
    this.emitStatus();
  }

  /** 手动清空待发送队列 */
  clearQueue(): { cleared: number } {
    const cleared = this.queue.length;
    if (cleared > 0) {
      this.queue = [];
      this.clearedCount += cleared;
      this.pushDecision({
        id: `clear-${Date.now()}`,
        timestamp: Date.now(),
        input: "",
        output: "",
        action: "cleared",
        reason: `手动清空队列，移除 ${cleared} 条待发送消息`,
      });
      this.emitStatus();
    }
    return { cleared };
  }

  /** 清空决策历史 */
  clearDecisionHistory(): { cleared: number } {
    const cleared = this.recentDecisions.length;
    if (cleared > 0) {
      this.recentDecisions.length = 0;
      this.emitStatus();
    }
    return { cleared };
  }

  /** 将弹幕加入处理队列 */
  enqueue(danmaku: RelayDanmaku): void {
    if (!this.connected || !this.config) return;
    const item: QueueItem = { seq: ++this.seq, danmaku, attempts: 0 };
    this.queue.push(item);
    if (this.queue.length > this.config.maxPending) {
      this.lastError = `排队数 ${this.queue.length} 超过设定上限 ${this.config.maxPending}，已继续排队以避免丢弹幕`;
    }
    this.emitStatus();
    void this.processQueue();
  }

  /** 检查弹幕是否应被忽略（echo guard：避免回复自己刚发的消息） */
  shouldIgnoreIncoming(danmaku: RelayDanmaku): boolean {
    const content = this.normalizeText(danmaku.content);
    if (!content) return false;
    const now = Date.now();
    this.pruneEchoGuards(now);
    for (const guard of this.echoGuards) {
      if (guard.text === content && guard.remaining > 0) {
        guard.remaining -= 1;
        return true;
      }
    }
    return false;
  }

  /** 获取当前状态快照 */
  getStatus(): AIRelayStatus {
    return {
      connected: this.connected,
      provider: this.config?.provider || "",
      modelId: this.config?.modelId || "",
      connectedAt: this.connectedAt,
      queueLength: this.queue.length,
      processing: this.processing,
      sentCount: this.sentCount,
      skippedCount: this.skippedCount,
      clearedCount: this.clearedCount,
      failedCount: this.failedCount,
      lastError: this.lastError,
      sendIntervalMs: this.config?.sendIntervalMs || 1800,
      maxPending: this.config?.maxPending || 100,
      recentDecisions: [...this.recentDecisions],
    };
  }

  private emitStatus(): void {
    this.emit("status", this.getStatus());
  }

  private formatForModel(danmaku: RelayDanmaku): string {
    const medal = danmaku.sender.medal?.name
      ? `${danmaku.sender.medal.name}${danmaku.sender.medal.level ? ` ${danmaku.sender.medal.level}` : ""}`
      : "无粉丝牌";
    const guard = danmaku.sender.guard_title || "";
    const username = danmaku.sender.username || "匿名用户";
    return `${guard ? `${guard} | ` : ""}粉丝牌:${medal} | 用户名:${username} | 弹幕:${danmaku.content}`;
  }

  private normalizeText(text: string): string {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  /** 仅基于最终回复文本做 skip 判断（不基于 thinking/reasoning） */
  private shouldSkipReply(reply: string): { skip: boolean; reason: string } {
    const normalized = this.normalizeText(reply);
    if (!normalized) return { skip: true, reason: "模型返回空内容" };

    const collapsed = normalized.replace(/\s+/g, "").toLowerCase();
    for (const rule of this.compiledSkipRules) {
      if (rule.regex) {
        try {
          if (rule.regex.test(normalized) || rule.regex.test(collapsed)) {
            return { skip: true, reason: `命中跳过正则: ${rule.raw}` };
          }
        } catch { /* 正则执行异常时跳过此规则 */ }
        continue;
      }
      if (collapsed === rule.literal) return { skip: true, reason: `命中跳过标记: ${rule.raw}` };
      if (
        collapsed.startsWith(`${rule.literal}:`) ||
        collapsed.startsWith(`${rule.literal}：`) ||
        collapsed.startsWith(`[${rule.literal}]`) ||
        collapsed.startsWith(`【${rule.literal}】`)
      ) {
        return { skip: true, reason: `命中跳过标记: ${rule.raw}` };
      }
    }
    return { skip: false, reason: "" };
  }

  private pushDecision(decision: AIReplyDecision): void {
    this.recentDecisions.unshift(decision);
    if (this.recentDecisions.length > 50) this.recentDecisions.length = 50;
  }

  private updateDecisionAction(id: string, action: AIReplyDecision["action"], reason?: string): void {
    const item = this.recentDecisions.find((x) => x.id === id);
    if (!item) return;
    item.action = action;
    if (reason) item.reason = reason;
  }

  /** 记录已发送消息到 echo guard（90 秒过期，防止回复自己的消息） */
  private rememberOutgoing(text: string): void {
    const normalized = this.normalizeText(text);
    if (!normalized) return;
    this.pruneEchoGuards();
    this.echoGuards.push({ text: normalized, expiresAt: Date.now() + 90_000, remaining: 1 });
  }

  private pruneEchoGuards(now = Date.now()): void {
    for (let i = this.echoGuards.length - 1; i >= 0; i -= 1) {
      if (this.echoGuards[i].expiresAt <= now || this.echoGuards[i].remaining <= 0) {
        this.echoGuards.splice(i, 1);
      }
    }
  }

  /**
   * 队列处理主循环。
   * 逐条取出弹幕 → 调用 AI → skip 判断 → 节流发送。
   * 超过 MAX_RETRIES 次重试的毒弹幕直接丢弃。
   * 失败后指数退避（800ms × attempts，上限 5s）。
   */
  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    this.emitStatus();
    try {
      while (this.connected && this.config && this.queue.length > 0) {
        const item = this.queue[0];

        // 超过最大重试次数，丢弃毒弹幕
        if (item.attempts >= MAX_RETRIES) {
          this.queue.shift();
          this.pushDecision({
            id: `drop-${item.seq}-${Date.now()}`,
            timestamp: Date.now(),
            input: this.formatForModel(item.danmaku),
            output: "",
            action: "error",
            reason: `重试 ${item.attempts} 次后丢弃，防止队列阻塞`,
          });
          this.emitStatus();
          continue;
        }

        try {
          const modelInput = this.formatForModel(item.danmaku);
          const rawResponse = await this.askModelRaw(this.config, modelInput);
          const decisionId = `d-${item.seq}-${Date.now()}`;

          // 截断检测：finish_reason=length 且 content 为空说明 token 不够
          const finishReason = rawResponse?.choices?.[0]?.finish_reason;
          const contentEmpty = !rawResponse?.choices?.[0]?.message?.content;
          if (finishReason === "length" && contentEmpty) {
            throw new Error(
              `模型输出被截断（max_tokens 不足），思考过程耗尽了 token 预算。` +
              `Ollama thinking 模型建议 max_tokens ≥ 2048。finish_reason=length`,
            );
          }

          // 提取回复文本（Ollama 的 <think/> 标签在 extractReplyText 内清理）
          const replyText = extractReplyText(rawResponse, this.config.provider);
          if (!replyText) {
            throw new Error(`未能解析模型回复，响应预览: ${responsePreview(rawResponse)}`);
          }
          const text = clampText(replyText, 40);

          const skip = this.shouldSkipReply(text);
          if (skip.skip) {
            this.skippedCount += 1;
            this.queue.shift();
            this.lastError = null;
            this.pushDecision({ id: decisionId, timestamp: Date.now(), input: modelInput, output: text, action: "skipped", reason: skip.reason });
            this.emitStatus();
            continue;
          }

          this.pushDecision({ id: decisionId, timestamp: Date.now(), input: modelInput, output: text, action: "pending_send", reason: "等待发送节流窗口" });
          this.emitStatus();

          const now = Date.now();
          const waitMs = this.config.sendIntervalMs - (now - this.lastSendAt);
          if (waitMs > 0) await sleep(waitMs);

          await this.sendDanmaku(text);
          this.rememberOutgoing(text);
          this.lastSendAt = Date.now();
          this.sentCount += 1;
          this.lastError = null;
          this.queue.shift();
          this.updateDecisionAction(decisionId, "sent", "已发送到直播间");
          this.emitStatus();
        } catch (err) {
          item.attempts += 1;
          this.failedCount += 1;
          this.lastError = err instanceof Error ? err.message : String(err);
          this.pushDecision({
            id: `err-${item.seq}-${Date.now()}`,
            timestamp: Date.now(),
            input: this.formatForModel(item.danmaku),
            output: "",
            action: "error",
            reason: this.lastError,
          });
          this.emitStatus();
          const backoff = Math.min(5000, 800 * item.attempts);
          await sleep(backoff);
        }
      }
    } finally {
      this.processing = false;
      this.emitStatus();
    }
  }

  /** 统一的 Ollama 供应商判断 */
  private isOllamaProvider(provider: string): boolean {
    return provider === "ollama";
  }

  /**
   * 连接握手验证。
   * Ollama: GET /api/tags 检查服务可用性 + 模型存在性。
   * OpenCode/OpenAI: 发送轻量 completion 测试。
   */
  private async verifyConnection(config: AIRelayConfig): Promise<void> {
    if (this.isOllamaProvider(config.provider)) {
      const baseUrl = (config.ollamaBaseUrl || config.endpoint)
        .replace(/\/v1\/chat\/completions.*$/, "")
        .replace(/\/+$/, "");
      const data = await this.getJson(`${baseUrl}/api/tags`, 10_000);
      const models: string[] = Array.isArray(data?.models)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? data.models.map((m: any) => m.name || m.model || "")
        : [];
      const modelExists = models.some((m) => m === config.modelId || m.startsWith(`${config.modelId}:`));
      if (!modelExists) {
        throw new Error(`Ollama 未找到模型 "${config.modelId}"，可用: ${models.join(", ") || "无"}`);
      }
    } else {
      const rawResponse = await this.askModelRaw(config, "连接握手测试：请仅回复「已就绪」。");
      const replyText = extractReplyText(rawResponse, config.provider);
      if (!replyText) {
        throw new Error(`握手失败：模型未返回有效回复`);
      }
    }
  }

  /** 返回原始 AI 响应数据（供三层管道处理） */
  private async askModelRaw(config: AIRelayConfig, userInput: string): Promise<AIResponseData> {
    const endpoint = config.endpoint.trim();
    if (endpoint.includes("/messages")) {
      return this.askAnthropicRaw(endpoint, config, userInput);
    }
    return this.askOpenAICompatibleRaw(endpoint, config, userInput);
  }

  /**
   * OpenAI 兼容接口请求。
   * 自动识别 Responses API (/responses) 和 Chat Completions API。
   * Ollama 通过 body.keep_alive 和 header X-Ollama-Keep-Alive 控制模型保活。
   */
  private async askOpenAICompatibleRaw(endpoint: string, config: AIRelayConfig, userInput: string): Promise<AIResponseData> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    };

    const isOllama = this.isOllamaProvider(config.provider);
    const maxTokens = Number(config.maxTokens) || (isOllama ? 2048 : 256);
    const temperature = Number(config.temperature) || 0.7;
    const topP = config.topP != null ? Number(config.topP) : undefined;

    if (isOllama && config.ollamaKeepAlive) {
      headers["X-Ollama-Keep-Alive"] = config.ollamaKeepAlive;
    }

    const isResponses = endpoint.includes("/responses");
    const body = isResponses
      ? {
          model: config.modelId,
          input: [
            { role: "system", content: [{ type: "input_text", text: config.prompt }] },
            { role: "user", content: [{ type: "input_text", text: userInput }] },
          ],
          max_output_tokens: maxTokens,
        }
      : {
          model: config.modelId,
          messages: [
            { role: "system", content: config.prompt },
            { role: "user", content: userInput },
          ],
          max_tokens: maxTokens,
          temperature,
          ...(topP != null ? { top_p: topP } : {}),
          ...(isOllama && config.ollamaKeepAlive ? { keep_alive: config.ollamaKeepAlive } : {}),
        };

    const defaultTimeout = isOllama ? 120_000 : 30_000;
    const timeoutMs = Number(config.requestTimeoutMs) || defaultTimeout;
    return this.postJson(endpoint, headers, body, timeoutMs);
  }

  /** Anthropic Messages API 请求 */
  private async askAnthropicRaw(endpoint: string, config: AIRelayConfig, userInput: string): Promise<AIResponseData> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
    };
    const body = {
      model: config.modelId,
      system: config.prompt,
      max_tokens: Number(config.maxTokens) || 256,
      messages: [{ role: "user", content: userInput }],
    };
    return this.postJson(endpoint, headers, body);
  }

  /** POST JSON 请求，使用 AbortController 实现可配置超时 */
  private async postJson(endpoint: string, headers: Record<string, string>, body: Record<string, unknown>, timeoutMs = 30_000): Promise<AIResponseData> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!resp.ok) {
        const errorText = await resp.text();
        throw new Error(`AI 请求失败(${resp.status}): ${errorText}`);
      }
      const rawText = await resp.text();
      try {
        return JSON.parse(rawText);
      } catch {
        throw new Error(`AI 响应非 JSON: ${rawText}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /** 轻量 GET 请求，用于 Ollama 握手（检查服务可用性和模型存在性） */
  private async getJson(url: string, timeoutMs = 10_000): Promise<AIResponseData> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, { signal: controller.signal });
      if (!resp.ok) {
        throw new Error(`Ollama 服务返回 ${resp.status}，请确认服务已启动`);
      }
      return await resp.json();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new Error(`连接 Ollama 超时(${timeoutMs / 1000}s)，请确认服务已启动: ${url}`);
      }
      if (err instanceof TypeError && err.message.includes("fetch")) {
        throw new Error(`无法连接 Ollama 服务，请确认已启动且地址正确: ${url}`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
