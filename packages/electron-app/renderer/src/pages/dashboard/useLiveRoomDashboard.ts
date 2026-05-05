import { computed, onMounted, onUnmounted, ref } from "vue";

/**
 * Dashboard 顶部房间资料（主播名、开播状态、房间号、人气、粉丝、头像）。
 *
 * 约束：
 * - 全部为“可直接展示”的字段，不在渲染层再做业务换算。
 * - 文本字段（popularityText/followersText）由主进程统一格式化（万/亿口径）。
 */
interface RoomProfile {
  name: string;
  live: boolean;
  roomId: number;
  popularityText: string;
  followersText: string;
  avatar: string;
}

/**
 * Dashboard 主面板快照。
 *
 * 说明：
 * - metrics: 统计卡片（弹幕/命中/队列/已回复）
 * - recentHits: 最近命中聚合（按规则聚合）
 * - recentRecords: 最近命中明细（时间线）
 * - aiQueueStatus: AI 队列状态分桶
 */
interface DashboardSnapshot {
  metrics: Array<{ key: string; label: string; value: number; tone: "blue" | "purple" | "green" }>;
  recentHits: Array<{ id: string; keyword: string; mode: "固定回复" | "AI" | "固定回复/AI"; priority: number; count: number }>;
  recentRecords: Array<{ id: string; time: string; title: string; mode: "固定回复" | "AI" | "固定回复/AI"; duration: string }>;
  aiQueueStatus: Array<{ key: "waiting" | "processing" | "done" | "failed"; label: string; value: number }>;
  hasEnabledKeywordRules: boolean;
}

/**
 * profile 默认值。
 *
 * 使用场景：
 * 1) 首次渲染（尚未拿到主进程数据）
 * 2) 主进程返回非 ok（例如未连接直播间）
 */
const DEFAULT_ROOM_PROFILE: RoomProfile = {
  name: "BiliBili",
  live: false,
  roomId: 0,
  popularityText: "0",
  followersText: "0",
  avatar: "",
};

/**
 * snapshot 默认值。
 *
 * 设计意图：
 * - 始终保证模板拿到完整结构，避免 v-for / 字段访问空值判断泛滥。
 */
const DEFAULT_DASHBOARD_SNAPSHOT: DashboardSnapshot = {
  metrics: [
    { key: "danmaku", label: "弹幕/分钟", value: 0, tone: "blue" },
    { key: "hit", label: "命中/分钟", value: 0, tone: "purple" },
    { key: "queue", label: "AI 队列", value: 0, tone: "green" },
    { key: "replied", label: "已回复", value: 0, tone: "green" },
  ],
  recentHits: [],
  recentRecords: [],
  aiQueueStatus: [
    { key: "waiting", label: "等待中", value: 0 },
    { key: "processing", label: "处理中", value: 0 },
    { key: "done", label: "已完成", value: 0 },
    { key: "failed", label: "失败", value: 0 },
  ],
  // 默认按“未配置规则”渲染，避免页面切换时先出现“最近暂无命中”再闪到“未配置规则”。
  hasEnabledKeywordRules: false,
};

/**
 * 组合器外的轻缓存。
 *
 * 目的：
 * - 页面重新挂载时可立即回显上一份 profile，减少“闪回默认值”的体感。
 * - 仅缓存房间资料（体量小、稳定）；snapshot 仍按实时轮询为准。
 */
let cachedRoomProfile: RoomProfile | null = null;

/**
 * Dashboard 视图数据组合器（renderer 轻适配层）
 *
 * 设计原则：
 * - 主进程负责业务统计与口径（snapshot + roomProfile）
 * - 渲染层只负责拉取、缓存、容错和输出给模板
 */
