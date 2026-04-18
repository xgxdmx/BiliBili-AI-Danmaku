<script setup lang="ts">
import { ref, onMounted, reactive } from "vue";

interface ConfigDisplay {
  room: { roomId: number; enabled: boolean; minMedalLevel: number };
  credentials: { sessdata: string; biliJct: string; buvid3: string };
  keywords: Array<{ id: string; pattern: string; type: string; enabled: boolean; caseSensitive: boolean; scope: string }>;
  quickReplies: Array<{ id: string; enabled: boolean; contains: string[]; notContains: string[]; regex: string; reply: string; caseSensitive: boolean; cooldownMs: number }>;
  aiModel: {
    provider: string;
    modelId: string;
    endpoint: string;
    prompt: string;
    sendIntervalMs: number;
    maxPending: number;
    ignoreUsernames: string[];
    skipReplies: string[];
    ollamaBaseUrl?: string;
  };
}

const config = reactive<ConfigDisplay>({
  room: { roomId: 0, enabled: true, minMedalLevel: 0 },
  credentials: { sessdata: "", biliJct: "", buvid3: "" },
  keywords: [],
  quickReplies: [],
  aiModel: {
    provider: "",
    modelId: "",
    endpoint: "",
    prompt: "",
    sendIntervalMs: 1800,
    maxPending: 100,
    ignoreUsernames: [],
    skipReplies: [],
  },
});

const loading = ref(false);
const message = ref("");
const messageType = ref<"success" | "error" | "">("");
const showCredentials = ref(false);

onMounted(async () => {
  try {
    const data = await window.danmakuAPI?.getConfig() as ConfigDisplay;
    if (data) {
      config.room = data.room;
      config.credentials = data.credentials;
      config.keywords = data.keywords;
      config.quickReplies = (data as any).quickReplies || [];
      config.aiModel = data.aiModel;
    }
  } catch (e) {
    }
});

async function handleExport() {
  loading.value = true;
  message.value = "";
  messageType.value = "";
  try {
    const result = await window.danmakuAPI?.exportConfig();
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
      <h2 class="page-title">开发者设置</h2>
    </div>

    <div class="card">
      <h3 class="card-title">配置导出</h3>
      <p class="card-desc">将加密配置导出为明文 JSON 文件，或从 JSON 文件导入并立即生效。</p>
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
          <span class="config-label">供应商:</span>
          <span class="config-value">{{ config.aiModel.provider || '未设置' }}</span>
        </div>
        <div v-if="config.aiModel.provider === 'ollama' && config.aiModel.ollamaBaseUrl" class="config-item">
          <span class="config-label">Ollama地址:</span>
          <span class="config-value">{{ config.aiModel.ollamaBaseUrl }}</span>
        </div>
        <div class="config-item">
          <span class="config-label">模型:</span>
          <span class="config-value">{{ config.aiModel.modelId || '未设置' }}</span>
        </div>
        <div class="config-item">
          <span class="config-label">间隔(ms):</span>
          <span class="config-value">{{ config.aiModel.sendIntervalMs }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import "../styles/dev.css";
</style>
