#!/usr/bin/env node
// ============================================================
// Phase B0: 免费模型可用性 + 响应格式测试脚本
//
// 目的：验证 OpenCode Zen 上 10 个免费模型在 AI 弹幕姬里的真实表现。
//   - 是否可用（HTTP 状态 + 能否返回回复）
//   - 响应字段路径（content / reasoning_content）
//   - 思考标签是否泄漏进 content（A1 修复的验证点）
//   - finish_reason（是否截断）
//   - 提取出的实际弹幕回复（经 stripThinkTags + clampText(40)）
//
// 用法：
//   $env:OC_API_KEY="sk-..."          # Windows PowerShell
//   node scripts/test-free-models.mjs
//
//   或：node scripts/test-free-models.mjs --api-key=sk-...
//
// 输出：
//   1) 控制台 markdown 汇总表
//   2) .build/free-model-test-results.json  完整原始响应（供深入分析）
//
// 注意：本脚本的 isLikelyThinkingModel / resolveMaxTokens / stripThinkTags
//       与 packages/electron-app/main/ai-relay.ts 镜像，保持同步。
// ============================================================
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const ENDPOINT = "https://opencode.ai/zen/v1/chat/completions";
const SYSTEM_PROMPT =
  "你现在是一个直播间助理，你会收到粉丝牌+用户名+弹幕内容，请逐条回复，单条回复不超过40字。";
// 模拟 formatForModel 的输出
const TEST_USER_MSG = "粉丝牌:无粉丝牌 | 用户名:测试官 | 弹幕:你好呀，今天直播什么游戏？";
const REQUEST_TIMEOUT_MS = 60_000;
const MODEL_GAP_MS = 1500; // 模型间间隔，避免触发限流

const FREE_MODELS = [
  "mimo-v2.5-free",                   // 当前默认模型（疑似思考型）
  "nemotron-3-ultra-free",            // Nemotron，可能有推理
  "nemotron-3.5-lightning-free",      // Nemotron 3.5
  "hy3-free",                         // Hy3
  "laguna-s-2.1-free",                // Laguna S
  "x-preview-f-free",                 // X Preview
  "big-pickle",                       // 隐身模型，格式未知
];

// ─── 镜像 ai-relay.ts 的逻辑（保持同步）────────────────────

function isLikelyThinkingModel(modelId) {
  const id = String(modelId || "").toLowerCase();
  return (
    id.includes("deepseek") ||
    id.includes("reasoner") ||
    id.includes("reasoning") ||
    id.includes("thinking") ||
    id.startsWith("qwen3") ||
    /^o[134](\b|-)/.test(id)
  );
}

function resolveMaxTokens(modelId, configured = 256) {
  // 模拟用户在 UI 里设的 maxTokens（默认 256）
  const userValue = Number.isFinite(configured) && configured > 0 ? configured : null;
  if (isLikelyThinkingModel(modelId)) {
    const THINKING_FLOOR = 2048;
    return Math.max(userValue ?? THINKING_FLOOR, THINKING_FLOOR);
  }
  return userValue ?? 256;
}

function stripThinkTags(text) {
  return String(text || "")
    .replace(/<think[\s\S]*?<\/think>/gi, "")
    .replace(/<thinking[\s\S]*?<\/thinking>/gi, "")
    .replace(/<reasoning[\s\S]*?<\/reasoning>/gi, "")
    .replace(/\n+/g, " ")
    .trim();
}

function clampText(text, maxLen = 40) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  return normalized.length <= maxLen ? normalized : normalized.slice(0, maxLen);
}

// ─── 单模型测试 ────────────────────────────────────────────

function readApiKey() {
  for (const arg of process.argv.slice(2)) {
    const m = /^--api-key=(.+)$/.exec(arg);
    if (m) return m[1].trim();
  }
  if (process.env.OC_API_KEY) return process.env.OC_API_KEY.trim();
  if (process.env.OPENCODE_API_KEY) return process.env.OPENCODE_API_KEY.trim();
  return null;
}

async function testModel(apiKey, modelId) {
  const maxTokens = resolveMaxTokens(modelId, 256);
  const body = {
    model: modelId,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: TEST_USER_MSG },
    ],
    max_tokens: maxTokens,
    temperature: 0.7,
    top_p: 1,
  };

  const start = Date.now();
  try {
    const resp = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const elapsed = Date.now() - start;
    const rawText = await resp.text();
    let data = null;
    try { data = JSON.parse(rawText); } catch { /* 非 JSON */ }

    if (!resp.ok) {
      return {
        modelId, ok: false, httpStatus: resp.status, elapsedMs: elapsed,
        error: (typeof data?.error?.message === "string" ? data.error.message : rawText).slice(0, 300),
        maxTokens, isThinking: isLikelyThinkingModel(modelId), raw: data ?? rawText,
      };
    }

    const choice = data?.choices?.[0];
    const content = choice?.message?.content ?? "";
    const reasoning = choice?.message?.reasoning_content ?? "";
    const finishReason = choice?.finish_reason ?? "";
    const hasThinkTags = /<think\b|<thinking\b|<reasoning\b/i.test(String(content));
    const cleaned = stripThinkTags(String(content));
    const wouldSend = clampText(cleaned, 40); // 模拟 app 实际会发的弹幕

    return {
      modelId,
      ok: true,
      httpStatus: resp.status,
      elapsedMs: elapsed,
      isThinking: isLikelyThinkingModel(modelId),
      maxTokens,
      finishReason,
      contentLen: String(content).length,
      reasoningLen: String(reasoning).length,
      contentEmpty: !content,
      hasThinkTags,
      thinkLeakAfterStrip: hasThinkTags && !cleaned, // 标签清理后变空 = 整段都是思考
      wouldSend, // ← 最关键字段：app 实际会发到直播间的弹幕
      raw: data,
    };
  } catch (err) {
    const isTimeout = err?.name === "TimeoutError" || err?.name === "AbortError";
    return {
      modelId, ok: false, httpStatus: 0, elapsedMs: Date.now() - start,
      error: isTimeout ? `请求超时(${REQUEST_TIMEOUT_MS / 1000}s)` : (err?.message || String(err)),
      maxTokens: resolveMaxTokens(modelId, 256),
      isThinking: isLikelyThinkingModel(modelId),
    };
  }
}

