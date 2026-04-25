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
@import "../styles/about.css";
</style>
