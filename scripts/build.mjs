#!/usr/bin/env node

/**
 * CI 与本地发布共用的统一打包入口。
 *
 * 构建总流程：
 * 1) 用 PyInstaller 构建 Python runtime（onedir）。
 * 2) 将 runtime 暂存到 packages/danmaku-core/runtime/run。
 * 3) 构建 Electron 应用并准备 .deploy 项目。
 * 4) 在部署目录中补丁 Windows 的 NSIS 配置。
 * 5) 调用 electron-builder 打包。
 * 6) 验证打包产物中的 runtime 存在且可运行。
 *
 * 设计目的：
 * - 保证本地与 GitHub Actions 发布步骤一致且可复现。
 * - runtime 缺失时快速失败，避免生成无效安装包。
 * - Windows Runner 打包失败时输出可定位日志。
 */
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DANMAKU_CORE = path.join(ROOT, "packages", "danmaku-core");
const ELECTRON_APP = path.join(ROOT, "packages", "electron-app");
const SHARED = path.join(ROOT, "packages", "shared");
const PY_DIST_ROOT = path.join(ROOT, ".build", "python-dist");
const PY_WORK_ROOT = path.join(ROOT, ".build", "python-work");
const RUNTIME_ROOT = path.join(DANMAKU_CORE, "runtime");
const RUNTIME_RUN_DIR = path.join(RUNTIME_ROOT, "run");

const isWin = process.platform === "win32";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

function logStep(msg) { console.log(`\n${BOLD}${CYAN}━━━ ${msg} ━━━${RESET}\n`); }
function logOk(msg) { console.log(`  ${GREEN}✔${RESET} ${msg}`); }
function logInfo(msg) { console.log(`  ${YELLOW}→${RESET} ${msg}`); }
function logFail(msg) { console.error(`  ${RED}✖${RESET} ${msg}`); }

/**
 * 统一执行外部命令，提供跨平台兼容和完整诊断输出。
 *
 * 关键行为：
 * - Windows 下 ".cmd" 命令统一通过 "cmd.exe /d /s /c" 调起。
 * - 始终捕获并回放 stdout/stderr，保证 CI 日志可见。
 * - 非零退出码会抛出带命令上下文的错误。
 * - windowsHide=true 避免打包阶段额外弹出控制台窗口。
 */
function run(cmd, args, options = {}) {
  const cwd = options.cwd || ROOT;
  logInfo([cmd, ...args].join(" "));

  const actualCmd = isWin && cmd.toLowerCase().endsWith(".cmd")
    ? process.env.ComSpec || "cmd.exe"
    : cmd;
  const actualArgs = isWin && cmd.toLowerCase().endsWith(".cmd")
    ? ["/d", "/s", "/c", cmd, ...args]
    : args;

  const result = spawnSync(actualCmd, actualArgs, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    env: { ...process.env, ...options.env },
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 64,
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const code = result.status ?? 1;
    throw new Error(`Command failed with exit code ${code}: ${[cmd, ...args].join(" ")}`);
  }
}

/**
 * 尝试执行命令（容错探测）。
 * 用于解释器发现或允许失败的探测场景。
 */
