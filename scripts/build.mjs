#!/usr/bin/env node
/**
 * Bilibili弹幕Claw — 一键构建脚本 (跨平台)
 *
 * 将 Python 弹幕核心打包为可执行文件，与 Electron 桌面客户端一起
 * 产出平台安装包 (Windows NSIS / macOS DMG / Linux AppImage)。
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │  用法                                                        │
 * │                                                              │
 * │  pnpm package            完整打包 (Python + Electron)         │
 * │  pnpm package:python     仅打包 Python 产物                   │
 * │  pnpm package:electron   仅打包 Electron 安装包               │
 * │  pnpm package:clean      清理所有构建产物                      │
 * └─────────────────────────────────────────────────────────────┘
 *
 * 构建流程总览：
 *
 *   ┌──────────────┐     ┌───────────────┐     ┌──────────────────┐
 *   │ Python 构建   │ ──▶ │  复制到        │ ──▶ │  Electron 打包    │
 *   │ (PyInstaller) │     │  danmaku-core/ │     │  (electron-builder)│
 *   └──────────────┘     └───────────────┘     └──────────────────┘
 *         │                                            │
 *    run.exe / run                                  dist/
 *    receiver.exe / receiver             BiliBili弹幕Claw Setup.exe (Win)
 *    sender.exe / sender                BiliBili弹幕Claw.dmg (Mac)
 *                                        BiliBili弹幕Claw.AppImage (Linux)
 *
 * 所有最终产物输出到项目根目录的 dist/ 文件夹。
 */

