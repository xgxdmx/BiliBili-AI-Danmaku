// ============================================================
// Shared Types - Bilibili Danmaku Claw
// ============================================================

// ─── Bilibili Danmaku Types ────────────────────────────────

/** 弹幕消息 */
export interface DanmakuMessage {
  /** 弹幕ID */
  id: number;
  /** 弹幕内容 */
  content: string;
  /** 发送者信息 */
  sender: DanmakuSender;
  /** 发送时间戳 (ms) */
  timestamp: number;
  /** 原始房间ID */
  roomId: number;
  /** 弹幕颜色 (十进制RGB) */
  color: number;
  /** 弹幕模式 (1=滚动 4=底部 5=顶部) */
  mode: number;
}

/** 弹幕发送者信息 */
export interface DanmakuSender {
  /** 用户 UID */
  uid: number;
  /** 用户名 */
  username: string;
  /** 是否房管 */
  is_admin: boolean;
  /** 是否VIP */
  is_vip: boolean;
  /** 大航海等级 (0=无, 1=总督, 2=提督, 3=舰长) */
  guard_level?: number;
  /** 大航海称号 (总督/提督/舰长，无则为空字符串) */
  guard_title?: string;
  /** 粉丝牌信息 */
  medal?: {
    name: string;
    level: number;
    color: number;
  };
}

/** 礼物消息 */
export interface GiftMessage {
  /** 礼物 ID */
  giftId: number;
  /** 礼物名称 */
  giftName: string;
  /** 礼物数量 */
  count: number;
  /** 金币类型 */
  coinType: "gold" | "silver";
  /** 礼物总价 */
  totalPrice: number;
  /** 发送者信息 */
  sender: DanmakuSender;
  /** 原始房间 ID */
  roomId: number;
  /** 发送时间戳 (ms) */
  timestamp: number;
}

/** SuperChat 消息 */
export interface SuperChatMessage {
  /** 消息 ID */
  id: number;
  /** 消息内容 */
  content: string;
  /** 价格 (元) */
  price: number;
  /** 发送者信息 */
  sender: DanmakuSender;
  /** 原始房间 ID */
  roomId: number;
  /** 发送时间戳 (ms) */
  timestamp: number;
}

// ─── Keyword Filter Types ──────────────────────────────────

/** 关键词规则 */
export interface KeywordRule {
  /** 规则唯一标识 */
  id: string;
  /** 关键词文本或正则表达式 */
  pattern: string;
  /** 匹配类型 */
  type: "keyword" | "regex";
  /** 是否启用 */
  enabled: boolean;
  /** 是否区分大小写 (仅 keyword 类型) */
  caseSensitive: boolean;
  /** 备注说明 */
  description?: string;
  /** 过滤范围: both=都匹配, quickReply=仅固定回复, ai=仅AI回复 */
  scope?: "both" | "quickReply" | "ai";
}

/** 关键词匹配结果 */
export interface KeywordMatchResult {
  /** 匹配到的关键词规则 */
  rule: KeywordRule;
  /** 匹配到的弹幕消息 */
  danmaku: DanmakuMessage;
  /** 正则匹配的捕获分组 (仅 regex 类型) */
  groups?: string[];
}

// ─── JSON-RPC Protocol (Node <-> Python) ───────────────────

/** JSON-RPC 2.0 请求 */
export interface JsonRpcRequest {
  /** 协议版本，固定为 "2.0" */
  jsonrpc: "2.0";
  /** 请求唯一标识 */
  id: string;
  /** 调用方法名 */
  method: string;
  /** 调用参数 */
  params?: Record<string, unknown>;
}

/** JSON-RPC 2.0 响应 */
export interface JsonRpcResponse {
  /** 协议版本，固定为 "2.0" */
  jsonrpc: "2.0";
  /** 对应请求的唯一标识 */
  id: string;
  /** 调用成功时的返回值 */
  result?: unknown;
  /** 调用失败时的错误信息 */
  error?: {
    /** 错误代码 */
    code: number;
    /** 错误描述 */
    message: string;
    /** 附加错误数据 */
    data?: unknown;
  };
}

/** JSON-RPC 2.0 通知 (无 id，不期望响应) */
export interface JsonRpcNotification {
  /** 协议版本，固定为 "2.0" */
  jsonrpc: "2.0";
  /** 通知方法名 */
  method: string;
  /** 通知参数 */
  params?: Record<string, unknown>;
}

// ─── Python ↔ Node Protocol ────────────────────────────────

/** Python -> Node 通知方法名 */
export type PythonNotificationMethod =
  | "danmaku.received"      // 收到弹幕
  | "danmaku.gift"          // 收到礼物
  | "danmaku.superchat"     // 收到SC
  | "connection.connected"   // 连接成功
  | "connection.disconnected"// 断开连接
  | "connection.error";      // 连接错误

/** Node -> Python 调用方法名 */
export type PythonRequestMethod =
  | "start"          // 开始监听
  | "stop"           // 停止监听
  | "sendDanmaku"    // 发送弹幕
  | "getRoomInfo"    // 获取房间信息
  | "getStatus";     // 获取状态

// ─── App Configuration (Electron) ──────────────────────────

/** 应用配置 (持久化) */
export interface AppConfig {
  /** 已保存的房间列表 */
  rooms: RoomConfig[];
  /** 全局关键词规则 */
  globalKeywords: KeywordRule[];
  /** 主题 */
  theme: "light" | "dark" | "system";
  /** 弹幕显示设置 */
  display: {
    maxLines: number;
    showAvatar: boolean;
    showMedal: boolean;
    filterEmpty: boolean;
  };
}

/** 房间配置 */
export interface RoomConfig {
  roomId: number;
  name: string;
  keywords: KeywordRule[];
  enabled: boolean;
  minMedalLevel?: number;
  /** B站登录凭证 */
  credentials: {
    sessdata: string;
    biliJct: string;
    buvid3: string;
  };
}

// ─── Event Types ───────────────────────────────────────────

/** 弹幕事件类型 */
export type DanmakuEventType = "danmaku" | "gift" | "superchat" | "system";

/** 弹幕事件（统一结构） */
export interface DanmakuEvent {
  /** 事件类型 */
  type: DanmakuEventType;
  /** 事件数据 */
  data: DanmakuMessage | GiftMessage | SuperChatMessage | SystemMessage;
  /** 事件时间戳 (ms) */
  timestamp: number;
}

/** 系统消息 */
export interface SystemMessage {
  /** 消息级别 */
  level: "info" | "warn" | "error";
  /** 消息内容 */
  message: string;
}
