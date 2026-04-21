// ============================================================
// Logger - 所有环境写日志，开发环境额外输出到控制台
// ============================================================

import { app } from "electron";
import { mkdirSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";

const isDev = !app.isPackaged;

function getLogFilePath(): string {
  return join(app.getPath("userData"), "logs", "main.log");
}

function formatLogLine(level: string, args: unknown[]): string {
  const message = args
    .map((arg) => {
      if (typeof arg === "string") return arg;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(" ");
  return `[${new Date().toISOString()}] [${level}] ${message}\n`;
}

function writeLog(level: string, args: unknown[]): void {
  try {
    const logFilePath = getLogFilePath();
    const logDir = dirname(logFilePath);
    mkdirSync(logDir, { recursive: true });
    appendFileSync(logFilePath, formatLogLine(level, args), "utf8");
  } catch {
    // ignore log write failures
  }
}

function devLog(...args: unknown[]): void {
  writeLog("INFO", args);
  if (isDev) {
    console.log("[Dev]", ...args);
  }
}

function devWarn(...args: unknown[]): void {
  writeLog("WARN", args);
  if (isDev) {
    console.warn("[Dev]", ...args);
  }
}

function errorLog(...args: unknown[]): void {
  writeLog("ERROR", args);
  console.error(...args);
}

/**
 * 日志策略：所有环境写入 userData/logs/main.log，
 * 开发环境额外输出到控制台，方便排查打包后运行问题。
 */
export const logger = {
  /** 记录 info 级别日志，dev 环境同步输出到控制台 */
  log: devLog,
  /** 记录 warn 级别日志，dev 环境同步输出到控制台 */
  warn: devWarn,
  /** 记录 error 级别日志，并输出到控制台 */
  error: errorLog,
  /** 当前是否为开发环境 */
  isDev,
  /** 当前日志文件路径 */
  get filePath() {
    return getLogFilePath();
  },
};