export function useLiveRoomDashboard() {
  /**
   * profile 响应式状态。
   * - 优先使用缓存，次选默认值。
   */
  const profile = ref<RoomProfile>(cachedRoomProfile ? { ...cachedRoomProfile } : { ...DEFAULT_ROOM_PROFILE });

  /**
   * snapshot 响应式状态。
   * - 初始化为完整默认结构，保证模板侧零空指针。
   */
  const snapshot = ref<DashboardSnapshot>({ ...DEFAULT_DASHBOARD_SNAPSHOT });

  /**
   * 轮询定时器句柄。
   * - 在 mounted 创建
   * - 在 unmounted 清理
   */
  let snapshotTimer: number | null = null;

  /**
   * 仅使用组合视图模型接口：一次获取 profile + snapshot。
   *
   * 说明：
   * - 当前分支已确认不需要旧接口兼容层，故移除 fallback 逻辑。
   * - IPC 抖动/异常时保留上一帧数据，避免 UI 抖动回空。
   */
  async function refreshDashboardViewModel(): Promise<void> {
    try {
      // 统一入口：一次拿到 profile + snapshot，避免双 IPC 竞态。
      const vmResp = await window.danmakuAPI.getDashboardViewModel();

      // 仅在响应成功且 data 存在时写入新状态。
      if (vmResp?.status === "ok" && vmResp.data) {
        // 更新房间资料（用于页面展示）
        profile.value = { ...vmResp.data.profile };

        // 同步到轻缓存，供下次重新挂载即时回显。
        cachedRoomProfile = { ...vmResp.data.profile };

        // 对每个数组字段做 Array.isArray 保护，避免异常 payload 污染状态。
        snapshot.value = {
          metrics: Array.isArray(vmResp.data.snapshot.metrics)
            ? vmResp.data.snapshot.metrics
            : DEFAULT_DASHBOARD_SNAPSHOT.metrics,
          recentHits: Array.isArray(vmResp.data.snapshot.recentHits) ? vmResp.data.snapshot.recentHits : [],
          recentRecords: Array.isArray(vmResp.data.snapshot.recentRecords) ? vmResp.data.snapshot.recentRecords : [],
          aiQueueStatus: Array.isArray(vmResp.data.snapshot.aiQueueStatus)
            ? vmResp.data.snapshot.aiQueueStatus
            : DEFAULT_DASHBOARD_SNAPSHOT.aiQueueStatus,
          hasEnabledKeywordRules: Boolean(vmResp.data.snapshot.hasEnabledKeywordRules),
        };

        // 成功分支到此结束，不执行下方兜底覆盖。
        return;
      }

      // 非 ok 响应：回退到默认空态（这是“明确失败”，不是网络抖动）。
      profile.value = { ...DEFAULT_ROOM_PROFILE };
      snapshot.value = { ...DEFAULT_DASHBOARD_SNAPSHOT };
    } catch {
      /**
       * 异常分支（IPC 瞬断/主进程忙等）：
       * - 不覆盖当前状态，保留上一帧
       * - 目标是“可读稳定”优先，避免面板闪空
       */
    }
  }

  /**
   * 挂载后生命周期：
   * 1) 立即拉一次，尽快填充真实数据
   * 2) 启动 3s 轮询，保证 dashboard 实时性
   */
  onMounted(async () => {
    await refreshDashboardViewModel();

    snapshotTimer = window.setInterval(() => {
      // void 明确忽略 Promise，防止未处理警告污染控制台。
      void refreshDashboardViewModel();
    }, 3000);
  });

  /**
   * 卸载生命周期：清理轮询，防止内存泄露与后台重复请求。
   */
  onUnmounted(() => {
    if (snapshotTimer) {
      window.clearInterval(snapshotTimer);
      snapshotTimer = null;
    }
  });

  /**
   * 以下 computed 的目的：
   * - 统一对外导出字段，模板按语义消费
   * - 后续若替换数据源，模板无需改动
   */
  const metrics = computed(() => snapshot.value.metrics);
  const recentHits = computed(() => snapshot.value.recentHits);
  const aiQueueStatus = computed(() => snapshot.value.aiQueueStatus);
  const recentRecords = computed(() => snapshot.value.recentRecords);
  const hasEnabledKeywordRules = computed(() => snapshot.value.hasEnabledKeywordRules);

  return {
    profile,
    metrics,
    recentHits,
    aiQueueStatus,
    recentRecords,
    hasEnabledKeywordRules,
  };
}
