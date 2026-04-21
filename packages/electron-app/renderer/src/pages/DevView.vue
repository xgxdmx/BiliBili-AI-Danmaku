<script setup lang="ts">
import { ref, onMounted, reactive } from "vue";

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

interface ConfigDisplay {
  room: { roomId: number; enabled: boolean; minMedalLevel: number };
  credentials: { sessdata: string; biliJct: string; buvid3: string };
  keywords: Array<{ id: string; pattern: string; type: string; enabled: boolean; caseSensitive: boolean; scope: string }>;
  quickRepliesEnabled: boolean;
  quickReplies: Array<{ id: string; enabled: boolean; contains: string[]; notContains: string[]; regex: string; reply: string; caseSensitive: boolean; cooldownMs: number }>;
  aiModel: {
    provider: string;
    prompt: string;
    sendIntervalMs: number;
    maxPending: number;
    providers: Record<string, ProviderConfig>;
  };
}

const config = reactive<ConfigDisplay>({
  room: { roomId: 0, enabled: true, minMedalLevel: 0 },
  credentials: { sessdata: "", biliJct: "", buvid3: "" },
  keywords: [],
  quickRepliesEnabled: false,
  quickReplies: [],
  aiModel: {
    provider: "",
    prompt: "",
    sendIntervalMs: 1800,
    maxPending: 100,
    providers: {},
  },
});

const loading = ref(false);
const message = ref("");
const messageType = ref<"success" | "error" | "">("");
const showCredentials = ref(false);
const exportIncludeSensitive = ref(false);

onMounted(async () => {
  try {
    const data = await window.danmakuAPI?.getConfig() as any;
    if (data) {
      config.room = data.room || config.room;
      config.credentials = data.credentials || config.credentials;
      config.keywords = Array.isArray(data.keywords) ? data.keywords : [];
      config.quickRepliesEnabled = data.quickRepliesEnabled === true;
      config.quickReplies = Array.isArray(data.quickReplies) ? data.quickReplies : [];
      if (data.aiModel) {
        config.aiModel = {
          provider: data.aiModel.provider || "",
          prompt: data.aiModel.prompt || "",
          sendIntervalMs: data.aiModel.sendIntervalMs || 1800,
          maxPending: data.aiModel.maxPending || 100,
          providers: data.aiModel.providers || {},
        };
      }
    }
  } catch (e) {
    }
});

async function handleExport() {
  loading.value = true;
  message.value = "";
  messageType.value = "";
  try {
    const result = await window.danmakuAPI?.exportConfig({ includeSensitive: exportIncludeSensitive.value });
    if (result?.status === "ok") {
      message.value = `已导出到: ${result.path}`;
      messageType.value = "success";
    } else if (result?.status === "cancelled") {
      message.value = "已取消导出";
      messageType.value = "";
    } else {
      message.value = `导出失败: ${result?.error}`;
      messageType.value = "error";
    }
  } catch (e) {
    message.value = `导出失败: ${String(e)}`;
    messageType.value = "error";
  }
  loading.value = false;
  setTimeout(() => { message.value = ""; messageType.value = ""; }, 5000);
}

async function handleImport() {
  // 使用 dialog 选择文件
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async (e: any) => {
    const file = e.target.files[0];
    if (!file) return;
    
    loading.value = true;
    message.value = "";
    try {
      const text = await file.text();
      const result = await window.danmakuAPI?.importConfigContent(text);
      if (result?.status !== "ok") {
        message.value = `导入失败: ${result?.error || "文件格式不正确"}`;
        messageType.value = "error";
        loading.value = false;
        return;
      }

      message.value = "导入成功（支持 plain-v1 / encrypted-v1）";
      messageType.value = "success";
      // 重新加载配置显示
      const data = await window.danmakuAPI?.getConfig() as ConfigDisplay;
      if (data) {
        config.room = data.room;
        config.credentials = data.credentials;
        config.keywords = data.keywords;
        config.quickRepliesEnabled = data.quickRepliesEnabled === true;
        config.quickReplies = data.quickReplies;
        config.aiModel = data.aiModel;
      }
    } catch (e) {
      message.value = `导入失败: ${String(e)}`;
      messageType.value = "error";
    }
    loading.value = false;
    setTimeout(() => { message.value = ""; messageType.value = ""; }, 5000);
  };
  input.click();
}
</script>

