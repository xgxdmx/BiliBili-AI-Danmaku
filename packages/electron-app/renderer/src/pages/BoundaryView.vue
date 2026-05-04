<script setup lang="ts">
import { computed, inject, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useLiveRoomDashboard } from "./dashboard/useLiveRoomDashboard";

const {
  profile,
  metrics,
  recentHits,
  aiQueueStatus,
  hasEnabledKeywordRules,
} = useLiveRoomDashboard();

const router = useRouter();

interface StreamDanmakuRow {
  id: number;
  content: string;
  timestamp: number;
  sender?: {
    username?: string;
    guard_title?: string;
    medal?: { name: string; level: number } | null;
  };
  type?: string;
}

const store = inject<any>("danmakuStore");
const sourceDanmaku = (store?.source ?? ref<StreamDanmakuRow[]>([])) as { value: StreamDanmakuRow[] };
const matchedDanmaku = (store?.matched ?? ref<StreamDanmakuRow[]>([])) as { value: StreamDanmakuRow[] };
const scheduleSave = store?.scheduleSave || (() => {});

const streamWindowMinutes = 15;
const streamWindowMs = streamWindowMinutes * 60 * 1000;
const showMatchedOnly = ref(true);
const nowTick = ref(Date.now());

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("zh-CN", { hour12: false });
}

const withinTimeWindow = (ts: number) => nowTick.value - Number(ts || 0) <= streamWindowMs;

const rawStreamDanmaku = computed(() => {
  const list = showMatchedOnly.value ? matchedDanmaku.value : sourceDanmaku.value;
  return list.filter((d) => withinTimeWindow(d.timestamp));
});

const streamModeText = computed(() =>
  showMatchedOnly.value
    ? `当前显示：最近 ${streamWindowMinutes} 分钟命中弹幕`
    : `当前显示：最近 ${streamWindowMinutes} 分钟全量弹幕`,
);

function mapStreamRows(list: StreamDanmakuRow[]) {
  const resolveStableBadgeClass = (row: StreamDanmakuRow) => {
    // 颜色按用户稳定映射，避免新弹幕到来后因索引变化导致历史行“变色抖动”。
    const seed = `${row.sender?.username || "匿名"}:${row.sender?.medal?.name || ""}`;
    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) {
      hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
    }
    const idx = hash % 5;
    return idx === 0 ? "pink" : idx === 1 ? "blue" : idx === 2 ? "indigo" : idx === 3 ? "violet" : "amber";
  };

  return list.slice(0, 300).map((row, idx) => ({
    id: row.id,
    time: formatTime(row.timestamp),
    medal: row.sender?.medal?.name || row.sender?.guard_title || "",
    medalLevel: row.sender?.medal?.level || null,
    guardTitle: row.sender?.guard_title || "",
    username: row.sender?.username || "匿名",
    content: row.content,
    isSuperChat: row.type === "sc",
    badgeClass: resolveStableBadgeClass(row),
  }));
}

const pausedRows = ref<ReturnType<typeof mapStreamRows>>([]);

const streamRows = computed(() => {
  const rows = streamPaused.value ? pausedRows.value : mapStreamRows(rawStreamDanmaku.value);
  // 底部最新：从上到下按时间旧 -> 新。
  return [...rows].reverse();
});

/**
 * 礼物 / SC 综合事件流（最近窗口）。
 * - 仅从全量 sourceDanmaku 中提取 gift/sc 事件
 * - 统一做轻展示，便于主播快速回看互动价值事件
 */
