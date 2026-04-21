import { rmSync, existsSync, readFileSync, writeFileSync, mkdirSync, cpSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const electronAppDir = path.join(repoRoot, "packages", "electron-app");
const deployDir = path.join(electronAppDir, ".deploy");
const danmakuCoreRuntimeDir = path.join(repoRoot, "packages", "danmaku-core", "runtime");
const stagingDir = path.join(os.tmpdir(), "danmuclaw-electron-deploy");
const configJsonPath = path.join(electronAppDir, "out", "config.json");
const runtimeExecutablePath = process.platform === "win32"
  ? path.join(danmakuCoreRuntimeDir, "run", "run.exe")
  : path.join(danmakuCoreRuntimeDir, "run", "run");

function assertRuntimeExecutable(targetPath, label) {
  if (existsSync(targetPath)) return;
  console.error(`[prepare-deploy] Missing ${label}: ${targetPath}`);
  console.error("[prepare-deploy] Build the Python runtime on the target OS before packaging Electron.");
  process.exit(1);
}

assertRuntimeExecutable(runtimeExecutablePath, "Python runtime executable");

if (existsSync(stagingDir)) {
  rmSync(stagingDir, { recursive: true, force: true });
}
mkdirSync(stagingDir, { recursive: true });

if (existsSync(configJsonPath)) {
  try {
    unlinkSync(configJsonPath);
    console.log("Removed test config.json before packaging");
  } catch (e) {
    console.warn("Could not remove config.json:", e.message);
  }
}

const entriesToCopy = [
  "package.json",
  "electron.vite.config.ts",
  "tsconfig.json",
];

const dirsToCopy = ["main", "preload", "renderer", "out", "build"];

for (const entry of entriesToCopy) {
  const src = path.join(electronAppDir, entry);
  if (existsSync(src)) {
    cpSync(src, path.join(stagingDir, entry));
  }
}

const rootNpmrc = path.join(repoRoot, ".npmrc");
if (existsSync(rootNpmrc)) {
  cpSync(rootNpmrc, path.join(stagingDir, ".npmrc"));
}

for (const dir of dirsToCopy) {
  const srcDir = path.join(electronAppDir, dir);
  if (existsSync(srcDir)) {
    cpSync(srcDir, path.join(stagingDir, dir), { recursive: true });
  }
}

const isWin = process.platform === "win32";
const installResult = spawnSync(
  isWin ? (process.env.ComSpec || "cmd.exe") : "pnpm",
  isWin
    ? ["/d", "/s", "/c", "pnpm.cmd", "install", "--prod", "--config.ignore-workspace-root-check=true", "--shamefully-hoist"]
    : ["install", "--prod", "--config.ignore-workspace-root-check=true", "--shamefully-hoist"],
  {
    cwd: stagingDir,
    stdio: "inherit",
    shell: false,
    env: { ...process.env, CI: process.env.CI ?? "true" },
    windowsHide: true,
  }
);

if ((installResult.status ?? 0) !== 0) {
  process.exit(installResult.status ?? 1);
}

mkdirSync(deployDir, { recursive: true });
cpSync(stagingDir, deployDir, { recursive: true });

const packageJsonPath = path.join(deployDir, "package.json");
if (existsSync(packageJsonPath)) {
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
  const extraResources = pkg?.build?.extraResources;
  if (Array.isArray(extraResources) && extraResources.length > 0) {
    const danmakuResource = extraResources.find((entry) => entry?.to === "danmaku-core");
    if (!danmakuResource) {
      console.error("[prepare-deploy] Missing extraResources entry with to=danmaku-core");
      process.exit(1);
    }
    danmakuResource.from = path
      .relative(deployDir, danmakuCoreRuntimeDir)
      .split(path.sep)
      .join("/");
    writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2));
  }
}

assertRuntimeExecutable(runtimeExecutablePath, "packaged Python runtime source");
