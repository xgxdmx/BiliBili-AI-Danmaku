<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, inject } from "vue";

interface DanmakuDisplay {
  id: number;
  content: string;
  sender: {
    uid: number;
    username: string;
    is_admin: boolean;
    is_vip: boolean;
    guard_level?: number;
    guard_title?: string;
    medal?: { name: string; level: number; color: number } | null;
  };
  timestamp: number;
  roomId: number;
  color: number;
  mode: number;
  isHighlighted?: boolean;
  type?: string; // "sent" = 发送的弹幕, 其他 = 收到的弹幕
  match?: { rule?: { id?: string }; groups?: string[] };
}

interface ConnectionStatus { connected: boolean; roomId: number | null }

// 使用全局存储的弹幕数据
const store = inject<any>("danmakuStore");
const sourceDanmaku = store?.source || ref<DanmakuDisplay[]>([]);
const matchedDanmaku = store?.matched || ref<DanmakuDisplay[]>([]);
// 调用 scheduleSave 触发保存
const scheduleSave = store?.scheduleSave || (() => {});

const maxLines = 500;
const itemRowHeight = 34;
const overscanRows = 12;
const status = ref<ConnectionStatus>({ connected: false, roomId: null });
const sendText = ref("");
const sending = ref(false);
const sendError = ref("");

const sourceSearchText = ref("");
const matchedSearchText = ref("");

const sourceListEl = ref<HTMLElement | null>(null);
const matchedListEl = ref<HTMLElement | null>(null);
const sourceAutoScroll = ref(true);
const matchedAutoScroll = ref(true);
const sourceStartIndex = ref(0);
const matchedStartIndex = ref(0);

/* danmakuAPI type is declared globally via preload */

// 注：弹幕监听已移至 App.vue 全局处理

function scrollToBottom(el: HTMLElement | null) {
  if (el) el.scrollTop = el.scrollHeight;
}

function clearSource() {
  sourceDanmaku.value = [];
}

function clearMatched() {
  matchedDanmaku.value = [];
}

// 注意：弹幕收集现在在 App.vue 全局处理，这里只处理自动滚动
// 直接使用全局数据，不需要在本页面注册监听器
// 数据已经通过 App.vue 的全局监听器自动更新

let offConnected: (() => void) | null = null;
let offDisconnected: (() => void) | null = null;

onMounted(async () => {
  const api = window.danmakuAPI;
  if (!api) return;

  try { status.value = await api.getStatus(); } catch { /* ignore */ }

  offConnected = api.onConnected((payload: any) => {
    const roomId = payload?.roomId ?? payload?.params?.roomId ?? status.value.roomId;
    status.value = { connected: true, roomId };
  });
  offDisconnected = api.onDisconnected(() => {
    status.value = { connected: false, roomId: null };
  });
});

onUnmounted(() => {
  offConnected?.();
  offDisconnected?.();
});

const filteredSourceList = computed(() => {
  if (!sourceSearchText.value) return sourceDanmaku.value;
  const q = sourceSearchText.value.toLowerCase();
  return sourceDanmaku.value.filter((d: { content: string; sender: { username: string; medal: { name: string; }; }; }) =>
    d.content.toLowerCase().includes(q) ||
    d.sender.username.toLowerCase().includes(q) ||
    d.sender.medal?.name?.toLowerCase().includes(q)
  );
});

const sourceVisibleCount = computed(() => {
  const h = sourceListEl.value?.clientHeight || 0;
  return Math.max(30, Math.ceil(h / itemRowHeight) + overscanRows * 2);
});

const displayedSourceList = computed(() => {
  const start = Math.max(0, Math.min(sourceStartIndex.value, Math.max(0, filteredSourceList.value.length - 1)));
  const end = Math.min(filteredSourceList.value.length, start + sourceVisibleCount.value);
  return filteredSourceList.value.slice(start, end);
});

const sourceTopSpacerHeight = computed(() => Math.max(0, sourceStartIndex.value * itemRowHeight));
const sourceBottomSpacerHeight = computed(() => {
  const rendered = displayedSourceList.value.length;
  const remaining = Math.max(0, filteredSourceList.value.length - sourceStartIndex.value - rendered);
  return remaining * itemRowHeight;
});

const filteredMatchedList = computed(() => {
  if (!matchedSearchText.value) return matchedDanmaku.value;
  const q = matchedSearchText.value.toLowerCase();
  return matchedDanmaku.value.filter((d: { content: string; sender: { username: string; medal: { name: string; }; }; }) =>
    d.content.toLowerCase().includes(q) ||
    d.sender.username.toLowerCase().includes(q) ||
    d.sender.medal?.name?.toLowerCase().includes(q)
  );
});

