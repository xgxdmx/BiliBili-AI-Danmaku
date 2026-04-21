// ============================================================
// Danmaku Service - Electron 主进程弹幕服务
// 管理 Python 子进程和关键词过滤
// ============================================================

import { EventEmitter } from "events";
import { spawn, spawnSync, type ChildProcess } from "child_process";
import { randomUUID } from "crypto";
import { join } from "path";
import * as fs from "fs";
import { logger } from "./logger";

// ─── Inline Types ────────────────────────────────────────────
// 弹幕消息、礼物消息、SC 消息和关键词规则的内联类型定义。
// 这些类型仅在本模块内部使用，跨进程传输通过 JSON 序列化。

interface DanmakuMessage {
  id: number;
  content: string;
  sender: {
    uid: number;
    username: string;
    is_admin: boolean;
    is_vip: boolean;
    guard_level?: number;
    guard_title?: string;
    medal?: { name: string; level: number; color: number } | null;
  };
  timestamp: number;
  roomId: number;
  color: number;
  mode: number;
}

interface GiftMessage {
  giftId: number;
  giftName: string;
  count: number;
  coinType?: "gold" | "silver";
  totalPrice?: number;
  sender: DanmakuMessage["sender"];
  timestamp: number;
  roomId: number;
}

interface SuperChatMessage {
  id: number;
  content: string;
  price: number;
  sender: DanmakuMessage["sender"];
  timestamp: number;
  roomId: number;
}

interface KeywordRule {
  id: string;
  pattern: string;
  type: "keyword" | "regex";
  enabled: boolean;
  caseSensitive: boolean;
  description?: string;
  scope?: "both" | "quickReply" | "ai";
}

// ─── Keyword Filter ──────────────────────────────────────────
// 关键词过滤器：维护启用的规则列表和编译好的正则缓存，
// 对每条弹幕执行子串/正则匹配，返回命中的规则和捕获组。

class KeywordFilter {
  private rules: KeywordRule[] = [];
  private regexCache: Map<string, RegExp> = new Map();
  private minMedalLevel = 0;

  updateRules(rules: KeywordRule[], minMedalLevel = 0): void {
    this.rules = rules.filter((r) => r.enabled);
    this.minMedalLevel = Math.max(0, Number(minMedalLevel || 0));
    this.regexCache.clear();
    for (const rule of this.rules) {
      if (rule.type === "regex") {
        try { this.regexCache.set(rule.id, new RegExp(rule.pattern)); }
        catch { /* skip invalid regex */ }
      }
    }
  }

  /** 返回所有启用规则的 scope 集合，用于判断未命中弹幕的路由 */
  getActiveScopes(): Set<"both" | "quickReply" | "ai"> {
    const scopes = new Set<"both" | "quickReply" | "ai">();
    for (const rule of this.rules) {
      scopes.add(rule.scope || "both");
    }
    return scopes;
  }

  match(danmaku: DanmakuMessage): { rule: KeywordRule; groups?: string[] } | null {
    const medalLevel = Number(danmaku.sender?.medal?.level || 0);
    if (medalLevel < this.minMedalLevel) {
      return null;
    }

    // 没有规则时，默认匹配所有（scope=both）
    if (this.rules.length === 0) {
      return { rule: { id: "_default", pattern: "", type: "keyword", enabled: true, caseSensitive: false, scope: "both" } };
    }
    
    for (const rule of this.rules) {
      const content = danmaku.content;
      if (rule.type === "keyword") {
        const hay = rule.caseSensitive ? content : content.toLowerCase();
        const needle = rule.caseSensitive ? rule.pattern : rule.pattern.toLowerCase();
        if (hay.includes(needle)) return { rule };
      } else if (rule.type === "regex") {
        const regex = this.regexCache.get(rule.id);
        if (!regex) continue;
        const m = regex.exec(content);
        if (m) return { rule, groups: m.length > 1 ? m.slice(1) : undefined };
      }
    }
    return null;
  }
}

