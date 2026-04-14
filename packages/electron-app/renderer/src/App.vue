<script setup lang="ts">
import { ref, provide, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";

const route = useRoute();
const router = useRouter();

// 程序关闭时清空缓存 - 启动时默认为空
const STORAGE_KEY = "bilibili-danmaku-cache";

function saveCache(source: any[], matched: any[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ source, matched }));
  } catch {}
}

// 不加载缓存 - 每次启动都是空的，只有运行时保存
const globalSourceDanmaku = ref<any[]>([]);
const globalMatchedDanmaku = ref<any[]>([]);

// 定时保存
let saveTimer: number | null = null;
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveCache(globalSourceDanmaku.value, globalMatchedDanmaku.value);
  }, 2000) as any;
}

// 全局监听弹幕 - 即使切换页面也继续更新
onMounted(() => {
  window.addEventListener("beforeunload", () => {
    saveCache(globalSourceDanmaku.value, globalMatchedDanmaku.value);
  });
  
  const api = window.danmakuAPI;
  if (api) {
    // 去重检查
    const isDuplicate = (d: any) => globalSourceDanmaku.value.some(
      existing => existing.content === d.content && existing.timestamp === d.timestamp
    );
    
    // Danmaku
    api.onDanmaku((d: any) => {
      // 去重
      if (isDuplicate(d)) return;
      globalSourceDanmaku.value.unshift(d);
      if (globalSourceDanmaku.value.length > 500) globalSourceDanmaku.value.length = 500;
      if (d.isHighlighted || d.match) {
        globalMatchedDanmaku.value.unshift(d);
        if (globalMatchedDanmaku.value.length > 500) globalMatchedDanmaku.value.length = 500;
      }
      scheduleSave();
    });
    // Gift
    api.onGift((d: any) => {
      globalSourceDanmaku.value.unshift({
        id: Date.now(), content: `🎁 ${d.sender?.username || "用户"} 送出 ${d.giftName} x${d.count}`,
        sender: d.sender || { uid: 0, username: "用户", is_admin: false, is_vip: false },
        timestamp: d.timestamp || Date.now(), roomId: d.roomId || 0, color: 16761024, mode: 1, type: "gift",
      });
      if (globalSourceDanmaku.value.length > 500) globalSourceDanmaku.value.length = 500;
      scheduleSave();
    });
    // SuperChat
    api.onSuperChat((d: any) => {
      globalSourceDanmaku.value.unshift({
        id: d.id || Date.now(), content: `💎 SC ¥${d.price}: ${d.content}`,
        sender: d.sender || { uid: 0, username: "用户", is_admin: false, is_vip: false },
        timestamp: d.timestamp || Date.now(), roomId: d.roomId || 0, color: 16744224, mode: 1, isHighlighted: true, type: "sc",
      });
      globalMatchedDanmaku.value.unshift({
        id: d.id || Date.now(), content: `💎 SC ¥${d.price}: ${d.content}`,
        sender: d.sender || { uid: 0, username: "用户", is_admin: false, is_vip: false },
        timestamp: d.timestamp || Date.now(), roomId: d.roomId || 0, color: 16744224, mode: 1, isHighlighted: true, type: "sc",
      });
      scheduleSave();
    });
  }
});

// 提供给子组件
provide("danmakuStore", {
  source: globalSourceDanmaku,
  matched: globalMatchedDanmaku,
  scheduleSave,
});

const isActive = (path: string) => {
  return route.path === path;
};

const navItems = [
  { path: "/", label: "弹幕", icon: "message" },
  { path: "/room", label: "直播间", icon: "tv" },
  { path: "/keywords", label: "关键词", icon: "tag" },
  { path: "/models", label: "大模型", icon: "ai" },
  { path: "/dev", label: "开发", icon: "settings" },
];

const icons: Record<string, string> = {
  message: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  tv: "M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7zm9 11v2m-4 0h8",
  tag: "M12 2H2v10l9.29 9.29a1 1 0 0 0 1.41 0L22 12V2H12z",
  ai: "M3 20h4.2l.8-3h4l.8 3H17l-3.8-16H6.8L3 20Zm6-6 1.2-5h1.6l1.2 5ZM20 4h4v16h-4z",
  settings: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
};
</script>

<template>
  <div class="app-shell">
    <!-- 左侧竖直图标导航 (Clash 风格) -->
    <aside class="sidebar">
      <div class="sidebar-logo" @click="router.push('/')">
        <svg class="dream-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 16.5c2.2-3.8 5.6-6.2 10.2-7.2"/>
          <path d="M6.2 19.2c2.8-2 5.8-3.2 9-3.6"/>
          <path d="M15.8 4.6l.9 2.2 2.2.9-2.2.9-.9 2.2-.9-2.2-2.2-.9 2.2-.9z"/>
          <path d="M10.3 8.8l.45 1.1 1.1.45-1.1.45-.45 1.1-.45-1.1-1.1-.45 1.1-.45z"/>
        </svg>
      </div>

      <nav class="sidebar-nav">
        <button
          v-for="item in navItems"
          :key="item.path"
          :class="['nav-btn', { active: isActive(item.path) }]"
          :title="item.label"
          @click="router.push(item.path)"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path :d="icons[item.icon]"/>
          </svg>
        </button>
      </nav>

    </aside>

    <!-- 主内容区 -->
    <main class="main-area">
      <router-view />
    </main>
  </div>
</template>

<style scoped>
@import "./styles/app.css";

.app-shell {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

.sidebar {
  width: 56px;
  min-width: 56px;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 0;
}

.sidebar-logo {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9eb7ff;
  cursor: pointer;
  margin-bottom: 12px;
  border-radius: 8px;
  transition: background 0.15s, color 0.15s, box-shadow 0.2s;
  box-shadow: 0 0 14px #7aa2f733;
}

.sidebar-logo:hover {
  background: var(--bg-hover);
  color: #c5d4ff;
  box-shadow: 0 0 18px #7aa2f755;
}

.dream-icon {
  filter: drop-shadow(0 0 6px #7dcfff55);
}

.sidebar-nav {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 4px 0;
}

.nav-btn {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  transition: all 0.15s;
}

.nav-btn:hover {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.nav-btn.active {
  background: var(--accent-dim);
  color: var(--accent);
}

.main-area {
  flex: 1;
  overflow: auto;
  background: var(--bg-primary);
}
</style>
