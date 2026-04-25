// ============================================================
// Config Store - 加密配置持久化
//
// 使用 electron-store 管理全部应用配置，支持：
//   - AES-256-GCM 加密存储（密钥由机器指纹 + 应用信息派生）
//   - 旧版弱密钥自动迁移（v1 → v2）
//   - 明文 JSON 导出/导入（分组格式，方便手动编辑）
//   - 加密导出格式（encrypted-v1，用于安全传输）
// ============================================================

import Store from "electron-store";
import { app } from "electron";
import { dirname, join } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, unlinkSync } from "fs";
import { networkInterfaces, hostname, platform, arch } from "os";
import { createHash, createDecipheriv } from "crypto";

// ─── 类型定义 ──────────────────────────────────────────────

/** B站登录凭证（SESSDATA / bili_jct / buvid3 三件套） */
export interface Credentials {
  sessdata: string;
  biliJct: string;
  buvid3: string;
}

/** 关键词匹配规则，支持纯文本子串 / 正则两种模式 */
export interface KeywordRule {
  id: string;
  pattern: string;
  type: "keyword" | "regex";
  enabled: boolean;
  caseSensitive: boolean;
  scope: "both" | "quickReply" | "ai";
}

/** 固定回复规则：命中条件后直接发送预设文本，无需等待 AI */
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

/** 直播间基础配置（房间号、最低粉丝牌等级、断开消息等） */
export interface RoomConfig {
  roomId: number;
  enabled: boolean;
  /** 弹幕捕捉总开关。关闭后弹幕仍正常显示，但不进入关键词匹配 / 固定回复 / AI 回复流程 */
  captureEnabled: boolean;
  minMedalLevel: number;
  sendOnDisconnect: boolean;
  disconnectMessage: string;
}

/**
 * 单个供应商的模型配置。
 * 每个供应商（opencode / ollama）独立维护自己的模型参数和凭证。
 */
export interface ProviderConfig {
  /** 当前选中的模型 ID */
  modelId: string;
  /** API Key（opencode 需要，ollama 不需要） */
  apiKey: string;
  /** API 端点 */
  endpoint: string;
  /** Ollama 服务地址（仅 ollama） */
  ollamaBaseUrl?: string;
  /** 最大输出 token 数 */
  maxTokens: number;
  /** 回复温度 (0~2) */
  temperature: number;
  /** 核采样概率累积截断 (0~1) */
  topP: number;
  /** Ollama 模型保活时间，如 "5m"（仅 ollama） */
  ollamaKeepAlive?: string;
  /** 单次请求超时(ms) */
  requestTimeoutMs: number;
}

/**
 * AI 大模型配置。
 * 共享字段（prompt/间隔/队列等）为全局配置，
 * 各供应商通过 providers 映射维护独立参数和凭证。
 */
export interface AIModelConfig {
  /** 当前激活的供应商（"opencode" / "ollama"） */
  provider: string;
  /** 系统提示词 */
  prompt: string;
  /** 发送间隔(ms)，防止风控 */
  sendIntervalMs: number;
  /** 待处理队列上限 */
  maxPending: number;
  /** 忽略的用户名列表 */
  ignoreUsernames: string[];
  /** 跳过回复的关键词 */
  skipReplies: string[];
  /** 各供应商独立配置映射 */
  providers: Record<string, ProviderConfig>;
}

/** 点击窗口右上角关闭按钮（X）时的行为 */
export type CloseWindowBehavior = "ask" | "tray" | "exit";

/** 应用配置总结构，对应 electron-store 存储的完整 schema */
export interface ConfigSchema {
  room: RoomConfig;
  credentials: Credentials;
  /** 固定回复全局开关：false 时固定回复引擎完全不触发 */
  quickReplyEnabled: boolean;
  keywords: KeywordRule[];
  /** 固定回复全局开关。关闭后规则保留但不会触发发送 */
  quickRepliesEnabled: boolean;
  quickReplies: QuickReplyRule[];
  aiModel: AIModelConfig;
  /** 主题模式：light / dark / system */
  theme: "light" | "dark" | "system";
  /** 点击主窗口关闭按钮（X）时的行为 */
  closeWindowBehavior: CloseWindowBehavior;
}

