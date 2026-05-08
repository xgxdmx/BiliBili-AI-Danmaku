// ============================================================
// Anchor Profile - 主播资料查询子进程编排
//
// 职责：
//   1) 启动 Python/runtime 子进程执行 anchor 查询
//   2) 通过 stdin 传递凭证（避免 argv 泄露）
//   3) 收集 stdout/stderr、超时控制、错误归一
//   4) 维护查询子进程集合并在退出阶段统一兜底清理
//
// 设计要点：
//   - 子进程生命周期局部化，降低 index.ts 噪音
//   - 查询能力与清理能力成对提供，避免残留进程
// ============================================================

import { spawn, spawnSync, type ChildProcess } from "child_process";
import { resolveAnchorScriptPath, resolveDanmakuRuntimePath, resolvePythonPath } from "./main-paths";

/** 主播资料查询响应结构（与 Python asdict(profile) 对齐）。 */
export interface AnchorProfilePayload {
  room_id_input: number;
  room_id_real: number;
  anchor_uid: number;
  anchor_name: string;
  anchor_face: string;
  anchor_face_data: string;
  live_status: number;
  room_title: string;
  popularity: number;
  followers: number;
}

const anchorProfileChildren = new Set<ChildProcess>();

/**
 * 强制结束子进程（Windows 下优先 taskkill /T /F 结束整棵树）。
 * 作为兜底清理手段，不向上抛异常。
 */
function forceKillChildProcessTree(child: ChildProcess): void {
  const pid = child.pid;
  if (!pid) return;

  if (process.platform === "win32") {
    try {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      return;
    } catch {
      // 回退到普通 kill
    }
  }

  try {
    child.kill("SIGKILL");
  } catch {
    // ignore
  }
}

/**
 * 查询主播资料。
 *
 * 流程：
 * 1) 解析运行命令（打包 runtime 优先，否则 python + script）
 * 2) 启动子进程并通过 stdin 写入凭证 JSON
 * 3) 监听 stdout/stderr，超时 15s 自动强杀
 * 4) 退出码非 0 / 空输出 / JSON 解析失败都返回明确错误
 */
export async function fetchAnchorProfileByPython(
  roomId: number,
  baseDirname: string,
  credentials: { sessdata?: string; biliJct?: string; buvid3?: string } | null | undefined,
): Promise<AnchorProfilePayload> {
  const isDevMode = Boolean(process.env.ELECTRON_RENDERER_URL || process.env.ELECTRON_RUN_AS_NODE);
  const scriptPath = resolveAnchorScriptPath(baseDirname);
  const pythonPath = resolvePythonPath(baseDirname);
  const runtimePath = resolveDanmakuRuntimePath(baseDirname);

  const command = !isDevMode && runtimePath ? runtimePath : pythonPath;
  const args = !isDevMode && runtimePath
    ? ["anchor", String(roomId)]
    : ["-X", "utf8", scriptPath, String(roomId)];
  const credentialPayload = {
    sessdata: credentials?.sessdata || null,
    biliJct: credentials?.biliJct || null,
    buvid3: credentials?.buvid3 || null,
  };

  return await new Promise<AnchorProfilePayload>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
      },
    });
    anchorProfileChildren.add(child);

    try {
      child.stdin?.write(JSON.stringify(credentialPayload));
      child.stdin?.end();
    } catch {
      // ignore stdin write failures; child close handler will report real error
    }

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      forceKillChildProcessTree(child);
      anchorProfileChildren.delete(child);
      reject(new Error("主播信息查询超时"));
    }, 15000);

    child.stdout?.on("data", (buf: Buffer) => {
      stdout += buf.toString("utf-8");
    });
    child.stderr?.on("data", (buf: Buffer) => {
      stderr += buf.toString("utf-8");
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      anchorProfileChildren.delete(child);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      anchorProfileChildren.delete(child);
      if (code !== 0) {
        reject(new Error(`主播信息脚本退出异常(code=${code}): ${stderr.trim() || "unknown error"}`));
        return;
      }
      const text = stdout.trim();
      if (!text) {
        reject(new Error("主播信息脚本无输出"));
        return;
      }
      try {
        const parsed = JSON.parse(text) as AnchorProfilePayload;
        resolve(parsed);
      } catch (e) {
        reject(new Error(`主播信息解析失败: ${String(e)} | output=${text}`));
      }
    });
  });
}

/**
 * 清理所有主播资料查询临时子进程。
 * 用于应用退出阶段兜底，避免遗留孤儿进程。
 */
export function cleanupAnchorProfileChildren(): void {
  for (const child of anchorProfileChildren) {
    forceKillChildProcessTree(child);
  }
  anchorProfileChildren.clear();
}
