<script setup lang="ts">
import { reactive, ref, onMounted } from "vue";

interface Rule {
  id: string;
  pattern: string;
  type: "keyword" | "regex";
  enabled: boolean;
  caseSensitive: boolean;
  scope: "both" | "quickReply" | "ai";
}

interface QuickReply {
  id: string;
  enabled: boolean;
  contains: string[];
  notContains: string[];
  regex: string;
  reply: string;
  caseSensitive: boolean;
  cooldownMs: number;
}

// 临时输入区的规则（每次添加新规则用）
const inputRules = reactive<Rule[]>([
  { id: crypto.randomUUID(), pattern: "", type: "keyword", enabled: true, caseSensitive: false, scope: "both" },
]);

// 已保存的关键词列表
const savedRules = ref<Rule[]>([]);

// 固定回复规则
const quickReplies = ref<QuickReply[]>([]);
const qrContainsText = ref("");
const qrNotContainsText = ref("");
const qrRegex = ref("");
const qrReply = ref("");
const qrCaseSensitive = ref(false);
const qrCooldown = ref(0);
const qrSaved = ref(false);
const qrError = ref("");

const captureEnabled = ref(true);
const saved = ref(false);
const saveError = ref("");
const ignoreUsersText = ref("");
const ignoreSaved = ref(false);
const ignoreError = ref("");
const minMedalLevel = ref(0);
const medalSaved = ref(false);
const medalError = ref("");

// 页面加载时从配置读取已保存的关键词
onMounted(async () => {
  try {
    const config = await window.danmakuAPI?.getConfig();
    if (config?.keywords && config.keywords.length > 0) {
      savedRules.value = [...config.keywords];
    }
    const names = config?.aiModel?.ignoreUsernames;
    if (Array.isArray(names) && names.length > 0) {
      ignoreUsersText.value = names.join("\n");
    }
    minMedalLevel.value = Number(config?.room?.minMedalLevel || 0);
    // 读取捕捉开关状态（默认 true）
    captureEnabled.value = config?.room?.captureEnabled !== false;
    if (Array.isArray(config?.quickReplies) && config.quickReplies.length > 0) {
      quickReplies.value = [...config.quickReplies];
    }
  } catch (e) {
    }
});

async function saveMinMedalLevel() {
  medalError.value = "";
  try {
    const level = Math.max(0, Number(minMedalLevel.value || 0));
    minMedalLevel.value = level;
    await window.danmakuAPI?.setConfig("room.minMedalLevel", level);
    await window.danmakuAPI?.updateMinMedalLevel(level);
    medalSaved.value = true;
    setTimeout(() => {
      medalSaved.value = false;
    }, 1800);
  } catch (e) {
    medalError.value = "保存失败: " + String(e);
  }
}

function parseIgnoreUsers(): string[] {
  const tokens = ignoreUsersText.value
    .split(/[\n,，]/g)
    .map((x) => x.trim())
    .filter(Boolean);
  return [...new Set(tokens)];
}

async function saveIgnoreUsers() {
  ignoreError.value = "";
  try {
    const names = parseIgnoreUsers();
    await window.danmakuAPI?.setConfig("aiModel.ignoreUsernames", JSON.parse(JSON.stringify(names)));
    ignoreSaved.value = true;
    setTimeout(() => {
      ignoreSaved.value = false;
    }, 1800);
  } catch (e) {
    ignoreError.value = "保存失败: " + String(e);
  }
}

// 切换弹幕捕捉开关，持久化到配置文件
async function toggleCapture() {
  try {
    await window.danmakuAPI?.setConfig("room.captureEnabled", captureEnabled.value);
  } catch {
    // 持久化失败时回滚 UI
    captureEnabled.value = !captureEnabled.value;
  }
}

// 临时添加一个新输入行
function addInputRule() {
  inputRules.push({ id: crypto.randomUUID(), pattern: "", type: "keyword", enabled: true, caseSensitive: false, scope: "both" });
}

// 删除临时输入行的某一项
function removeInputRule(idx: number) {
  inputRules.splice(idx, 1);
}