const matchedVisibleCount = computed(() => {
  const h = matchedListEl.value?.clientHeight || 0;
  return Math.max(30, Math.ceil(h / itemRowHeight) + overscanRows * 2);
});

const displayedMatchedList = computed(() => {
  const start = Math.max(0, Math.min(matchedStartIndex.value, Math.max(0, filteredMatchedList.value.length - 1)));
  const end = Math.min(filteredMatchedList.value.length, start + matchedVisibleCount.value);
  return filteredMatchedList.value.slice(start, end);
});

const matchedTopSpacerHeight = computed(() => Math.max(0, matchedStartIndex.value * itemRowHeight));
const matchedBottomSpacerHeight = computed(() => {
  const rendered = displayedMatchedList.value.length;
  const remaining = Math.max(0, filteredMatchedList.value.length - matchedStartIndex.value - rendered);
  return remaining * itemRowHeight;
});

const totalCount = computed(() => sourceDanmaku.value.length);
const matchedCount = computed(() => matchedDanmaku.value.length);
const sourceVirtualized = computed(() => filteredSourceList.value.length > displayedSourceList.value.length);
const matchedVirtualized = computed(() => filteredMatchedList.value.length > displayedMatchedList.value.length);

// 发送弹幕 - 取最近 20 条发送的弹幕 (type === 'sent')
const recentDanmakuList = computed(() => {
  return sourceDanmaku.value.filter((d: { type: string; }) => d.type === 'sent').slice(0, 20);
});

const recentSearchText = ref("");
const filteredRecentList = computed(() => {
  // 只搜索发送的弹幕
  if (!recentSearchText.value) return recentDanmakuList.value;
  const q = recentSearchText.value.toLowerCase();
  return recentDanmakuList.value
    .filter((d: { type: string; }) => d.type === 'sent')
    .filter((d: { content: string; sender: { username: string; medal: { name: string; }; }; }) =>
      d.content.toLowerCase().includes(q) ||
      d.sender?.username?.toLowerCase()?.includes(q) ||
      d.sender?.medal?.name?.toLowerCase()?.includes(q)
    );
});

const canSend = computed(() => status.value.connected && !!sendText.value.trim() && !sending.value);

async function handleSend() {
  const api = window.danmakuAPI;
  if (!api) return;
  const text = sendText.value.trim();
  if (!text) {
    sendError.value = "请输入弹幕内容";
    return;
  }
  if (!status.value.connected) {
    sendError.value = "未连接直播间";
    return;
  }
  sending.value = true;
  sendError.value = "";
  try {
    await api.send({ msg: text });
    const now = Date.now();
    const manual: DanmakuDisplay = {
      id: now,
      content: text,
      sender: { uid: 0, username: "我", is_admin: false, is_vip: false },
      timestamp: now,
      roomId: status.value.roomId ?? 0,
      color: 0xffffff,
      mode: 1,
      type: "sent",
    };
    sourceDanmaku.value.unshift(manual);
    if (sourceDanmaku.value.length > maxLines) sourceDanmaku.value.length = maxLines;
    scheduleSave();
    sendText.value = "";
  } catch (err: any) {
    sendError.value = err?.message || "发送失败";
  } finally {
    sending.value = false;
  }
}

function handleSendKey(e: KeyboardEvent) {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    handleSend();
  }
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("zh-CN", { hour12: false });
}

function medalColor(c: number): string {
  return `#${(c || 0).toString(16).padStart(6, "0")}`;
}

function onSourceScroll() {
  if (!sourceListEl.value) return;
  const el = sourceListEl.value;
  sourceAutoScroll.value = el.scrollTop + el.clientHeight >= el.scrollHeight - 50;
  sourceStartIndex.value = Math.max(0, Math.floor(el.scrollTop / itemRowHeight) - overscanRows);
}

function onMatchedScroll() {
  if (!matchedListEl.value) return;
  const el = matchedListEl.value;
  matchedAutoScroll.value = el.scrollTop + el.clientHeight >= el.scrollHeight - 50;
  matchedStartIndex.value = Math.max(0, Math.floor(el.scrollTop / itemRowHeight) - overscanRows);
}

function onSourceWheel(e: WheelEvent) {
  if (!sourceListEl.value) return;
  e.preventDefault();
  sourceListEl.value.scrollTop += e.deltaY;
}

function onMatchedWheel(e: WheelEvent) {
  if (!matchedListEl.value) return;
  e.preventDefault();
  matchedListEl.value.scrollTop += e.deltaY;
}
</script>

