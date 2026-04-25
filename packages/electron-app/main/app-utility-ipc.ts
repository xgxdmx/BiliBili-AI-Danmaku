// ============================================================
// App Utility IPC - 应用级工具类 IPC（更新检查 / 外链打开）
//
// 职责：
//   1. 注册 app:checkUpdate（查询 GitHub 最新发布）
//   2. 注册 shell:openExternal（系统浏览器打开链接）
//   3. 提供版本号纯数字比较，避免语义字符串误判
// ============================================================

import { app, ipcMain, shell } from "electron";

type CheckUpdateResult =
  | {
      status: "ok";
      currentVersion: string;
      latestVersion: string;
      hasUpdate: boolean;
      releaseUrl: string;
      releaseNotes: string;
    }
  | {
      status: "error";
      message: string;
    };

function parseVersionNumbers(version: string): number[] {
  return (String(version).match(/\d+/g) || []).map(Number);
}

/**
 * 比较 latest 是否严格高于 current（按数字段逐位比较）。
 */
function hasNewerVersion(currentVersion: string, latestVersion: string): boolean {
  const currentNums = parseVersionNumbers(currentVersion);
  const latestNums = parseVersionNumbers(latestVersion);
  const maxLen = Math.max(currentNums.length, latestNums.length);

  for (let i = 0; i < maxLen; i += 1) {
    const current = currentNums[i] ?? 0;
    const latest = latestNums[i] ?? 0;
    if (latest > current) return true;
    if (latest < current) return false;
  }

  return false;
}

/**
 * 拉取 GitHub latest release 并生成前端可直接消费的更新结果。
 */
async function checkLatestRelease(): Promise<CheckUpdateResult> {
  try {
    const currentVersion = app.getVersion();
    const resp = await fetch("https://api.github.com/repos/xgxdmx/BiliBili-AI-Danmaku/releases/latest", {
      headers: { "User-Agent": "BiliBili-AI-Danmaku-UpdateCheck" },
      signal: AbortSignal.timeout(8000),
    });

    if (!resp.ok) {
      return { status: "error", message: `GitHub 返回 ${resp.status}` };
    }

    const data = (await resp.json()) as { tag_name?: string; html_url?: string; body?: string };
    const latestVersion = String(data.tag_name || "").replace(/^v/, "");
    if (!latestVersion) {
      return { status: "error", message: "无法解析最新版本号" };
    }

    return {
      status: "ok",
      currentVersion,
      latestVersion,
      hasUpdate: hasNewerVersion(currentVersion, latestVersion),
      releaseUrl: data.html_url || "https://github.com/xgxdmx/BiliBili-AI-Danmaku/releases/latest",
      releaseNotes: data.body || "",
    };
  } catch (error: unknown) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "检查更新失败",
    };
  }
}

/**
 * 注册应用工具类 IPC。
 */
export function registerAppUtilityIpcHandlers(): void {
  ipcMain.handle("app:checkUpdate", async () => {
    return checkLatestRelease();
  });

  ipcMain.handle("shell:openExternal", async (_event, url: string) => {
    try {
      await shell.openExternal(url);
      return { status: "ok" };
    } catch (error: unknown) {
      return {
        status: "error",
        message: error instanceof Error ? error.message : "打开链接失败",
      };
    }
  });
}
