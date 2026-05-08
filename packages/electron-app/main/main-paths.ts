// ============================================================
// Main Paths - 主进程路径解析模块
//
// 职责：
//   1) 统一解析 danmaku-core 目录（开发态 / 打包态）
//   2) 统一解析 Python 解释器路径（优先项目 .venv）
//   3) 统一解析打包 runtime 可执行文件路径
//   4) 统一解析 anchor 查询脚本与 preload 脚本路径
//
// 设计原则：
//   - 纯路径决策，不做业务逻辑
//   - 输入稳定（baseDirname），输出可预测
//   - 便于在 index.ts 中复用，降低主入口复杂度
// ============================================================

import { app } from "electron";
import { existsSync } from "fs";
import { join } from "path";

/** 判断是否开发态（Vite dev server / Node 模式）。 */
function isDevMode(): boolean {
  return Boolean(process.env.ELECTRON_RENDERER_URL || process.env.ELECTRON_RUN_AS_NODE);
}

/**
 * 解析 danmaku-core 根目录。
 * - 开发态：回到仓库 packages/danmaku-core
 * - 打包态：读取 resources/danmaku-core
 */
export function resolveDanmakuCoreDir(baseDirname: string): string {
  if (isDevMode()) {
    return join(baseDirname, "..", "..", "..", "..", "packages", "danmaku-core");
  }
  const resourcesPath = process.resourcesPath || app.getAppPath();
  return join(resourcesPath, "danmaku-core");
}

/**
 * 解析 Python 解释器路径。
 * - 优先使用项目内 .venv（确保依赖版本与打包脚本一致）
 * - 回退到系统 python / python3
 */
export function resolvePythonPath(baseDirname: string): string {
  const isWin = process.platform === "win32";
  const venvPython = isWin
    ? join(baseDirname, "..", "..", "..", "..", ".venv", "Scripts", "python.exe")
    : join(baseDirname, "..", "..", "..", "..", ".venv", "bin", "python");
  if (existsSync(venvPython)) return venvPython;
  return isWin ? "python" : "python3";
}

/**
 * 解析 danmaku runtime 可执行文件路径（打包态优先）。
 * 按平台扫描候选文件，返回首个存在路径；未命中返回 null。
 */
export function resolveDanmakuRuntimePath(baseDirname: string): string | null {
  const base = resolveDanmakuCoreDir(baseDirname);
  const isWin = process.platform === "win32";
  const candidates = isWin
    ? [
        join(base, "danmaku.exe"),
        join(base, "danmaku", "danmaku.exe"),
        join(base, "run.exe"),
        join(base, "run", "run.exe"),
      ]
    : [
        join(base, "danmaku"),
        join(base, "danmaku", "danmaku"),
        join(base, "run"),
        join(base, "run", "run"),
      ];
  return candidates.find((p) => existsSync(p)) || null;
}

/** 解析主播资料查询脚本路径（bilibili_core_api.py）。 */
export function resolveAnchorScriptPath(baseDirname: string): string {
  const base = resolveDanmakuCoreDir(baseDirname);
  const candidates = [join(base, "bilibili_core_api.py")];
  return candidates.find((p) => existsSync(p)) || candidates[0];
}

/**
 * 解析 preload 脚本路径。
 * 优先 mjs，兼容 js 产物，适配不同构建输出。
 */
export function resolvePreloadScriptPath(baseDirname: string): string {
  const candidates = [
    join(baseDirname, "../preload/index.mjs"),
    join(baseDirname, "../preload/index.js"),
  ];
  return candidates.find((p) => existsSync(p)) || candidates[0];
}
