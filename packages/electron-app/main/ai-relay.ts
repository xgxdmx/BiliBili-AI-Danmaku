import { EventEmitter } from "events";

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

/**
 * 解析 /pattern/flags 语法为 RegExp，否则返回 null。
 * 支持：/无需回复/i、/^\s*跳过\s*$/、/no.?reply/i
 */
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
    // 文本匹配时先去掉所有空白字符，防止"无 需 回 复"等拆字绕过
    const literal = trimmed.replace(/\s+/g, "").toLowerCase();
    // 如果正则编译失败（无效语法），仍作为纯文本使用
    rules.push({ literal, regex: regex ?? null, raw: trimmed });
  }
  return rules;
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
    if (parts.length > 0) return parts.join(" ").trim();
    return null;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const directCandidates = [obj.text, obj.output_text, obj.content, obj.value];
    for (const candidate of directCandidates) {
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

/** AI 响应的宽松类型，兼容 OpenAI / Anthropic / 其他 provider */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI provider 响应格式不确定，需深度访问
type AIResponseData = any;

function extractSkipFromReasoning(data: AIResponseData): string | null {
  const candidates: string[] = [];

  const reasoning = normalizeAnyText(data?.choices?.[0]?.message?.reasoning);
  if (reasoning) candidates.push(reasoning);

  const reasoningDetails = Array.isArray(data?.choices?.[0]?.message?.reasoning_details)
    ? data.choices[0].message.reasoning_details
    : [];
  for (const item of reasoningDetails) {
    const text = normalizeAnyText(item?.text);
    if (text) candidates.push(text);
  }

  const joined = candidates.join("\n");
  if (!joined) return null;

  // 使用编译后的默认规则进行匹配（reasoning 阶段尚未连接，fallback 到 DEFAULT_SKIP_REPLIES）
  const rules = compileSkipRules(DEFAULT_SKIP_REPLIES);
  const collapsed = joined.replace(/\s+/g, "").toLowerCase();
  for (const rule of rules) {
    if (rule.regex) {
      try {
        if (rule.regex.test(joined) || rule.regex.test(collapsed)) {
          return "NO_REPLY";
        }
      } catch {
        // skip
      }
      continue;
    }
    if (collapsed === rule.literal || collapsed.startsWith(`${rule.literal}:`) || collapsed.startsWith(`${rule.literal}：`) || collapsed.startsWith(`[${rule.literal}]`) || collapsed.startsWith(`【${rule.literal}】`)) {
      return "NO_REPLY";
    }
  }

  return null;
}

function extractOpenAIText(data: AIResponseData): string | null {
  const choiceText = normalizeAnyText(data?.choices?.[0]?.message?.content);
  if (choiceText) return choiceText;

  const choiceTextFallback = normalizeAnyText(data?.choices?.[0]?.text);
  if (choiceTextFallback) return choiceTextFallback;

  const outputText = normalizeAnyText(data?.output_text);
  if (outputText) return outputText;

  const responseOutputText = normalizeAnyText(data?.response?.output_text);
  if (responseOutputText) return responseOutputText;

  const output = Array.isArray(data?.output) ? data.output : [];
  for (const item of output) {
    const text = normalizeAnyText(item?.content) || normalizeAnyText(item?.text) || normalizeAnyText(item?.output_text);
    if (text) return text;
  }

  const flatContent = normalizeAnyText(data?.content);
  if (flatContent) return flatContent;

  const skipMarker = extractSkipFromReasoning(data);
  if (skipMarker) return skipMarker;

  const finishReason = String(data?.choices?.[0]?.finish_reason || "").toLowerCase();
  const hasReasoning = Boolean(
    normalizeAnyText(data?.choices?.[0]?.message?.reasoning) ||
    normalizeAnyText(data?.choices?.[0]?.message?.reasoning_details)
  );
  const messageContent = normalizeAnyText(data?.choices?.[0]?.message?.content);
  if (!messageContent && finishReason === "length" && hasReasoning) {
    // 保底策略：模型把 token 消耗在 reasoning 且 content 为空时，默认跳过发送，避免队列反复报错阻塞
    return "NO_REPLY";
  }

  return null;
}

function extractAnthropicText(data: AIResponseData): string | null {
  const contentText = normalizeAnyText(data?.content);
  if (contentText) return contentText;

  const alt = normalizeAnyText(data?.output_text) || normalizeAnyText(data?.completion);
  if (alt) return alt;

  return null;
}

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
  private readonly echoGuards: Array<{ text: string; expiresAt: number; remaining: number }> = [];
  private readonly recentDecisions: AIReplyDecision[] = [];

  constructor(private readonly sendDanmaku: (msg: string) => Promise<unknown>) {
    super();
  }

  async connect(config: AIRelayConfig): Promise<void> {
    // 防止 NaN：先解析，NaN 时 fallback 到默认值
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

    // 编译跳过规则（纯文本 + 正则）
    this.compiledSkipRules = compileSkipRules(normalized.skipReplies);

    if (!normalized.provider || !normalized.modelId || !normalized.endpoint) {
      throw new Error("请先完整保存模型供应商配置");
    }
    if (!normalized.apiKey) {
      throw new Error("请先填写 API Key 并保存");
    }
    if (!normalized.prompt) {
      throw new Error("请先填写提示词");
    }

    // 重置会话状态，确保新连接不会延续旧上下文
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

  disconnect(): void {
    this.connected = false;
    this.connectedAt = null;
    this.processing = false;
    this.queue = [];
    this.echoGuards.length = 0;
    this.lastSendAt = 0;
    this.emitStatus();
  }

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

  clearDecisionHistory(): { cleared: number } {
    const cleared = this.recentDecisions.length;
    if (cleared > 0) {
      this.recentDecisions.length = 0;
      this.emitStatus();
    }
    return { cleared };
  }

  enqueue(danmaku: RelayDanmaku): void {
    if (!this.connected || !this.config) return;
    const item: QueueItem = {
      seq: ++this.seq,
      danmaku,
      attempts: 0,
    };
    this.queue.push(item);
    if (this.queue.length > this.config.maxPending) {
      this.lastError = `排队数 ${this.queue.length} 超过设定上限 ${this.config.maxPending}，已继续排队以避免丢弹幕`;
    }
    this.emitStatus();
    void this.processQueue();
  }

  shouldIgnoreIncoming(danmaku: RelayDanmaku): boolean {
    const now = Date.now();
    const content = this.normalizeText(danmaku.content);
    if (!content) return false;

    this.pruneEchoGuards(now);
    for (const guard of this.echoGuards) {
      if (guard.text === content && guard.remaining > 0) {
        guard.remaining -= 1;
        return true;
      }
    }
    return false;
  }

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
    const guardPrefix = guard ? `${guard} | ` : "";
    return `${guardPrefix}粉丝牌:${medal} | 用户名:${username} | 弹幕:${danmaku.content}`;
  }

  private normalizeText(text: string): string {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  private shouldSkipReply(reply: string): { skip: boolean; reason: string } {
    const normalized = this.normalizeText(reply);
    if (!normalized) {
      return { skip: true, reason: "模型返回空内容" };
    }

    // 去掉所有空白字符再做匹配，防止"无 需 回 复"等拆字绕过
    const collapsed = normalized.replace(/\s+/g, "").toLowerCase();

    for (const rule of this.compiledSkipRules) {
      // 1) 正则规则：优先用正则匹配
      if (rule.regex) {
        try {
          if (rule.regex.test(normalized) || rule.regex.test(collapsed)) {
            return { skip: true, reason: `命中跳过正则: ${rule.raw}` };
          }
        } catch {
          // 正则执行异常时跳过此规则
        }
        continue;
      }

      // 2) 纯文本规则：对去空白后的文本做匹配
      //    精确匹配
      if (collapsed === rule.literal) {
        return { skip: true, reason: `命中跳过标记: ${rule.raw}` };
      }
      //    前缀匹配（支持 "NO_REPLY: ..." / "NO_REPLY：..." / "[NO_REPLY]" / "【NO_REPLY】"）
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
    if (this.recentDecisions.length > 50) {
      this.recentDecisions.length = 50;
    }
  }

  private updateDecisionAction(id: string, action: AIReplyDecision["action"], reason?: string): void {
    const item = this.recentDecisions.find((x) => x.id === id);
    if (!item) return;
    item.action = action;
    if (reason) item.reason = reason;
  }

  private rememberOutgoing(text: string): void {
    const normalized = this.normalizeText(text);
    if (!normalized) return;
    const now = Date.now();
    this.pruneEchoGuards(now);
    this.echoGuards.push({
      text: normalized,
      expiresAt: now + 90_000,
      remaining: 1,
    });
  }

  private pruneEchoGuards(now = Date.now()): void {
    for (let i = this.echoGuards.length - 1; i >= 0; i -= 1) {
      const guard = this.echoGuards[i];
      if (guard.expiresAt <= now || guard.remaining <= 0) {
        this.echoGuards.splice(i, 1);
      }
    }
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    this.emitStatus();
    try {
      while (this.connected && this.config && this.queue.length > 0) {
        const item = this.queue[0];
        try {
          const modelInput = this.formatForModel(item.danmaku);
          const reply = await this.askModel(this.config, modelInput);
          const text = clampText(reply, 40);
          const decisionId = `d-${item.seq}-${Date.now()}`;
          const skip = this.shouldSkipReply(text);

          if (skip.skip) {
            this.skippedCount += 1;
            this.queue.shift();
            this.lastError = null;
            this.pushDecision({
              id: decisionId,
              timestamp: Date.now(),
              input: modelInput,
              output: text,
              action: "skipped",
              reason: skip.reason,
            });
            this.emitStatus();
            continue;
          }

          this.pushDecision({
            id: decisionId,
            timestamp: Date.now(),
            input: modelInput,
            output: text,
            action: "pending_send",
            reason: "等待发送节流窗口",
          });
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

  private async verifyConnection(config: AIRelayConfig): Promise<void> {
    await this.askModel(config, "连接握手测试：请仅回复“已就绪”。");
  }

  private async askModel(config: AIRelayConfig, userInput: string): Promise<string> {
    const endpoint = config.endpoint.trim();
    if (endpoint.includes("/messages")) {
      return this.askAnthropic(endpoint, config, userInput);
    }
    return this.askOpenAICompatible(endpoint, config, userInput);
  }

  private async askOpenAICompatible(endpoint: string, config: AIRelayConfig, userInput: string): Promise<string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    };

    const isResponses = endpoint.includes("/responses");
    const body = isResponses
      ? {
          model: config.modelId,
          input: [
            {
              role: "system",
              content: [{ type: "input_text", text: config.prompt }],
            },
            {
              role: "user",
              content: [{ type: "input_text", text: userInput }],
            },
          ],
          // 适度提高上限，减少只输出 reasoning 而无 content 的截断概率
          max_output_tokens: 256,
        }
      : {
          model: config.modelId,
          messages: [
            { role: "system", content: config.prompt },
            { role: "user", content: userInput },
          ],
          // 适度提高上限，减少只输出 reasoning 而无 content 的截断概率
          max_tokens: 256,
          temperature: 0.7,
        };

    const data = await this.postJson(endpoint, headers, body);
    const text = extractOpenAIText(data);
    if (!text) {
      throw new Error(`未能解析模型回复，响应预览: ${responsePreview(data)}`);
    }
    return text;
  }

  private async askAnthropic(endpoint: string, config: AIRelayConfig, userInput: string): Promise<string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
    };

    const body = {
      model: config.modelId,
      system: config.prompt,
      max_tokens: 256,
      messages: [{ role: "user", content: userInput }],
    };

    const data = await this.postJson(endpoint, headers, body);
    const text = extractAnthropicText(data);
    if (!text) {
      throw new Error(`未能解析模型回复，响应预览: ${responsePreview(data)}`);
    }
    return text;
  }

  private async postJson(endpoint: string, headers: Record<string, string>, body: Record<string, unknown>): Promise<AIResponseData> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
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
}
