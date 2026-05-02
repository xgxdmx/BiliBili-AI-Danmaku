import { computed, inject, onMounted, onUnmounted, ref } from "vue";

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
  isHighlighted?: boolean;
  match?: { rule?: { id?: string }; groups?: string[] };
}

interface KeywordRule {
  id: string;
  pattern: string;
  scope?: "both" | "quickReply" | "ai";
}

interface RoomProfile {
  name: string;
  live: boolean;
  roomId: number;
  popularityText: string;
  followersText: string;
  avatar: string;
}

const DEFAULT_ROOM_PROFILE: RoomProfile = {
  name: "BiliBili",
  live: false,
  roomId: 0,
  popularityText: "0",
  followersText: "0",
  avatar: "",
};

let cachedRoomProfile: RoomProfile | null = null;
let cachedRoomProfileRoomId = 0;

function formatCountText(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}亿`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)}万`;
  return value.toLocaleString("zh-CN");
}

function normalizeAvatarUrl(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("//")) return `https:${raw}`;
  if (raw.startsWith("http://")) return raw.replace(/^http:\/\//i, "https://");
  if (raw.startsWith("https://")) return raw;
  if (raw.startsWith("/")) return `https:${raw}`;
  return raw;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("zh-CN", { hour12: false });
}

function inferBadgeName(d: DanmakuDisplay): string {
  if (d.sender?.guard_title) return d.sender.guard_title;
  if (d.sender?.medal?.name) return d.sender.medal.name;
  return "观众";
}

function inferMedal(d: DanmakuDisplay): { name: string; level: number | null } {
  if (d.sender?.medal?.name) {
    const level = Number(d.sender.medal.level || 0);
    return {
      name: d.sender.medal.name,
      level: level > 0 ? level : null,
    };
  }
  return { name: "", level: null };
}

