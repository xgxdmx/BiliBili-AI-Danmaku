// ============================================================
// Dashboard Metrics Store（主进程聚合）
//
// 目标：
//   1) 在主进程统一维护 dashboard 的统计口径
//   2) 把 renderer 的“业务聚合”下沉，renderer 只做展示
//   3) 通过轻量内存缓冲 + 快照函数输出给 IPC
//
// 说明：
//   - 本模块是“纯聚合器”，不依赖窗口对象，不直接操作 IPC。
//   - index.ts 负责把 danmaku/gift/superchat 事件喂给本模块。
// ============================================================

import { getConfig } from "./config-store";
import type { AIRelayStatus } from "./ai-relay";

export interface DashboardKeywordHitItem {
  id: string;
  keyword: string;
  mode: "固定回复" | "AI" | "固定回复/AI";
  priority: number;
  count: number;
}

export interface DashboardRecentRecordItem {
  id: string;
  time: string;
  title: string;
  mode: "固定回复" | "AI" | "固定回复/AI";
  duration: string;
}

export interface DashboardSnapshotPayload {
  metrics: Array<{ key: string; label: string; value: number; tone: "blue" | "purple" | "green" }>;
  recentHits: DashboardKeywordHitItem[];
  recentRecords: DashboardRecentRecordItem[];
  aiQueueStatus: Array<{ key: "waiting" | "processing" | "done" | "failed"; label: string; value: number }>;
  hasEnabledKeywordRules: boolean;
}

const DASHBOARD_BUFFER_MAX = 500;
/** “最近”口径窗口（15 分钟），用于命中统计与记录列表。 */
const DASHBOARD_WINDOW_MS = 15 * 60 * 1000;

function formatDashboardTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("zh-CN", { hour12: false });
}

/**
 * 创建 dashboard 统计存储实例。
 *
 * 设计原则：
 * - ingest* 只负责“写入标准化事件”
 * - buildSnapshot 只负责“按统一口径读出”
 */
