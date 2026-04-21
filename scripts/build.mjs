#!/usr/bin/env node

/**
 * Unified packaging entry for CI and local release builds.
 *
 * High-level pipeline:
 * 1) Build Python runtime via PyInstaller (onedir).
 * 2) Stage runtime under packages/danmaku-core/runtime/run.
 * 3) Build Electron app and prepare .deploy project.
 * 4) Patch deploy-time NSIS options for Windows.
 * 5) Package with electron-builder.
 * 6) Verify packaged runtime is present and runnable.
 *
 * Why this script exists:
 * - Keep release steps deterministic across local and GitHub Actions.
 * - Fail fast on missing runtime artifacts.
 * - Emit actionable logs when packaging fails on Windows runners.
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
 * Run a command with robust cross-platform behavior and full diagnostics.
 *
 * Important behaviors:
 * - On Windows, ".cmd" commands are routed through "cmd.exe /d /s /c".
 * - stdout/stderr are always captured then replayed, so CI logs are preserved.
 * - Non-zero exit codes throw explicit errors with command context.
 * - windowsHide=true avoids transient console windows during packaging.
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
 * Best-effort command probe.
 * Used for interpreter discovery and optional checks where failure is expected.
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
 * Return pnpm executable command name for current platform.
 * Note: actual ".cmd" execution details are handled in run().
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
 * Resolve python interpreter in this order:
 * 1) project virtualenv
 * 2) system python commands
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
 * Compute packaging target args for electron-builder.
 * Current workflow is Windows-focused; non-Windows defaults to Linux AppImage.
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
 * Resolve local electron-builder CLI path from node_modules.
 * We invoke it directly to avoid recursive pnpm exec wrappers
 * hiding important failure output in CI.
 */
function getElectronBuilderCli() {
  const candidates = [
    path.join(ROOT, "node_modules", ".pnpm", "node_modules", "electron-builder", "cli.js"),
    path.join(ROOT, "node_modules", "electron-builder", "cli.js"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  logFail("electron-builder CLI not found in node_modules");
  process.exit(1);
}

/**
 * Remove build outputs and stale runtime artifacts.
 * Safe to call repeatedly.
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
 * Ensure required Python dependencies exist.
 * Installs only missing packages to reduce CI variance.
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
 * Build Python runtime as PyInstaller onedir output, then stage it
 * under packages/danmaku-core/runtime/run for electron extraResources.
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
 * Guard that staged runtime exists before electron packaging starts.
 */
function verifyRuntimeStaged() {
  const runtimeExe = path.join(RUNTIME_RUN_DIR, isWin ? "run.exe" : "run");
  requirePath(RUNTIME_RUN_DIR, "Runtime directory");
  requirePath(runtimeExe, "Runtime executable");
}

/**
 * Runtime smoke test:
 * - Executes runtime binary with no args.
 * - Treats known "usage" style exits as acceptable for probe runs.
 * - Fails hard for launch/runtime loader issues (DLL/import errors, etc.).
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
 * Patch generated .deploy package.json for Windows installer behavior.
 * Applied at deploy time so source package.json remains minimal.
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
 * Verify runtime embedded in packaged app output.
 * Currently implemented for Windows, where regressions were observed.
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
 * Electron packaging phase:
 * - install deps
 * - build renderer/main
 * - prepare deploy folder
 * - run electron-builder
 * - finalize artifacts
 * - run post-package runtime checks on Windows
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

  run("node", [
    getElectronBuilderCli(),
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
 * CLI entry:
 * - clean
 * - python
 * - electron
 * - all (default)
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
