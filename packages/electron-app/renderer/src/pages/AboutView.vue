<script setup lang="ts">
// ─── 应用信息 (按需手动修改) ────────────────────────────────────
const APP_INFO = {
  name: "BiliBili 弹幕 Claw",
  version: "0.1.0",
  author: "星光下的梦想",
  description: "B站直播间弹幕监听 + AI 自动回复",
  license: "Apache-2.0",
  buildDate: __APP_BUILD_DATE__,
};

// ─── 技术栈 ─────────────────────────────────────────────────────
const TECH_STACK = [
  { name: "Electron", version: "41" },
  { name: "Vue", version: "3" },
  { name: "Python", version: "3.10+" },
  { name: "blivedm", version: "" },
  { name: "aiohttp", version: "≥3.9" },
];

// ─── 开源致谢 ───────────────────────────────────────────────────
const OPEN_SOURCE = [
  { name: "blivedm", url: "https://github.com/xfgryujk/blivedm" },
  { name: "electron-builder", url: "https://www.electron.build" },
  { name: "PyInstaller", url: "https://pyinstaller.org" },
  { name: "electron-store", url: "https://github.com/sindresorhus/electron-store" },
  { name: "vue-router", url: "https://router.vuejs.org" },
];
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
        <span class="info-value">{{ APP_INFO.version }}</span>
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
        <a
          v-for="lib in OPEN_SOURCE"
          :key="lib.name"
          :href="lib.url"
          target="_blank"
          class="oss-item"
        >
          <span class="oss-name">{{ lib.name }}</span>
          <span class="oss-arrow">↗</span>
        </a>
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

.info-link {
  color: var(--accent);
  text-decoration: none;
  transition: color 0.15s;
}

.info-link:hover {
  color: var(--text-primary);
  text-decoration: underline;
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
  text-decoration: none;
  color: var(--text-primary);
  font-size: 13px;
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

/* ─── 底部 ──────────────────────────────── */
.about-footer {
  margin-top: 32px;
  text-align: center;
  font-size: 12px;
  color: var(--text-muted);
}
</style>