export function useLiveRoomDashboard() {
  const store = inject<any>("danmakuStore");
  const sourceDanmaku = (store?.source ?? ref<DanmakuDisplay[]>([])) as { value: DanmakuDisplay[] };
  const matchedDanmaku = (store?.matched ?? ref<DanmakuDisplay[]>([])) as { value: DanmakuDisplay[] };

  const profile = ref<RoomProfile>(cachedRoomProfile ? { ...cachedRoomProfile } : { ...DEFAULT_ROOM_PROFILE });

  const keywordRuleMap = ref<Map<string, KeywordRule>>(new Map());
  const aiStatus = ref<Awaited<ReturnType<typeof window.danmakuAPI.getAIStatus>> | null>(null);
  let offAIStatus: (() => void) | null = null;

  const recentDanmaku = computed(() => sourceDanmaku.value.slice(0, 300).map((d) => {
    const medal = inferMedal(d);
    return {
    id: d.id,
    time: formatTime(d.timestamp),
    badge: inferBadgeName(d),
    medal: medal.name,
    medalLevel: medal.level,
    username: d.sender?.username || "匿名",
    content: d.content,
    };
  }));

  const recentHits = computed(() => matchedDanmaku.value.slice(0, 5).map((d, idx) => {
    const ruleId = d.match?.rule?.id;
    const rule = ruleId ? keywordRuleMap.value.get(ruleId) : undefined;
    const scope = rule?.scope || "both";
    const scopeLabel = scope === "quickReply" ? "固定回复" : scope === "ai" ? "AI" : "固定回复/AI";
    return {
      id: d.id,
      keyword: rule?.pattern || `命中规则 ${idx + 1}`,
      mode: scopeLabel,
      priority: idx + 1,
      count: Math.max(3, 23 - idx * 5),
    };
  }));

  const aiQueueStatus = computed(() => {
    const waiting = Number(aiStatus.value?.queueLength || 0);
    const processing = aiStatus.value?.processing ? 1 : 0;
    const completed = Number(aiStatus.value?.sentCount || 0);
    const failed = Number(aiStatus.value?.failedCount || 0);
    return [
      { key: "waiting", label: "等待中", value: waiting },
      { key: "processing", label: "处理中", value: processing },
      { key: "done", label: "已完成", value: completed },
      { key: "failed", label: "失败", value: failed },
    ];
  });

  const recentRecords = computed(() => matchedDanmaku.value.slice(0, 5).map((d) => ({
    id: d.id,
    time: formatTime(d.timestamp),
    title: d.match?.rule?.id || "命中规则",
    mode: "占位",
    duration: "00:0" + ((d.id % 7) + 2),
  })));

  const danmakuPerMinute = computed(() => {
    const now = Date.now();
    return sourceDanmaku.value.filter((d) => now - d.timestamp <= 60_000).length;
  });

  const hitPerMinute = computed(() => {
    const now = Date.now();
    return matchedDanmaku.value.filter((d) => now - d.timestamp <= 60_000).length;
  });

  const metrics = computed(() => [
    { key: "danmaku", label: "弹幕/分钟", value: danmakuPerMinute.value, tone: "blue" },
    { key: "hit", label: "命中/分钟", value: hitPerMinute.value, tone: "purple" },
    { key: "queue", label: "AI 队列", value: Number(aiStatus.value?.queueLength || 0), tone: "green" },
    { key: "replied", label: "已回复", value: Number(aiStatus.value?.sentCount || 0), tone: "green" },
  ]);

  onMounted(async () => {
    let connected = false;
    let currentRoomId = 0;
    try {
      const status = await window.danmakuAPI.getStatus();
      connected = Boolean(status?.connected);
      currentRoomId = Number(status?.roomId || 0);
      if (connected && currentRoomId > 0) {
        profile.value.roomId = currentRoomId;
      } else {
        profile.value = { ...DEFAULT_ROOM_PROFILE };
        cachedRoomProfile = { ...DEFAULT_ROOM_PROFILE };
        cachedRoomProfileRoomId = 0;
      }
    } catch {
      profile.value = { ...DEFAULT_ROOM_PROFILE };
      cachedRoomProfile = { ...DEFAULT_ROOM_PROFILE };
      cachedRoomProfileRoomId = 0;
    }

    try {
      const canReuseCached = connected && currentRoomId > 0
        && cachedRoomProfile
        && cachedRoomProfileRoomId === currentRoomId
        && cachedRoomProfile.name !== DEFAULT_ROOM_PROFILE.name;

      if (canReuseCached) {
        profile.value = { ...cachedRoomProfile! };
      } else if (connected && profile.value.roomId > 0) {
        const resp = await window.danmakuAPI.getAnchorProfile(profile.value.roomId);
        if (resp?.status === "ok" && resp.data) {
          profile.value.name = resp.data.anchor_name || profile.value.name;
          profile.value.live = Number(resp.data.live_status || 0) === 1;
          profile.value.roomId = Number(resp.data.room_id_real || profile.value.roomId);
          profile.value.popularityText = formatCountText(Number(resp.data.popularity || 0));
          profile.value.followersText = formatCountText(Number(resp.data.followers || 0));
          const avatarDataUrl = String(resp.data.anchor_face_data || "");
          const avatarUrl = normalizeAvatarUrl(String(resp.data.anchor_face || ""));
          profile.value.avatar = avatarDataUrl || avatarUrl;
          cachedRoomProfile = { ...profile.value };
          cachedRoomProfileRoomId = currentRoomId;
        }
      } else {
        profile.value = { ...DEFAULT_ROOM_PROFILE };
        cachedRoomProfile = { ...DEFAULT_ROOM_PROFILE };
        cachedRoomProfileRoomId = 0;
      }
    } catch {
      if (!connected) {
        profile.value = { ...DEFAULT_ROOM_PROFILE };
        cachedRoomProfile = { ...DEFAULT_ROOM_PROFILE };
        cachedRoomProfileRoomId = 0;
      }
    }

    try {
      const config = await window.danmakuAPI.getConfig();
      const rules = Array.isArray(config?.keywords) ? config.keywords : [];
      keywordRuleMap.value = new Map(rules.map((r: any) => [r.id, { id: r.id, pattern: r.pattern, scope: r.scope }]));
    } catch {
      keywordRuleMap.value = new Map();
    }

    try {
      aiStatus.value = await window.danmakuAPI.getAIStatus();
    } catch {
      aiStatus.value = null;
    }

    offAIStatus = window.danmakuAPI.onAIStatus((data) => {
      aiStatus.value = data;
    });
  });

  onUnmounted(() => {
    offAIStatus?.();
  });

  return {
    profile,
    metrics,
    recentDanmaku,
    recentHits,
    aiQueueStatus,
    recentRecords,
  };
}
