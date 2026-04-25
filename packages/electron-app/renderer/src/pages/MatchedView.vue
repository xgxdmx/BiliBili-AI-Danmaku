<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";

interface MatchedItem {
  id: number;
  content: string;
  sender: { uid: number; username: string; is_admin: boolean; is_vip: boolean; medal?: { name: string; level: number; color: number } | null };
  timestamp: number;
  roomId: number;
  color: number;
  matchedRule?: string;
  matchedGroups?: string[];
}

/* danmakuAPI type is declared globally via preload */

const matchedList = ref<MatchedItem[]>([]);

let cleanups: (() => void)[] = [];
onMounted(() => {
  const api = window.danmakuAPI;
  if (!api) return;
  cleanups.push(api.onDanmaku((d: any) => {
    if (d.isHighlighted || d.match) {
      matchedList.value.unshift({ ...d, matchedRule: d.match?.rule?.id, matchedGroups: d.match?.groups });
      if (matchedList.value.length > 500) matchedList.value.length = 500;
    }
  }));
});
onUnmounted(() => { cleanups.forEach(fn => fn()); cleanups = []; });

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("zh-CN", { hour12: false });
}
</script>

<template>
  <div class="page">
    <div class="page-header">
      <h2 class="page-title">匹配弹幕</h2>
      <span class="stat">仅显示命中关键词的弹幕</span>
    </div>

    <div v-if="matchedList.length === 0" class="empty-banner">
      <div class="empty-icon">🔍</div>
      <p>暂无匹配弹幕</p>
      <p class="empty-sub">配置关键词后，命中的弹幕会在此显示</p>
    </div>

    <div v-else class="match-scroll">
      <div v-for="d in matchedList" :key="d.id" class="m-item">
        <div class="m-top">
          <span class="m-badge">✦ 匹配</span>
          <span v-if="d.matchedRule" class="m-rule">{{ d.matchedRule }}</span>
          <span class="m-user">{{ d.sender?.username }}</span>
          <span class="m-time">{{ formatTime(d.timestamp) }}</span>
        </div>
        <div class="m-content">{{ d.content }}</div>
        <div v-if="d.matchedGroups?.length" class="m-groups">
          <span v-for="(g, i) in d.matchedGroups" :key="i" class="m-group">组{{ i + 1 }}: {{ g }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import "../styles/matched.css";
</style>