// 保存：将临时输入区的有效规则添加到已有关键词列表
async function handleSave() {
  // 将 reactive 转换为普通对象
  const plainInputRules = inputRules.map(r => ({ ...r }));
  const newRules = plainInputRules.filter(r => r.pattern.trim());
  
  if (newRules.length === 0) {
    saveError.value = "请至少填写一个关键词";
    setTimeout(() => { saveError.value = ""; }, 2000);
    return;
  }
  
  try {
    // 将新规则合并到已有关键词（避免重复）
    const plainSaved = savedRules.value.map(r => ({ ...r }));
    const existingPatterns = new Set(plainSaved.map(r => r.pattern));
    const uniqueNewRules = newRules.filter(r => !existingPatterns.has(r.pattern));
    
    const allRules = [...plainSaved, ...uniqueNewRules];
    
    // 保存到配置文件 - 确保是纯数据
    await window.danmakuAPI?.setConfig("keywords", JSON.parse(JSON.stringify(allRules)));
    // 更新到服务
    await window.danmakuAPI?.updateKeywords(JSON.parse(JSON.stringify(allRules)));
    
    // 更新已有关键词列表
    savedRules.value = JSON.parse(JSON.stringify(allRules));
    
    // 清空临时输入区
    inputRules.splice(0, inputRules.length);
    inputRules.push({ id: crypto.randomUUID(), pattern: "", type: "keyword", enabled: true, caseSensitive: false, scope: "both" });
    
    saved.value = true;
    saveError.value = "";
    setTimeout(() => { saved.value = false; }, 2000);
  } catch (e) {
    saveError.value = "保存失败: " + String(e);
    saved.value = false;
  }
}

// 从已有关键词中删除
async function deleteSavedRule(id: string) {
  const plainList = savedRules.value.map(r => ({ ...r }));
  const newList = plainList.filter(r => r.id !== id);
  savedRules.value = newList;
  
  // 同步保存和更新服务
  await window.danmakuAPI?.setConfig("keywords", JSON.parse(JSON.stringify(newList)));
  await window.danmakuAPI?.updateKeywords(JSON.parse(JSON.stringify(newList)));
}

// 切换已有关键词的启用状态 - 直接保存
async function toggleSavedRule(id: string) {
  const plainList = savedRules.value.map(r => ({ ...r }));
  const rule = plainList.find(r => r.id === id);
  if (rule) {
    rule.enabled = !rule.enabled;
    savedRules.value = plainList;
    await window.danmakuAPI?.setConfig("keywords", JSON.parse(JSON.stringify(plainList)));
    await window.danmakuAPI?.updateKeywords(JSON.parse(JSON.stringify(plainList)));
  }
}

// 切换大小写敏感 - 直接保存
async function toggleCaseSensitive(id: string) {
  const plainList = savedRules.value.map(r => ({ ...r }));
  const rule = plainList.find(r => r.id === id);
  if (rule) {
    rule.caseSensitive = !rule.caseSensitive;
    savedRules.value = plainList;
    await window.danmakuAPI?.setConfig("keywords", JSON.parse(JSON.stringify(plainList)));
    await window.danmakuAPI?.updateKeywords(JSON.parse(JSON.stringify(plainList)));
  }
}

// ─── 固定回复规则 ─────────────────────────────────────────

function parseTextList(text: string): string[] {
  return text.split(/[\n,，]/g).map(x => x.trim()).filter(Boolean);
}

async function addQuickReply() {
  qrError.value = "";
  const contains = parseTextList(qrContainsText.value);
  const reply = qrReply.value.trim();
  if (!reply) {
    qrError.value = "请填写回复内容";
    return;
  }
  if (contains.length === 0 && !qrRegex.value.trim()) {
    qrError.value = "请填写包含词或正则";
    return;
  }

  const newRule: QuickReply = {
    id: crypto.randomUUID(),
    enabled: true,
    contains,
    notContains: parseTextList(qrNotContainsText.value),
    regex: qrRegex.value.trim(),
    reply,
    caseSensitive: qrCaseSensitive.value,
    cooldownMs: Math.max(0, Number(qrCooldown.value || 0)),
  };

  try {
    const all = [...quickReplies.value.map(r => ({ ...r })), newRule];
    await window.danmakuAPI?.setConfig("quickReplies", JSON.parse(JSON.stringify(all)));
    await window.danmakuAPI?.updateQuickReplies(JSON.parse(JSON.stringify(all)));
    quickReplies.value = all;
    qrContainsText.value = "";
    qrNotContainsText.value = "";
    qrRegex.value = "";
    qrReply.value = "";
    qrCaseSensitive.value = false;
    qrCooldown.value = 0;
    qrSaved.value = true;
    setTimeout(() => { qrSaved.value = false; }, 1800);
  } catch (e) {
    qrError.value = "保存失败: " + String(e);
  }
}

