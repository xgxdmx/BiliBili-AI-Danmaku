<script setup lang="ts">
import { ref, onMounted } from "vue";

// ─── 应用信息 ─────────────────────────────────────────────────────
const APP_INFO = {
  name: "BiliBili AI弹幕姬",
  version: __APP_VERSION__ || "0.3.1",
  author: "星光下的梦想",
  description: "B站直播间弹幕监听 + AI 自动回复",
  license: "Apache-2.0",
  buildDate: __APP_BUILD_DATE__,
};

// ─── 技术栈 ─────────────────────────────────────────────────────
const TECH_STACK = [
  { name: "Electron", version: "41" },
  { name: "Vite", version: "6.4" },
  { name: "Vue", version: "3" },
  { name: "Python", version: "3.13" },
  { name: "blivedm", version: "1.1.5" },
];

// ─── 开源致谢 ───────────────────────────────────────────────────
const OPEN_SOURCE = [
  { name: "blivedm", url: "https://github.com/xfgryujk/blivedm" },
  { name: "electron-builder", url: "https://www.electron.build" },
  { name: "PyInstaller", url: "https://pyinstaller.org" },
  { name: "electron-store", url: "https://github.com/sindresorhus/electron-store" },
  { name: "vue-router", url: "https://router.vuejs.org" },
];

// ─── 主题设置 ─────────────────────────────────────────────────
type ThemeMode = "light" | "dark" | "system";
const themeMode = ref<ThemeMode>("system");

const themeOptions: { value: ThemeMode; label: string; desc: string }[] = [
  { value: "light", label: "☀️ 明亮", desc: "明亮淡雅风格" },
  { value: "dark", label: "🌙 夜间", desc: "深夜酷炫风格" },
  { value: "system", label: "💻 跟随系统", desc: "自动匹配系统主题" },
];

// ─── 版本更新检查 ───────────────────────────────────────────────
type UpdateStatus = "idle" | "checking" | "up-to-date" | "has-update" | "error";
const updateStatus = ref<UpdateStatus>("idle");
const updateMessage = ref("");
const latestVersion = ref("");
const releaseUrl = ref("");

async function checkUpdate() {
  updateStatus.value = "checking";
  updateMessage.value = "";
  try {
    const result = await window.danmakuAPI?.checkUpdate();
    if (!result || result.status !== "ok") {
      updateStatus.value = "error";
      updateMessage.value = result?.message || "检查更新失败";
      return;
    }
    latestVersion.value = result.latestVersion || "";
    releaseUrl.value = result.releaseUrl || "";
    if (result.hasUpdate) {
      updateStatus.value = "has-update";
      updateMessage.value = `发现新版本 v${latestVersion.value}`;
    } else {
      updateStatus.value = "up-to-date";
      updateMessage.value = "已是最新版本";
    }
  } catch {
    updateStatus.value = "error";
    updateMessage.value = "网络连接失败";
  }
}

function openReleasePage() {
  if (releaseUrl.value) {
    window.danmakuAPI?.openExternal(releaseUrl.value);
  }
}

function openLink(url: string) {
  window.danmakuAPI?.openExternal(url);
}

onMounted(async () => {
  try {
    const result = await window.danmakuAPI?.getTheme();
    if (result) themeMode.value = result.mode;
  } catch { /* 忽略 */ }
  // 启动时自动检查更新
  checkUpdate();
});

async function setTheme(mode: ThemeMode) {
  themeMode.value = mode;
  try {
    await window.danmakuAPI?.setTheme(mode);
  } catch { /* 忽略 */ }
}
</script>