// ─── 输出格式化 ────────────────────────────────────────────

function statusEmoji(r) {
  if (!r.ok) return "❌";
  if (r.contentEmpty) return "⚠️"; // 可用但正文为空（思考耗尽 / 模型拒答）
  if (r.hasThinkTags && !r.wouldSend) return "⚠️"; // 清理后为空
  return "✅";
}

function verdict(r) {
  if (!r.ok) return `不可用(${r.httpStatus || "网络"})`;
  if (r.contentEmpty) {
    if (r.finishReason === "length") return "正文空+截断(token 耗尽)";
    return "正文空(模型拒答/异常)";
  }
  if (r.hasThinkTags) return r.thinkLeakAfterStrip ? "思考标签占满(content 全是 think)" : "含 think 标签(A1 已清理)";
  return "正常";
}

function printSummaryTable(results) {
  console.log("\n" + "═".repeat(100));
  console.log("免费模型测试汇总");
  console.log("═".repeat(100));
  const header = ["状态", "模型", "思考?", "finish_reason", "content", "reasoning", "think标签", "将发送(≤40字)", "判定"].map((h, i) => h.padEnd(i === 7 ? 42 : 12));
  console.log(header.join(" | "));
  console.log("-".repeat(100));
  for (const r of results) {
    const row = [
      statusEmoji(r),
      r.modelId.slice(0, 26),
      r.isThinking ? "是" : "—",
      (r.finishReason || (r.ok ? "?" : "-")).slice(0, 8),
      r.ok ? String(r.contentLen) : "-",
      r.ok ? String(r.reasoningLen) : "-",
      r.ok ? (r.hasThinkTags ? "是" : "无") : "-",
      (r.wouldSend || "").toString().slice(0, 40).padEnd(40),
      verdict(r).slice(0, 28),
    ];
    console.log(row.join(" | "));
  }
  console.log("═".repeat(100));
}

function printMarkdownReport(results) {
  const lines = [];
  lines.push("# 免费模型测试报告\n");
  lines.push("生成时间: " + new Date().toISOString() + "\n");
  lines.push("| 状态 | 模型 | 思考型 | finish_reason | content长度 | reasoning长度 | think标签 | 判定 | 将发送的弹幕 |");
  lines.push("|------|------|--------|---------------|-------------|--------------|-----------|------|--------------|");
  for (const r of results) {
    const willSend = (r.wouldSend || "").replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 40);
    lines.push([
      statusEmoji(r),
      `\`${r.modelId}\``,
      r.isThinking ? "是" : "—",
      r.finishReason || (r.ok ? "?" : "-"),
      r.ok ? r.contentLen : "-",
      r.ok ? r.reasoningLen : "-",
      r.ok ? (r.hasThinkTags ? "是" : "无") : "-",
      verdict(r),
      willSend,
    ].join(" | "));
  }
  lines.push("");
  lines.push("## 失败详情");
  for (const r of results.filter((x) => !x.ok)) {
    lines.push(`- **${r.modelId}**: ${r.error}`);
  }
  return lines.join("\n");
}

// ─── 主流程 ────────────────────────────────────────────────

async function main() {
  const apiKey = readApiKey();
  if (!apiKey) {
    console.error("缺少 API Key。请用环境变量 OC_API_KEY 或参数 --api-key=sk-... 提供。");
    process.exit(1);
  }

  console.log(`开始测试 ${FREE_MODELS.length} 个免费模型（端点: ${ENDPOINT}）...`);
  const results = [];
  for (let i = 0; i < FREE_MODELS.length; i += 1) {
    const modelId = FREE_MODELS[i];
    const budget = resolveMaxTokens(modelId, 256);
    process.stdout.write(`[${i + 1}/${FREE_MODELS.length}] ${modelId} (max_tokens=${budget}) ... `);
    const r = await testModel(apiKey, modelId);
    results.push(r);
    process.stdout.write(`${statusEmoji(r)} ${verdict(r)} (${r.elapsedMs}ms)\n`);
    if (i < FREE_MODELS.length - 1) await new Promise((res) => setTimeout(res, MODEL_GAP_MS));
  }

  printSummaryTable(results);

  // 保存完整原始响应
  const buildDir = path.join(ROOT, ".build");
  mkdirSync(buildDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(buildDir, `free-model-test-results-${ts}.json`);
  writeFileSync(jsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
  const mdPath = path.join(buildDir, `free-model-test-report-${ts}.md`);
  writeFileSync(mdPath, printMarkdownReport(results));

  console.log(`\n原始响应已保存: ${jsonPath}`);
  console.log(`Markdown 报告:   ${mdPath}`);

  // 退出码：有失败或异常则非零
  const failed = results.filter((r) => !r.ok || r.contentEmpty || (r.hasThinkTags && !r.wouldSend));
  if (failed.length > 0) {
    console.log(`\n${failed.length} 个模型需要关注（见上表 ⚠️/❌）。`);
    process.exit(2);
  }
  console.log("\n全部模型表现正常 ✅");
}

main().catch((err) => {
  console.error("测试脚本异常:", err);
  process.exit(1);
});
