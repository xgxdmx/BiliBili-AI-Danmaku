<script setup lang="ts">
import { reactive, ref, computed, onMounted, watch, onUnmounted } from "vue";

interface ProviderModel {
  id: string;
  name: string;
  endpoint: string;
}

interface ProviderOption {
  id: string;
  name: string;
  description: string;
  endpoint: string;
  docUrl: string;
  models: ProviderModel[];
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
    models: [
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
      { id: "minimax-m2.5", name: "MiniMax M2.5", endpoint: "https://opencode.ai/zen/v1/chat/completions" },
      { id: "minimax-m2.5-free", name: "MiniMax M2.5 Free", endpoint: "https://opencode.ai/zen/v1/chat/completions" },
      { id: "glm-5.1", name: "GLM 5.1", endpoint: "https://opencode.ai/zen/v1/chat/completions" },
      { id: "glm-5", name: "GLM 5", endpoint: "https://opencode.ai/zen/v1/chat/completions" },
      { id: "kimi-k2.5", name: "Kimi K2.5", endpoint: "https://opencode.ai/zen/v1/chat/completions" },
      { id: "big-pickle", name: "Big Pickle", endpoint: "https://opencode.ai/zen/v1/chat/completions" },
      { id: "mimo-v2-pro-free", name: "MiMo V2 Pro Free", endpoint: "https://opencode.ai/zen/v1/chat/completions" },
      { id: "mimo-v2-omni-free", name: "MiMo V2 Omni Free", endpoint: "https://opencode.ai/zen/v1/chat/completions" },
      { id: "qwen3.6-plus-free", name: "Qwen 3.6 Plus Free", endpoint: "https://opencode.ai/zen/v1/chat/completions" },
      { id: "nemotron-3-super-free", name: "Nemotron 3 Super Free", endpoint: "https://opencode.ai/zen/v1/chat/completions" },
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
});

// Ollama 动态模型列表
const ollamaModels = ref<ProviderModel[]>([]);
const ollamaLoading = ref(false);
const ollamaError = ref<string | null>(null);
const ollamaBaseUrl = ref("http://localhost:11434");

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

const selectedProvider = computed(() => providerOptions.find((p) => p.id === form.provider) || providerOptions[0]);
const modelOptions = computed(() => {
  // Ollama 使用动态拉取的模型列表
  if (form.provider === "ollama") {
    return ollamaModels.value.length > 0 ? ollamaModels.value : [];
  }
  return selectedProvider.value.models;
});

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