// ─── 默认值 & 常量 ──────────────────────────────────────────

/** 配置 schema 默认值，新安装或字段缺失时使用 */
const schema: ConfigSchema = {
  room: {
    roomId: 0,
    enabled: true,
    captureEnabled: true,
    minMedalLevel: 0,
    sendOnDisconnect: true,
    disconnectMessage: "先下播啦，感谢大家陪伴，我们下次见～",
  },
  credentials: {
    sessdata: "",
    biliJct: "",
    buvid3: "",
  },
  quickReplyEnabled: false,
  keywords: [],
  quickRepliesEnabled: false,
  quickReplies: [],
  aiModel: {
    provider: "opencode",
    prompt: "你现在是一个直播间助理，你会收到粉丝牌+用户名+弹幕内容，请逐条回复，单条回复不超过40字。",
    sendIntervalMs: 1800,
    maxPending: 100,
    ignoreUsernames: [],
    skipReplies: ["NO_REPLY", "无需回复", "不需要回复", "不用回复", "不回复", "忽略", "skip", "pass"],
    providers: {
      opencode: {
        modelId: "minimax-m2.5-free",
        apiKey: "",
        endpoint: "https://opencode.ai/zen/v1/chat/completions",
        maxTokens: 256,
        temperature: 0.7,
        topP: 1,
        requestTimeoutMs: 30000,
      },
      ollama: {
        modelId: "",
        apiKey: "",
        endpoint: "http://localhost:11434/v1/chat/completions",
        ollamaBaseUrl: "http://localhost:11434",
        maxTokens: 2048,
        temperature: 0.7,
        topP: 1,
        ollamaKeepAlive: "5m",
        requestTimeoutMs: 120000,
      },
    },
  },
  theme: "system",
  closeWindowBehavior: "ask",
};

// ─── 加密密钥派生 ──────────────────────────────────────────

/** 旧版本曾使用的独立配置目录名（与 Electron userData 分离） */
const LEGACY_ROAMING_CONFIG_DIR_NAME = "BiliBiliDanmuClaw";

/**
 * 获取配置文件目录：
 * - 打包模式：统一使用 Electron userData 目录（与缓存在同一目录）
 * - 开发模式：项目根目录
 */
function getConfigDir(): string {
  if (app.isPackaged) {
    // 关键：配置与缓存共用同一目录，避免额外新建独立配置目录
    return app.getPath("userData");
  }
  // 开发模式：使用项目根目录
  return join(app.getAppPath(), "../../");
}

const configDir = getConfigDir();
/** 旧版加密密钥（v1，简单字符串），仅用于迁移 */
const LEGACY_ENCRYPTION_KEY = "danmuClaw-v1";
/** 当前密钥版本标识，参与密钥派生 seed */
const ENCRYPTION_KEY_VERSION = "v2";
/**
 * 密钥派生使用的稳定应用名（禁止跟随 UI 品牌名变化）。
 * 否则仅改显示名称就会导致历史配置无法解密。
 */
const STABLE_KEY_APP_NAME = "bilibili-danmu-claw";

// 确保目录存在
if (!existsSync(configDir)) {
  mkdirSync(configDir, { recursive: true });
}

/**
 * 迁移历史配置到当前 userData 目录。
 * 迁移来源：
 *   1) 旧版独立 Roaming 配置目录（BiliBiliDanmuClaw）
 *   2) 更老版本 exe 同目录
 * 仅在目标文件不存在时复制，避免覆盖用户现有配置。
 */