<template>
  <div class="page">
    <div class="page-header">
      <h2 class="page-title">应用配置文件管理</h2>
    </div>

    <div class="card">
      <h3 class="card-title">应用配置管理</h3>
      <p class="card-desc">将加密配置导出为明文 JSON 文件，或从 JSON 文件导入并立即生效。</p>
      <p class="card-desc">如需导出包含敏感信息的配置文件，请打开下方配置开关。</p>
      <div class="export-option">
        <div class="export-option-info">
          <span class="export-option-label">配置文件是否包含敏感信息</span>
          <span class="export-option-desc">模型API Key、B站登录 Cookie 等凭证数据</span>
        </div>
        <label class="toggle-pill" :class="{ active: exportIncludeSensitive }">
          <input v-model="exportIncludeSensitive" type="checkbox" class="toggle-input" />
          <span class="toggle-track">
            <span class="toggle-knob"></span>
          </span>
        </label>
      </div>
      <div class="btn-row">
        <button class="btn btn-accent" :disabled="loading" @click="handleExport">
          {{ loading ? "处理中..." : "导出配置" }}
        </button>
        <button class="btn btn-muted" :disabled="loading" @click="handleImport">
          {{ loading ? "处理中..." : "导入配置" }}
        </button>
      </div>
      <span v-if="message" class="msg" :class="messageType === 'success' ? 'msg-success' : messageType === 'error' ? 'msg-error' : ''" style="margin-top:8px;display:block">{{ message }}</span>
    </div>

    <div class="card">
      <h3 class="card-title">当前配置预览</h3>
      
      <div class="config-section">
        <h4 class="section-title">直播间</h4>
        <div class="config-item">
          <span class="config-label">房间号:</span>
          <span class="config-value">{{ config.room.roomId || '未设置' }}</span>
        </div>
        <div class="config-item">
          <span class="config-label">启用:</span>
          <span class="config-value">{{ config.room.enabled ? '是' : '否' }}</span>
        </div>
        <div class="config-item">
          <span class="config-label">最低粉丝牌等级:</span>
          <span class="config-value">{{ config.room.minMedalLevel || 0 }}</span>
        </div>
      </div>

      <div class="config-section">
        <h4 class="section-title">凭证 (已脱敏)</h4>
        <div class="config-item">
          <span class="config-label">SESSDATA:</span>
          <span class="config-value">{{ showCredentials ? config.credentials.sessdata : '••••••••' }}</span>
        </div>
        <div class="config-item">
          <span class="config-label">bili_jct:</span>
          <span class="config-value">{{ showCredentials ? config.credentials.biliJct : '••••••••' }}</span>
        </div>
        <button class="btn btn-small" @click="showCredentials = !showCredentials">
          {{ showCredentials ? '隐藏' : '显示' }}
        </button>
      </div>

      <div class="config-section">
        <h4 class="section-title">关键词 ({{ config.keywords.length }})</h4>
        <div v-if="config.keywords.length === 0" class="empty-text">暂无关键词</div>
        <div v-else class="keyword-list">
          <div v-for="kw in config.keywords" :key="kw.id" class="keyword-item">
            <span class="kw-pattern">{{ kw.pattern }}</span>
            <span class="kw-type">{{ kw.type }}</span>
            <span class="kw-enabled">{{ kw.enabled ? '启用' : '禁用' }}</span>
            <span class="kw-case">{{ kw.caseSensitive ? '区分大小写' : '不区分' }}</span>
          </div>
        </div>
      </div>

      <div class="config-section">
        <h4 class="section-title">AI模型</h4>
        <div class="config-item">
          <span class="config-label">当前供应商:</span>
          <span class="config-value">{{ config.aiModel.provider || '未设置' }}</span>
        </div>
        <div class="config-item">
          <span class="config-label">发送间隔(ms):</span>
          <span class="config-value">{{ config.aiModel.sendIntervalMs }}</span>
        </div>
        <div class="config-item">
          <span class="config-label">最大队列:</span>
          <span class="config-value">{{ config.aiModel.maxPending }}</span>
        </div>
        <!-- 遍历每个供应商的独立配置 -->
        <div v-for="(pc, pid) in config.aiModel.providers" :key="pid" class="provider-block">
          <h5 class="provider-title">{{ pid === 'opencode' ? 'OpenCode' : pid === 'ollama' ? 'Ollama' : pid }}</h5>
          <div class="config-item">
            <span class="config-label">模型:</span>
            <span class="config-value">{{ pc.modelId || '未设置' }}</span>
          </div>
          <div class="config-item">
            <span class="config-label">端点:</span>
            <span class="config-value">{{ pc.endpoint || '默认' }}</span>
          </div>
          <div v-if="pid === 'ollama' && pc.ollamaBaseUrl" class="config-item">
            <span class="config-label">Ollama地址:</span>
            <span class="config-value">{{ pc.ollamaBaseUrl }}</span>
          </div>
          <div class="config-item">
            <span class="config-label">温度:</span>
            <span class="config-value">{{ pc.temperature }}</span>
          </div>
          <div class="config-item">
            <span class="config-label">Top P:</span>
            <span class="config-value">{{ pc.topP }}</span>
          </div>
          <div class="config-item">
            <span class="config-label">最大Token:</span>
            <span class="config-value">{{ pc.maxTokens }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import "../styles/dev.css";

/* ─── 导出选项行 ─── */
.export-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 10px 0 14px;
  padding: 10px 12px;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 6px;
}

.export-option-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.export-option-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.export-option-desc {
  font-size: 11px;
  color: var(--text-muted);
}

/* ─── Toggle Pill ─── */
.toggle-pill {
  display: flex;
  align-items: center;
  cursor: pointer;
  flex-shrink: 0;
}

.toggle-input {
  position: absolute;
  opacity: 0;
  width: 1px;
  height: 1px;
  pointer-events: none;
}

.toggle-track {
  position: relative;
  width: 36px;
  height: 20px;
  border-radius: 999px;
  background: var(--bg-active);
  transition: background 0.18s ease;
}

.toggle-pill.active .toggle-track {
  background: var(--accent);
}

.toggle-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #e8eeff;
  box-shadow: 0 1px 3px #00000040;
  transition: transform 0.18s ease;
}

.toggle-pill.active .toggle-knob {
  transform: translateX(16px);
}

/* ─── 供应商配置块 ─── */
.provider-block {
  margin-top: 10px;
  padding: 8px 10px;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 6px;
}

.provider-title {
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--accent);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
</style>
