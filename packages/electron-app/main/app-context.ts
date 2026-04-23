// ============================================================
// Main App Context - 主进程共享运行时上下文
//
// 职责：
//   1. 统一暴露主进程运行时状态的 getter / setter
//   2. 降低各模块重复注入同一批依赖的胶水代码
//   3. 作为 main/ 下模块之间共享状态的收敛接口
// ============================================================

import type { BrowserWindow, Tray } from "electron";
import type { AIRelayManager, AIRelayStatus } from "./ai-relay";
import type { CloseWindowDialogAction } from "./app-shell";
import type { CloseWindowBehavior } from "./config-store";
import type { DanmakuService } from "./danmaku-service";
import type { QuickReplyEngine } from "./quick-reply-engine";

/**
 * 主进程共享运行时上下文。
 * 统一承载各模块需要读取/更新的状态，避免每个模块维护一套重复的 getter/setter 参数表。
 */
export interface MainAppContext {
  getMainWindow: () => BrowserWindow | null;
  setMainWindow: (window: BrowserWindow | null) => void;
  getBiliLoginWindow: () => BrowserWindow | null;
  setBiliLoginWindow: (window: BrowserWindow | null) => void;

  getDanmakuService: () => DanmakuService | null;
  setDanmakuService: (service: DanmakuService | null) => void;
  getAIRelay: () => AIRelayManager | null;
  setAIRelay: (relay: AIRelayManager | null) => void;
  getQuickReplyEngine: () => QuickReplyEngine | null;
  setQuickReplyEngine: (engine: QuickReplyEngine | null) => void;

  getAppTray: () => Tray | null;
  setAppTray: (tray: Tray | null) => void;

  getIsAppQuitting: () => boolean;
  setIsAppQuitting: (value: boolean) => void;
  getPendingCloseDecisionRequestId: () => string | null;
  setPendingCloseDecisionRequestId: (value: string | null) => void;

  getLatestAIStatus: () => AIRelayStatus;
  setLatestAIStatus: (status: AIRelayStatus) => void;

  getCloseWindowBehavior: () => CloseWindowBehavior;
  setCloseWindowBehavior: (value: Exclude<CloseWindowBehavior, "ask">) => void;
  applyCloseDecision: (action: CloseWindowDialogAction, remember: boolean) => void;
}
