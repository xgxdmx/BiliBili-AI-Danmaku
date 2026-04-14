// ============================================================
// Config Store - 加密配置持久化
// ============================================================

import Store from "electron-store";
import { app } from "electron";
import { dirname, join } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, unlinkSync } from "fs";
import { networkInterfaces, hostname, platform, arch } from "os";
import { createHash, createDecipheriv } from "crypto";

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

export interface ConfigSchema {
  room: RoomConfig;
  credentials: Credentials;
  keywords: KeywordRule[];
  quickReplies: QuickReplyRule[];
  aiModel: AIModelConfig;
}

const schema: ConfigSchema = {
  room: {
    roomId: 0,
    enabled: true,
    minMedalLevel: 0,
    sendOnDisconnect: true,
    disconnectMessage: "先下播啦，感谢大家陪伴，我们下次见～",
  },
  credentials: {
    sessdata: "",
    biliJct: "",
    buvid3: "",
  },
  keywords: [],
  quickReplies: [],
  aiModel: {
    provider: "opencode",
    apiKey: "",
    modelId: "minimax-m2.5-free",
    endpoint: "https://opencode.ai/zen/v1/chat/completions",
    prompt: "你现在是一个直播间助理，你会收到粉丝牌+用户名+弹幕内容，请逐条回复，单条回复不超过40字。",
    sendIntervalMs: 1800,
    maxPending: 100,
    ignoreUsernames: [],
    skipReplies: ["NO_REPLY", "无需回复", "不需要回复", "不用回复", "不回复", "忽略", "skip", "pass"],
  },
};

// 获取配置目录
function getConfigDir(): string {
  if (app.isPackaged) {
    // 打包模式：使用 exe 同目录
    return dirname(app.getPath("exe"));
  }
  // 开发模式：使用项目根目录
  return join(app.getAppPath(), "../../");
}

const configDir = getConfigDir();
const LEGACY_ENCRYPTION_KEY = "danmuClaw-v1";
const ENCRYPTION_KEY_VERSION = "v2";

// 确保目录存在
if (!existsSync(configDir)) {
  mkdirSync(configDir, { recursive: true });
}

// 开发/打包模式配置目录已就绪

function deriveEncryptionKey(): string {
  const machineId = getMachineId();
  const appName = app.getName() || "danmuClaw";
  const appId = app.isPackaged ? "com.danmuclaw.app" : "com.danmuclaw.app.dev";
  const pepper = "danmuClaw::config::pepper::2026";
  const seed = `${ENCRYPTION_KEY_VERSION}|${appName}|${appId}|${machineId}|${pepper}`;
  return createHash("sha512").update(seed).digest("hex");
}

function createConfigStore(encryptionKey: string, clearInvalidConfig: boolean): Store<ConfigSchema> {
  return new Store<ConfigSchema>({
    name: "config",
    cwd: configDir,
    encryptionKey,
    defaults: schema,
    clearInvalidConfig,
  });
}

function initializeStore(): Store<ConfigSchema> {
  const strongKey = deriveEncryptionKey();

  try {
    const storeWithStrongKey = createConfigStore(strongKey, false);
    void storeWithStrongKey.store;
    return storeWithStrongKey;
  } catch (strongErr) {
    // 强密钥打开失败，尝试迁移旧密钥
    void strongErr;
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- electron-store snapshot 是无类型对象
    const snap = snapshot as any;
    migratedStore.set("room", snap.room || schema.room);
    migratedStore.set("credentials", snap.credentials || schema.credentials);
    migratedStore.set("keywords", snap.keywords || schema.keywords);
    migratedStore.set("quickReplies", snap.quickReplies || schema.quickReplies);
    migratedStore.set("aiModel", snap.aiModel || schema.aiModel);

    return migratedStore;
  } catch (legacyErr) {
    void legacyErr;
    return createConfigStore(strongKey, true);
  }
}

const store = initializeStore();

export function getConfig(): ConfigSchema {
  return {
    room: store.get("room", schema.room),
    credentials: store.get("credentials", schema.credentials),
    keywords: store.get("keywords", schema.keywords),
    quickReplies: store.get("quickReplies", schema.quickReplies),
    aiModel: store.get("aiModel", schema.aiModel),
  };
}

export function setConfig<K extends keyof ConfigSchema>(
  key: K,
  value: ConfigSchema[K]
): void {
  store.set(key, value);
}

export function setConfigPath(path: string, value: unknown): void {
  // electron-store 支持点号路径字符串
  (store as unknown as { set: (p: string, v: unknown) => void }).set(path, value);
}

interface EncryptedExportPayload {
  iv: string;
  tag: string;
  ciphertext: string;
}

function deriveExportKey(): Buffer {
  return createHash("sha256").update(`${deriveEncryptionKey()}|export|v1`).digest();
}

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

// 导出配置文件到明文 JSON 文件
export function exportConfigToFile(targetPath?: string): { status: string; path?: string; error?: string } {
  try {
    const config = store.store;
    const exportPayload = {
      __meta: {
        machineId: getMachineId(),
        exportedAt: new Date().toISOString(),
        appName: "danmuClaw",
        format: "plain-v1",
      },
      ...config,
    };
    const configDir = store.path ? dirname(store.path) : process.cwd();
    const exportPath = targetPath || join(configDir, 'config-export.json');
    writeFileSync(exportPath, JSON.stringify(exportPayload, null, 2), 'utf-8');
    return { status: "ok", path: exportPath };
  } catch (e) {
    return { status: "error", error: String(e) };
  }
}

// 导入配置文件从明文 JSON 文件
export function importConfigFromFile(filePath: string): { status: string; error?: string } {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return importConfigFromContent(content);
  } catch (e) {
    return { status: "error", error: String(e) };
  }
}

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
    if (config.keywords) store.set("keywords", config.keywords);
    if (config.quickReplies) store.set("quickReplies", config.quickReplies);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- aiModel may not exist on older configs
    if ((config as any).aiModel) store.set("aiModel", (config as any).aiModel);
    
    return { status: "ok" };
  } catch (e) {
    return { status: "error", error: String(e) };
  }
}

export default store;