async function deleteQuickReply(id: string) {
  const newList = quickReplies.value.filter(r => r.id !== id).map(r => ({ ...r }));
  quickReplies.value = newList;
  await window.danmakuAPI?.setConfig("quickReplies", JSON.parse(JSON.stringify(newList)));
  await window.danmakuAPI?.updateQuickReplies(JSON.parse(JSON.stringify(newList)));
}

async function toggleQuickReply(id: string) {
  const plainList = quickReplies.value.map(r => ({ ...r }));
  const rule = plainList.find(r => r.id === id);
  if (rule) {
    rule.enabled = !rule.enabled;
    quickReplies.value = plainList;
    await window.danmakuAPI?.setConfig("quickReplies", JSON.parse(JSON.stringify(plainList)));
    await window.danmakuAPI?.updateQuickReplies(JSON.parse(JSON.stringify(plainList)));
  }
}
</script>

<template>
  <div class="page">
    <div class="page-header">
      <h2 class="page-title">关键词匹配</h2>
      <label class="switch-row">
        <span class="switch-label">捕捉开关</span>
        <input v-model="captureEnabled" type="checkbox" class="switch-input" @change="toggleCapture" />
        <span class="switch-track" :class="{ on: captureEnabled }">
          <span class="switch-thumb"></span>
        </span>
        <span class="switch-state" :class="captureEnabled ? 'on' : 'off'">
          {{ captureEnabled ? "已开启" : "已关闭" }}
        </span>
      </label>
    </div>

    <!-- 临时输入区：用于添加新关键词 -->
    <div class="card">
      <h3 class="card-title">添加关键词</h3>
      <p class="card-desc">在下方输入关键词，点击保存后将添加到已有关键词列表。</p>

      <div v-for="(rule, idx) in inputRules" :key="rule.id" class="rule-card">
        <div class="rule-row">
          <select v-model="rule.type" class="type-select">
            <option value="keyword">关键词</option>
            <option value="regex">正则</option>
          </select>
          <select v-model="rule.scope" class="type-select scope-select">
            <option value="both">全部匹配</option>
            <option value="quickReply">仅固定回复</option>
            <option value="ai">仅AI回复</option>
          </select>
          <input
            v-model="rule.pattern"
            :placeholder="rule.type === 'keyword' ? '关键词...' : '正则表达式...'"
            class="pattern-input"
          />
          <label v-if="rule.type === 'keyword'" class="check-label">
            <input v-model="rule.caseSensitive" type="checkbox" class="compact-check" /> 大小写
          </label>
          <label class="check-label">
            <input v-model="rule.enabled" type="checkbox" class="compact-check" /> 启用
          </label>
          <button class="del-btn" @click="removeInputRule(idx)">✕</button>
        </div>
      </div>

      <button class="btn btn-ghost" @click="addInputRule">+ 添加规则</button>

      <div class="btn-row" style="margin-top: 16px">
        <button class="btn btn-accent" @click="handleSave">保存并应用</button>
        <span v-if="saved" class="msg-inline msg-success">已保存</span>
        <span v-if="saveError" class="msg-inline msg-error">{{ saveError }}</span>
      </div>
    </div>

    <!-- 已保存的关键词列表 -->
    <div v-if="savedRules.length > 0" class="card" style="margin-top: 12px;">
      <h3 class="card-title">已有关键词 ({{ savedRules.length }})</h3>
      <div class="saved-list">
        <div v-for="rule in savedRules" :key="rule.id" class="saved-item">
          <span :class="['type-badge', rule.type]">{{ rule.type === 'keyword' ? '关键词' : '正则' }}</span>
          <span :class="['type-badge', 'scope-badge', rule.scope || 'both']">{{ (rule.scope || 'both') === 'both' ? 'ALL' : (rule.scope || 'both') === 'quickReply' ? '固定' : 'AI' }}</span>
          <span class="pattern-text">{{ rule.pattern }}</span>
          <button 
            v-if="rule.type === 'keyword'" 
            class="case-btn" 
            :class="{ active: rule.caseSensitive }"
            :title="rule.caseSensitive ? '已启用区分大小写，点击切换' : '未启用区分大小写，点击切换'"
            @click="toggleCaseSensitive(rule.id)"
          >
            {{ rule.caseSensitive ? 'Aa' : 'aa' }}
          </button>
          <button 
            :class="['status-dot', rule.enabled ? 'enabled' : 'disabled']" 
            :title="rule.enabled ? '已启用' : '已禁用'"
            @click="toggleSavedRule(rule.id)"
          ></button>
          <button class="del-btn" @click="deleteSavedRule(rule.id)">✕</button>
        </div>
      </div>
    </div>

    <!-- 固定回复规则 -->
    <div class="card" style="margin-top: 12px;">
      <h3 class="card-title">固定回复规则</h3>
      <p class="card-desc">弹幕命中包含词/正则且不命中排除词时，直接发送固定回复（不走 AI）。优先级高于 AI 自动回复。</p>

      <div class="field">
        <label class="field-label">包含词（任一命中即触发，逗号或换行分隔）</label>
        <textarea v-model="qrContainsText" class="field-input" rows="2" placeholder="例如：啥游戏，什么游戏，游戏叫啥"></textarea>
      </div>

      <div class="field">
        <label class="field-label">排除词（任一命中则不触发）</label>
        <textarea v-model="qrNotContainsText" class="field-input" rows="2" placeholder="可选，例如：货物"></textarea>
      </div>

      <div class="field field-inline-2">
        <div>
          <label class="field-label">正则（可选，填写后优先匹配正则）</label>
          <input v-model="qrRegex" class="field-input" placeholder="留空则仅用包含词匹配" />
        </div>
        <div>
          <label class="field-label">回复内容</label>
          <input v-model="qrReply" class="field-input" placeholder="固定回复文本" />
        </div>
      </div>

      <div class="field field-inline-2">
        <div>
          <label class="field-label">冷却（秒，0=无冷却）</label>
          <input v-model.number="qrCooldown" type="number" min="0" step="1" class="field-input" placeholder="0" />
        </div>
        <div>
          <label class="field-label">区分大小写</label>
          <label class="switch-row" style="margin-top: 4px;">
            <span class="switch-label">{{ qrCaseSensitive ? '开' : '关' }}</span>
            <input v-model="qrCaseSensitive" type="checkbox" class="switch-input" />
            <span class="switch-track" :class="{ on: qrCaseSensitive }">
              <span class="switch-thumb"></span>
            </span>
          </label>
        </div>
      </div>

      <div class="btn-row" style="margin-top: 12px">
        <button class="btn btn-accent" @click="addQuickReply">添加固定回复</button>
        <span v-if="qrSaved" class="msg-inline msg-success">已保存</span>
        <span v-if="qrError" class="msg-inline msg-error">{{ qrError }}</span>
      </div>
    </div>

    <!-- 已保存的固定回复规则列表 -->
    <div v-if="quickReplies.length > 0" class="card" style="margin-top: 12px;">
      <h3 class="card-title">已有固定回复 ({{ quickReplies.length }})</h3>
      <div class="saved-list">
        <div v-for="rule in quickReplies" :key="rule.id" class="qr-item">
          <div class="qr-top">
            <div class="qr-tags">
              <span v-for="w in rule.contains.slice(0, 4)" :key="w" class="qr-tag contains">{{ w }}</span>
              <span v-if="rule.contains.length > 4" class="qr-tag more">+{{ rule.contains.length - 4 }}</span>
              <span v-if="rule.regex" class="qr-tag regex">/{{ rule.regex }}/</span>
            </div>
            <div class="qr-actions">
              <button 
                :class="['status-dot', rule.enabled ? 'enabled' : 'disabled']" 
                :title="rule.enabled ? '已启用' : '已禁用'"
                @click="toggleQuickReply(rule.id)"
              ></button>
              <button class="del-btn" @click="deleteQuickReply(rule.id)">✕</button>
            </div>
          </div>
          <div v-if="rule.notContains && rule.notContains.length > 0" class="qr-excludes">
            排除: <span v-for="w in rule.notContains" :key="w" class="qr-tag excludes">{{ w }}</span>
          </div>
          <div class="qr-reply">→ {{ rule.reply }}</div>
          <div v-if="rule.cooldownMs > 0" class="qr-cooldown">冷却 {{ Math.round(rule.cooldownMs / 1000) }}s</div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top: 12px;">
      <h3 class="card-title">粉丝牌等级过滤</h3>
      <p class="card-desc">设置"匹配弹幕/AI自动回复"的最低粉丝牌等级门槛。0 表示不过滤。源弹幕仍会正常显示。</p>
      <div class="field">
        <input v-model.number="minMedalLevel" type="number" min="0" step="1" class="field-input" placeholder="0" />
      </div>
      <div class="btn-row" style="margin-top: 8px">
        <button class="btn btn-accent" @click="saveMinMedalLevel">保存等级过滤</button>
        <span v-if="medalSaved" class="msg-inline msg-success">已保存并生效</span>
        <span v-if="medalError" class="msg-inline msg-error">{{ medalError }}</span>
      </div>
    </div>

    <div class="card" style="margin-top: 12px;">
      <h3 class="card-title">忽略用户名</h3>
      <p class="card-desc">这些用户名的弹幕会正常显示，但不会进入 AI 自动回复队列（用于避免机器人自回复死循环）。支持换行或逗号分隔。</p>
      <div class="field">
        <textarea v-model="ignoreUsersText" class="field-input" rows="4" placeholder="例如：\n我的直播昵称\n机器人账号"></textarea>
      </div>
      <div class="btn-row" style="margin-top: 8px">
        <button class="btn btn-accent" @click="saveIgnoreUsers">保存忽略列表</button>
        <span v-if="ignoreSaved" class="msg-inline msg-success">已保存</span>
        <span v-if="ignoreError" class="msg-inline msg-error">{{ ignoreError }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import "../styles/keywords.css";

.compact-check {
  margin: 0;
  padding: 0;
  vertical-align: middle;
}

.field-label {
  display: block;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 4px;
  font-weight: 500;
}

.field-input {
  width: 100%;
  padding: 6px 10px;
  font-size: 12px;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-primary);
  outline: none;
  transition: border-color 0.15s;
}