const recentGiftScRecords = computed(() => {
  return sourceDanmaku.value
    .filter((row) => withinTimeWindow(row.timestamp) && (row.type === "gift" || row.type === "sc"))
    .slice(0, 12)
    .map((row) => ({
      id: row.id,
      username: row.sender?.username || "匿名",
      type: row.type === "sc" ? "sc" : "gift",
      content: String(row.content || ""),
      parsed: (() => {
        const text = String(row.content || "");
        if (row.type === "sc") {
          const amount = /SC\s*¥\s*([0-9]+(?:\.[0-9]+)?)/i.exec(text)?.[1] || "0";
          return { scAmount: amount, giftName: "", giftCount: "" };
        }

        const giftMatch = /送出\s+(.+?)\s+x\s*([0-9]+)/.exec(text);
        if (giftMatch) {
          const giftName = giftMatch[1] || "礼物";
          const count = giftMatch[2] || "1";
          return { scAmount: "", giftName, giftCount: count };
        }

        return { scAmount: "", giftName: "未知赠礼", giftCount: "1" };
      })(),
    }));
});

const queueDotClass = (key: string) => `dot-${key}`;

/**
 * 当 recentHits 全部是“未识别规则”时，通常表示当前未配置关键词规则，
 * 或命中来源是系统事件回退键。此时使用更友好的空态提示替代列表噪音。
 */
const hasOnlyUnknownHits = computed(() => !hasEnabledKeywordRules.value);

const visibleRecentHits = computed(() => {
  return hasOnlyUnknownHits.value ? [] : recentHits.value;
});

const streamPaused = ref(false);
const streamCardHeight = ref<number | null>(null);
const hitCardHeight = ref<number | null>(null);
const DASHBOARD_LAYOUT_STORAGE_KEY = "dashboard-layout-heights-v1";
const streamListEl = ref<HTMLElement | { $el?: HTMLElement } | null>(null);
const streamStickToBottom = ref(true);
const pendingLatestCount = ref(0);
const lastSeenNewestId = ref<number | null>(null);
const sendText = ref("");
const sending = ref(false);
const sendError = ref("");
const status = ref<{ connected: boolean; roomId: number | null }>({ connected: false, roomId: null });
const maxLines = 500;

const canSend = computed(() => status.value.connected && !!sendText.value.trim() && !sending.value);

/**
 * 切换“命中/全量”显示模式。
 * 关键点：若当前处于暂停状态，列表展示的是 pausedRows 快照，
 * 必须在切换时同步刷新快照，否则会出现“按钮状态变了但列表没变”的错觉。
 */
const toggleMatchedView = () => {
  showMatchedOnly.value = !showMatchedOnly.value;
  if (streamPaused.value) {
    pausedRows.value = mapStreamRows(rawStreamDanmaku.value);
  }
};

const goToKeywordRules = () => {
  router.push("/keywords");
};

/**
 * 播放/暂停实时流：
 * - 暂停：冻结当前窗口内的列表快照
 * - 播放：恢复实时计算结果
 */
const toggleStreamPaused = () => {
  if (!streamPaused.value) {
    pausedRows.value = mapStreamRows(rawStreamDanmaku.value);
    streamPaused.value = true;
    return;
  }
  streamPaused.value = false;
};

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
    sourceDanmaku.value.unshift({
      id: now,
      content: text,
      sender: { uid: 0, username: "我", is_admin: false, is_vip: false },
      timestamp: now,
      roomId: status.value.roomId ?? 0,
      color: 0xffffff,
      mode: 1,
      type: "sent",
    });
    if (sourceDanmaku.value.length > maxLines) sourceDanmaku.value.length = maxLines;
    scheduleSave();
    sendText.value = "";
  } catch (err: any) {
    sendError.value = err?.message || "发送失败";
  } finally {
    sending.value = false;
  }
}

function handleSendEnter() {
  void handleSend();
}

let offConnected: (() => void) | null = null;
let offDisconnected: (() => void) | null = null;
let tickTimer: number | null = null;

type ResizeTarget = "stream" | "hit";
let activeResizeTarget: ResizeTarget | null = null;
let dragStartY = 0;
let dragStartHeight = 0;

function getStreamResizeBounds() {
  const viewport = Math.max(720, window.innerHeight || 0);
  const min = 420;
  // 左侧实时流最多占到视口约 82%，防止撑爆后把底部工具区挤压异常。
  const max = Math.max(560, Math.floor(viewport * 0.82));
  return { min, max };
}

