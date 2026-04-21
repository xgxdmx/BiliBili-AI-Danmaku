#!/usr/bin/env node

import { execFileSync } from "node:child_process";
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

function run(cmd, args, options = {}) {
  const cwd = options.cwd || ROOT;
  logInfo([cmd, ...args].join(" "));

  const actualCmd = isWin && cmd.toLowerCase().endsWith(".cmd")
    ? process.env.ComSpec || "cmd.exe"
    : cmd;
  const actualArgs = isWin && cmd.toLowerCase().endsWith(".cmd")
    ? ["/d", "/s", "/c", cmd, ...args]
    : args;

  execFileSync(actualCmd, actualArgs, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, ...options.env },
    windowsHide: true,
  });
}

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

function getPnpmCmd() {
  return isWin ? "pnpm.cmd" : "pnpm";
}

function getVenvPython() {
  return isWin
    ? path.join(ROOT, ".venv", "Scripts", "python.exe")
    : path.join(ROOT, ".venv", "bin", "python");
}

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

function getElectronBuilderTarget() {
  if (isWin) return ["--win", "nsis"];
  return ["--linux", "AppImage"];
}

function getPlatformLabel() {
  if (isWin) return "Windows";
  return "Linux";
}

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

function verifyRuntimeStaged() {
  const runtimeExe = path.join(RUNTIME_RUN_DIR, isWin ? "run.exe" : "run");
  requirePath(RUNTIME_RUN_DIR, "Runtime directory");
  requirePath(runtimeExe, "Runtime executable");
}

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
    "--filter",
    "bilibili-danmu-claw-electron-app",
    "exec",
    "electron-builder",
    "--projectDir",
    "./.deploy",
    ...getElectronBuilderTarget(),
  ]);

  run("node", [path.join("scripts", "finalize-electron-deploy.mjs")]);
  if (isWin) {
    verifyPackagedRuntime();
  }
  logOk("Electron packaging complete");
}

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