.field-input:focus {
  border-color: var(--accent);
}

.field {
  margin-bottom: 10px;
}

.field-inline-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.qr-item {
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 8px 10px;
  margin-bottom: 6px;
}

.qr-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
}

.qr-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  flex: 1;
}

.qr-tag {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
  white-space: nowrap;
}

.qr-tag.contains {
  background: var(--accent-dim);
  color: var(--accent);
}

.qr-tag.regex {
  background: #bb9af722;
  color: var(--purple);
  font-family: monospace;
}

.qr-tag.more {
  background: var(--bg-primary);
  color: var(--text-muted);
  border: 1px dashed var(--border);
}

.qr-tag.excludes {
  background: #f7768e22;
  color: #f7768e;
}

.qr-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.qr-excludes {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 4px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}

.qr-reply {
  font-size: 12px;
  color: var(--text-primary);
  margin-top: 4px;
  font-weight: 500;
}

.qr-cooldown {
  font-size: 10px;
  color: var(--text-muted);
  margin-top: 2px;
}

.btn-muted {
  padding: 6px 16px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  background: var(--bg-primary);
  color: var(--text-secondary);
  border: 1px solid var(--border);
  cursor: pointer;
}

.btn-muted:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.btn-muted:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-small {
  padding: 2px 8px;
  font-size: 10px;
  border-radius: 3px;
  background: none;
  border: 1px solid var(--border);
  color: var(--text-secondary);
  cursor: pointer;
}
</style>