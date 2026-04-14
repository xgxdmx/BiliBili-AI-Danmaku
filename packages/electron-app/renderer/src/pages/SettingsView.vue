<script setup lang="ts">
import { ref, reactive } from "vue";
// TODO: 类型定义需要从 shared 导入
// import type { KeywordRule, RoomConfig } from "@bilibili-danmaku-claw/shared";

interface KeywordRule {
  id: string;
  pattern: string;
  type: string;
  enabled: boolean;
  caseSensitive: boolean;
  description: string;
}

interface RoomConfig {
  roomId: number;
  name: string;
  keywords: string[];
  enabled: boolean;
  credentials: {
    sessdata: string;
    biliJct: string;
    buvid3: string;
  };
}

// ─── State ──────────────────────────────────────────────────

const activeTab = ref<"room" | "keywords">("room");

const roomConfig = reactive<RoomConfig>({
  roomId: 0,
  name: "",
  keywords: [],
  enabled: true,
  credentials: {
    sessdata: "",
    biliJct: "",
    buvid3: "",
  },
});

const keywordRules = reactive<KeywordRule[]>([
  {
    id: crypto.randomUUID(),
    pattern: "",
    type: "keyword",
    enabled: true,
    caseSensitive: false,
    description: "",
  },
]);

const rawCookie = ref(""); // 粘贴的原始Cookie
const isConnecting = ref(false);
const connectionError = ref("");

// 解析Cookie字符串
function parseCookie(cookieStr: string): boolean {
  if (!cookieStr) return false;
  
  try {
    // 解析 cookie 字符串
    const pairs = cookieStr.split(';').map(p => p.trim());
    for (const pair of pairs) {
      const [key, ...valueParts] = pair.split('=');
      const value = valueParts.join('=');
      
      if (key === 'SESSDATA') {
        roomConfig.credentials.sessdata = value;
      } else if (key === 'bili_jct') {
        roomConfig.credentials.biliJct = value;
      } else if (key === 'buvid3') {
        roomConfig.credentials.buvid3 = value;
      }
    }
    // 如果解析不到，尝试直接从整个字符串中查找
    if (!roomConfig.credentials.sessdata) {
      const sessMatch = cookieStr.match(/SESSDATA=([^;]+)/);
      if (sessMatch) roomConfig.credentials.sessdata = sessMatch[1];
    }
    if (!roomConfig.credentials.biliJct) {
      const biliMatch = cookieStr.match(/bili_jct=([^;]+)/);
      if (biliMatch) roomConfig.credentials.biliJct = biliMatch[1];
    }
    if (!roomConfig.credentials.buvid3) {
      const buvidMatch = cookieStr.match(/buvid3=([^;]+)/);
      if (buvidMatch) roomConfig.credentials.buvid3 = buvidMatch[1];
    }
    
    return !!(roomConfig.credentials.sessdata && roomConfig.credentials.biliJct);
  } catch {
    return false;
  }
}

// 粘贴Cookie后自动解析
function handleCookiePaste() {
  if (parseCookie(rawCookie.value)) {
    rawCookie.value = ""; // 解析成功后清除
  }
}

// ─── 事件处理 ────────────────────────────────────────────────

async function handleConnect(): Promise<void> {
  if (!roomConfig.roomId) {
    connectionError.value = "请输入直播间房间号";
    return;
  }
  if (!roomConfig.credentials.sessdata || !roomConfig.credentials.biliJct) {
    connectionError.value = "请填写 SESSDATA 和 bili_jct";
    return;
  }

  isConnecting.value = true;
  connectionError.value = "";

  try {
    await window.danmakuAPI.start({
      roomId: roomConfig.roomId,
      credentials: roomConfig.credentials,
      keywords: keywordRules.filter((r) => r.pattern),
    });
  } catch (err: any) {
    connectionError.value = err.message || "连接失败";
  } finally {
    isConnecting.value = false;
  }
}

async function handleDisconnect(): Promise<void> {
  try {
    await window.danmakuAPI.stop();
  } catch (err: any) {
    connectionError.value = err.message || "断开失败";
  }
}

