<script setup lang="ts">
import { ref, provide, onMounted, onUnmounted } from "vue";
import { useRoute, useRouter } from "vue-router";

const route = useRoute();
const router = useRouter();

type CloseDialogAction = "tray" | "exit" | "cancel";

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

// ─── 关闭确认弹窗（主题化） ──────────────────────────────────

/** 是否显示“点击 X”关闭确认弹窗 */
const closeDialogVisible = ref(false);
/** 本次主进程关闭请求 ID，用于回传时防串单 */
const closeDialogRequestId = ref("");
/** 弹窗标题文本 */
const closeDialogMessage = ref("关闭窗口时你希望如何处理？");
/** 弹窗补充说明 */
const closeDialogDetail = ref("");
/** 是否记住当前选择 */
const closeDialogRemember = ref(false);
const closeDialogSubmitting = ref(false);
const quittingVisible = ref(false);
const quittingMessage = ref("正在退出程序，请稍候…");

/** 向主进程提交关闭确认结果 */
async function submitCloseDialogDecision(action: CloseDialogAction): Promise<void> {
  if (closeDialogSubmitting.value) return;
  closeDialogSubmitting.value = true;

  // 先关 UI，避免托盘唤醒时出现“弹窗闪一下又消失”
  const requestId = closeDialogRequestId.value;
  const remember = closeDialogRemember.value;
  closeDialogVisible.value = false;
  closeDialogRequestId.value = "";

  try {
    if (requestId) {
      await window.danmakuAPI.respondCloseConfirm({
        requestId,
        action,
        remember,
      });
    } else {
      // 兜底：requestId 丢失时仍然确保按钮动作必达
      await window.danmakuAPI.submitCloseConfirmAction({
        action,
        remember,
      });
    }
  } catch {
    // invoke 异常时再走一次无 requestId 直达通道
    try {
      await window.danmakuAPI.submitCloseConfirmAction({
        action,
        remember,
      });
    } catch {
      // ignore
    }
  } finally {
    closeDialogRemember.value = false;
    closeDialogSubmitting.value = false;
  }
}

// ─── 主题管理 ──────────────────────────────────────────────

/** 将解析后的主题应用到 DOM 根节点 */
function applyTheme(resolved: "light" | "dark"): void {
  document.documentElement.setAttribute("data-theme", resolved);
}

// 启动时加载主题
let unsubscribeThemeChanged: (() => void) | null = null;
let unsubscribeCloseConfirmRequested: (() => void) | null = null;
let unsubscribeAppQuitting: (() => void) | null = null;

onMounted(async () => {
  try {
    const result = await window.danmakuAPI?.getTheme();
    if (result) applyTheme(result.resolved);
  } catch { /* 忽略 */ }

  // 监听主题变更（系统主题变化或用户手动切换）
  unsubscribeThemeChanged = window.danmakuAPI?.onThemeChanged?.((resolved) => {
    applyTheme(resolved);
  }) || null;

  // 监听主进程发起的关闭确认请求，显示应用内主题化弹窗
  unsubscribeCloseConfirmRequested = window.danmakuAPI?.onCloseConfirmRequested?.((data) => {
    closeDialogRequestId.value = data.requestId;
    closeDialogMessage.value = data.message || "关闭窗口时你希望如何处理？";
    closeDialogDetail.value = data.detail || "";
    closeDialogRemember.value = false;
    closeDialogVisible.value = true;
  }) || null;

  unsubscribeAppQuitting = window.danmakuAPI?.onAppQuitting?.((data) => {
    closeDialogVisible.value = false;
    closeDialogRequestId.value = "";
    quittingMessage.value = data?.message || "正在退出程序，请稍候…";
    quittingVisible.value = true;
  }) || null;
});

onUnmounted(() => {
  unsubscribeThemeChanged?.();
  unsubscribeCloseConfirmRequested?.();
  unsubscribeAppQuitting?.();
});

