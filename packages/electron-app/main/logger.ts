// ============================================================
// Logger - 所有环境写日志，开发环境额外输出到控制台
// ============================================================

import { app } from "electron";
import { mkdirSync } from "node:fs";
import { appendFile, rename, stat, unlink } from "node:fs/promises";
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

const MAX_LOG_BYTES = 2 * 1024 * 1024; // 2MB
const ROTATED_LOG_SUFFIX = ".1";
let logQueue: string[] = [];
let flushing = false;
let rotateCheckCounter = 0;

async function rotateLogIfNeeded(logFilePath: string): Promise<void> {
  // 每 80 条日志检查一次文件大小，避免每条都 stat。
  rotateCheckCounter += 1;
  if (rotateCheckCounter % 80 !== 0) return;

  try {
    const st = await stat(logFilePath);
    if (st.size < MAX_LOG_BYTES) return;

    const rotatedPath = `${logFilePath}${ROTATED_LOG_SUFFIX}`;
    try {
      await unlink(rotatedPath);
    } catch {
      // ignore if no rotated file exists
    }
    await rename(logFilePath, rotatedPath);
  } catch {
    // ignore stat/rename failures
  }
}

async function flushLogs(): Promise<void> {
  if (flushing) return;
  flushing = true;

  try {
    const logFilePath = getLogFilePath();
    const logDir = dirname(logFilePath);
    mkdirSync(logDir, { recursive: true });

    while (logQueue.length > 0) {
      const chunk = logQueue.splice(0, 120).join("");
      try {
        await appendFile(logFilePath, chunk, "utf8");
        await rotateLogIfNeeded(logFilePath);
      } catch {
        // ignore log write failures
      }
    }
  } finally {
    flushing = false;
    if (logQueue.length > 0) {
      void flushLogs();
    }
  }
}

function writeLog(level: string, args: unknown[]): void {
  logQueue.push(formatLogLine(level, args));
  void flushLogs();
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