<template>
  <div class="page">
    <div class="page-header">
      <h2 class="page-title">弹幕监控</h2>
      <div class="header-stats">
        <span class="stat">总计 {{ totalCount }} 条</span>
        <span class="stat accent">匹配 {{ matchedCount }} 条</span>
      </div>
    </div>

    <div v-if="!status.connected" class="empty-banner">
      <div class="empty-icon">📺</div>
      <p>未连接直播间</p>
      <p class="empty-sub">前往「直播间」配置并开始监听</p>
    </div>

    <div v-else class="columns-container">
      <!-- 上方：源弹幕 | 匹配弹幕 -->
      <div class="columns-body">
        <!-- Left Column: Source Danmaku -->
        <div class="column">
          <div class="column-header">
            <h3 class="column-title">源弹幕</h3>
            <span class="column-count">{{ sourceDanmaku.length }}</span>
            <input v-model="sourceSearchText" type="text" placeholder="搜索..." class="column-search" />
            <button class="btn-clear" @click="clearSource">清空弹幕列表</button>
          </div>
          <div ref="sourceListEl" class="column-scroll" @scroll="onSourceScroll">
            <div :style="{ height: `${sourceTopSpacerHeight}px` }" aria-hidden="true"></div>
            <div v-for="d in displayedSourceList" :key="d.id" :class="['d-item', { highlight: d.isHighlighted, gift: d.type === 'gift' }]">
              <span v-if="d.sender?.medal" class="medal" :style="{ color: medalColor(d.sender.medal.color) }">
                {{ d.sender.medal.name }} {{ d.sender.medal.level }}
              </span>
              <span v-if="d.sender?.guard_title" class="guard-badge">{{ d.sender.guard_title }}</span>
              <span class="uname">{{ d.sender?.username || '匿名' }}: </span>
              <span class="dmsg">{{ d.content }}</span>
              <span class="dtime">{{ formatTime(d.timestamp) }}</span>
            </div>
            <div :style="{ height: `${sourceBottomSpacerHeight}px` }" aria-hidden="true"></div>
            <div v-if="displayedSourceList.length === 0" class="empty-inline">暂无弹幕</div>
            <div v-else-if="sourceVirtualized" class="empty-inline">已启用虚拟渲染（共 {{ filteredSourceList.length }} 条）</div>
          </div>
        </div>

        <!-- Right Column: Matched Danmaku -->
        <div class="column">
          <div class="column-header">
            <h3 class="column-title">匹配弹幕</h3>
            <span class="column-count">{{ matchedDanmaku.length }}</span>
            <input v-model="matchedSearchText" type="text" placeholder="搜索..." class="column-search" />
            <button class="btn-clear" @click="clearMatched">清空弹幕列表</button>
          </div>
          <div ref="matchedListEl" class="column-scroll" @scroll="onMatchedScroll">
            <div :style="{ height: `${matchedTopSpacerHeight}px` }" aria-hidden="true"></div>
            <div v-for="d in displayedMatchedList" :key="d.id" class="m-item">
              <span v-if="d.sender?.medal" class="m-badge">
                {{ d.sender.medal.name }} {{ d.sender.medal.level }}
              </span>
              <span v-if="d.sender?.guard_title" class="m-badge m-guard">{{ d.sender.guard_title }}</span>
              <span class="m-user">{{ d.sender?.username || '匿名' }}</span>:&nbsp;
              <span class="m-content">{{ d.content }}</span>
              <span class="m-time">{{ formatTime(d.timestamp) }}</span>
            </div>
            <div :style="{ height: `${matchedBottomSpacerHeight}px` }" aria-hidden="true"></div>
            <div v-if="displayedMatchedList.length === 0" class="empty-inline">暂无匹配弹幕</div>
            <div v-else-if="matchedVirtualized" class="empty-inline">已启用虚拟渲染（共 {{ filteredMatchedList.length }} 条）</div>
          </div>
        </div>
      </div>

      <!-- 下方：最新弹幕 -->
      <div class="danmaku-bar">
        <div class="column-header">
          <h3 class="column-title">发送弹幕</h3>
          <span class="column-count">{{ recentDanmakuList.length }}</span>
          <input v-model="recentSearchText" type="text" placeholder="搜索发送..." class="column-search" />
        </div>
        <div class="danmaku-list">
          <div v-for="d in filteredRecentList" :key="d.id" class="danmaku-bar-item sent">
            <span class="bar-indicator">→</span>
            <span class="bar-content">{{ d.content }}</span>
          </div>
          <div v-if="filteredRecentList.length === 0" class="empty-inline">暂无发送记录</div>
        </div>
        <div class="send-form">
          <textarea
            v-model="sendText"
            class="send-input"
            rows="2"
            placeholder="输入要发送的弹幕，Ctrl+Enter 发送"
            @keydown="handleSendKey"
          ></textarea>
          <div class="send-actions">
            <span v-if="sendError" class="send-error">{{ sendError }}</span>
            <button class="btn-send" :disabled="!canSend" @click="handleSend">
              {{ sending ? "发送中..." : "发送" }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import "../styles/danmaku.css";
</style>