<template>
  <div class="about-view">
    <!-- 顶部标识 -->
    <div class="about-header">
      <div class="app-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 16.5c2.2-3.8 5.6-6.2 10.2-7.2"/>
          <path d="M6.2 19.2c2.8-2 5.8-3.2 9-3.6"/>
          <path d="M15.8 4.6l.9 2.2 2.2.9-2.2.9-.9 2.2-.9-2.2-2.2-.9 2.2-.9z"/>
          <path d="M10.3 8.8l.45 1.1 1.1.45-1.1.45-.45 1.1-.45-1.1-1.1-.45 1.1-.45z"/>
        </svg>
      </div>
      <div class="app-name">{{ APP_INFO.name }}</div>
      <div class="app-desc">{{ APP_INFO.description }}</div>
    </div>

    <!-- 信息卡片 -->
    <div class="info-card">
      <div class="info-row">
        <span class="info-label">版本</span>
        <div class="info-value-group">
          <span class="info-value">v{{ APP_INFO.version }}</span>
          <span
            v-if="updateStatus === 'checking'"
            class="update-badge checking"
          >检查中...</span>
          <span
            v-else-if="updateStatus === 'up-to-date'"
            class="update-badge up-to-date"
          >✓ 已是最新</span>
          <button
            v-else-if="updateStatus === 'has-update'"
            class="update-badge has-update"
            @click="openReleasePage"
          >↑ {{ updateMessage }}</button>
          <span
            v-else-if="updateStatus === 'error'"
            class="update-badge error"
            :title="updateMessage"
          >检查失败</span>
        </div>
      </div>
      <div class="info-row">
        <span class="info-label">作者</span>
        <span class="info-value">{{ APP_INFO.author }}</span>
      </div>
      <div class="info-row">
        <span class="info-label">构建时间</span>
        <span class="info-value">{{ APP_INFO.buildDate }}</span>
      </div>
      <div class="info-row">
        <span class="info-label">许可证</span>
        <span class="info-value">{{ APP_INFO.license }}</span>
      </div>
    </div>

    <!-- 主题设置 -->
    <div class="section">
      <h3 class="section-title">外观主题</h3>
      <div class="theme-options">
        <button
          v-for="opt in themeOptions"
          :key="opt.value"
          :class="['theme-option', { active: themeMode === opt.value }]"
          @click="setTheme(opt.value)"
        >
          <span class="theme-label">{{ opt.label }}</span>
          <span class="theme-desc">{{ opt.desc }}</span>
        </button>
      </div>
    </div>

    <!-- 技术栈 -->
    <div class="section">
      <h3 class="section-title">技术栈</h3>
      <div class="tech-grid">
        <div v-for="tech in TECH_STACK" :key="tech.name" class="tech-item">
          <span class="tech-name">{{ tech.name }}</span>
          <span v-if="tech.version" class="tech-version">{{ tech.version }}</span>
        </div>
      </div>
    </div>

    <!-- 开源致谢 -->
    <div class="section">
      <h3 class="section-title">开源致谢</h3>
      <div class="oss-list">
        <button
          v-for="lib in OPEN_SOURCE"
          :key="lib.name"
          class="oss-item"
          @click="openLink(lib.url)"
        >
          <span class="oss-name">{{ lib.name }}</span>
          <span class="oss-arrow">↗</span>
        </button>
      </div>
    </div>

    <!-- 底部 -->
    <div class="about-footer">
      Copyright © by 星光下的梦想
    </div>
  </div>
</template>

<style scoped>
.about-view {
  max-width: 520px;
  margin: 0 auto;
  padding: 32px 24px;
}

/* ─── 头部 ──────────────────────────────── */
.about-header {
  text-align: center;
  margin-bottom: 28px;
}

.app-icon {
  width: 72px;
  height: 72px;
  margin: 0 auto 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-tertiary);
  border-radius: 16px;
  color: #9eb7ff;
  box-shadow: 0 0 24px #7aa2f733;
}

.app-name {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 6px;
}

.app-desc {
  font-size: 13px;
  color: var(--text-muted);
}

/* ─── 信息卡片 ──────────────────────────── */
.info-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 4px 0;
  margin-bottom: 24px;
}

.info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 16px;
}

.info-row + .info-row {
  border-top: 1px solid var(--border);
}

.info-label {
  font-size: 13px;
  color: var(--text-muted);
}

.info-value {
  font-size: 13px;
  color: var(--text-primary);
  font-weight: 500;
}

.info-value-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* ─── 版本更新标记 ──────────────────────────── */
.update-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  border: none;
  cursor: default;
  white-space: nowrap;
}

.update-badge.checking {
  background: var(--bg-tertiary);
  color: var(--text-muted);
}

.update-badge.up-to-date {
  background: #9ece6a22;
  color: #9ece6a;
}

.update-badge.has-update {
  background: #7aa2f722;
  color: #7aa2f7;
  cursor: pointer;
  font-weight: 600;
  transition: background 0.15s;
}

.update-badge.has-update:hover {
  background: #7aa2f744;
}

.update-badge.error {
  background: #f7768e22;
  color: #f7768e;
}

/* ─── 段落 ─────────────────────────────── */
.section {
  margin-bottom: 24px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-secondary);
  margin: 0 0 12px 0;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* ─── 技术栈 ─────────────────────────────── */
.tech-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tech-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 13px;
}

.tech-name {
  color: var(--text-primary);
  font-weight: 500;
}

.tech-version {
  color: var(--text-muted);
  font-size: 12px;
}

/* ─── 开源列表 ───────────────────────────── */
.oss-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.oss-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-radius: 6px;
  border: none;
  background: none;
  color: var(--text-primary);
  font-size: 13px;
  width: 100%;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s;
}

.oss-item:hover {
  background: var(--bg-hover);
}

.oss-name {
  font-weight: 500;
}

.oss-arrow {
  color: var(--text-muted);
  font-size: 12px;
}

/* ─── 主题选项 ─────────────────────────────── */
.theme-options {
  display: flex;
  gap: 8px;
}

.theme-option {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px 8px;
  background: var(--bg-secondary);
  border: 2px solid var(--border);
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.18s ease;
}

.theme-option:hover {
  border-color: var(--text-muted);
  background: var(--bg-hover);
}

.theme-option.active {
  border-color: var(--accent);
  background: var(--accent-dim);
}

.theme-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.theme-option.active .theme-label {
  color: var(--accent);
}

.theme-desc {
  font-size: 11px;
  color: var(--text-muted);
  text-align: center;
}

/* ─── 底部 ──────────────────────────────── */
.about-footer {
  margin-top: 32px;
  text-align: center;
  font-size: 12px;
  color: var(--text-muted);
}
</style>