function tryRun(cmd, args, options = {}) {
  try {
    run(cmd, args, options);
    return true;
  } catch {
    return false;
  }
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

function removeIfExists(target) {
  if (existsSync(target)) {
    rmSync(target, { recursive: true, force: true });
  }
}

function requirePath(target, label) {
  if (!existsSync(target)) {
    logFail(`${label} not found: ${target}`);
    process.exit(1);
  }
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * 根据当前平台返回 pnpm 命令名。
 * 注意：".cmd" 的实际执行细节由 run() 统一处理。
 */
function getPnpmCmd() {
  return isWin ? "pnpm.cmd" : "pnpm";
}

function getVenvPython() {
  return isWin
    ? path.join(ROOT, ".venv", "Scripts", "python.exe")
    : path.join(ROOT, ".venv", "bin", "python");
}

/**
 * 按顺序解析 Python 解释器：
 * 1) 项目虚拟环境
 * 2) 系统 Python 命令
 */
function getPythonExe() {
  const venvPython = getVenvPython();
  if (existsSync(venvPython)) return venvPython;

  const candidates = isWin ? ["python", "py"] : ["python3", "python"];
  for (const cmd of candidates) {
    if (tryRun(cmd, ["--version"])) {
      return cmd;
    }
  }
  return null;
}

function pipPackageExists(python, pkg) {
  try {
    execFileSync(python, ["-m", "pip", "show", pkg], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * 计算 electron-builder 的目标参数。
 * 当前流程以 Windows 为主，非 Windows 默认走 Linux AppImage。
 */
function getElectronBuilderTarget() {
  if (isWin) return ["--win", "nsis"];
  return ["--linux", "AppImage"];
}

function getPlatformLabel() {
  if (isWin) return "Windows";
  return "Linux";
}

/**
 * 清理构建产物和陈旧 runtime 文件。
 * 可重复调用，不依赖调用顺序。
 */
function clean() {
  logStep("Clean build artifacts");

  const dirs = [
    path.join(ROOT, "dist"),
    path.join(ROOT, ".build"),
    path.join(ELECTRON_APP, "out"),
    path.join(ELECTRON_APP, "dist"),
    path.join(ELECTRON_APP, ".deploy"),
    path.join(SHARED, "dist"),
    RUNTIME_ROOT,
  ];

  for (const dir of dirs) {
    removeIfExists(dir);
  }

  for (const legacyName of ["run.exe", "receiver.exe", "sender.exe", "run", "receiver", "sender"]) {
    removeIfExists(path.join(DANMAKU_CORE, legacyName));
  }

  logOk("Clean done");
}

/**
 * 确保 Python 依赖齐全。
 * 仅安装缺失包，降低 CI 波动。
 */
function installPythonDeps(python) {
  logStep("Python: check dependencies");

  const requirements = ["blivedm", "aiohttp", "brotli", "pyinstaller"];
  const missing = requirements.filter((pkg) => !pipPackageExists(python, pkg));
  if (missing.length === 0) {
    logOk("All Python dependencies already installed");
    return;
  }

  if (!tryRun(python, ["-m", "pip", "install", "--prefer-binary", ...missing])) {
    logFail("Failed to install Python dependencies");
    process.exit(1);
  }

  logOk(`Installed Python dependencies: ${missing.join(", ")}`);
}

/**
 * 将 Python runtime 构建为 PyInstaller onedir 产物，
 * 并暂存到 packages/danmaku-core/runtime/run 供 Electron extraResources 打包。
 */
function buildPython() {
  logStep("Python: find interpreter");
  const python = getPythonExe();
  if (!python) {
    logFail("Python not found. Install Python 3.10+ or activate .venv");
    process.exit(1);
  }

  const version = execFileSync(python, ["--version"], { encoding: "utf8" }).trim();
  logOk(`Using ${version} (${python})`);

  installPythonDeps(python);

  logStep("Python: build onedir runtime");
  removeIfExists(PY_DIST_ROOT);
  removeIfExists(PY_WORK_ROOT);
  removeIfExists(RUNTIME_ROOT);
  for (const legacyName of ["run.exe", "receiver.exe", "sender.exe", "run", "receiver", "sender"]) {
    removeIfExists(path.join(DANMAKU_CORE, legacyName));
  }
  ensureDir(PY_DIST_ROOT);
  ensureDir(PY_WORK_ROOT);
  ensureDir(RUNTIME_ROOT);

  const specPath = path.join(ROOT, "run.spec");
  requirePath(specPath, "run.spec");

  run(python, [
    "-m",
    "PyInstaller",
    specPath,
    "--noconfirm",
    "--clean",
    "--distpath",
    PY_DIST_ROOT,
    "--workpath",
    PY_WORK_ROOT,
  ]);

  const builtRuntimeDir = path.join(PY_DIST_ROOT, "run");
  const runtimeExe = path.join(builtRuntimeDir, isWin ? "run.exe" : "run");
  requirePath(runtimeExe, "Python runtime executable");
  smokeTestRuntime(runtimeExe, "Built Python runtime");

  cpSync(builtRuntimeDir, RUNTIME_RUN_DIR, { recursive: true });
  requirePath(path.join(RUNTIME_RUN_DIR, isWin ? "run.exe" : "run"), "Staged Python runtime");

  logOk(`Staged runtime: ${RUNTIME_RUN_DIR}`);
}

/**
 * 在 Electron 打包前校验 runtime 已正确暂存。
 */
function verifyRuntimeStaged() {
  const runtimeExe = path.join(RUNTIME_RUN_DIR, isWin ? "run.exe" : "run");
  requirePath(RUNTIME_RUN_DIR, "Runtime directory");
  requirePath(runtimeExe, "Runtime executable");
}

/**
 * runtime 冒烟测试：
 * - 直接执行 runtime 二进制（不传参数）。
 * - 对已知的 "usage" 类退出视为可接受探测结果。
 * - 对启动失败/加载失败（如 DLL、import 错误）直接判失败。
 */
function smokeTestRuntime(runtimeExe, label) {
  logStep(`Runtime smoke test: ${label}`);
  requirePath(runtimeExe, label);

  try {
    const output = execFileSync(runtimeExe, [], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
      windowsHide: true,
    });
    const preview = output.trim().split("\n").slice(0, 2).join(" | ");
    logOk(`${label} launched successfully${preview ? `: ${preview}` : ""}`);
    return;
  } catch (error) {
    const stdout = error.stdout?.toString?.("utf8") ?? "";
    const stderr = error.stderr?.toString?.("utf8") ?? "";
    const combined = `${stdout}\n${stderr}`.trim();
    const accepted = combined.includes("Usage: python run.py") || combined.includes("Unknown mode");

    if (accepted) {
      const preview = combined.split("\n").slice(0, 2).join(" | ");
      logOk(`${label} launched successfully: ${preview}`);
      return;
    }

    logFail(`${label} failed to launch`);
    if (combined) {
      console.error(combined);
    } else if (error.message) {
      console.error(error.message);
    }
    process.exit(1);
  }
}

/**
 * 修改 .deploy/package.json 中的 Windows 安装器行为配置。
 * 只在部署目录生效，保持源 package.json 简洁。
 */
function patchDeployPackage() {
  const deployPkgPath = path.join(ELECTRON_APP, ".deploy", "package.json");
  requirePath(deployPkgPath, ".deploy/package.json");

  const pkg = readJson(deployPkgPath);
  const build = pkg.build || {};
  const nsis = build.nsis || {};

  if (isWin) {
    nsis.runAfterFinish = false;
    nsis.warningsAsErrors = true;
  }

  build.nsis = nsis;
  pkg.build = build;
  writeJson(deployPkgPath, pkg);

  if (isWin) {
    logOk("Patched Windows NSIS config: runAfterFinish=false");
  }
}

/**
 * 验证打包产物中是否包含可执行 runtime。
 * 当前仅在 Windows 路径实现（历史回归主要发生在该平台）。
 */
function verifyPackagedRuntime() {
  logStep(`Electron: verify packaged runtime (${getPlatformLabel()})`);

  if (isWin) {
    const packagedRuntimeExe = path.join(ROOT, "dist", "win-unpacked", "resources", "danmaku-core", "run", "run.exe");
    requirePath(packagedRuntimeExe, "Packaged Windows runtime");
    smokeTestRuntime(packagedRuntimeExe, "Packaged Windows runtime");
    return;
  }

  logInfo("Packaged runtime verification is only implemented for Windows in this script");
}

/**
 * Electron 打包阶段：
 * - 安装依赖
 * - 构建 renderer/main
 * - 准备 deploy 目录
 * - 执行 electron-builder
 * - 整理最终产物
 * - Windows 下做打包后 runtime 校验
 */
function buildElectron() {
  logStep(`Electron: prepare package (${getPlatformLabel()})`);
  verifyRuntimeStaged();

  const pnpmCmd = getPnpmCmd();
  const installArgs = process.env.CI ? ["install", "--frozen-lockfile"] : ["install"];

  run(pnpmCmd, installArgs);
  run(pnpmCmd, ["build"]);
  run(pnpmCmd, ["--filter", "bilibili-danmu-claw-electron-app", "run", "prepare-deploy"]);

  const deployDir = path.join(ELECTRON_APP, ".deploy");
  requirePath(deployDir, ".deploy directory");
  patchDeployPackage();

  run(pnpmCmd, [
    "exec",
    "electron-builder",
    "--projectDir",
    "./.deploy",
    ...getElectronBuilderTarget(),
  ], {
    cwd: ELECTRON_APP,
    env: {
      DEBUG: process.env.DEBUG || "electron-builder,builder-util",
    },
  });

  run("node", [path.join("scripts", "finalize-electron-deploy.mjs")]);
  if (isWin) {
    verifyPackagedRuntime();
  }
  logOk("Electron packaging complete");
}

/**
 * CLI 入口参数：
 * - clean
 * - python
 * - electron
 * - all（默认）
 */
const arg = process.argv[2] || "all";

switch (arg) {
  case "clean":
    clean();
    break;
  case "python":
    buildPython();
    break;
  case "electron":
    buildElectron();
    break;
  case "all":
  default:
    buildPython();
    buildElectron();
    logStep("All done");
    console.log(`  ${GREEN}Runtime:${RESET}   ${RUNTIME_RUN_DIR}`);
    console.log(`  ${GREEN}Installer:${RESET} dist/`);
    break;
}