export function createDashboardMetricsStore() {
  /** 全量弹幕缓冲：用于弹幕/分钟等全量统计。 */
  const danmakuBuffer: any[] = [];
  /** 命中弹幕缓冲：用于命中/分钟、关键词命中、最近匹配记录。 */
  const matchedBuffer: any[] = [];

  /**
   * 头插写入 ring buffer。
   * - 新数据总在前面，便于“最近记录”直接切片
   * - 超过上限直接截断，控制内存稳定
   */
  const pushBuffer = (target: any[], item: any): void => {
    target.unshift(item);
    if (target.length > DASHBOARD_BUFFER_MAX) target.length = DASHBOARD_BUFFER_MAX;
  };

  /**
   * 摄入普通弹幕。
   * 若弹幕带 match/isHighlighted，则同时进入 matchedBuffer。
   */
  const ingestDanmaku = (data: any): void => {
    pushBuffer(danmakuBuffer, data);
    if (data?.isHighlighted || data?.match) {
      pushBuffer(matchedBuffer, data);
    }
  };

  /**
   * 摄入礼物事件。
   * 礼物默认不进入 matchedBuffer（除非上游明确打上 match）。
   */
  const ingestGift = (data: any): void => {
    pushBuffer(danmakuBuffer, {
      id: Number(data?.giftId || Date.now()),
      content: `🎁 ${data?.sender?.username || "用户"} 送出 ${data?.giftName || "礼物"} x${Number(data?.count || 1)}`,
      sender: data?.sender,
      timestamp: Number(data?.timestamp || Date.now()),
      roomId: Number(data?.roomId || 0),
      type: "gift",
    });
  };

  /**
   * 摄入 SC 事件。
   * 业务上 SC 需要被主播重点关注，因此同时进入全量与命中缓冲。
   */
  const ingestSuperChat = (data: any): void => {
    const sc = {
      id: Number(data?.id || Date.now()),
      content: `💎 SC ¥${data?.price}: ${data?.content}`,
      sender: data?.sender,
      timestamp: Number(data?.timestamp || Date.now()),
      roomId: Number(data?.roomId || 0),
      type: "sc",
      isHighlighted: true,
      match: { rule: { id: "_superchat_auto", type: "event" } },
    };
    pushBuffer(danmakuBuffer, sc);
    pushBuffer(matchedBuffer, sc);
  };

  /**
   * 生成 dashboard 快照。
   *
   * 口径说明：
   * 1) metrics:
   *    - 弹幕/分钟：全量缓冲最近 60s 条数
   *    - 命中/分钟：命中缓冲最近 60s 条数
   *    - AI 队列/已回复：直接来自 latestAIStatus
   * 2) recentHits:
   *    - 最近 15 分钟命中弹幕聚合
   *    - 先按命中次数降序，再按最近命中时间降序
   * 3) recentRecords:
   *    - 最近命中明细（最多 5 条）
   *    - title 显示 pattern（可读）而非 ruleId(UUID)
   */
  const buildSnapshot = (latestAIStatus: AIRelayStatus): DashboardSnapshotPayload => {
    const now = Date.now();
    const matchedScoped = matchedBuffer.filter((d) => now - Number(d?.timestamp || 0) <= DASHBOARD_WINDOW_MS);
    const danmakuPerMinute = danmakuBuffer.filter((d) => now - Number(d?.timestamp || 0) <= 60_000).length;
    const hitPerMinute = matchedBuffer.filter((d) => now - Number(d?.timestamp || 0) <= 60_000).length;

    // 读取当前配置中的关键词规则，用于把 ruleId 反查为可读 pattern/scope。
    const keywordRules = Array.isArray(getConfig().keywords) ? getConfig().keywords : [];
    const enabledKeywordRules = keywordRules.filter((rule) => {
      const pattern = String(rule?.pattern || "").trim();
      return rule?.enabled !== false && pattern.length > 0;
    });
    const hasEnabledKeywordRules = enabledKeywordRules.length > 0;
    const keywordRuleMap = new Map(keywordRules.map((rule) => [String(rule.id), rule]));

    type HitAggregate = {
      key: string;
      keyword: string;
      mode: "固定回复" | "AI" | "固定回复/AI";
      count: number;
      latestTimestamp: number;
    };

    // 聚合键优先 ruleId；若缺失，则降级为 fallback:keyword。
    const hitAgg = new Map<string, HitAggregate>();
    for (const d of matchedScoped) {
      const ruleId = String(d?.match?.rule?.id || "");
      const rule = ruleId ? keywordRuleMap.get(ruleId) : undefined;
      const scope = rule?.scope || "both";
      const mode = scope === "quickReply" ? "固定回复" : scope === "ai" ? "AI" : "固定回复/AI";
      const keyword = String(rule?.pattern || "未识别规则");
      const key = ruleId || `fallback:${keyword}`;
      const ts = Number(d?.timestamp || 0);
      const existing = hitAgg.get(key);
      if (!existing) {
        hitAgg.set(key, { key, keyword, mode, count: 1, latestTimestamp: ts });
      } else {
        existing.count += 1;
        if (ts > existing.latestTimestamp) existing.latestTimestamp = ts;
      }
    }

    let recentHits: DashboardKeywordHitItem[] = [...hitAgg.values()]
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return b.latestTimestamp - a.latestTimestamp;
      })
      .slice(0, 5)
      .map((item, idx) => ({
        id: item.key,
        keyword: item.keyword,
        mode: item.mode,
        priority: idx + 1,
        count: item.count,
      }));

    // 当“没有启用中的关键词规则”时，注入一个稳定占位项，
    // 让 renderer 始终展示“请先配置关键词规则”的空态提示（而不是空白）。
    if (!hasEnabledKeywordRules) {
      recentHits = [{
        id: "_no_keyword_rules",
        keyword: "未识别规则",
        mode: "固定回复/AI",
        priority: 1,
        count: 0,
      }];
    }

    const recentRecords: DashboardRecentRecordItem[] = matchedScoped.slice(0, 5).map((d) => {
      const ruleId = String(d?.match?.rule?.id || "");
      const rule = ruleId ? keywordRuleMap.get(ruleId) : undefined;
      const scope = rule?.scope || "both";
      const mode = scope === "quickReply" ? "固定回复" : scope === "ai" ? "AI" : "固定回复/AI";
      const ts = Number(d?.timestamp || now);
      const ageSec = Math.max(1, Math.floor((now - ts) / 1000));
      const mm = String(Math.floor(ageSec / 60)).padStart(2, "0");
      const ss = String(ageSec % 60).padStart(2, "0");
      return {
        id: String(d?.id || ts),
        time: formatDashboardTime(ts),
        title: String(rule?.pattern || "未识别规则"),
        mode,
        duration: `${mm}:${ss}`,
      };
    });

    return {
      metrics: [
        { key: "danmaku", label: "弹幕/分钟", value: danmakuPerMinute, tone: "blue" },
        { key: "hit", label: "命中/分钟", value: hitPerMinute, tone: "purple" },
        { key: "queue", label: "AI 队列", value: Number(latestAIStatus.queueLength || 0), tone: "green" },
        { key: "replied", label: "已回复", value: Number(latestAIStatus.sentCount || 0), tone: "green" },
      ],
      recentHits,
      recentRecords,
      aiQueueStatus: [
        { key: "waiting", label: "等待中", value: Number(latestAIStatus.queueLength || 0) },
        { key: "processing", label: "处理中", value: latestAIStatus.processing ? 1 : 0 },
        { key: "done", label: "已完成", value: Number(latestAIStatus.sentCount || 0) },
        { key: "failed", label: "失败", value: Number(latestAIStatus.failedCount || 0) },
      ],
      hasEnabledKeywordRules,
    };
  };

  return {
    ingestDanmaku,
    ingestGift,
    ingestSuperChat,
    buildSnapshot,
  };
}