watch(
  () => form.provider,
  (providerId) => {
    const provider = providerOptions.find((p) => p.id === providerId);
    if (!provider) return;
    form.endpoint = provider.endpoint;
    // Ollama: 自动拉取模型列表，API Key 留空，Endpoint 由地址栏驱动
    if (providerId === "ollama") {
      form.apiKey = "";
      form.endpoint = `${ollamaBaseUrl.value.replace(/\/+$/, "")}/v1/chat/completions`;
      fetchOllamaModelList();
    } else if (!provider.models.some((m) => m.id === form.modelId)) {
      form.modelId = provider.models[0]?.id || "";
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
    // Ollama 模型切换由 ollamaBaseUrl watch 处理，不走 provider.models
    if (form.provider === "ollama") return;
    const provider = selectedProvider.value;
    const model = provider.models.find((m) => m.id === modelId);
    if (model) {
      form.endpoint = model.endpoint;
    }
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
      // 先恢复 ollamaBaseUrl，避免 provider watch 触发时地址还是默认值
      if (cfg.aiModel.ollamaBaseUrl) {
        ollamaBaseUrl.value = cfg.aiModel.ollamaBaseUrl;
      }
      form.provider = cfg.aiModel.provider || form.provider;
      form.apiKey = cfg.aiModel.apiKey || "";
      form.modelId = cfg.aiModel.modelId || form.modelId;
      form.endpoint = cfg.aiModel.endpoint || form.endpoint;
      form.prompt = cfg.aiModel.prompt || form.prompt;
      lastSavedPrompt.value = form.prompt;
      form.sendIntervalMs = Number(cfg.aiModel.sendIntervalMs || form.sendIntervalMs);
      form.maxPending = Number(cfg.aiModel.maxPending || form.maxPending);
      form.ignoreUsernames = Array.isArray(cfg.aiModel.ignoreUsernames) ? cfg.aiModel.ignoreUsernames : [];
      form.skipReplies = Array.isArray(cfg.aiModel.skipReplies) && cfg.aiModel.skipReplies.length > 0
        ? cfg.aiModel.skipReplies
        : form.skipReplies;
      skipRepliesText.value = form.skipReplies.join("\n");
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
}

async function handleSave() {
  const api = window.danmakuAPI;
  if (!api) return;
  errorMsg.value = null;
  saving.value = true;
  try {
    const payload = JSON.parse(JSON.stringify({
      provider: form.provider,
      apiKey: form.apiKey,
      modelId: form.modelId,
      endpoint: form.endpoint,
      prompt: form.prompt,
      sendIntervalMs: Math.max(500, Number(form.sendIntervalMs || 1800)),
      maxPending: Math.max(10, Number(form.maxPending || 100)),
      ignoreUsernames: form.ignoreUsernames,
      skipReplies: parseSkipRepliesText(),
      ollamaBaseUrl: ollamaBaseUrl.value,
    }));
    const result = await api.setConfig("aiModel", payload);
    if (result?.status !== "ok") {
      throw new Error((result as any)?.message || "保存失败");
    }
    saved.value = true;
    setTimeout(() => (saved.value = false), 2000);
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
    const saveResult = await api.setConfig("aiModel", JSON.parse(JSON.stringify({
      provider: form.provider,
      apiKey: form.apiKey,
      modelId: form.modelId,
      endpoint: form.endpoint,
      prompt: form.prompt,
      sendIntervalMs: Math.max(500, Number(form.sendIntervalMs || 1800)),
      maxPending: Math.max(10, Number(form.maxPending || 100)),
      ignoreUsernames: form.ignoreUsernames,
      skipReplies: parseSkipRepliesText(),
      ollamaBaseUrl: ollamaBaseUrl.value,
    })));
    if (saveResult?.status !== "ok") {
      throw new Error("连接前保存配置失败，请先点击「保存供应商配置」");
    }
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
        <select v-model="form.provider" class="field-input">
          <option v-for="provider in providerOptions" :key="provider.id" :value="provider.id">
            {{ provider.name }}
          </option>
        </select>
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
          <div v-if="ollamaModels.length > 0" class="msg-inline msg-success" style="margin-top:6px">已获取 {{ ollamaModels.length }} 个模型</div>
        </div>

        <div class="field">
          <label class="field-label">模型</label>
          <select v-model="form.modelId" class="field-input">
            <option v-for="model in modelOptions" :key="model.id" :value="model.id">
              {{ model.name }}
            </option>
          </select>
          <div v-if="modelOptions.length === 0 && !ollamaLoading" class="msg-inline" style="margin-top:4px">请先点击「刷新模型」拉取本地模型列表</div>
        </div>
      </template>

      <!-- 非 Ollama: 固定模型列表 + API Key -->
      <template v-else>
        <div class="field">
          <label class="field-label">模型</label>
          <select v-model="form.modelId" class="field-input">
            <option v-for="model in modelOptions" :key="model.id" :value="model.id">
              {{ model.name }} ({{ model.id }})
            </option>
          </select>
        </div>

        <div class="field">
          <label class="field-label">API Key</label>
          <input v-model="form.apiKey" type="password" placeholder="输入从供应商控制台获取的 API Key" class="field-input" />
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
          {{ saving ? "保存中..." : "保存供应商配置" }}
        </button>
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

      <div class="field" style="margin-top: 12px;">
        <label class="field-label">AI 返回预览（发送前/跳过都会记录）</label>
        <div class="btn-row" style="margin-bottom: 8px;">
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

    <div class="card">
      <h3 class="card-title">供应商说明 - {{ selectedProvider.name }}</h3>
      <p class="card-desc">
        {{ selectedProvider.description }}
      </p>
      <template v-if="form.provider === 'ollama'">
        <ul class="card-desc">
          <li>无需 API Key，本地运行，数据不出本机</li>
          <li>确保 Ollama 已启动：<code>ollama serve</code></li>
          <li>拉取模型：<code>ollama pull llama3</code></li>
          <li>支持自定义地址（可指向局域网内其他机器）</li>
        </ul>
      </template>
      <template v-else>
        <ul class="card-desc">
          <li>文档：<a :href="selectedProvider.docUrl" target="_blank">{{ selectedProvider.docUrl }}</a></li>
          <li>免费额度：多数模型提供免费限额，详见官方公告。</li>
          <li>SDK：兼容 <code>@ai-sdk/openai</code>、<code>@ai-sdk/anthropic</code>、<code>@ai-sdk/google</code> 等包。</li>
        </ul>
      </template>
    </div>
  </div>
</template>

<style scoped>
@import "../styles/model-settings.css";

/* ─── AI Flow Diagram ─── */
.flow { display: flex; align-items: center; gap: 8px; padding: 8px 0; }
.flow-step { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.flow-icon { font-size: 24px; }
.flow-text { font-size: 11px; color: var(--text-secondary); }
.flow-arrow { color: var(--text-muted); font-size: 16px; }

/* ─── Code Block ─── */
.code-block {
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 10px 14px;
  font-family: "Cascadia Code", "Consolas", monospace;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.6;
}

/* ─── Ollama ─── */
.ollama-url-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.ollama-url-input {
  flex: 1;
  min-width: 0;
}

.ollama-fetch-btn {
  white-space: nowrap;
  flex-shrink: 0;
}

.field-inline-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.prompt-textarea {
  min-height: 150px;
  resize: vertical;
  line-height: 1.6;
}

.runtime-status {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 12px;
  margin-top: 10px;
  color: var(--text-muted);
  font-size: 12px;
}

.runtime-item b {
  color: var(--text-primary);
  font-weight: 600;
}

.decision-list {
  max-height: 260px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px;
  background: var(--bg-secondary);
}

.decision-item {
  border-bottom: 1px dashed var(--border);
  padding: 8px 4px;
}

.decision-item:last-child {
  border-bottom: none;
}

.decision-head {
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
}

.decision-head-right {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.copy-btn {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  border-radius: 6px;
  padding: 2px 8px;
  cursor: pointer;
  font-size: 12px;
}

.copy-btn:hover {
  color: var(--text-primary);
  border-color: var(--accent);
}

.decision-time {
  font-size: 12px;
  color: var(--text-muted);
}

.decision-action {
  font-size: 12px;
  font-weight: 600;
}

.decision-action.a-pending_send { color: #e0af68; }
.decision-action.a-sent { color: #9ece6a; }
.decision-action.a-skipped { color: #7aa2f7; }
.decision-action.a-error { color: #f7768e; }
.decision-action.a-cleared { color: #bb9af7; }

.decision-line {
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
  word-break: break-word;
}

.decision-reason {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 2px;
}

.card-desc ul {
  margin: 6px 0 0 16px;
  padding: 0;
}

.card-desc li {
  line-height: 1.6;
}

.card-desc a {
  color: var(--accent);
  text-decoration: none;
}

.card-desc a:hover {
  text-decoration: underline;
}

@media (max-width: 900px) {
  .field-inline-2 {
    grid-template-columns: 1fr;
  }

  .runtime-status {
    grid-template-columns: 1fr;
  }
}
</style>