function migratePackagedConfigToUserDataIfNeeded(): void {
  if (!app.isPackaged) return;

  const userDataDir = configDir;
  const legacyRoamingDir = join(app.getPath("appData"), LEGACY_ROAMING_CONFIG_DIR_NAME);
  const legacyExeDir = dirname(app.getPath("exe"));

  const migrationFiles = ["config.json", "config.json.legacy.bak", "config-export.json"];

  const copyIfMissing = (fromDir: string): void => {
    if (!fromDir || fromDir === userDataDir) return;
    try {
      for (const name of migrationFiles) {
        const fromPath = join(fromDir, name);
        const toPath = join(userDataDir, name);
        if (existsSync(fromPath) && !existsSync(toPath)) {
          copyFileSync(fromPath, toPath);
        }
      }
    } catch {
      // 迁移失败不阻塞启动
    }
  };

  // 优先迁移“旧独立配置目录”，其次迁移“exe 同目录”
  copyIfMissing(legacyRoamingDir);
  copyIfMissing(legacyExeDir);
}

migratePackagedConfigToUserDataIfNeeded();

// 开发/打包模式配置目录已就绪

/**
 * 基于机器指纹派生 512-bit 加密密钥。
 * 种子 = 版本号 + 应用名 + appId + machineId + pepper，经 SHA-512 摘要。
 * 不同机器产生的密钥不同，配置文件不可跨机使用。
 */
function deriveEncryptionKeyWithAppName(appName: string): string {
  const machineId = getMachineId();
  const appId = app.isPackaged ? "com.danmuclaw.app" : "com.danmuclaw.app.dev";
  const pepper = "danmuClaw::config::pepper::2026";
  const seed = `${ENCRYPTION_KEY_VERSION}|${appName}|${appId}|${machineId}|${pepper}`;
  return createHash("sha512").update(seed).digest("hex");
}

function deriveEncryptionKey(): string {
  return deriveEncryptionKeyWithAppName(STABLE_KEY_APP_NAME);
}

/** 创建 electron-store 实例，指定加密密钥和是否清除损坏配置 */
function createConfigStore(encryptionKey: string, clearInvalidConfig: boolean): Store<ConfigSchema> {
  return new Store<ConfigSchema>({
    name: "config",
    cwd: configDir,
    encryptionKey,
    defaults: schema,
    clearInvalidConfig,
  });
}

/**
 * 将旧 store 快照写回到新 store（按当前 schema 做兜底）
 */
function hydrateFromSnapshot(target: Store<ConfigSchema>, snapshot: unknown): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- electron-store snapshot 为运行时动态对象
  const snap = snapshot as any;
  target.set("room", snap.room || schema.room);
  target.set("credentials", snap.credentials || schema.credentials);
  target.set("quickReplyEnabled", snap.quickReplyEnabled ?? snap.quickRepliesEnabled ?? schema.quickReplyEnabled);
  target.set("keywords", snap.keywords || schema.keywords);
  target.set("quickRepliesEnabled", snap.quickRepliesEnabled ?? schema.quickRepliesEnabled);
  target.set("quickReplies", snap.quickReplies || schema.quickReplies);
  target.set("aiModel", snap.aiModel || schema.aiModel);
}

/**
 * 尝试将“可读取的旧 strongKey”迁移到当前稳定 strongKey。
 */
function tryMigrateStrongKey(fromKey: string, toKey: string): Store<ConfigSchema> | null {
  try {
    const sourceStore = createConfigStore(fromKey, false);
    const snapshot = sourceStore.store;
    const sourcePath = sourceStore.path;

    try {
      if (existsSync(sourcePath)) {
        copyFileSync(sourcePath, `${sourcePath}.legacy.bak`);
        unlinkSync(sourcePath);
      }
    } catch {
      // 备份失败不阻塞迁移
    }

    const migratedStore = createConfigStore(toKey, true);
    hydrateFromSnapshot(migratedStore, snapshot);
    return migratedStore;
  } catch {
    return null;
  }
}

/**
 * 初始化配置存储，处理密钥迁移：
 * 1. 先尝试当前强密钥（v2）打开
 * 2. 失败则用旧密钥（v1）读取 → 备份 → 用强密钥重写
 * 3. 都失败则创建空白配置
 */