// ─── 弹幕缓存 ──────────────────────────────────────────────
onMounted(() => {
  window.addEventListener("beforeunload", () => {
    saveCache(globalSourceDanmaku.value, globalMatchedDanmaku.value);
  });
  
  const api = window.danmakuAPI;
  if (api) {
    const resolveSender = (raw: any) => {
      const candidate = raw?.sender ?? raw?.user_info ?? raw?.userInfo ?? raw?.user ?? {};
      const username = candidate.username || candidate.uname || candidate.name || raw?.username || raw?.uname || "用户";
      const uid = Number(candidate.uid ?? candidate.userId ?? raw?.uid ?? 0) || 0;
      return {
        uid,
        username,
        is_admin: Boolean(candidate.is_admin ?? candidate.isAdmin ?? false),
        is_vip: Boolean(candidate.is_vip ?? candidate.isVip ?? false),
        guard_level: candidate.guard_level ?? candidate.guardLevel,
        guard_title: candidate.guard_title ?? candidate.guardTitle,
        medal: candidate.medal ?? null,
      };
    };

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
      const sender = resolveSender(d);
      globalSourceDanmaku.value.unshift({
        id: Date.now(), content: `🎁 ${sender.username} 送出 ${d.giftName} x${d.count}`,
        sender,
        timestamp: d.timestamp || Date.now(), roomId: d.roomId || 0, color: 16761024, mode: 1, type: "gift",
      });
      if (globalSourceDanmaku.value.length > 500) globalSourceDanmaku.value.length = 500;
      scheduleSave();
    });
    // SuperChat
    api.onSuperChat((d: any) => {
      const sender = resolveSender(d);
      globalSourceDanmaku.value.unshift({
        id: d.id || Date.now(), content: `💎 SC ¥${d.price}: ${d.content}`,
        sender,
        timestamp: d.timestamp || Date.now(), roomId: d.roomId || 0, color: 16744224, mode: 1, isHighlighted: true, type: "sc",
      });
      globalMatchedDanmaku.value.unshift({
        id: d.id || Date.now(), content: `💎 SC ¥${d.price}: ${d.content}`,
        sender,
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
  { path: "/boundary", label: "直播间", icon: "tv" },
  { path: "/", label: "弹幕监控", icon: "message" },
  { path: "/room", label: "直播间配置", icon: "roomConfig" },
  { path: "/keywords", label: "关键词匹配", icon: "tag" },
  { path: "/models", label: "大模型配置", icon: "ai" },
  { path: "/dev", label: "配置管理", icon: "settings" },
  { path: "/about", label: "关于", icon: "about" },
];

const icons: Record<string, string> = {
  roomConfig: "M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-5l-2 3-2-3H5a2 2 0 0 1-2-2V6m4 2h10m-8 4h6",
  message: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  tv: "M9 5.6 7.2 4.3M15 5.6l1.8-1.3M4.8 7.2a2.8 2.8 0 0 1 2.8-2.8h8.8a2.8 2.8 0 0 1 2.8 2.8v7.6a2.8 2.8 0 0 1-2.8 2.8H7.6a2.8 2.8 0 0 1-2.8-2.8V7.2m4.2 3.4h.01m5.98 0h.01",
  tag: "M12 2H2v10l9.29 9.29a1 1 0 0 0 1.41 0L22 12V2H12z",
  ai: "M1 20h4.2l.8-3h4l.8 3H15l-3.8-16H4.8L1 20Zm6-6 1.2-5h1.6l1.2 5ZM18 4h4v16h-4z",
  settings: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  about: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z",
};
</script>

<template>
  <div class="app-shell">
    <!-- 左侧品牌化导航 -->
    <aside class="sidebar">
      <button class="sidebar-brand" @click="router.push('/')">
        <span class="sidebar-brand-icon" aria-hidden="true">
          <svg class="dream-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M8.8 5.2l-2.1-1.9"></path>
            <path d="M15.2 5.2l2.1-1.9"></path>
            <rect x="4.6" y="6.4" width="14.8" height="11.2" rx="3.2"></rect>
            <circle cx="9.7" cy="12" r="1" fill="currentColor" stroke="none"></circle>
            <circle cx="14.3" cy="12" r="1" fill="currentColor" stroke="none"></circle>
          </svg>
        </span>
        <span class="sidebar-brand-copy">
          <strong class="sidebar-brand-title">BiliBili AI 弹幕姬</strong>
          <span class="sidebar-brand-subtitle">BiliBili-AI-Danmaku</span>
        </span>
      </button>

      <nav class="sidebar-nav">
        <div class="nav-main">
          <button
            v-for="item in navItems"
            :key="item.path"
            :class="['nav-btn', { active: isActive(item.path) }]"
            @click="router.push(item.path)"
          >
            <span class="nav-btn-icon" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path :d="icons[item.icon]"/>
              </svg>
            </span>
            <span class="nav-btn-label">{{ item.label }}</span>
          </button>
        </div>

      </nav>

    </aside>

    <!-- 主内容区 -->
    <main class="main-area">
      <router-view />
    </main>

    <!-- 点击 X 时的主题化关闭确认弹窗 -->
    <div
      v-if="closeDialogVisible"
      class="close-modal-mask"
      @click="submitCloseDialogDecision('cancel')"
    >
      <div class="close-modal-card" @click.stop>
        <h3 class="close-modal-title">{{ closeDialogMessage }}</h3>
        <p class="close-modal-detail">{{ closeDialogDetail }}</p>

        <label class="close-modal-remember">
          <input v-model="closeDialogRemember" type="checkbox" />
          <span>下次不再提示（记住本次选择）</span>
        </label>

        <div class="close-modal-actions">
          <button class="btn btn-muted" @click="submitCloseDialogDecision('cancel')">取消</button>
          <button class="btn btn-muted" @click="submitCloseDialogDecision('exit')">退出程序</button>
          <button class="btn btn-accent" @click="submitCloseDialogDecision('tray')">最小化到后台</button>
        </div>
      </div>
    </div>

    <!-- 退出中提示 -->
    <div v-if="quittingVisible" class="quitting-mask">
      <div class="quitting-card">
        <div class="quitting-spinner" aria-hidden="true"></div>
        <h3 class="quitting-title">正在退出</h3>
        <p class="quitting-desc">{{ quittingMessage }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import "./styles/app.css";
</style>
