// ============================================================
// Danmaku Service - Electron 主进程弹幕服务
// 管理 Python 子进程和关键词过滤
// ============================================================

import { EventEmitter } from "events";
import { spawn, type ChildProcess } from "child_process";
import { randomUUID } from "crypto";
import { join, dirname } from "path";
import * as fs from "fs";
import { logger } from "./logger";

// ─── Inline Types ────────────────────────────────────────────

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

  async start(config: DanmakuServiceConfig): Promise<void> {
    this.config = config;
    this.keywordFilter.updateRules(config.keywords, config.minMedalLevel ?? 0);

    logger.log("DanmakuService.start, roomId:", config.roomId);

    // 查找脚本路径
    let basePath: string;
    let pythonPath: string;
    const isDevMode = !!process.env.ELECTRON_RENDERER_URL;
    const isWin = process.platform === "win32";

    if (isDevMode || process.env.ELECTRON_RUN_AS_NODE) {
      // Dev mode: 使用项目根目录的 .venv
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
    const pyPath = join(basePath, "run.py");
    
    let scriptPath = exePath;
    let usePython = false;

    if (!isDevMode) {
      if (isWin && fs.existsSync(exePath)) {
        scriptPath = exePath;
        usePython = false;
      } else if (!isWin && fs.existsSync(binPath)) {
        scriptPath = binPath;
        usePython = false;
      } else if (fs.existsSync(pyPath)) {
        scriptPath = pyPath;
        usePython = true;
      } else {
        throw new Error("未找到 danmaku-core 脚本");
      }
    } else {
      scriptPath = pyPath;
      usePython = true;
    }

    // 构建命令
    logger.log("Spawning:", usePython ? pythonPath : scriptPath, "script:", scriptPath);
    if (process.platform === "win32") {
      if (usePython) {
        this.process = spawn(pythonPath, ["-X", "utf8", scriptPath, "receiver"], {
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env, PYTHONUNBUFFERED: "1", PYTHONUTF8: "1" },
          windowsHide: true,
        });
      } else {
        try {
          this.process = spawn(scriptPath, ["receiver"], {
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
          });
        } catch (err: unknown) {
          throw err;
        }
      }
    } else {
      this.process = spawn(
        usePython ? pythonPath : scriptPath,
        usePython ? ["-X", "utf8", scriptPath, "receiver"] : ["receiver"],
        {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
      });
    }
     
    let stderrData = "";
    this.process.stdout?.on("data", (data: Buffer) => {
      this.handleStdout(data.toString("utf-8"));
    });
    this.process.stderr?.on("data", (data: Buffer) => {
      try {
        const text = data.toString("utf-8");
        if (text.includes("unknown cmd=")) return;
        if (text.trim()) {
          stderrData += text;
          // 实时输出 Python stderr 日志到控制台
          for (const line of text.trim().split("\n")) {
            if (line.trim()) logger.log("[Python]", line.trim());
          }
        }
      } catch {}
    });
    this.process.on("close", (code) => {
      logger.log("Python process closed, code:", code);
      this._connected = false;
      if (code !== 0 && stderrData) {
        this.emit("error", { error: `Python 进程异常退出 (${code}): ${stderrData.substring(0, 500)}` });
      }
      this.emit("disconnected", { code });
    });
    this.process.on("error", (err) => {
      this.emit("error", { error: err.message });
    });

    // 等待 Python 启动，最多 3 秒
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve(undefined);
      }, 3000);
      const checkConnection = () => {
        if (this._connected) {
          clearTimeout(timeout);
          resolve(undefined);
        }
      };
      this.once("connected", checkConnection);
      this.once("disconnected", () => { clearTimeout(timeout); resolve(undefined); });
    });

    await this.request("start", {
      roomId: config.roomId,
      credentials: config.credentials,
    });
    this._connected = true;
  }

  async stop(): Promise<void> {
    const proc = this.process;
    if (!proc) {
      this._connected = false;
      return;
    }

    try {
      await this.request("stop", {});
    } catch {
      // 停止命令发送失败时静默处理
    }

    this._connected = false;
    proc.stdin?.end();
    
    // 等待进程退出
    await this.waitForProcessExit(proc, 2000);
    
    if (proc.exitCode === null) {
      this.forceKill(proc);
      await this.waitForProcessExit(proc, 2000);
    }
    
    this.process = null;
    this.pendingRequests.clear();
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

  private forceKill(proc: ChildProcess): void {
    if (proc.exitCode !== null) return;
    if (process.platform === "win32") {
      const pid = proc.pid;
      if (pid) {
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