function initializeStore(): Store<ConfigSchema> {
  const strongKey = deriveEncryptionKey();

  try {
    const storeWithStrongKey = createConfigStore(strongKey, false);
    void storeWithStrongKey.store;
    return storeWithStrongKey;
  } catch {
    // 当前稳定 strongKey 打开失败，继续尝试兼容迁移
  }

  // 兼容“历史使用 app.getName() 参与派生”的 strongKey（例如仅改品牌名导致 app.getName 变化）
  const runtimeAppName = String(app.getName() || "").trim();
  if (runtimeAppName && runtimeAppName !== STABLE_KEY_APP_NAME) {
    const oldStrongKey = deriveEncryptionKeyWithAppName(runtimeAppName);
    const migratedFromOldStrong = tryMigrateStrongKey(oldStrongKey, strongKey);
    if (migratedFromOldStrong) {
      return migratedFromOldStrong;
    }
  }

  try {
    const legacyStore = createConfigStore(LEGACY_ENCRYPTION_KEY, false);
    const snapshot = legacyStore.store;
    const legacyPath = legacyStore.path;

    try {
      if (existsSync(legacyPath)) {
        copyFileSync(legacyPath, `${legacyPath}.legacy.bak`);
        unlinkSync(legacyPath);
      }
    } catch {
      // 备份失败时继续迁移
    }

    const migratedStore = createConfigStore(strongKey, true);
    hydrateFromSnapshot(migratedStore, snapshot);

    return migratedStore;
  } catch {
    return createConfigStore(strongKey, true);
  }
}

const store = initializeStore();

// ─── 公共读写 API ──────────────────────────────────────────

/** 读取完整配置（各字段缺失时回退到 schema 默认值，自动迁移旧版 aiModel 结构） */
export function getConfig(): ConfigSchema {
  const raw = {
    room: store.get("room", schema.room),
    credentials: store.get("credentials", schema.credentials),
    quickReplyEnabled: store.get("quickReplyEnabled", schema.quickReplyEnabled),
    keywords: store.get("keywords", schema.keywords),
    quickRepliesEnabled: store.get("quickRepliesEnabled", schema.quickRepliesEnabled),
    quickReplies: store.get("quickReplies", schema.quickReplies),
    aiModel: store.get("aiModel", schema.aiModel),
    theme: store.get("theme", schema.theme),
    closeWindowBehavior: store.get("closeWindowBehavior", schema.closeWindowBehavior),
  };

  // 迁移旧版 aiModel（扁平结构 → per-provider 结构）
  raw.aiModel = migrateAIModel(raw.aiModel);

  return raw;
}

/**
 * 将旧版扁平 aiModel 配置迁移为 per-provider 结构。
 * 检测标志：存在顶层 apiKey 字段且不存在 providers 字段。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function migrateAIModel(ai: any): AIModelConfig {
  if (!ai) return schema.aiModel;
  // 已经是新格式
  if (ai.providers && typeof ai.providers === "object") {
    return ai as AIModelConfig;
  }

  // 旧格式迁移：将扁平字段拆入 providers
  const oldProvider = ai.provider || "opencode";
  const migrated: AIModelConfig = {
    provider: oldProvider,
    prompt: ai.prompt || schema.aiModel.prompt,
    sendIntervalMs: Number(ai.sendIntervalMs || schema.aiModel.sendIntervalMs),
    maxPending: Number(ai.maxPending || schema.aiModel.maxPending),
    ignoreUsernames: ai.ignoreUsernames || [],
    skipReplies: ai.skipReplies || schema.aiModel.skipReplies,
    providers: {
      opencode: {
        modelId: oldProvider === "opencode" ? (ai.modelId || "minimax-m2.5-free") : "minimax-m2.5-free",
        apiKey: (ai.apiKeys && ai.apiKeys.opencode) || ai.apiKey || "",
        endpoint: oldProvider === "opencode" ? (ai.endpoint || "https://opencode.ai/zen/v1/chat/completions") : "https://opencode.ai/zen/v1/chat/completions",
        maxTokens: Number(oldProvider === "opencode" ? (ai.maxTokens || 256) : 256),
        temperature: Number(ai.temperature ?? 0.7),
        topP: Number(ai.topP ?? 1),
        requestTimeoutMs: Number(oldProvider === "opencode" ? (ai.requestTimeoutMs || 30000) : 30000),
      },
      ollama: {
        modelId: oldProvider === "ollama" ? (ai.modelId || "") : "",
        apiKey: "",
        endpoint: `${(ai.ollamaBaseUrl || "http://localhost:11434").replace(/\/+$/, "")}/v1/chat/completions`,
        ollamaBaseUrl: ai.ollamaBaseUrl || "http://localhost:11434",
        maxTokens: Number(oldProvider === "ollama" ? (ai.maxTokens || 2048) : 2048),
        temperature: Number(ai.temperature ?? 0.7),
        topP: Number(ai.topP ?? 1),
        ollamaKeepAlive: ai.ollamaKeepAlive || "5m",
        requestTimeoutMs: Number(oldProvider === "ollama" ? (ai.requestTimeoutMs || 120000) : 120000),
      },
    },
  };

  // 写回 store 以便后续读取不再需要迁移
  try {
    store.set("aiModel", migrated);
  } catch {
    // 迁移写入失败时静默处理
  }

  return migrated;
}

/** 设置顶层配置键值（类型安全） */
export function setConfig<K extends keyof ConfigSchema>(
  key: K,
  value: ConfigSchema[K]
): void {
  store.set(key, value);
}