function getHitResizeBounds() {
  const viewport = Math.max(720, window.innerHeight || 0);
  const min = 130;
  // 关键词命中上限：不超过视口约 55%，避免把右下两个模块挤压到不可用。
  const hardMax = Math.max(260, Math.floor(viewport * 0.55));

  const rightGrid = document.querySelector(".right-grid") as HTMLElement | null;
  if (!rightGrid) return { min, max: hardMax };

  // 基于当前右列总高度再做一次约束，预留下面模块至少 190px + gap。
  const rightGridHeight = Math.max(0, Math.floor(rightGrid.getBoundingClientRect().height));
  const structuralMax = Math.max(min, rightGridHeight - 200);
  return { min, max: Math.max(min, Math.min(hardMax, structuralMax)) };
}

const streamCardStyle = computed(() => {
  return streamCardHeight.value ? { height: `${streamCardHeight.value}px` } : undefined;
});

const hitCardStyle = computed(() => {
  return hitCardHeight.value ? { height: `${hitCardHeight.value}px` } : undefined;
});

const rightGridStyle = computed(() => {
  if (!hitCardHeight.value) return undefined;
  // 当用户手动调整关键词命中高度时，右侧第一行跟随该高度。
  // 空态下给一个更贴内容的下限，避免第一行过高造成中间空洞。
  const contentFloor = hasOnlyUnknownHits.value ? 132 : 160;
  const firstRow = Math.max(contentFloor, hitCardHeight.value);
  return {
    gridTemplateRows: `${firstRow}px minmax(0, 1fr)`,
  };
});

