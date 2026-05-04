<script setup lang="ts">
import { reactive, ref, computed, onMounted, watch, onUnmounted } from "vue";

interface ProviderModel {
  id: string;
  name: string;
  endpoint: string;
}

interface ModelGroup {
  label: string;
  models: ProviderModel[];
}

interface ProviderOption {
  id: string;
  name: string;
  description: string;
  endpoint: string;
  docUrl: string;
  models: ProviderModel[];
  /** 模型分组（用于下拉框 optgroup），按顺序渲染 */
  modelGroups?: ModelGroup[];
}

interface ProviderConfig {
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

interface AIModelForm {
  provider: string;
  apiKey: string;
  modelId: string;
  endpoint: string;
  prompt: string;
  sendIntervalMs: number;
  maxPending: number;
  ignoreUsernames: string[];
  skipReplies: string[];
  maxTokens: number;
  temperature: number;
  topP: number;
  ollamaKeepAlive: string;
  requestTimeoutMs: number;
}

interface ReplyDecision {
  id: string;
  timestamp: number;
  input: string;
  output: string;
  action: "pending_send" | "sent" | "skipped" | "error" | "cleared";
  reason: string;
}

const providerOptions: ProviderOption[] = [
  {
    id: "opencode",
    name: "OpenCode",
    description: "提供 GPT、Claude、Gemini、MiniMax 等多家大模型的统一接入，免费额度友好，接口兼容 OpenAI SDK。",
    endpoint: "https://opencode.ai/zen/v1/responses",
    docUrl: "https://opencode.ai/zen/v1/models",
    models: [],
    modelGroups: [
      {
        label: "── 免费模型 (Zen 免费额度) ──",
        models: [
          { id: "minimax-m2.5-free", name: "MiniMax M2.5 Free", endpoint: "https://opencode.ai/zen/v1/chat/completions" },
          { id: "ling-2.6-flash-free", name: "Ling 2.6 Flash Free", endpoint: "https://opencode.ai/zen/v1/chat/completions" },
          { id: "trinity-large-preview-free", name: "Trinity Large Preview Free", endpoint: "https://opencode.ai/zen/v1/chat/completions" },
          { id: "big-pickle", name: "Big Pickle", endpoint: "https://opencode.ai/zen/v1/chat/completions" },
          { id: "hy3-preview-free", name: "Hy3 Preview Free", endpoint: "https://opencode.ai/zen/v1/chat/completions" },
          { id: "nemotron-3-super-free", name: "Nemotron 3 Super Free", endpoint: "https://opencode.ai/zen/v1/chat/completions" },
        ],
      },
      {
        label: "── Go 方案 ($5→$10/月 订阅) ──",
        models: [
          { id: "glm-5", name: "GLM-5", endpoint: "https://opencode.ai/zen/go/v1/chat/completions" },
          { id: "glm-5.1", name: "GLM-5.1", endpoint: "https://opencode.ai/zen/go/v1/chat/completions" },
          { id: "kimi-k2.5", name: "Kimi K2.5", endpoint: "https://opencode.ai/zen/go/v1/chat/completions" },
          { id: "kimi-k2.6", name: "Kimi K2.6", endpoint: "https://opencode.ai/zen/go/v1/chat/completions" },
          { id: "mimo-v2-pro", name: "MiMo-V2-Pro", endpoint: "https://opencode.ai/zen/go/v1/chat/completions" },
          { id: "mimo-v2-omni", name: "MiMo-V2-Omni", endpoint: "https://opencode.ai/zen/go/v1/chat/completions" },
          { id: "mimo-v2.5-pro", name: "MiMo-V2.5-Pro", endpoint: "https://opencode.ai/zen/go/v1/chat/completions" },
          { id: "mimo-v2.5", name: "MiMo-V2.5", endpoint: "https://opencode.ai/zen/go/v1/chat/completions" },
          { id: "minimax-m2.5", name: "MiniMax M2.5", endpoint: "https://opencode.ai/zen/go/v1/messages" },
          { id: "qwen3.6-plus", name: "Qwen 3.6 Plus", endpoint: "https://opencode.ai/zen/go/v1/chat/completions" },
          { id: "qwen3.5-plus", name: "Qwen 3.5 Plus", endpoint: "https://opencode.ai/zen/go/v1/chat/completions" },
          { id: "minimax-m2.7", name: "MiniMax M2.7", endpoint: "https://opencode.ai/zen/go/v1/messages" },
          { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", endpoint: "https://opencode.ai/zen/go/v1/messages" },
          { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", endpoint: "https://opencode.ai/zen/go/v1/messages" },
        ],
      },
      {
        label: "── Zen 方案 ($20 即用即付) ──",
        models: [
          { id: "gpt-5.5", name: "GPT 5.5", endpoint: "https://opencode.ai/zen/v1/responses" },
          { id: "gpt-5.5-pro", name: "GPT 5.5 Pro", endpoint: "https://opencode.ai/zen/v1/responses" },
          { id: "gpt-5.4", name: "GPT 5.4", endpoint: "https://opencode.ai/zen/v1/responses" },
          { id: "gpt-5.4-pro", name: "GPT 5.4 Pro", endpoint: "https://opencode.ai/zen/v1/responses" },
          { id: "gpt-5.4-mini", name: "GPT 5.4 Mini", endpoint: "https://opencode.ai/zen/v1/responses" },
          { id: "gpt-5.4-nano", name: "GPT 5.4 Nano", endpoint: "https://opencode.ai/zen/v1/responses" },
          { id: "gpt-5.3-codex", name: "GPT 5.3 Codex", endpoint: "https://opencode.ai/zen/v1/responses" },
          { id: "gpt-5.3-codex-spark", name: "GPT 5.3 Codex Spark", endpoint: "https://opencode.ai/zen/v1/responses" },
          { id: "gpt-5.2", name: "GPT 5.2", endpoint: "https://opencode.ai/zen/v1/responses" },
          { id: "gpt-5.2-codex", name: "GPT 5.2 Codex", endpoint: "https://opencode.ai/zen/v1/responses" },
          { id: "gpt-5.1", name: "GPT 5.1", endpoint: "https://opencode.ai/zen/v1/responses" },
          { id: "gpt-5.1-codex", name: "GPT 5.1 Codex", endpoint: "https://opencode.ai/zen/v1/responses" },
          { id: "gpt-5.1-codex-max", name: "GPT 5.1 Codex Max", endpoint: "https://opencode.ai/zen/v1/responses" },
          { id: "gpt-5.1-codex-mini", name: "GPT 5.1 Codex Mini", endpoint: "https://opencode.ai/zen/v1/responses" },
          { id: "gpt-5", name: "GPT 5", endpoint: "https://opencode.ai/zen/v1/responses" },
          { id: "gpt-5-codex", name: "GPT 5 Codex", endpoint: "https://opencode.ai/zen/v1/responses" },
          { id: "gpt-5-nano", name: "GPT 5 Nano", endpoint: "https://opencode.ai/zen/v1/responses" },
          { id: "claude-opus-4-7", name: "Claude Opus 4.7", endpoint: "https://opencode.ai/zen/v1/messages" },
          { id: "claude-opus-4-6", name: "Claude Opus 4.6", endpoint: "https://opencode.ai/zen/v1/messages" },
          { id: "claude-opus-4-5", name: "Claude Opus 4.5", endpoint: "https://opencode.ai/zen/v1/messages" },
          { id: "claude-opus-4-1", name: "Claude Opus 4.1", endpoint: "https://opencode.ai/zen/v1/messages" },
          { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", endpoint: "https://opencode.ai/zen/v1/messages" },
          { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", endpoint: "https://opencode.ai/zen/v1/messages" },
          { id: "claude-sonnet-4", name: "Claude Sonnet 4", endpoint: "https://opencode.ai/zen/v1/messages" },
          { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", endpoint: "https://opencode.ai/zen/v1/messages" },
          { id: "claude-3-5-haiku", name: "Claude Haiku 3.5", endpoint: "https://opencode.ai/zen/v1/messages" },
          { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro", endpoint: "https://opencode.ai/zen/v1/models/gemini-3.1-pro" },
          { id: "gemini-3-flash", name: "Gemini 3 Flash", endpoint: "https://opencode.ai/zen/v1/models/gemini-3-flash" },
        ],
      },
    ],
  },
  {
    id: "ollama",
    name: "Ollama (本地)",
    description: "使用本地 Ollama 服务，无需 API Key，模型从本地实例自动拉取。确保 Ollama 已启动并拉取了模型。",
    endpoint: "http://localhost:11434/v1/chat/completions",
    docUrl: "https://ollama.com/library",
    models: [], // 动态获取，初始为空
  },
];

const defaultPrompt = "你现在是一个直播间助理，你会收到粉丝牌+用户名+弹幕内容，请逐条回复，单条回复不超过40字。";
const defaultModelId = "minimax-m2.5-free";
const defaultModelEndpoint = "https://opencode.ai/zen/v1/chat/completions";

const form = reactive<AIModelForm>({
  provider: providerOptions[0].id,
  apiKey: "",
  modelId: defaultModelId,
  endpoint: defaultModelEndpoint,
  prompt: defaultPrompt,
  sendIntervalMs: 1800,
  maxPending: 100,
  ignoreUsernames: [],
  skipReplies: ["NO_REPLY", "无需回复", "不需要回复", "不用回复", "不回复", "忽略", "skip", "pass"],
  maxTokens: 256,
  temperature: 0.7,
  topP: 1,
  ollamaKeepAlive: "5m",
  requestTimeoutMs: 30000,
});

/** 缓存所有供应商的独立配置，切换供应商时保存/恢复 */
const providerConfigs = reactive<Record<string, ProviderConfig>>({
  opencode: {
    modelId: defaultModelId,
    apiKey: "",
    endpoint: defaultModelEndpoint,
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
});

// Ollama 动态模型列表
const ollamaModels = ref<ProviderModel[]>([]);
const ollamaLoading = ref(false);
const ollamaError = ref<string | null>(null);
const ollamaBaseUrl = ref("http://localhost:11434");

// OpenCode 动态模型列表（从 API 拉取后覆盖静态列表）
const opencodeRemoteIds = ref<string[]>([]);
const opencodeLoading = ref(false);
const opencodeError = ref<string | null>(null);

async function fetchOllamaModelList() {
  ollamaLoading.value = true;
  ollamaError.value = null;
  try {
    const api = window.danmakuAPI;
    if (!api?.fetchOllamaModels) {
      ollamaError.value = "IPC 桥接不可用";
      return;
    }
    const result = await api.fetchOllamaModels(ollamaBaseUrl.value);
    if (result.status === "ok" && Array.isArray(result.models)) {
      ollamaModels.value = result.models.map((name: string) => ({
        id: name,
        name: name,
        endpoint: `${ollamaBaseUrl.value.replace(/\/+$/, "")}/v1/chat/completions`,
      }));
      // 如果当前模型不在列表中，自动选择第一个
      if (ollamaModels.value.length > 0 && !ollamaModels.value.some(m => m.id === form.modelId)) {
        form.modelId = ollamaModels.value[0].id;
        form.endpoint = ollamaModels.value[0].endpoint;
      }
    } else {
      ollamaError.value = result.message || "获取模型列表失败";
    }
  } catch (e: any) {
    ollamaError.value = e?.message || "连接 Ollama 失败";
  } finally {
    ollamaLoading.value = false;
  }
}

/** 从 OpenCode Zen API 拉取最新模型 ID 列表 */
async function fetchOpenCodeModelList() {
  opencodeLoading.value = true;
  opencodeError.value = null;
  try {
    const api = window.danmakuAPI;
    if (!api?.fetchOpenCodeModels) {
      opencodeError.value = "IPC 桥接不可用";
      return;
    }
    const result = await api.fetchOpenCodeModels();
    if (result.status === "ok" && Array.isArray(result.models)) {
      opencodeRemoteIds.value = result.models;
      ensureOpenCodeModelSelectionValid();
    } else {
      opencodeRemoteIds.value = [];
      opencodeError.value = result.message || "获取模型列表失败";
      ensureOpenCodeModelSelectionValid();
    }
  } catch (e: any) {
    opencodeRemoteIds.value = [];
    opencodeError.value = e?.message || "连接 OpenCode 失败";
    ensureOpenCodeModelSelectionValid();
  } finally {
    opencodeLoading.value = false;
  }
}

const skipRepliesText = ref("NO_REPLY\n无需回复\n不需要回复\n不用回复\n不回复\n忽略\nskip\npass");

const saving = ref(false);
const saved = ref(false);
const errorMsg = ref<string | null>(null);

const promptSaving = ref(false);
const promptSaved = ref(false);
const promptError = ref<string | null>(null);
const lastSavedPrompt = ref("");

const connecting = ref(false);
const connected = ref(false);
const connectMsg = ref<string | null>(null);
const queueLength = ref(0);
const processing = ref(false);
const sentCount = ref(0);
const skippedCount = ref(0);
const clearedCount = ref(0);
const failedCount = ref(0);
const runtimeError = ref<string | null>(null);
const recentDecisions = ref<ReplyDecision[]>([]);
const clearingQueue = ref(false);
const clearingPreview = ref(false);
const showProviderModal = ref(false);
const showApiKey = ref(false);
const modelMenuOpen = ref(false);
const modelMenuRef = ref<HTMLElement | null>(null);

const selectedProvider = computed(() => providerOptions.find((p) => p.id === form.provider) || providerOptions[0]);
const isOpenCodeStaticFallback = computed(() => {
  return form.provider === "opencode" && !!opencodeError.value && opencodeRemoteIds.value.length === 0;
});

type OpenCodeTier = "free" | "go" | "zen" | "unknown";

/**
 * 远端新增模型的手工分层映射。
 */
const remoteOpenCodeTierOverrides: Record<string, Exclude<OpenCodeTier, "unknown">> = {
  "big-pickle": "free",
  // "model-id": "go",
  // "model-id": "zen",
};

/**
 * Free 白名单：仅保留用户确认的免费模型。
 * 不在该列表中的模型即便名字带 free，也不会归入免费分组。
 */
const ALLOWED_FREE_MODEL_IDS = new Set<string>([
  "minimax-m2.5-free",
  "ling-2.6-flash-free",
  "trinity-large-preview-free",
  "hy3-preview-free",
  "nemotron-3-super-free",
  "big-pickle",
]);

function isFreeModel(modelId: string, modelName?: string): boolean {
  const id = modelId.toLowerCase();
  return ALLOWED_FREE_MODEL_IDS.has(id);
}

function inferOpenCodeEndpointByModelId(modelId: string): string {
  if (modelId.startsWith("gemini-")) return `https://opencode.ai/zen/v1/models/${modelId}`;
  if (modelId.startsWith("gpt-")) return "https://opencode.ai/zen/v1/responses";
  if (modelId.startsWith("claude-")) return "https://opencode.ai/zen/v1/messages";
  return "https://opencode.ai/zen/v1/chat/completions";
}

function classifyRemoteOpenCodeTier(modelId: string): OpenCodeTier {
  const overridden = remoteOpenCodeTierOverrides[modelId];
  if (overridden) return overridden;
  if (isFreeModel(modelId)) return "free";
  return "unknown";
}

const modelGroups = computed(() => {
  if (form.provider === "ollama") {
    return ollamaModels.value.length > 0
      ? [{ label: "Ollama 本地模型", models: ollamaModels.value }]
      : [];
  }
  // OpenCode: 从静态 modelGroups 过滤出远程存在的模型
  const staticGroups = selectedProvider.value.modelGroups || [];
  if (opencodeRemoteIds.value.length === 0) {
    // 未拉取远程时，使用静态完整列表
    return staticGroups;
  }

  const staticModelIds = new Set(staticGroups.flatMap((g) => g.models.map((m) => m.id)));
  const remoteSet = new Set(opencodeRemoteIds.value);
  // Go 分组的模型 endpoint 已硬编码为 /zen/go/v1/，不依赖远端发现，始终显示
  let groupedFromStatic = staticGroups
    .map((group) => ({
      ...group,
      models: group.label.includes("Go")
        ? group.models // Go 分组：不过滤，始终显示
        : group.models.filter((m) => remoteSet.has(m.id)), // 其余分组：只显示远端存在的
    }))
    .filter((group) => group.models.length > 0);

  // 强制规则：名称或 id 含 free（以及 big-pickle）都归类到免费组
  const forcedFreeMap = new Map<string, ProviderModel>();
  for (const group of groupedFromStatic) {
    for (const model of group.models) {
      if (isFreeModel(model.id, model.name)) {
        forcedFreeMap.set(model.id, model);
      }
    }
  }
  if (forcedFreeMap.size > 0) {
    groupedFromStatic = groupedFromStatic
      .map((group) => ({
        ...group,
        models: group.models.filter((m) => !isFreeModel(m.id, m.name)),
      }))
      .filter((group) => group.models.length > 0);

    groupedFromStatic.unshift({
      label: "── 免费模型 (Zen 免费额度) ──",
      models: Array.from(forcedFreeMap.values()),
    });
  }

  const remoteOnlyByTier: Record<OpenCodeTier, ProviderModel[]> = {
    free: [],
    go: [],
    zen: [],
    unknown: [],
  };

  const remoteOnlyIds = opencodeRemoteIds.value.filter((id) => !staticModelIds.has(id));
  for (const id of remoteOnlyIds) {
    const tier = classifyRemoteOpenCodeTier(id);
    remoteOnlyByTier[tier].push({
      id,
      name: id,
      endpoint: inferOpenCodeEndpointByModelId(id),
    });
  }

  if (remoteOnlyByTier.free.length > 0) {
    for (const model of remoteOnlyByTier.free) {
      forcedFreeMap.set(model.id, model);
    }
    groupedFromStatic = groupedFromStatic.filter((group) => group.label !== "── 免费模型 (Zen 免费额度) ──");
    groupedFromStatic.unshift({
      label: "── 免费模型 (Zen 免费额度) ──",
      models: Array.from(forcedFreeMap.values()),
    });
  }
  if (remoteOnlyByTier.go.length > 0) {
    groupedFromStatic.push({
      label: "── 远端新增模型（已标记：Go） ──",
      models: remoteOnlyByTier.go,
    });
  }
  if (remoteOnlyByTier.zen.length > 0) {
    groupedFromStatic.push({
      label: "── 远端新增模型（已标记：Zen） ──",
      models: remoteOnlyByTier.zen,
    });
  }
  if (remoteOnlyByTier.unknown.length > 0) {
    groupedFromStatic.push({
      label: "── 远端新增模型（Go/Zen） ──",
      models: remoteOnlyByTier.unknown,
    });
  }

  return groupedFromStatic;
});
const modelOptions = computed(() => {
  // 从 modelGroups 展平出全部模型列表，保持顺序
  return modelGroups.value.flatMap((g) => g.models);
});

const selectedModelLabel = computed(() => {
  const model = modelOptions.value.find((m) => m.id === form.modelId);
  return model?.name || form.modelId || "请选择模型";
});

function selectModel(model: ProviderModel): void {
  form.modelId = model.id;
  form.endpoint = model.endpoint;
  modelMenuOpen.value = false;
}

function toggleModelMenu(): void {
  modelMenuOpen.value = !modelMenuOpen.value;
}

function handleGlobalPointerDown(event: Event): void {
  const target = event.target as Node | null;
  if (!target) return;
  if (modelMenuRef.value && !modelMenuRef.value.contains(target)) {
    modelMenuOpen.value = false;
  }
}

function ensureOpenCodeModelSelectionValid(): void {
  if (form.provider !== "opencode") return;

  if (modelOptions.value.length === 0) {
    form.modelId = "";
    return;
  }

  const exists = modelOptions.value.some((m) => m.id === form.modelId);
  if (!exists) {
    form.modelId = modelOptions.value[0].id;
    form.endpoint = modelOptions.value[0].endpoint;
  }
}

let promptTimer: ReturnType<typeof setTimeout> | null = null;
let promptSavedTimer: ReturnType<typeof setTimeout> | null = null;
let offAIStatus: (() => void) | null = null;

function parseSkipRepliesText(): string[] {
  const tokens = skipRepliesText.value
    .split(/[\n,，]/g)
    .map((x) => x.trim())
    .filter(Boolean);
  return [...new Set(tokens)];
}

/** 将当前表单状态保存回 providerConfigs，并构建完整 aiModel payload */
function syncFormToProviderConfig(): void {
  const p = form.provider;
  providerConfigs[p] = {
    modelId: form.modelId,
    apiKey: form.apiKey,
    endpoint: form.endpoint,
    ...(p === "ollama" ? { ollamaBaseUrl: ollamaBaseUrl.value } : {}),
    maxTokens: Number(form.maxTokens) || (p === "ollama" ? 2048 : 256),
    temperature: Number(form.temperature ?? 0.7),
    topP: Number(form.topP ?? 1),
    ...(p === "ollama" ? { ollamaKeepAlive: form.ollamaKeepAlive || "5m" } : {}),
    requestTimeoutMs: Number(form.requestTimeoutMs) || (p === "ollama" ? 120000 : 30000),
  };
}

/** 构建发送给 config-store 的 aiModel 完整 payload */
function buildSavePayload(): Record<string, unknown> {
  syncFormToProviderConfig();

  return {
    provider: form.provider,
    prompt: form.prompt,
    sendIntervalMs: Math.max(500, Number(form.sendIntervalMs || 1800)),
    maxPending: Math.max(10, Number(form.maxPending || 100)),
    ignoreUsernames: form.ignoreUsernames,
    skipReplies: parseSkipRepliesText(),
    providers: JSON.parse(JSON.stringify(providerConfigs)),
  };
}

// ─── 未保存变更检测 ───
const lastSavedSnapshot = ref<string>("");

function takeSnapshot(): string {
  return JSON.stringify(buildSavePayload());
}

const hasUnsavedChanges = computed(() => {
  if (!lastSavedSnapshot.value) return false;
  return takeSnapshot() !== lastSavedSnapshot.value;
});

watch(
  () => form.provider,
  (newProviderId, oldProviderId) => {
    // 保存旧供应商的配置
    if (oldProviderId) {
      syncFormToProviderConfig();
    }

    const provider = providerOptions.find((p) => p.id === newProviderId);
    if (!provider) return;

    // 从 providerConfigs 恢复新供应商的配置
    const pc = providerConfigs[newProviderId];
    if (pc) {
      form.apiKey = pc.apiKey || "";
      form.modelId = pc.modelId || "";
      form.endpoint = pc.endpoint || provider.endpoint;
      form.maxTokens = pc.maxTokens || (newProviderId === "ollama" ? 2048 : 256);
      form.temperature = pc.temperature ?? 0.7;
      form.topP = pc.topP ?? 1;
      form.requestTimeoutMs = pc.requestTimeoutMs || (newProviderId === "ollama" ? 120000 : 30000);
      form.ollamaKeepAlive = pc.ollamaKeepAlive || "5m";
      if (pc.ollamaBaseUrl) ollamaBaseUrl.value = pc.ollamaBaseUrl;
    } else {
      form.endpoint = provider.endpoint;
      form.apiKey = "";
    }

    // Ollama: 自动拉取模型列表
    if (newProviderId === "ollama") {
      form.endpoint = `${ollamaBaseUrl.value.replace(/\/+$/, "")}/v1/chat/completions`;
      fetchOllamaModelList();
    } else {
      if (!provider.models.some((m) => m.id === form.modelId) && !modelOptions.value.some((m) => m.id === form.modelId)) {
        form.modelId = modelOptions.value[0]?.id || "";
      }
    }
  }
);

// Ollama 地址变更时同步 Endpoint
watch(ollamaBaseUrl, (url) => {
  if (form.provider === "ollama") {
    form.endpoint = `${url.replace(/\/+$/, "")}/v1/chat/completions`;
  }
});

watch(
  () => form.modelId,
  (modelId) => {
    // Ollama 模型切换由 ollamaBaseUrl watch 处理
    if (form.provider === "ollama") return;
    // 从分组模型中查找 endpoint
    const model = modelOptions.value.find((m) => m.id === modelId);
    if (model) {
      form.endpoint = model.endpoint;
    }
  }
);

watch(
  () => form.provider,
  () => {
    modelMenuOpen.value = false;
  }
);

watch(
  () => form.prompt,
  (value) => {
    promptError.value = null;
    if (promptTimer) clearTimeout(promptTimer);
    promptTimer = setTimeout(() => {
      savePrompt(value);
    }, 450);
  }
);

async function loadConfig() {
  const api = window.danmakuAPI;
  if (!api) return;
  try {
    const cfg = await api.getConfig();
    if (cfg.aiModel) {
      const ai = cfg.aiModel as any;

      // 恢复共享字段
      form.provider = ai.provider || form.provider;
      form.prompt = ai.prompt || form.prompt;
      lastSavedPrompt.value = form.prompt;
      form.sendIntervalMs = Number(ai.sendIntervalMs || form.sendIntervalMs);
      form.maxPending = Number(ai.maxPending || form.maxPending);
      form.ignoreUsernames = Array.isArray(ai.ignoreUsernames) ? ai.ignoreUsernames : [];
      form.skipReplies = Array.isArray(ai.skipReplies) && ai.skipReplies.length > 0
        ? ai.skipReplies
        : form.skipReplies;
      skipRepliesText.value = form.skipReplies.join("\n");

      // 恢复各供应商独立配置
      if (ai.providers && typeof ai.providers === "object") {
        Object.keys(ai.providers).forEach((pid) => {
          const pc = ai.providers[pid];
          if (pc) {
            providerConfigs[pid] = { ...providerConfigs[pid], ...pc };
          }
        });
      }

      // 恢复 Ollama 地址（需要在 provider watch 之前）
      if (providerConfigs.ollama?.ollamaBaseUrl) {
        ollamaBaseUrl.value = providerConfigs.ollama.ollamaBaseUrl;
      }

      // 从当前激活供应商的配置恢复表单
      const activePc = providerConfigs[form.provider];
      if (activePc) {
        form.apiKey = activePc.apiKey || "";
        form.modelId = activePc.modelId || form.modelId;
        form.endpoint = activePc.endpoint || form.endpoint;
        form.maxTokens = activePc.maxTokens || (form.provider === "ollama" ? 2048 : 256);
        form.temperature = activePc.temperature ?? 0.7;
        form.topP = activePc.topP ?? 1;
        form.ollamaKeepAlive = activePc.ollamaKeepAlive || "5m";
        form.requestTimeoutMs = activePc.requestTimeoutMs || (form.provider === "ollama" ? 120000 : 30000);
      }

      // 初始化保存快照
      lastSavedSnapshot.value = takeSnapshot();
    }
    const status = await api.getAIStatus();
    connected.value = !!status.connected;
    queueLength.value = Number(status.queueLength || 0);
    processing.value = !!status.processing;
    sentCount.value = Number(status.sentCount || 0);
    skippedCount.value = Number(status.skippedCount || 0);
    clearedCount.value = Number(status.clearedCount || 0);
    failedCount.value = Number(status.failedCount || 0);
    runtimeError.value = status.lastError || null;
    recentDecisions.value = Array.isArray(status.recentDecisions) ? status.recentDecisions : [];
  } catch (e) {
    }
  // 启动时自动拉取 OpenCode 最新模型列表（不阻塞加载）
  fetchOpenCodeModelList();
}

async function handleSave() {
  const api = window.danmakuAPI;
  if (!api) return;
  errorMsg.value = null;
  saving.value = true;
  try {
    const payload = buildSavePayload();
    const result = await api.setConfig("aiModel", JSON.parse(JSON.stringify(payload)));
    if (result?.status !== "ok") {
      throw new Error((result as any)?.message || "保存失败");
    }
    lastSavedSnapshot.value = JSON.stringify(payload);
    saved.value = true;
    setTimeout(() => (saved.value = false), 2000);

    // 已连接状态下保存 → 自动热重载新配置（断旧连新）
    if (connected.value) {
      try {
        await handleConnect();
      } catch {
        // 重连失败时保持已保存状态，用户可手动重连
      }
    }
  } catch (e: any) {
    const msg = e?.message || "保存失败";
    errorMsg.value = msg;
  } finally {
    saving.value = false;
  }
}

async function savePrompt(text: string) {
  const api = window.danmakuAPI;
  if (!api) return;
  promptSaving.value = true;
  try {
    const result = await api.setConfig("aiModel.prompt", text);
    if (result?.status !== "ok") {
      throw new Error((result as any)?.message || "提示词自动保存失败");
    }
    lastSavedPrompt.value = text;
    promptSaved.value = true;
    if (promptSavedTimer) clearTimeout(promptSavedTimer);
    promptSavedTimer = setTimeout(() => {
      promptSaved.value = false;
    }, 1200);
  } catch (e: any) {
    promptError.value = e?.message || "提示词自动保存失败";
  } finally {
    promptSaving.value = false;
  }
}

async function flushPromptIfNeeded(): Promise<void> {
  const latest = String(form.prompt || "");
  if (latest === lastSavedPrompt.value) return;
  await savePrompt(latest);
}

async function handleConnect() {
  const api = window.danmakuAPI;
  if (!api) return;
  connectMsg.value = null;
  connecting.value = true;
  try {
    if (promptTimer) {
      clearTimeout(promptTimer);
      promptTimer = null;
    }
    await flushPromptIfNeeded();
    // 连接前先保存完整配置，确保 store 中有最新的 provider/endpoint 等值
    const payload = buildSavePayload();
    const saveResult = await api.setConfig("aiModel", JSON.parse(JSON.stringify(payload)));
    if (saveResult?.status !== "ok") {
      throw new Error("连接前保存配置失败，请先点击「保存供应商配置」");
    }
    // 连接成功后同步快照，避免误报"未保存"
    lastSavedSnapshot.value = JSON.stringify(payload);

    const result = await api.connectAI();
    if (result?.status !== "ok") {
      throw new Error(result?.message || "连接失败");
    }
    connected.value = true;
    connectMsg.value = result?.message || "连接成功";
  } catch (e: any) {
    connected.value = false;
    connectMsg.value = e?.message || "连接失败";
  } finally {
    connecting.value = false;
  }
}

async function handleDisconnect() {
  const api = window.danmakuAPI;
  if (!api) return;
  try {
    await api.disconnectAI();
  } finally {
    connected.value = false;
    connectMsg.value = "已断开连接";
  }
}

async function handleClearQueue() {
  const api = window.danmakuAPI;
  if (!api) return;
  clearingQueue.value = true;
  connectMsg.value = null;
  try {
    const result = await api.clearAIQueue();
    connectMsg.value = `已清空 ${Number(result?.cleared || 0)} 条待发送消息`;
    const status = await api.getAIStatus();
    queueLength.value = Number(status.queueLength || 0);
    recentDecisions.value = Array.isArray(status.recentDecisions) ? status.recentDecisions : [];
  } catch (e: any) {
    connectMsg.value = e?.message || "清空队列失败";
  } finally {
    clearingQueue.value = false;
  }
}

async function handleClearPreview() {
  const api = window.danmakuAPI;
  if (!api) return;
  clearingPreview.value = true;
  try {
    const result = await api.clearAIPreview();
    connectMsg.value = `已清空 ${Number(result?.cleared || 0)} 条返回预览记录`;
    const status = await api.getAIStatus();
    recentDecisions.value = Array.isArray(status.recentDecisions) ? status.recentDecisions : [];
  } catch (e: any) {
    connectMsg.value = e?.message || "清空返回预览失败";
  } finally {
    clearingPreview.value = false;
  }
}

async function copyDecision(item: ReplyDecision) {
  const payload = {
    id: item.id,
    timestamp: item.timestamp,
    action: item.action,
    reason: item.reason,
    input: item.input,
    output: item.output,
  };
  await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  connectMsg.value = "已复制该条返回预览";
}

async function copyAllDecisions() {
  await navigator.clipboard.writeText(JSON.stringify(recentDecisions.value, null, 2));
  connectMsg.value = `已复制 ${recentDecisions.value.length} 条返回预览`;
}

function formatDecisionTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("zh-CN", { hour12: false });
}

function actionText(action: ReplyDecision["action"]): string {
  if (action === "pending_send") return "待发送";
  if (action === "sent") return "已发送";
  if (action === "skipped") return "已跳过";
  if (action === "error") return "错误";
  return "已清空";
}

onMounted(() => {
  loadConfig();
  window.addEventListener("mousedown", handleGlobalPointerDown);
  const api = window.danmakuAPI;
  if (api?.onAIStatus) {
      offAIStatus = api.onAIStatus((status: any) => {
      connected.value = !!status.connected;
      queueLength.value = Number(status.queueLength || 0);
      processing.value = !!status.processing;
        sentCount.value = Number(status.sentCount || 0);
        skippedCount.value = Number(status.skippedCount || 0);
        clearedCount.value = Number(status.clearedCount || 0);
        failedCount.value = Number(status.failedCount || 0);
        runtimeError.value = status.lastError || null;
        recentDecisions.value = Array.isArray(status.recentDecisions) ? status.recentDecisions : [];
      });
  }
});

onUnmounted(() => {
  if (promptTimer) {
    clearTimeout(promptTimer);
    promptTimer = null;
  }
  void flushPromptIfNeeded();
  if (promptSavedTimer) clearTimeout(promptSavedTimer);
  offAIStatus?.();
  window.removeEventListener("mousedown", handleGlobalPointerDown);
});
</script>

<template>
  <div class="page">
    <div class="page-header">
      <h2 class="page-title">大模型配置</h2>
    </div>

    <div class="card">
      <h3 class="card-title">模型供应商</h3>
      <p class="card-desc">
        这里只保存供应商配置，不会自动连接。你可以先保存供应商、模型、API Key，再配置提示词后手动连接。
      </p>

      <div class="field">
        <label class="field-label">供应商</label>
        <div class="provider-row">
          <div class="provider-select-wrap">
            <select v-model="form.provider" class="field-input provider-select">
              <option v-for="provider in providerOptions" :key="provider.id" :value="provider.id">
                {{ provider.name }}
              </option>
            </select>
            <span class="provider-select-caret" aria-hidden="true">
              <svg viewBox="0 0 12 12" class="provider-select-caret-icon" focusable="false">
                <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </span>
          </div>
          <button class="btn btn-muted" @click="showProviderModal = true">说明</button>
        </div>
      </div>

      <!-- Ollama: 自定义地址 + 拉取模型 -->
      <template v-if="form.provider === 'ollama'">
        <div class="field">
          <label class="field-label">Ollama 地址</label>
          <div class="ollama-url-row">
            <input v-model="ollamaBaseUrl" type="text" placeholder="http://localhost:11434" class="field-input ollama-url-input" />
            <button class="btn btn-accent ollama-fetch-btn" :disabled="ollamaLoading" @click="fetchOllamaModelList">
              {{ ollamaLoading ? "获取中..." : "刷新模型" }}
            </button>
          </div>
          <div v-if="ollamaError" class="msg-inline msg-error">{{ ollamaError }}</div>
          <div v-if="ollamaModels.length > 0" class="msg msg-success msg-mt-6">已获取 {{ ollamaModels.length }} 个模型</div>
        </div>

        <div class="field">
          <label class="field-label">模型</label>
          <div ref="modelMenuRef" class="model-select-wrap">
            <button type="button" class="field-input model-select-trigger" @click="toggleModelMenu">
              <span class="model-select-value">{{ selectedModelLabel }}</span>
              <span class="model-select-caret" aria-hidden="true">
                <svg viewBox="0 0 12 12" class="model-select-caret-icon" focusable="false">
                  <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </span>
            </button>
            <div v-if="modelMenuOpen" class="model-select-menu">
              <div v-for="group in modelGroups" :key="group.label" class="model-select-group">
                <div class="model-select-group-label">{{ group.label }}</div>
                <button
                  v-for="model in group.models"
                  :key="model.id"
                  type="button"
                  class="model-select-option"
                  :class="{ active: form.modelId === model.id }"
                  @click="selectModel(model)"
                >
                  {{ model.name }}
                </button>
              </div>
            </div>
          </div>
          <div v-if="modelOptions.length === 0 && !ollamaLoading" class="msg-inline msg-inline-mt-4">请先点击「刷新模型」拉取本地模型列表</div>
        </div>
      </template>

      <!-- 非 Ollama: 固定模型列表 + API Key -->
      <template v-else>
        <div class="field">
          <label class="field-label">模型</label>
          <div class="ollama-url-row">
            <div ref="modelMenuRef" class="model-select-wrap ollama-url-input">
              <button type="button" class="field-input model-select-trigger" @click="toggleModelMenu">
                <span class="model-select-value">{{ selectedModelLabel }}</span>
                <span class="model-select-caret" aria-hidden="true">
                  <svg viewBox="0 0 12 12" class="model-select-caret-icon" focusable="false">
                    <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </span>
              </button>
              <div v-if="modelMenuOpen" class="model-select-menu">
                <div v-for="group in modelGroups" :key="group.label" class="model-select-group">
                  <div class="model-select-group-label">{{ group.label }}</div>
                  <button
                    v-for="model in group.models"
                    :key="model.id"
                    type="button"
                    class="model-select-option"
                    :class="{ active: form.modelId === model.id }"
                    @click="selectModel(model)"
                  >
                    {{ model.name }}
                  </button>
                </div>
              </div>
            </div>
            <button class="btn btn-muted" :disabled="opencodeLoading" @click="fetchOpenCodeModelList">
              {{ opencodeLoading ? "刷新中..." : "刷新模型" }}
            </button>
          </div>
          <div v-if="opencodeError" class="msg-inline msg-error">{{ opencodeError }}</div>
          <div v-if="opencodeRemoteIds.length > 0" class="msg msg-success msg-mt-6">已同步 {{ opencodeRemoteIds.length }} 个模型</div>
          <div v-else-if="isOpenCodeStaticFallback" class="msg-inline msg-warning msg-mt-6">
            当前使用本地静态模型列表（OpenCode 远端列表拉取失败），部分模型可能暂不可用。
          </div>
        </div>

        <div class="field">
          <label class="field-label">API Key</label>
          <div class="apikey-row">
            <input v-model="form.apiKey" :type="showApiKey ? 'text' : 'password'" placeholder="输入从供应商控制台获取的 API Key" class="field-input apikey-input" />
            <button class="btn btn-muted apikey-toggle" @click="showApiKey = !showApiKey">
              {{ showApiKey ? '隐藏' : '显示' }}
            </button>
          </div>
        </div>
      </template>

      <div class="field">
        <label class="field-label">Endpoint</label>
        <input v-model="form.endpoint" type="text" class="field-input" :readonly="form.provider !== 'ollama'" />
        <div v-if="form.provider === 'ollama'" class="msg-inline">Ollama 使用 OpenAI 兼容接口，可修改为远程服务器地址</div>
      </div>

      <div class="field field-inline-2">
        <div>
          <label class="field-label">发送间隔(ms)</label>
          <input v-model.number="form.sendIntervalMs" type="number" min="500" step="100" class="field-input" />
        </div>
        <div>
          <label class="field-label">队列上限</label>
          <input v-model.number="form.maxPending" type="number" min="10" step="10" class="field-input" />
        </div>
      </div>

      <!-- 云端供应商：温度 + Top P -->
      <div v-if="form.provider !== 'ollama'" class="field field-inline-2">
        <div>
          <label class="field-label">温度 (0~2)</label>
          <input v-model.number="form.temperature" type="number" min="0" max="2" step="0.1" class="field-input" />
          <div class="msg-inline">越高越随机，越低越确定</div>
        </div>
        <div>
          <label class="field-label">Top P (0~1)</label>
          <input v-model.number="form.topP" type="number" min="0" max="1" step="0.05" class="field-input" />
          <div class="msg-inline">核采样截断，1=不限制</div>
        </div>
      </div>

      <!-- Ollama 供应商：全部模型参数 -->
      <template v-if="form.provider === 'ollama'">
        <div class="field field-inline-4">
          <div>
            <label class="field-label">最大 Token 数</label>
            <input v-model.number="form.maxTokens" type="number" min="64" step="128" class="field-input" />
            <div class="msg-inline">thinking 模型建议 ≥ 2048</div>
          </div>
          <div>
            <label class="field-label">温度 (0~2)</label>
            <input v-model.number="form.temperature" type="number" min="0" max="2" step="0.1" class="field-input" />
            <div class="msg-inline">建议 0.5~0.8</div>
          </div>
          <div>
            <label class="field-label">Top P (0~1)</label>
            <input v-model.number="form.topP" type="number" min="0" max="1" step="0.05" class="field-input" />
            <div class="msg-inline">核采样截断，1=不限制</div>
          </div>
          <div>
            <label class="field-label">请求超时(ms)</label>
            <input v-model.number="form.requestTimeoutMs" type="number" min="5000" step="5000" class="field-input" />
            <div class="msg-inline">建议 ≥ 120000</div>
          </div>
        </div>

        <div class="field">
          <label class="field-label">模型保活时间</label>
          <input v-model="form.ollamaKeepAlive" type="text" placeholder="5m" class="field-input field-input-half" />
          <div class="msg-inline">如 "5m"、"30m"，避免每次请求重新加载模型</div>
        </div>
      </template>

      <div class="field">
        <label class="field-label">无需发送标记（可配置）</label>
        <textarea
          v-model="skipRepliesText"
          class="field-input"
          rows="3"
          placeholder="每行一个标记，如 NO_REPLY；支持 /pattern/flags 正则"
        ></textarea>
        <div class="msg-inline">
          当模型输出命中这些标记时跳过发送。纯文本做去空格匹配防拆字；<code>/pattern/flags</code> 语法支持正则。
        </div>
      </div>

      <div class="btn-row">
        <button class="btn btn-accent" :disabled="saving" @click="handleSave">
          {{ saving ? "保存中..." : "保存模型配置" }}
        </button>
        <span v-if="hasUnsavedChanges && !saving" class="msg-inline msg-warning">配置已修改，请保存</span>
        <span v-if="saved" class="msg-inline msg-success">{{ connected ? '已保存' : '已保存（未连接）' }}</span>
        <span v-if="errorMsg" class="msg-inline msg-error">{{ errorMsg }}</span>
      </div>
    </div>

    <div class="card">
      <h3 class="card-title">提示词配置</h3>
      <p class="card-desc">
        这里输入大模型角色提示词。输入后会自动保存。点击“开始连接”后，程序会把该提示词作为会话初始化内容发送给模型。
      </p>
      <p class="card-desc">
        提示词建议约定：<b>需要回复时输出最终弹幕文本；不需要回复时仅输出 NO_REPLY（或你在上方配置的标记）</b>。
        这样系统会自动跳过发送，避免无效刷屏。
      </p>

      <div class="field">
        <label class="field-label">系统提示词</label>
        <textarea
          v-model="form.prompt"
          class="field-input prompt-textarea"
          rows="7"
          placeholder="例如：你现在是一个直播间助理..."
        ></textarea>
      </div>

      <div class="btn-row">
        <button class="btn btn-accent" :disabled="connecting || !form.prompt.trim()" @click="handleConnect">
          {{ connecting ? "连接中..." : "开始连接" }}
        </button>
        <button class="btn btn-muted" :disabled="!connected" @click="handleDisconnect">断开连接</button>
        <button class="btn btn-muted" :disabled="clearingQueue" @click="handleClearQueue">
          {{ clearingQueue ? "清空中..." : "一键清空发送队列" }}
        </button>
        <span class="msg-inline" :class="connected ? 'msg-success' : 'msg-error'">
          {{ connected ? "已连接" : "未连接" }}
        </span>
        <span v-if="promptSaving" class="msg-inline">提示词保存中...</span>
        <span v-else-if="promptSaved" class="msg-inline msg-success">提示词已自动保存</span>
        <span v-if="promptError" class="msg-inline msg-error">{{ promptError }}</span>
      </div>
      <div v-if="connectMsg" :class="['msg', connected ? 'msg-success' : 'msg-error']">
        {{ connectMsg }}
      </div>

      <div class="runtime-status">
        <div class="runtime-item">队列长度：<b>{{ queueLength }}</b></div>
        <div class="runtime-item">处理中：<b>{{ processing ? "是" : "否" }}</b></div>
        <div class="runtime-item">已发送：<b>{{ sentCount }}</b></div>
        <div class="runtime-item">已跳过：<b>{{ skippedCount }}</b></div>
        <div class="runtime-item">已清空：<b>{{ clearedCount }}</b></div>
        <div class="runtime-item">失败重试次数：<b>{{ failedCount }}</b></div>
      </div>
      <div v-if="runtimeError" class="msg msg-error">运行提示：{{ runtimeError }}</div>

      <div class="field preview-field">
        <label class="field-label preview-label-spaced">AI 返回预览（发送前/跳过都会记录）</label>
        <div class="btn-row preview-actions">
          <button class="btn btn-muted" :disabled="clearingPreview" @click="handleClearPreview">
            {{ clearingPreview ? "清空中..." : "清空返回预览" }}
          </button>
          <button class="btn btn-muted" :disabled="recentDecisions.length === 0" @click="copyAllDecisions">
            复制全部预览
          </button>
        </div>
        <div class="decision-list">
          <div v-for="item in recentDecisions" :key="item.id" class="decision-item">
            <div class="decision-head">
              <span class="decision-time">{{ formatDecisionTime(item.timestamp) }}</span>
              <div class="decision-head-right">
                <span class="decision-action" :class="`a-${item.action}`">{{ actionText(item.action) }}</span>
                <button class="copy-btn" @click="copyDecision(item)">复制</button>
              </div>
            </div>
            <div v-if="item.input" class="decision-line"><b>入参:</b> {{ item.input }}</div>
            <div v-if="item.output" class="decision-line"><b>输出:</b> {{ item.output }}</div>
            <div class="decision-reason">{{ item.reason }}</div>
          </div>
          <div v-if="recentDecisions.length === 0" class="msg-inline">暂无记录</div>
        </div>
      </div>
    </div>

    <!-- 供应商说明弹窗 -->
    <Teleport to="body">
      <div v-if="showProviderModal" class="modal-overlay" @click.self="showProviderModal = false">
        <div class="modal-content">
          <div class="modal-header">
            <h3 class="modal-title">供应商说明</h3>
            <button class="modal-close" @click="showProviderModal = false">&times;</button>
          </div>
          <div class="modal-body">
            <div class="provider-section">
              <h4 class="provider-section-title">OpenCode（云端）</h4>
              <p class="card-desc">
                提供 GPT、Claude、Gemini、MiniMax 等多家大模型的统一接入，免费额度友好，接口兼容 OpenAI SDK。
              </p>
              <div class="provider-notes">
                <ul>
                  <li>文档：<a href="https://opencode.ai/zen/v1/models" target="_blank">https://opencode.ai/zen/v1/models</a></li>
                  <li>免费额度：多数模型提供免费限额，详见官方公告。</li>
                  <li>SDK：兼容 <code>@ai-sdk/openai</code>、<code>@ai-sdk/anthropic</code>、<code>@ai-sdk/google</code> 等包。</li>
                  <li><b>GPT 系列</b>：使用 Responses API，支持 GPT 5.x 全系列，推理能力强但延迟较高</li>
                  <li><b>Claude 系列</b>：使用 Messages API，Opus 擅长复杂推理，Haiku 轻量快速</li>
                  <li><b>Gemini 系列</b>：Google 多模态模型，Pro 适合综合任务，Flash 速度优先</li>
                  <li><b>MiniMax</b>：国产模型，中文能力强，M2.5 Free 免费可用，弹幕场景推荐</li>
                  <li><b>GLM</b>：智谱清言模型，中文理解优秀，适合直播互动场景</li>
                  <li><b>Kimi K2.5</b>：月之暗面长上下文模型，知识面广</li>
                  <li><b>温度</b>：建议 0.6~0.8，保持回复多样性但不过于随机</li>
                </ul>
              </div>
            </div>

            <div class="provider-section">
              <h4 class="provider-section-title">Ollama（本地）</h4>
              <p class="card-desc">
                使用本地 Ollama 服务，无需 API Key，模型从本地实例自动拉取。确保 Ollama 已启动并拉取了模型。
              </p>
              <div class="provider-notes">
                <ul>
                  <li>无需 API Key，本地运行，数据不出本机</li>
                  <li>确保 Ollama 已启动：<code>ollama serve</code></li>
                  <li>拉取模型：<code>ollama pull qwen3.5:9b</code></li>
                  <li>支持自定义地址（可指向局域网内其他机器）</li>
                  <li><b>Thinking 模型</b>（qwen3、deepseek-r1 等）推理过程消耗大量 token，<b>最大 Token 数建议 ≥ 2048</b>，否则回复会被截断为空</li>
                  <li><b>模型保活时间</b>：默认 "5m"，设为 "30m" 可减少模型冷启动延迟</li>
                  <li><b>温度</b>：弹幕场景建议 0.5~0.8，太低回复重复，太高回复发散</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
@import "../styles/model-settings.css";
</style>
