// ============================================================
// Danmaku Routing - 弹幕路由判定纯函数
//
// 职责：
//   1. 标准化关键词 scope（both / quickReply / ai）
//   2. 计算固定回复是否有资格处理当前弹幕
//   3. 计算 AI 是否有资格处理当前弹幕
//
// 说明：
//   这里只做“可路由性”判定，不涉及发送、队列、配置读写副作用。
// ============================================================

export type KeywordScope = "both" | "quickReply" | "ai";

export type DanmakuRouteContext = {
  matchScope: KeywordScope;
  hasKeywordMatch: boolean;
  activeScopes: Set<KeywordScope>;
};

/** 将未知 scope 值规整为受支持枚举，默认 both。 */
export function resolveMatchScope(scope: unknown): KeywordScope {
  return scope === "quickReply" || scope === "ai" || scope === "both" ? scope : "both";
}

/**
 * 固定回复路由规则：
 * - scope=ai：固定回复可处理全部弹幕
 * - 命中关键词：固定回复可处理
 * - 未命中但存在 ai 作用域关键词：固定回复可绕过关键词过滤
 */
export function isQuickReplyEligible(context: DanmakuRouteContext): boolean {
  if (context.matchScope === "ai") return true;
  if (context.hasKeywordMatch) return true;
  return context.activeScopes.has("ai");
}

/**
 * AI 路由规则：
 * - scope=quickReply：AI 可处理全部弹幕
 * - 命中关键词：AI 可处理
 * - 未命中但存在 quickReply 作用域关键词：AI 可绕过关键词过滤
 */
export function isAiEligible(context: DanmakuRouteContext): boolean {
  if (context.matchScope === "quickReply") return true;
  if (context.hasKeywordMatch) return true;
  return context.activeScopes.has("quickReply");
}
