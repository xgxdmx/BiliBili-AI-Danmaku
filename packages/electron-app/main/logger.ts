// ============================================================
// Logger - 开发环境输出日志，生产环境静默
// ============================================================

import { app } from "electron";

const isDev = !app.isPackaged;

function devLog(...args: unknown[]): void {
  if (!isDev) return;
  console.log("[Dev]", ...args);
}

function devWarn(...args: unknown[]): void {
  if (!isDev) return;
  console.warn("[Dev]", ...args);
}

/**
 * 开发日志：仅在 dev 环境输出到控制台。
 * 生产环境下静默，不写入任何日志。
 */
export const logger = {
  /** 开发环境 console.log，生产环境静默 */
  log: devLog,
  /** 开发环境 console.warn，生产环境静默 */
  warn: devWarn,
  /** 始终输出的错误日志（dev 和 prod 都输出） */
  error: console.error,
  /** 当前是否为开发环境 */
  isDev,
};