import { execSync } from 'child_process';
import { existsSync, rmSync, copyFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ╔══════════════════════════════════════════════════════════════════╗
// ║  平台检测                                                         ║
// ║  根据 process.platform 决定二进制扩展名、构建目标等                    ║
// ╚══════════════════════════════════════════════════════════════════╝

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';

/** Windows 下 Python 可执行文件带 .exe 后缀，macOS/Linux 无后缀 */
const PY_BIN_EXT = isWin ? '.exe' : '';
const PY_OUT_EXT = isWin ? '.exe' : '';

// ╔══════════════════════════════════════════════════════════════════╗
// ║  路径常量                                                         ║
// ╚══════════════════════════════════════════════════════════════════╝

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT          = join(__dirname, '..');                        // 项目根目录
const DANMAKU_CORE  = join(ROOT, 'packages', 'danmaku-core');      // Python 弹幕核心
const ELECTRON_APP  = join(ROOT, 'packages', 'electron-app');      // Electron 桌面客户端
const SHARED        = join(ROOT, 'packages', 'shared');             // 共享类型定义

/**
 * 获取 venv 中的 Python 路径
 * - Windows: .venv/Scripts/python.exe
 * - macOS/Linux: .venv/bin/python
 */
function getVenvPython() {
  if (isWin) return join(ROOT, '.venv', 'Scripts', 'python.exe');
  return join(ROOT, '.venv', 'bin', 'python');
}

// ╔══════════════════════════════════════════════════════════════════╗
// ║  日志工具 — 彩色终端输出                                           ║
// ╚══════════════════════════════════════════════════════════════════╝

const CYAN  = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED   = '\x1b[31m';
const BOLD  = '\x1b[1m';
const RESET = '\x1b[0m';

/** 阶段标题：━━━ Python: find interpreter ━━━ */
function logStep(msg)  { console.log(`\n${BOLD}${CYAN}━━━ ${msg} ━━━${RESET}\n`); }
/** ✔ 成功 */
function logOk(msg)   { console.log(`  ${GREEN}✔${RESET} ${msg}`); }
/** ✖ 失败（输出到 stderr） */
function logFail(msg)  { console.error(`  ${RED}✖${RESET} ${msg}`); }
/** → 命令/信息 */
function logInfo(msg)  { console.log(`  ${YELLOW}→${RESET} ${msg}`); }
/** ⚠ 警告 */
function logWarn(msg)  { console.log(`  ${YELLOW}⚠${RESET} ${msg}`); }

// ╔══════════════════════════════════════════════════════════════════╗
// ║  通用工具函数                                                     ║
// ╚══════════════════════════════════════════════════════════════════╝

/**
 * 查找系统可用的 Python 解释器
 * 优先级: .venv > python3 > python
 * @returns {string|null} Python 可执行文件路径，未找到返回 null
 */
function getPythonExe() {
  const venvPython = getVenvPython();
  if (existsSync(venvPython)) return venvPython;
  for (const cmd of ['python3', 'python']) {
    try { execSync(`${cmd} --version`, { stdio: 'ignore' }); return cmd; }
    catch { /* 继续尝试下一个 */ }
  }
  return null;
}

/**
 * 执行 shell 命令并实时输出
 * @param {string} cmd  - 要执行的命令
 * @param {object} opts - 选项，支持 cwd 指定工作目录
 * @returns {boolean} 命令是否成功 (exit code === 0)
 */
function run(cmd, opts = {}) {
  const cwd = opts.cwd || ROOT;
  const runOpts = { ...opts }; delete runOpts.cwd;
  logInfo(cmd);
  try {
    execSync(cmd, { stdio: 'inherit', cwd, ...runOpts });
    return true;
  } catch { return false; }
}

/**
 * 检查文件是否存在，不存在则报错退出
 * @param {string} filepath - 文件路径
 * @param {string} label    - 友好名称（用于错误消息）
 */
function requireFile(filepath, label) {
  if (!existsSync(filepath)) {
    logFail(`${label} not found: ${filepath}`);
    process.exit(1);
  }
}

/**
 * 用 pip show 检查 Python 包是否已安装
 * 避免重复安装（尤其解决 aiohttp 在 Python 3.13 上源码编译失败的问题）
 * @param {string} python - Python 路径
 * @param {string} pkg    - 包名 (pip show 的名称)
 * @returns {boolean}
 */
function pipPackageExists(python, pkg) {
  try {
    execSync(`"${python}" -m pip show "${pkg}"`, { stdio: 'pipe', encoding: 'utf8' });
    return true;
  } catch { return false; }
}

/**
 * 根据 当前平台返回 electron-builder 的构建目标参数
 * Windows → --win nsis | macOS → --mac dmg zip | Linux → --linux AppImage
 * @returns {string}
 */
function getElectronBuilderTarget() {
  if (isWin) return '--win nsis';
  if (isMac) return '--mac dmg zip';
  return '--linux AppImage';
}

/** 返回当前平台的人类可读名称，用于日志输出 */
function getPlatformLabel() {
  if (isWin) return 'Windows (NSIS)';
  if (isMac) return 'macOS (DMG)';
  return 'Linux (AppImage)';
}

// ╔══════════════════════════════════════════════════════════════════╗
// ║  clean — 清理所有构建产物                                         ║
// ║                                                                    ║
// ║  删除以下目录：                                                     ║
// ║    根目录/build      PyInstaller 的工作目录                        ║
// ║    根目录/dist       PyInstaller 的输出 + 最终安装包                  ║
// ║    danmaku-core/build   PyInstaller 子进程可能产生的残留               ║
// ║    danmaku-core/dist    同上                                         ║
// ║    electron-app/out     electron-vite 的编译输出                     ║
// ║    electron-app/dist    electron-builder 的打包输出                    ║
// ║    electron-app/.deploy 部署暂存目录                                  ║
// ║    shared/dist          TypeScript 编译输出                         ║
// ║  以及 danmaku-core/ 下的可执行文件和根目录的 .tgz                    ║
// ╚══════════════════════════════════════════════════════════════════╝

function clean() {
  logStep('Clean build artifacts');

  const dirs = [
    join(ROOT, 'build'),         join(ROOT, 'dist'),
    join(DANMAKU_CORE, 'build'),  join(DANMAKU_CORE, 'dist'),
    join(ELECTRON_APP, 'out'),    join(ELECTRON_APP, 'dist'),
    join(ELECTRON_APP, '.deploy'),
    join(SHARED, 'dist'),
  ];

  for (const d of dirs) {
    if (existsSync(d)) { logInfo(`Delete ${d}`); rmSync(d, { recursive: true, force: true }); }
  }

  // 清理 danmaku-core 中的 Python 可执行文件（打包产物）
  for (const name of ['run', 'receiver', 'sender']) {
    const bin = join(DANMAKU_CORE, name + PY_BIN_EXT);
    if (existsSync(bin)) { logInfo(`Delete ${bin}`); rmSync(bin, { force: true }); }
  }

  // 清理 pnpm pack 生成的 .tgz（与我们的构建无关）
  const tgz = join(ROOT, 'bilibili-danmaku-claw-0.1.0.tgz');
  if (existsSync(tgz)) rmSync(tgz, { force: true });

  logOk('Clean done');
}

// ╔══════════════════════════════════════════════════════════════════╗
// ║  buildPython — 构建 Python 弹幕核心                                ║
// ║                                                                    ║
// ║  流程：                                                            ║
// ║    1. 查找 Python 解释器 (.venv 优先)                              ║
// ║    2. 检查并安装 pip 依赖 (仅缺失的)                                  ║
// ║    3. 用 PyInstaller 将 .py 打包为可执行文件                          ║
// ║    4. 复制可执行文件到 packages/danmaku-core/                        ║
// ╚══════════════════════════════════════════════════════════════════╝

function buildPython() {
  // ── 步骤 1: 查找 Python ──────────────────────────────────────────
  logStep('Python: find interpreter');
  const python = getPythonExe();
  if (!python) {
    logFail('Python not found. Install Python 3.10+ or activate .venv');
    process.exit(1);
  }
  const pyVer = execSync(`"${python}" --version`, { encoding: 'utf8' }).trim();
  logOk(`Using ${pyVer} (${python})`);

  // ── 步骤 2: 检查并安装依赖 ──────────────────────────────────────
  // 只安装 pip show 报告为未安装的包，避免重复安装导致
  // aiohttp 等需要源码编译的包在 Python 3.13 上编译失败
  logStep('Python: check dependencies');

  // [pip show 名称, pip install 指定版本]
  const PIP_PKGS = [
    ['blivedm',     'blivedm'],
    ['aiohttp',     'aiohttp'],
    ['brotli',      'brotli'],
    ['pyinstaller', 'pyinstaller'],
  ];

  const missing = PIP_PKGS.filter(([pkg]) => !pipPackageExists(python, pkg));

  if (missing.length > 0) {
    const installSpecs = missing.map(([, spec]) => spec);
    logInfo(`Installing: ${installSpecs.join(', ')}`);
    const ok = run(`"${python}" -m pip install ${installSpecs.join(' ')} --prefer-binary`);
    if (!ok) {
      logFail('Failed to install Python dependencies.');
      if (isWin) {
        logFail('If aiohttp fails to build, install Visual C++ Build Tools:');
        logFail('  https://visualstudio.microsoft.com/visual-cpp-build-tools/');
      } else {
        logFail('Make sure you have C compiler (Xcode CLT on macOS, gcc on Linux).');
      }
      logFail('Or use Python 3.12 which has prebuilt aiohttp wheels.');
      process.exit(1);
    }
    logOk('Dependencies installed');
  } else {
    logOk('All dependencies already installed — skipping pip install');
  }

  // ── 步骤 3: PyInstaller 打包 ─────────────────────────────────────
  // 三个入口: run (JSON-RPC 服务器), receiver (弹幕接收), sender (弹幕发送)
  logStep('Python: build binary (PyInstaller)');

  const specFiles = [
    { name: 'run',      file: 'run.spec' },       // JSON-RPC 服务器入口
    { name: 'receiver', file: 'receiver.spec' },   // 弹幕接收器
    { name: 'sender',   file: 'sender.spec' },     // 弹幕发送器
  ];

  // 确保输出目录存在
  mkdirSync(join(ROOT, 'dist'), { recursive: true });
  mkdirSync(join(ROOT, 'build'), { recursive: true });

  for (const { name, file } of specFiles) {
    const specPath = join(ROOT, file);
    requireFile(specPath, `${name}.spec`);

    const outName = name + PY_OUT_EXT; // Windows: run.exe, macOS: run
    logInfo(`Building ${outName}...`);
    if (!run(`"${python}" -m PyInstaller "${specPath}" --noconfirm --distpath "${join(ROOT, 'dist')}" --workpath "${join(ROOT, 'build')}"`)) {
      logFail(`Failed to build ${outName}`);
      process.exit(1);
    }
    logOk(`${outName} built`);
  }

  // ── 步骤 4: 复制可执行文件到 danmaku-core ──────────────────────
  // electron-builder 打包时会将 danmaku-core/ 作为 extraResource 打入安装包
  logStep('Python: copy binary to packages/danmaku-core/');
  for (const { name } of specFiles) {
    const outName = name + PY_OUT_EXT;
    // 从根目录 dist/ 复制到 packages/danmaku-core/
    const src = join(ROOT, 'dist', outName);
    const dst = join(DANMAKU_CORE, outName);
    requireFile(src, outName);
    copyFileSync(src, dst);
    logOk(`${outName} -> packages/danmaku-core/`);
  }

  // macOS 下 PyInstaller 可能还会生成 .app bundle，提示用户
  if (isMac) {
    for (const { name } of specFiles) {
      const appBundle = join(ROOT, 'dist', `${name}.app`);
      if (existsSync(appBundle)) {
        logInfo(`Found ${name}.app bundle (macOS) — not bundled into Electron`);
      }
    }
  }

  console.log(`\n${BOLD}${GREEN}Python build complete!${RESET}`);
}

// ╔══════════════════════════════════════════════════════════════════╗
// ║  buildElectron — 构建 Electron 桌面客户端安装包                    ║
// ║                                                                    ║
// ║  流程：                                                            ║
// ║    0. 检查 Python 可执行文件是否就位                                ║
// ║    1. pnpm install  安装 Node 依赖                                  ║
// ║    2. pnpm build    编译 TypeScript (shared → electron-app)         ║
// ║    3. prepare-deploy  准备部署目录 (复制产物 + 安装生产依赖)          ║
// ║    4. electron-builder 打包安装包                                   ║
// ║    5. finalize        验证输出                                      ║
// ╚══════════════════════════════════════════════════════════════════╝

function buildElectron() {
  const target = getElectronBuilderTarget();     // e.g. "--win nsis"
  const platformLabel = getPlatformLabel();       // e.g. "Windows (NSIS)"

  // ── 步骤 0: 检查 Python 产物是否存在 ─────────────────────────────
  // electron-builder 会将 danmaku-core/ 目录整体打入安装包，
  // 如果没有可执行文件则会打包一个不能运行的应用
  const requiredBins = ['run', 'receiver', 'sender'].map(n => n + PY_BIN_EXT);
  for (const bin of requiredBins) {
    const filepath = join(DANMAKU_CORE, bin);
    if (!existsSync(filepath)) {
      logFail(`Python binary not found: ${filepath}`);
      logFail('Run "pnpm package:python" first');
      process.exit(1);
    }
  }

  // ── 步骤 1: 安装 Node 依赖 ────────────────────────────────────────
  logStep('Electron: install Node dependencies');
  if (!run('pnpm install')) { logFail('pnpm install failed'); process.exit(1); }
  logOk('Node dependencies installed');

  // ── 步骤 2: 编译 TypeScript ──────────────────────────────────────
  // shared → electron-app (包括 electron-vite build 输出到 out/)
  logStep('Electron: build TypeScript');
  if (!run('pnpm build')) { logFail('TypeScript build failed'); process.exit(1); }
  logOk('TypeScript build complete');

  // ── 步骤 3: 准备部署目录 ─────────────────────────────────────────
  // 将编译产物复制到 .deploy/，安装仅生产依赖，修改 extraResources 路径
  logStep('Electron: prepare deploy directory');
  if (!run('pnpm --filter bilibili-danmu-claw-electron-app run prepare-deploy')) {
    logFail('prepare-deploy failed'); process.exit(1);
  }
  logOk('Deploy directory ready');

  // ── 步骤 4: electron-builder 打包 ────────────────────────────────
  // 根据当前平台自动选择目标: Windows NSIS / macOS DMG / Linux AppImage
  logStep(`Electron: package installer (${platformLabel})`);
  const deployDir = join(ELECTRON_APP, '.deploy');
  requireFile(deployDir, '.deploy directory');

  if (!run(`pnpm --filter bilibili-danmu-claw-electron-app exec electron-builder --projectDir ./.deploy ${target}`)) {
    logFail('electron-builder failed'); process.exit(1);
  }
  logOk(`${platformLabel} installer built`);

  // ── 步骤 5: 验证输出 ─────────────────────────────────────────────
  // finalize 脚本确认安装包已输出到根目录 dist/
  logStep('Electron: finalize output');
  if (!run('node scripts/finalize-electron-deploy.mjs')) { logFail('finalize failed'); process.exit(1); }
  logOk('Output finalized');

  console.log(`\n${BOLD}${GREEN}Electron build complete!${RESET}`);
  console.log(`  Installer: dist/`);
}

// ╔══════════════════════════════════════════════════════════════════╗
// ║  主入口 — 根据命令行参数选择执行的构建步骤                          ║
// ║                                                                    ║
// ║  pnpm package          → buildPython() + buildElectron()            ║
// ║  pnpm package:python   → buildPython()                              ║
// ║  pnpm package:electron → buildElectron()                            ║
// ║  pnpm package:clean    → clean()                                    ║
// ╚══════════════════════════════════════════════════════════════════╝

const arg = process.argv[2] || 'all';

switch (arg) {
  case 'clean':
    clean();
    break;
  case 'python':
    buildPython();
    break;
  case 'electron':
    buildElectron();
    break;
  case 'all':
  default:
    buildPython();
    buildElectron();
    logStep('All done!');
    console.log(`  ${GREEN}Python binaries:${RESET}   packages/danmaku-core/`);
    console.log(`  ${GREEN}Installer:${RESET}         dist/  (${getPlatformLabel()})`);
    break;
}