function addKeywordRule(): void {
  keywordRules.push({
    id: crypto.randomUUID(),
    pattern: "",
    type: "keyword",
    enabled: true,
    caseSensitive: false,
    description: "",
  });
}

function removeKeywordRule(index: number): void {
  keywordRules.splice(index, 1);
}

async function saveKeywords(): Promise<void> {
  try {
    await window.danmakuAPI.updateKeywords(keywordRules.filter((r) => r.pattern));
    connectionError.value = "";
  } catch (err: any) {
    connectionError.value = err.message || "保存关键词失败";
  }
}

// ─── 标签页 ────────────────────────────────────────────────

const tabs = [
  { key: "room" as const, label: "直播间" },
  { key: "keywords" as const, label: "关键词" },
];
</script>

<template>
  <div class="settings-view">
    <!-- 标签切换 -->
    <div class="tab-bar">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        :class="['tab-btn', { active: activeTab === tab.key }]"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- 错误提示 -->
    <div v-if="connectionError" class="error-toast">
      {{ connectionError }}
    </div>

    <!-- 直播间设置 -->
    <div v-if="activeTab === 'room'" class="tab-content">
      <h3 class="section-title">直播间连接</h3>

      <div class="form-group">
        <label class="form-label">房间号</label>
        <input
          v-model.number="roomConfig.roomId"
          type="number"
          placeholder="请输入B站直播间房间号"
          class="form-input"
        />
      </div>

      <h4 class="sub-title">B站登录凭证</h4>
      <p class="form-hint">
        从浏览器 Cookie 中获取：
        <code>SESSDATA</code>、<code>bili_jct</code>、<code>buvid3</code>
        或直接粘贴完整 Cookie 字符串
      </p>

      <!-- 粘贴Cookie -->
      <div class="form-group">
        <label class="form-label">粘贴Cookie (自动识别)</label>
        <textarea
          v-model="rawCookie"
          placeholder="从浏览器开发者工具→Application→Cookies 复制整段Cookie粘贴至此"
          rows="2"
        ></textarea>
        <button class="btn btn-secondary" @click="handleCookiePaste" style="margin-top: 8px;">
          识别Cookie
        </button>
      </div>

      <div class="form-group">
        <label class="form-label">SESSDATA</label>
        <input
          v-model="roomConfig.credentials.sessdata"
          type="password"
          placeholder="从 Cookie 中复制"
          class="form-input"
        />
      </div>

      <div class="form-group">
        <label class="form-label">bili_jct</label>
        <input
          v-model="roomConfig.credentials.biliJct"
          type="password"
          placeholder="从 Cookie 中复制"
          class="form-input"
        />
      </div>

      <div class="form-group">
        <label class="form-label">buvid3</label>
        <input
          v-model="roomConfig.credentials.buvid3"
          type="text"
          placeholder="从 Cookie 中复制 (可选)"
          class="form-input"
        />
      </div>

      <div class="btn-group">
        <button
          class="btn btn-primary"
          :disabled="isConnecting"
          @click="handleConnect"
        >
          {{ isConnecting ? "连接中..." : "开始监听" }}
        </button>
        <button class="btn btn-danger" @click="handleDisconnect">
          停止监听
        </button>
      </div>
    </div>

    <!-- 关键词设置 -->
    <div v-if="activeTab === 'keywords'" class="tab-content">
      <h3 class="section-title">关键词过滤规则</h3>
      <p class="form-hint">
        匹配到关键词的弹幕会推送给你配置的大模型处理并自动回复
      </p>

      <div
        v-for="(rule, index) in keywordRules"
        :key="rule.id"
        class="keyword-rule"
      >
        <div class="rule-row">
          <select v-model="rule.type" class="form-select rule-type">
            <option value="keyword">关键词</option>
            <option value="regex">正则</option>
          </select>

          <input
            v-model="rule.pattern"
            :placeholder="rule.type === 'keyword' ? '输入关键词...' : '输入正则表达式...'"
            class="form-input rule-pattern"
          />

          <label v-if="rule.type === 'keyword'" class="checkbox-label">
            <input type="checkbox" v-model="rule.caseSensitive" />
            区分大小写
          </label>

          <label class="checkbox-label">
            <input type="checkbox" v-model="rule.enabled" />
            启用
          </label>

          <button class="btn-icon btn-danger-sm" @click="removeKeywordRule(index)">
            ✕
          </button>
        </div>

        <input
          v-model="rule.description"
          type="text"
          placeholder="备注说明 (可选)"
          class="form-input rule-desc"
        />
      </div>

      <button class="btn btn-secondary" @click="addKeywordRule">
        + 添加规则
      </button>

      <div class="btn-group">
        <button class="btn btn-primary" @click="saveKeywords">
          保存并应用
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-view {
  max-width: 800px;
  margin: 0 auto;
}