function persistLayoutHeights() {
  if (streamCardHeight.value || hitCardHeight.value) {
    try {
      localStorage.setItem(
        DASHBOARD_LAYOUT_STORAGE_KEY,
        JSON.stringify({
          streamCardHeight: streamCardHeight.value,
          hitCardHeight: hitCardHeight.value,
        }),
      );
    } catch {
      // 忽略本地存储不可用场景
    }
    return;
  }

  // 全部恢复默认时清理存储，避免带着过期高度配置。
  try {
    localStorage.removeItem(DASHBOARD_LAYOUT_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function onResizeMove(e: MouseEvent) {
  if (!activeResizeTarget) return;
  const delta = e.clientY - dragStartY;
  if (activeResizeTarget === "stream") {
    const bounds = getStreamResizeBounds();
    const next = Math.max(bounds.min, Math.min(bounds.max, Math.round(dragStartHeight + delta)));
    streamCardHeight.value = next;
    return;
  }
  const bounds = getHitResizeBounds();
  const next = Math.max(bounds.min, Math.min(bounds.max, Math.round(dragStartHeight + delta)));
  hitCardHeight.value = next;
}

function stopResize() {
  persistLayoutHeights();
  activeResizeTarget = null;
  window.removeEventListener("mousemove", onResizeMove);
  window.removeEventListener("mouseup", stopResize);
}

function resetResize(target: ResizeTarget) {
  if (target === "stream") {
    streamCardHeight.value = null;
  } else {
    hitCardHeight.value = null;
  }
  persistLayoutHeights();
}

function scrollToLatest() {
  const el = getStreamListElement();
  if (!el) return;
  // 用户显式点击 Latest 后，恢复“贴底跟随”状态。
  streamStickToBottom.value = true;
  pendingLatestCount.value = 0;
  el.scrollTop = el.scrollHeight;
}

function clearStreamDanmaku() {
  sourceDanmaku.value = [];
  matchedDanmaku.value = [];
  pausedRows.value = [];
  pendingLatestCount.value = 0;
  lastSeenNewestId.value = null;
  scheduleSave();
}

function onStreamScroll() {
  const el = getStreamListElement();
  if (!el) return;
  const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 20;
  streamStickToBottom.value = nearBottom;
  if (nearBottom) {
    pendingLatestCount.value = 0;
    const newest = streamRows.value.at(-1);
    lastSeenNewestId.value = newest ? Number(newest.id) : null;
  }
}

function getStreamListElement(): HTMLElement | null {
  if (!streamListEl.value) return null;
  if (streamListEl.value instanceof HTMLElement) return streamListEl.value;
  if (streamListEl.value.$el instanceof HTMLElement) return streamListEl.value.$el;
  return null;
}

function startResize(target: ResizeTarget, e: MouseEvent) {
  e.preventDefault();
  activeResizeTarget = target;
  dragStartY = e.clientY;
  if (target === "stream") {
    const card = (e.currentTarget as HTMLElement)?.closest(".stream-card") as HTMLElement | null;
    const bounds = getStreamResizeBounds();
    dragStartHeight = streamCardHeight.value || card?.getBoundingClientRect().height || 560;
    dragStartHeight = Math.max(bounds.min, Math.min(bounds.max, Math.round(dragStartHeight)));
  } else {
    const card = (e.currentTarget as HTMLElement)?.closest(".hit-card") as HTMLElement | null;
    const bounds = getHitResizeBounds();
    dragStartHeight = hitCardHeight.value || card?.getBoundingClientRect().height || 260;
    dragStartHeight = Math.max(bounds.min, Math.min(bounds.max, Math.round(dragStartHeight)));
  }
  window.addEventListener("mousemove", onResizeMove);
  window.addEventListener("mouseup", stopResize);
}

onMounted(async () => {
  try {
    const raw = localStorage.getItem(DASHBOARD_LAYOUT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { streamCardHeight?: number; hitCardHeight?: number };
      const stream = Number(parsed.streamCardHeight || 0);
      const hit = Number(parsed.hitCardHeight || 0);
      if (Number.isFinite(stream) && stream > 0) streamCardHeight.value = stream;
      if (Number.isFinite(hit) && hit > 0) hitCardHeight.value = hit;
    }
  } catch {
    // 忽略本地存储损坏场景
  }

  const api = window.danmakuAPI;
  if (!api) return;

  try {
    status.value = await api.getStatus();
  } catch {
    status.value = { connected: false, roomId: null };
  }

  offConnected = api.onConnected((payload: any) => {
    const roomId = payload?.roomId ?? payload?.params?.roomId ?? status.value.roomId;
    status.value = { connected: true, roomId };
  });

  offDisconnected = api.onDisconnected(() => {
    status.value = { connected: false, roomId: null };
  });

  tickTimer = window.setInterval(() => {
    nowTick.value = Date.now();
  }, 15000);

  pausedRows.value = mapStreamRows(rawStreamDanmaku.value);

  streamStickToBottom.value = true;
  void nextTick(() => {
    scrollToLatest();
  });
});

watch(streamRows, async () => {
  const newest = streamRows.value.at(-1);
  const newestId = newest ? Number(newest.id) : null;
  if (newestId == null) return;

  if (streamStickToBottom.value && !streamPaused.value) {
    lastSeenNewestId.value = newestId;
    pendingLatestCount.value = 0;
    await nextTick();
    scrollToLatest();
    return;
  }

  if (lastSeenNewestId.value == null) {
    lastSeenNewestId.value = newestId;
    return;
  }

  if (newestId !== lastSeenNewestId.value) {
    pendingLatestCount.value += 1;
  }
});

onUnmounted(() => {
  offConnected?.();
  offDisconnected?.();
  stopResize();
  if (tickTimer) {
    window.clearInterval(tickTimer);
    tickTimer = null;
  }
});
</script>

<template>
  <div class="page boundary-page">
    <section class="dash-overview card-shell">
      <div class="room-identity metric-segment">
        <div class="room-avatar" aria-hidden="true">
          <img v-if="profile.avatar" :src="profile.avatar" alt="主播头像" class="room-avatar-img" />
          <span v-else>🩵</span>
        </div>
        <div class="room-meta">
          <div class="room-title-row">
            <h2 class="room-title">{{ profile.name }}</h2>
            <span v-if="profile.live" class="live-badge">LIVE</span>
          </div>
          <p class="room-subline">
            房间号：{{ profile.roomId }}
            <span class="dot">·</span>
            人气：{{ profile.popularityText }}
            <span class="dot">·</span>
            关注：{{ profile.followersText }}
          </p>
        </div>
      </div>

      <div class="metric-grid">
        <div v-for="item in metrics" :key="item.key" class="metric-item metric-segment">
          <span class="metric-label">{{ item.label }}</span>
          <strong class="metric-value" :class="`tone-${item.tone}`">{{ item.value.toLocaleString() }}</strong>
        </div>
      </div>
    </section>

    <section class="dash-main-grid">
      <article class="card-shell stream-card" :style="streamCardStyle">
        <header class="card-head">
          <div class="title-group">
            <h3>实时弹幕流</h3>
            <button
              type="button"
              class="pill mode-toggle"
              :class="showMatchedOnly ? 'is-matched' : 'is-all'"
              @click="toggleMatchedView"
              :title="showMatchedOnly ? '切换到全量弹幕' : '切换到命中弹幕'"
            >
              {{ showMatchedOnly ? '已显示命中' : '未显示命中' }}
            </button>
            <button
              type="button"
              class="pill control"
              :class="streamPaused ? 'is-paused' : 'is-running'"
              @click="toggleStreamPaused"
              :aria-label="streamPaused ? '开始' : '暂停'"
              :title="streamPaused ? '开始' : '暂停'"
            >
              <span class="control-icon" :class="streamPaused ? 'is-play' : 'is-pause'">
                {{ streamPaused ? '▶' : '⏸' }}
              </span>
            </button>
            <button
              type="button"
              class="pill jump-latest"
              title="显示最新弹幕（最下面）"
              @click="scrollToLatest"
            >
              Latest
            </button>
            <button
              type="button"
              class="pill clear-stream"
              title="清空实时弹幕"
              @click="clearStreamDanmaku"
            >
              清空
            </button>
          </div>
          <p class="stream-mode-desc">{{ streamModeText }}</p>
        </header>

        <transition-group ref="streamListEl" tag="ul" class="stream-list" @scroll="onStreamScroll">
          <li v-for="row in streamRows" :key="row.id" :class="['stream-row', { 'is-superchat': row.isSuperChat }]">
            <span class="stream-time">{{ row.time }}</span>
            <span v-if="row.medal" class="stream-medal" :class="row.badgeClass">
              <span class="stream-medal-name">{{ row.medal }}</span>
              <span v-if="row.medalLevel" class="stream-medal-level">{{ row.medalLevel }}</span>
            </span>
            <span v-else class="stream-medal-empty" aria-hidden="true"></span>
            <span class="stream-user">
              <span v-if="row.isSuperChat" class="sc-mark">SC</span>
              <span
                v-if="row.guardTitle === '舰长' || row.guardTitle === '提督' || row.guardTitle === '总督'"
                class="guard-mark"
                :class="`guard-${row.guardTitle}`"
              >
                {{ row.guardTitle }}
              </span>
              {{ row.username }}:
            </span>
            <span class="stream-content">{{ row.content }}</span>
          </li>
        </transition-group>

        <button
          v-if="!streamStickToBottom && pendingLatestCount > 0"
          type="button"
          class="new-danmaku-bubble"
          @click="scrollToLatest"
        >
          有 {{ pendingLatestCount }} 条新弹幕
        </button>

        <div class="stream-separator" aria-hidden="true"></div>

        <div class="stream-toolbar">
          <label class="toolbar-input" for="stream-send-input">
            <span class="filter-icon">💬</span>
            <input
              id="stream-send-input"
              v-model="sendText"
              class="toolbar-input-field"
              type="text"
              placeholder="输入要发送的弹幕（回车发送）"
              @keydown.enter.prevent="handleSendEnter"
            />
          </label>
          <button class="toolbar-send-btn" type="button" :disabled="!canSend" @click="handleSend">
            {{ sending ? "发送中..." : "发送" }}
          </button>
          <span v-if="sendError" class="toolbar-send-error">{{ sendError }}</span>
        </div>
        <div
          class="card-resize-handle"
          title="拖拽调整高度（双击恢复默认）"
          @mousedown="startResize('stream', $event)"
          @dblclick="resetResize('stream')"
        ></div>
      </article>

      <aside class="right-grid" :style="rightGridStyle">
        <article class="card-shell hit-card" :style="hitCardStyle">
          <header class="card-head">
            <h3>关键词命中 <small>（最近）</small></h3>
            <button class="action-link action-link-btn" type="button" @click="goToKeywordRules">查看规则</button>
          </header>
          <div v-if="hasOnlyUnknownHits" class="hit-empty-state">
            <p class="hit-empty-title">当前未配置关键词规则</p>
            <p class="hit-empty-desc">请先在“关键词规则”中添加规则，命中面板会展示真实关键词统计。</p>
          </div>
          <div v-else-if="visibleRecentHits.length === 0" class="hit-empty-state">
            <p class="hit-empty-title">最近暂无关键词命中</p>
            <p class="hit-empty-desc">可以继续观察弹幕，或到“关键词规则”里新增匹配词。</p>
          </div>
          <ul v-else class="hit-list">
            <li v-for="row in visibleRecentHits" :key="row.id" class="hit-row">
              <template v-if="row.id === '_no_keyword_rules'">
                <div class="hit-main">
                  <p><strong>尚未配置关键词规则</strong></p>
                  <p class="muted">请前往“关键词匹配”页面添加关键词后，这里会显示真实命中统计。</p>
                </div>
              </template>
              <template v-else>
                <div class="hit-main">
                  <p><strong>关键词：</strong>{{ row.keyword }}</p>
                  <p class="muted">回复方式：{{ row.mode }}</p>
                </div>
                <div class="hit-side">
                  <span class="muted">优先级：{{ row.priority }}</span>
                  <em>{{ row.count }}</em>
                </div>
              </template>
            </li>
          </ul>
          <div
            class="card-resize-handle"
            title="拖拽调整高度（双击恢复默认）"
            @mousedown="startResize('hit', $event)"
            @dblclick="resetResize('hit')"
          ></div>
        </article>

        <div class="right-subgrid">
          <article class="card-shell queue-card">
            <header class="card-head">
              <h3>AI 队列状态</h3>
              <a class="action-link" href="javascript:void(0)">查看队列</a>
            </header>
            <ul class="queue-list">
              <li v-for="item in aiQueueStatus" :key="item.key" class="queue-row">
                <span class="queue-left"><i class="state-dot" :class="queueDotClass(item.key)" />{{ item.label }}</span>
                <strong>{{ item.value }}</strong>
              </li>
            </ul>
          </article>

          <article class="card-shell records-card">
            <header class="card-head">
              <h3>礼物 / SC 综合展示</h3>
            </header>
            <ul class="record-list">
              <li v-for="item in recentGiftScRecords" :key="item.id" class="record-row gift-sc-row">
                <strong>{{ item.username }}</strong>
                <template v-if="item.type === 'sc'">
                  <span class="muted gift-sc-kind">SC</span>
                  <span class="gift-sc-amount">¥{{ item.parsed.scAmount }}</span>
                </template>
                <template v-else>
                  <span class="gift-sc-name">{{ item.parsed.giftName }}</span>
                  <span class="gift-sc-count">×{{ item.parsed.giftCount }}</span>
                </template>
              </li>
              <li v-if="recentGiftScRecords.length === 0" class="empty-inline">最近暂无礼物或 SC 事件</li>
            </ul>
          </article>
        </div>
      </aside>
    </section>
  </div>
</template>

<style scoped>
@import "../styles/live-room-dashboard.css";
</style>