/**
 * 按点号路径设置配置值，如 "aiModel.prompt"、"room.roomId"。
 * electron-store 原生支持 dot-notation 路径。
 */
export function setConfigPath(path: string, value: unknown): void {
  (store as unknown as { set: (p: string, v: unknown) => void }).set(path, value);
}

// ─── 加密导出/导入 ─────────────────────────────────────────

/** 加密导出 payload 结构（AES-256-GCM 密文 + IV + AuthTag） */
interface EncryptedExportPayload {
  iv: string;
  tag: string;
  ciphertext: string;
}

/** 从主加密密钥派生导出专用密钥（SHA-256，与主密钥隔离） */
function deriveExportKey(): Buffer {
  return createHash("sha256").update(`${deriveEncryptionKey()}|export|v1`).digest();
}

/** 解密 AES-256-GCM 密文（用于 encrypted-v1 格式的配置导入） */
function decryptText(payload: EncryptedExportPayload): string {
  const key = deriveExportKey();
  const iv = Buffer.from(payload.iv, "base64");
  const tag = Buffer.from(payload.tag, "base64");
  const ciphertext = Buffer.from(payload.ciphertext, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString("utf8");
}

/**
 * 获取本机唯一标识：收集所有非内部网卡 MAC 地址，
 * 结合 hostname / platform / arch 经 SHA-256 摘要后截取前 24 字符。
 * 该 ID 参与加密密钥派生，确保配置文件不可跨机解密。
 */
function getMachineId(): string {
  const nics = networkInterfaces();
  const macs: string[] = [];
  for (const key of Object.keys(nics)) {
    const entries = nics[key] || [];
    for (const item of entries) {
      if (!item || item.internal) continue;
      const mac = String(item.mac || "").toLowerCase();
      if (!mac || mac === "00:00:00:00:00:00") continue;
      macs.push(mac);
    }
  }
  macs.sort();
  const seed = `${hostname()}|${platform()}|${arch()}|${macs.join("|")}`;
  return createHash("sha256").update(seed).digest("hex").slice(0, 24);
}

// ─── 文件导出/导入 ─────────────────────────────────────────

/**
 * 导出配置到明文 JSON 文件（plain-v2 分组格式）。
 * 包含 __meta 元信息（格式版本、导出时间、machineId），
 * 方便用户手动编辑和跨机器迁移。
 * @param targetPath 导出目标路径，不传则使用默认路径
 * @param options
 * @param options.includeSensitive 是否包含敏感信息（API Key、B站Cookie等），默认 false
 */
export function exportConfigToFile(
  targetPath?: string,
  options?: { includeSensitive?: boolean }
): { status: string; path?: string; error?: string } {
  try {
    const config = store.store;
    const ai = config.aiModel || {};
    const includeSensitive = options?.includeSensitive === true;

    // 脱敏处理：不包含敏感信息时清空凭证和密钥字段
    const exportedCredentials = includeSensitive
      ? config.credentials
      : { sessdata: "", biliJct: "", buvid3: "" };

    // 脱敏各供应商配置中的 apiKey
    const exportedProviders: Record<string, unknown> = {};
    if (ai.providers && typeof ai.providers === "object") {
      for (const [pid, pc] of Object.entries(ai.providers as Record<string, any>)) {
        exportedProviders[pid] = {
          ...pc,
          apiKey: includeSensitive ? (pc.apiKey || "") : "",
        };
      }
    }

    const exportPayload = {
      __meta: {
        format: "plain-v2",
        appName: "BiliBili AI弹幕姬",
        exportedAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().replace("Z", "+08:00"),
        machineId: getMachineId(),
      },
      room: config.room,
      credentials: exportedCredentials,
      quickReplyEnabled: config.quickReplyEnabled,
      keywords: config.keywords,
      quickRepliesEnabled: config.quickRepliesEnabled ?? schema.quickRepliesEnabled,
      quickReplies: config.quickReplies,
      aiModel: {
        provider: ai.provider,
        prompt: ai.prompt,
        sendIntervalMs: ai.sendIntervalMs,
        maxPending: ai.maxPending,
        ignoreUsernames: ai.ignoreUsernames,
        skipReplies: ai.skipReplies,
        providers: exportedProviders,
      },
      closeWindowBehavior: config.closeWindowBehavior || "ask",
    };
    const configDir = store.path ? dirname(store.path) : process.cwd();
    const exportPath = targetPath || join(configDir, 'config-export.json');
    writeFileSync(exportPath, JSON.stringify(exportPayload, null, 2), 'utf-8');
    return { status: "ok", path: exportPath };
  } catch (e) {
    return { status: "error", error: String(e) };
  }
}

/** 从文件路径导入配置（自动识别 plain-v2 和 encrypted-v1 格式） */
export function importConfigFromFile(filePath: string): { status: string; error?: string } {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return importConfigFromContent(content);
  } catch (e) {
    return { status: "error", error: String(e) };
  }
}