.tab-bar {
  display: flex;
  gap: 0;
  border-bottom: 1px solid #30363d;
  margin-bottom: 20px;
}

.tab-btn {
  padding: 10px 20px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: #8b949e;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.tab-btn:hover {
  color: #e6edf3;
}

.tab-btn.active {
  color: #58a6ff;
  border-bottom-color: #58a6ff;
}

.tab-content {
  padding: 8px 0;
}

.section-title {
  font-size: 18px;
  font-weight: 600;
  margin: 0 0 16px 0;
}

.sub-title {
  font-size: 14px;
  font-weight: 500;
  margin: 20px 0 8px 0;
  color: #8b949e;
}

.form-group {
  margin-bottom: 16px;
}

.form-label {
  display: block;
  font-size: 13px;
  color: #8b949e;
  margin-bottom: 6px;
}

.form-input {
  width: 100%;
  padding: 8px 12px;
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 6px;
  color: #e6edf3;
  font-size: 14px;
  box-sizing: border-box;
}

.form-input:focus {
  outline: none;
  border-color: #58a6ff;
}

.form-select {
  padding: 8px 12px;
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 6px;
  color: #e6edf3;
  font-size: 14px;
}

.form-hint {
  font-size: 13px;
  color: #484f58;
  margin: 0 0 12px 0;
}

/* 强制显示 textarea */
.settings-view textarea {
  display: block !important;
  width: 100%;
  min-height: 60px;
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 6px;
  color: #e6edf3;
  font-size: 14px;
  font-family: monospace;
  padding: 8px 12px;
  box-sizing: border-box;
  resize: vertical;
}

.settings-view textarea:focus {
  outline: none;
  border-color: #58a6ff;
}

.form-hint code {
  background: #1f2937;
  padding: 2px 6px;
  border-radius: 3px;
  color: #d2a8ff;
  font-size: 12px;
}

.form-textarea {
  width: 100%;
  padding: 8px 12px;
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 6px;
  color: #e6edf3;
  font-size: 14px;
  box-sizing: border-box;
  font-family: monospace;
  resize: vertical;
}

.form-textarea:focus {
  outline: none;
  border-color: #58a6ff;
}

.error-toast {
  padding: 10px 16px;
  background: #f8514920;
  border: 1px solid #f8514940;
  border-radius: 6px;
  color: #f85149;
  font-size: 13px;
  margin-bottom: 16px;
}

.btn-group {
  display: flex;
  gap: 12px;
  margin-top: 20px;
}

.btn {
  padding: 8px 20px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: #238636;
  color: #fff;
}

.btn-primary:hover:not(:disabled) {
  background: #2ea043;
}

.btn-danger {
  background: #da3633;
  color: #fff;
}

.btn-danger:hover {
  background: #f85149;
}

.btn-secondary {
  background: #1f2937;
  color: #e6edf3;
  border: 1px solid #30363d;
}

.btn-secondary:hover {
  background: #2d333b;
}

.keyword-rule {
  padding: 12px;
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 8px;
  margin-bottom: 12px;
}

.rule-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.rule-type {
  min-width: 100px;
}

.rule-pattern {
  flex: 1;
}

.rule-desc {
  margin-top: 8px;
  font-size: 13px;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: #8b949e;
  white-space: nowrap;
}

.btn-icon {
  background: none;
  border: none;
  font-size: 16px;
  cursor: pointer;
  padding: 4px 8px;
}

.btn-danger-sm {
  color: #f85149;
}

.btn-danger-sm:hover {
  color: #ff7b72;
}
</style>