// ─── Danmaku Service ─────────────────────────────────────────
// 弹幕服务主类：管理 Python 子进程的生命周期，
// 通过 stdio JSON-RPC 2.0 双向通信，处理弹幕/礼物/SC 事件。

interface DanmakuServiceConfig {
  roomId: number;
  credentials: { sessdata: string; biliJct: string; buvid3: string };
  keywords: KeywordRule[];
  minMedalLevel?: number;
}

export class DanmakuService extends EventEmitter {
  private process: ChildProcess | null = null;
  private keywordFilter = new KeywordFilter();
  private config: DanmakuServiceConfig | null = null;
  private pendingRequests: Map<string, {
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();
  private buffer = "";
  private _connected = false;

  private logBinaryDiagnostics(scriptPath: string, usePython: boolean, pythonPath: string): void {
    const packagedBasePath = process.resourcesPath ? join(process.resourcesPath, "danmaku-core") : "";
    const candidates = [
      scriptPath,
      packagedBasePath ? join(packagedBasePath, "run", "run.exe") : "",
      packagedBasePath ? join(packagedBasePath, "run", "run") : "",
      packagedBasePath ? join(packagedBasePath, "run.exe") : "",
      packagedBasePath ? join(packagedBasePath, "run") : "",
      packagedBasePath ? join(packagedBasePath, "run.py") : "",
    ].filter(Boolean);

    const snapshot = candidates.map((candidate) => {
      const exists = fs.existsSync(candidate);
      return {
        path: candidate,
        exists,
        size: exists ? fs.statSync(candidate).size : null,
      };
    });

    logger.log("DanmakuService binary diagnostics", {
      isPackaged: !logger.isDev,
      processResourcesPath: process.resourcesPath,
      usePython,
      pythonPath,
      selectedScript: scriptPath,
      candidates: snapshot,
      logFilePath: logger.filePath,
    });
  }

  /**
   * 启动弹幕服务。
   * 流程：解析脚本路径 → 创建子进程 → 绑定事件 → 等待连接就绪 → 发送 start 请求。
   */
  async start(config: DanmakuServiceConfig): Promise<void> {
    this.config = config;
    this.keywordFilter.updateRules(config.keywords, config.minMedalLevel ?? 0);
    logger.log("DanmakuService.start, roomId:", config.roomId);

    const { scriptPath, usePython, pythonPath } = this.resolveScriptPaths();
    this.logBinaryDiagnostics(scriptPath, usePython, pythonPath);
    logger.log("Spawning:", usePython ? pythonPath : scriptPath, "script:", scriptPath);
    this.process = this.spawnProcess(scriptPath, usePython, pythonPath);
    this.bindProcessEvents(this.process);
    await this.waitForConnection();

    await this.request("start", {
      roomId: config.roomId,
      credentials: config.credentials,
    });
    this._connected = true;
  }

  /** 解析 Python 脚本和解释器路径 */
  private resolveScriptPaths(): { scriptPath: string; usePython: boolean; pythonPath: string } {
    const isDevMode = !!process.env.ELECTRON_RENDERER_URL;
    const isWin = process.platform === "win32";
    let basePath: string;
    let pythonPath: string;

    if (isDevMode || process.env.ELECTRON_RUN_AS_NODE) {
      basePath = join(__dirname, "..", "..", "..", "..", "packages", "danmaku-core");
      const venvPython = isWin
        ? join(__dirname, "..", "..", "..", "..", ".venv", "Scripts", "python.exe")
        : join(__dirname, "..", "..", "..", "..", ".venv", "bin", "python");
      pythonPath = fs.existsSync(venvPython) ? venvPython : (isWin ? "python" : "python3");
    } else {
      const { app } = require("electron");
      const resourcesPath = process.resourcesPath || app.getAppPath();
      basePath = join(resourcesPath, "danmaku-core");
      pythonPath = isWin ? "python" : "python3";
    }

    const exePath = join(basePath, "run.exe");
    const binPath = join(basePath, "run");
    const runtimeExePath = join(basePath, "run", "run.exe");
    const runtimeBinPath = join(basePath, "run", "run");
    const pyPath = join(basePath, "run.py");

    if (!isDevMode) {
      if (isWin && fs.existsSync(runtimeExePath)) return { scriptPath: runtimeExePath, usePython: false, pythonPath };
      if (!isWin && fs.existsSync(runtimeBinPath)) return { scriptPath: runtimeBinPath, usePython: false, pythonPath };
      if (isWin && fs.existsSync(exePath)) return { scriptPath: exePath, usePython: false, pythonPath };
      if (!isWin && fs.existsSync(binPath)) return { scriptPath: binPath, usePython: false, pythonPath };
      if (fs.existsSync(pyPath)) return { scriptPath: pyPath, usePython: true, pythonPath };
      logger.error("DanmakuService resolveScriptPaths failed", {
        basePath,
        runtimeExePath,
        runtimeBinPath,
        exePath,
        binPath,
        pyPath,
        resourcesPath: process.resourcesPath,
        appPath: require("electron").app.getAppPath(),
      });
      throw new Error("未找到 danmaku-core 脚本");
    }
    return { scriptPath: pyPath, usePython: true, pythonPath };
  }

  /** 根据平台和脚本类型创建子进程 */
  private spawnProcess(scriptPath: string, usePython: boolean, pythonPath: string): ChildProcess {
    if (!fs.existsSync(scriptPath)) {
      logger.error("DanmakuService spawn target does not exist", { scriptPath, usePython, pythonPath });
      throw new Error(`Danmaku core binary not found: ${scriptPath}`);
    }

    if (process.platform === "win32") {
      if (usePython) {
        return spawn(pythonPath, ["-X", "utf8", scriptPath, "receiver"], {
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env, PYTHONUNBUFFERED: "1", PYTHONUTF8: "1" },
          windowsHide: true,
        });
      }
      return spawn(scriptPath, ["receiver"], {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    }
    return spawn(
      usePython ? pythonPath : scriptPath,
      usePython ? ["-X", "utf8", scriptPath, "receiver"] : ["receiver"],
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
      },
    );
  }

  /** 绑定子进程的 stdout/stderr/close/error 事件 */
  private bindProcessEvents(proc: ChildProcess): void {
    let stderrData = "";
    proc.stdout?.on("data", (data: Buffer) => { this.handleStdout(data.toString("utf-8")); });
    proc.stderr?.on("data", (data: Buffer) => {
      try {
        const text = data.toString("utf-8");
        if (text.includes("unknown cmd=")) return;
        if (text.trim()) {
          stderrData += text;
          for (const line of text.trim().split("\n")) {
            if (line.trim()) logger.warn("[Python]", line.trim());
          }
        }
      } catch {}
    });
    proc.on("close", (code) => {
      logger.warn("Python process closed", { code, stderrPreview: stderrData.substring(0, 500) });
      this._connected = false;
      if (code !== 0 && stderrData) {
        this.emit("error", { error: `Python 进程异常退出 (${code}): ${stderrData.substring(0, 500)}` });
      }
      this.emit("disconnected", { code });
    });
    proc.on("error", (err) => {
      logger.error("Python process spawn error", {
        message: err.message,
        name: err.name,
        stack: err.stack,
      });
      this.emit("error", { error: err.message });
    });
  }

  /** 等待 Python 进程上报连接就绪，最多 3 秒 */
  private async waitForConnection(): Promise<void> {
    await new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(undefined), 3000);
      this.once("connected", () => { clearTimeout(timeout); resolve(undefined); });
      this.once("disconnected", () => { clearTimeout(timeout); resolve(undefined); });
    });
  }

  /**
   * 停止弹幕服务。
   * 流程：发送 stop 请求 → 关闭 stdin → 等待进程退出（2s）→ 强制 kill。
   */
  async stop(): Promise<void> {
    const proc = this.process;
    if (!proc) {
      this._connected = false;
      return;
    }

    const procPid = proc.pid ?? null;
    logger.log("Stopping danmaku service", { pid: procPid });

    try {
      await this.request("stop", {});
    } catch {
      // 停止命令发送失败时静默处理
    }

    this._connected = false;
    proc.stdin?.end();
    
    // 等待进程退出
    const exitedGracefully = await this.waitForProcessExit(proc, 2000);
    
    if (proc.exitCode === null) {
      logger.warn("Danmaku service did not exit in time, forcing shutdown", { pid: procPid });
      this.forceKill(proc);
      await this.waitForProcessExit(proc, 2000);
    }

    if (!exitedGracefully && proc.exitCode === null) {
      logger.error("Danmaku service process still alive after force kill", { pid: procPid });
    }

    this.process = null;
    this.rejectPendingRequests(new Error("Danmaku service stopped"));
    logger.log("Danmaku service stopped", { pid: procPid, exitCode: proc.exitCode });
  }

  updateKeywords(keywords: KeywordRule[]): void {
    this.keywordFilter.updateRules(keywords, this.config?.minMedalLevel ?? 0);
  }

  updateMinMedalLevel(level: number): void {
    const normalized = Math.max(0, Number(level || 0));
    if (this.config) {
      this.config.minMedalLevel = normalized;
      this.keywordFilter.updateRules(this.config.keywords || [], normalized);
    }
  }

  getKeywordFilterScopes(): Set<"both" | "quickReply" | "ai"> {
    return this.keywordFilter.getActiveScopes();
  }

  /**
   * 发送弹幕到直播间。
   * 将消息文本 + 凭证打包为 JSON-RPC 请求发送给 Python sender。
   */
  async sendDanmaku(params: { msg: string; color?: number; mode?: number }): Promise<unknown> {
    return this.request("sendDanmaku", {
      ...params,
      roomId: this.config?.roomId,
      sessdata: this.config?.credentials.sessdata,
      biliJct: this.config?.credentials.biliJct,
      buvid3: this.config?.credentials.buvid3,
    });
  }

  getStatus() {
    return {
      connected: this._connected,
      roomId: this.config?.roomId || null,
    };
  }

  /**
   * 处理 Python 子进程的 stdout 输出。
   * 按行解析 JSON，支持三种协议格式：
   *   1) JSON-RPC 2.0 response（含 id + result/error）→ 匹配 pending 请求
   *   2) JSON-RPC 2.0 notification（含 method）→ 路由到对应事件
   *   3) 旧协议（含 type 字段）→ 兼容处理
   */
  private handleStdout(text: string) {
    this.buffer += text;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";
    
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        // 1) JSON-RPC 2.0 response (Python receiver.py 当前实现)
        if (Object.prototype.hasOwnProperty.call(msg, "id") && (Object.prototype.hasOwnProperty.call(msg, "result") || Object.prototype.hasOwnProperty.call(msg, "error"))) {
          const pending = this.pendingRequests.get(String(msg.id));
          if (pending) {
            clearTimeout(pending.timeout);
            this.pendingRequests.delete(String(msg.id));
            if (msg.error) {
              const errMessage = typeof msg.error === "string"
                ? msg.error
                : (msg.error.message || JSON.stringify(msg.error));
              pending.reject(new Error(errMessage));
            } else {
              pending.resolve(msg.result);
            }
          }
          continue;
        }

        // 2) JSON-RPC 2.0 notification
        if (msg.method) {
          const method = String(msg.method);
          const params = msg.params ?? {};

          if (method === "danmaku.received") {
            const matched = this.keywordFilter.match(params as DanmakuMessage);
            this.emit("danmaku", { ...(params as DanmakuMessage), match: matched });
          } else if (method === "danmaku.gift") {
            this.emit("gift", params as GiftMessage);
          } else if (method === "danmaku.superchat") {
            this.emit("superchat", params as SuperChatMessage);
          } else if (method === "connection.connected") {
this._connected = true;
    logger.log("DanmakuService started successfully");
            this.emit("connected", params);
          } else if (method === "connection.disconnected") {
            this._connected = false;
            this.emit("disconnected", params);
          } else if (method === "connection.error") {
            this.emit("error", params);
          } else if (method === "system.error") {
            const message = typeof params === "object" && params && "message" in params
              ? String((params as { message?: unknown }).message)
              : String(params);
            this.emit("error", { error: message });
          }
          continue;
        }

        // 3) 兼容旧协议 (type 字段)
        if (msg.type === "response") {
          const pending = this.pendingRequests.get(msg.id);
          if (pending) {
            clearTimeout(pending.timeout);
            this.pendingRequests.delete(msg.id);
            if (msg.error) {
              pending.reject(new Error(msg.error.message || msg.error));
            } else {
              pending.resolve(msg.result);
            }
          }
        } else if (msg.type === "danmaku") {
          const matched = this.keywordFilter.match(msg.data);
          this.emit("danmaku", { ...msg.data, match: matched });
        } else if (msg.type === "connected") {
          this._connected = true;
          this.emit("connected", msg.data);
        } else if (msg.type === "disconnected") {
          this._connected = false;
          this.emit("disconnected", msg.data);
        }
      } catch {
        // ignore non-JSON lines
      }
    }
  }

  /**
   * 向 Python 子进程发送 JSON-RPC 请求，返回 Promise。
   * 超时 30 秒后自动 reject 并清理 pending 条目。
   */
  private async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Timeout: ${method}`));
      }, 30000);
      
      this.pendingRequests.set(id, { resolve, reject, timeout });
      this.process?.stdin?.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }

  /** 等待子进程退出，超时返回 false（表示进程仍在运行） */
  private async waitForProcessExit(proc: ChildProcess, timeoutMs: number): Promise<boolean> {
    if (proc.exitCode !== null || proc.killed) {
      return true;
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        proc.off("exit", onExit);
        resolve(false);
      }, timeoutMs);
      const onExit = () => {
        clearTimeout(timer);
        resolve(true);
      };
      proc.once("exit", onExit);
    });
  }

  private rejectPendingRequests(error: Error): void {
    for (const [id, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pendingRequests.delete(id);
    }
  }

  /**
   * 强制终止子进程。
   * Windows：先 process.kill(pid) 再 proc.kill(SIGKILL)
   * Unix：先 SIGTERM，500ms 后 SIGKILL
   */
  private forceKill(proc: ChildProcess): void {
    if (proc.exitCode !== null) return;
    if (process.platform === "win32") {
      const pid = proc.pid;
      if (pid) {
        try {
          const result = spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], {
            stdio: "ignore",
            windowsHide: true,
          });
          if (result.status === 0) {
            logger.warn("Killed danmaku service process tree", { pid });
            return;
          }
          logger.warn("taskkill did not fully terminate danmaku service", {
            pid,
            status: result.status,
            signal: result.signal,
          });
        } catch (error) {
          logger.warn("taskkill failed for danmaku service", {
            pid,
            error: error instanceof Error ? error.message : String(error),
          });
        }

        try {
          process.kill(pid);
        } catch {
          // 进程可能已退出
        }
      }
      try { proc.kill("SIGKILL"); } catch {}
    } else {
      try { proc.kill("SIGTERM"); } catch {}
      setTimeout(() => {
        if (proc.exitCode === null) {
          try { proc.kill("SIGKILL"); } catch {}
        }
      }, 500).unref?.();
    }
  }
}

export default DanmakuService;