/**
 * 从 JSON 字符串导入配置。
 * 支持两种格式：
 *   - plain-v2：直接 JSON，按字段验证后写入 store
 *   - encrypted-v1：先 AES-256-GCM 解密，再按 plain 格式处理
 */
export function importConfigFromContent(content: string): { status: string; error?: string } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Imported config structure is dynamic
    const parsed: any = JSON.parse(content);
    const config: ConfigSchema = parsed?.__meta?.format === "encrypted-v1"
      ? JSON.parse(decryptText(parsed.payload as EncryptedExportPayload))
      : parsed;
    
    // 验证并保存每个字段
    if (config.room) store.set("room", config.room);
    if (config.credentials) store.set("credentials", config.credentials);
    if ((config as Partial<ConfigSchema>).quickReplyEnabled !== undefined) {
      store.set("quickReplyEnabled", (config as Partial<ConfigSchema>).quickReplyEnabled === true);
    }
    if (config.keywords) store.set("keywords", config.keywords);
    store.set("quickRepliesEnabled", config.quickRepliesEnabled ?? schema.quickRepliesEnabled);
    if (config.quickReplies) store.set("quickReplies", config.quickReplies);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- aiModel may not exist on older configs
    if ((config as any).aiModel) store.set("aiModel", (config as any).aiModel);
    if ((config as Partial<ConfigSchema>).closeWindowBehavior) {
      store.set("closeWindowBehavior", (config as Partial<ConfigSchema>).closeWindowBehavior as CloseWindowBehavior);
    }
    
    return { status: "ok" };
  } catch (e) {
    return { status: "error", error: String(e) };
  }
}

export default store;
