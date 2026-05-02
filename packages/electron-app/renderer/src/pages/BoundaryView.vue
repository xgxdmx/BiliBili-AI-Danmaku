<script setup lang="ts">
import { computed, ref } from "vue";
import { useLiveRoomDashboard } from "./dashboard/useLiveRoomDashboard";

const {
  profile,
  metrics,
  recentDanmaku,
  recentHits,
  aiQueueStatus,
  recentRecords,
} = useLiveRoomDashboard();

const streamRows = computed(() => recentDanmaku.value.map((row, idx) => ({
  ...row,
  badgeClass: idx % 5 === 0 ? "pink" : idx % 5 === 1 ? "blue" : idx % 5 === 2 ? "indigo" : idx % 5 === 3 ? "violet" : "amber",
})));

const queueDotClass = (key: string) => `dot-${key}`;

const streamPaused = ref(true);
const keywordFilterInput = ref("");
const toggleStreamPaused = () => {
  streamPaused.value = !streamPaused.value;
};

const onSubmitKeywordFilter = () => {
  keywordFilterInput.value = keywordFilterInput.value.trim();
};
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
      <article class="card-shell stream-card">
        <header class="card-head">
          <div class="title-group">
            <h3>实时弹幕流</h3>
            <span class="pill active">已显示命中</span>
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
          </div>
        </header>

        <ul class="stream-list">
          <li v-for="row in streamRows" :key="row.id" class="stream-row">
            <span class="stream-time">{{ row.time }}</span>
            <span v-if="row.medal" class="stream-medal" :class="row.badgeClass">
              <span class="stream-medal-name">{{ row.medal }}</span>
              <span v-if="row.medalLevel" class="stream-medal-level">{{ row.medalLevel }}</span>
            </span>
            <span v-else class="stream-medal-empty" aria-hidden="true"></span>
            <span class="stream-user">{{ row.username }}: </span>
            <span class="stream-content">{{ row.content }}</span>
          </li>
        </ul>

        <div class="stream-separator" aria-hidden="true"></div>

        <div class="stream-toolbar">
          <label class="toolbar-input" for="stream-keyword-filter">
            <span class="filter-icon">⏷</span>
            <input
              id="stream-keyword-filter"
              v-model="keywordFilterInput"
              class="toolbar-input-field"
              type="text"
              placeholder="输入关键词过滤（回车添加）"
              @keydown.enter.prevent="onSubmitKeywordFilter"
            />
          </label>
          <label class="gift-toggle">
            <input type="checkbox" checked />
            <span>显示礼物 / SC</span>
          </label>
          <button class="toolbar-btn" type="button">⚙</button>
        </div>
      </article>

      <aside class="right-grid">
        <article class="card-shell hit-card">
          <header class="card-head">
            <h3>关键词命中 <small>（最近）</small></h3>
            <a class="action-link" href="javascript:void(0)">查看规则</a>
          </header>
          <ul class="hit-list">
            <li v-for="row in recentHits" :key="row.id" class="hit-row">
              <div class="hit-main">
                <p><strong>关键词：</strong>{{ row.keyword }}</p>
                <p class="muted">回复方式：{{ row.mode }}</p>
              </div>
              <div class="hit-side">
                <span class="muted">优先级：{{ row.priority }}</span>
                <em>{{ row.count }}</em>
              </div>
            </li>
          </ul>
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
              <h3>最近匹配记录</h3>
              <a class="action-link" href="javascript:void(0)">查看全部</a>
            </header>
            <ul class="record-list">
              <li v-for="item in recentRecords" :key="item.id" class="record-row">
                <span class="muted">{{ item.time }}</span>
                <strong>{{ item.title }}</strong>
                <span class="muted">{{ item.mode }}</span>
                <span>{{ item.duration }}</span>
              </li>
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
