// ============================================================
// Runtime Cache - 退出前清理 Electron 运行缓存
//
// 职责：
//   1. 收集主窗口与登录窗口涉及的 Session
//   2. 在退出前清理 HTTP cache 与可再生缓存存储
//   3. 控制清理超时，避免退出流程被缓存清理阻塞
// ============================================================

import { type BrowserWindow, session as electronSession } from "electron";

/**
 * Electron 41 文档允许清理的可再生缓存类存储。
 * 注意：appcache 已不在当前 API 支持列表中，因此不能继续传入。
 */
const CLEARABLE_RUNTIME_STORAGES = ["shadercache", "cachestorage", "serviceworkers"] as const;

type ClearableRuntimeStorage = (typeof CLEARABLE_RUNTIME_STORAGES)[number];

async function withTimeout(task: Promise<unknown>, timeoutMs: number): Promise<void> {
  await Promise.race([
    task.then(() => undefined).catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

/**
 * 退出前清理 Electron/Chromium 运行缓存（仅清理可再生缓存，不动业务配置）。
 * 目标：减少 Roaming 下的缓存残留，同时避免影响 config.json 等业务数据。
 */
export async function clearElectronRuntimeCachesOnExit(options: {
  mainWindow: BrowserWindow | null;
  biliLoginWindow: BrowserWindow | null;
}): Promise<void> {
  const sessions = new Set<Electron.Session>();

  // 默认会话（主窗口通常在这里）
  sessions.add(electronSession.defaultSession);

  // 主窗口会话
  if (options.mainWindow && !options.mainWindow.isDestroyed()) {
    sessions.add(options.mainWindow.webContents.session);
  }

  // 登录窗口会话
  if (options.biliLoginWindow && !options.biliLoginWindow.isDestroyed()) {
    sessions.add(options.biliLoginWindow.webContents.session);
  }

  for (const ses of sessions) {
    // HTTP 缓存
    await withTimeout(ses.clearCache(), 1500);

    // 仅清理可再生缓存类存储，不清理 localStorage/indexedDB/cookies
    const storages: ClearableRuntimeStorage[] = [...CLEARABLE_RUNTIME_STORAGES];
    await withTimeout(ses.clearStorageData({ storages }), 1500);
  }
}
