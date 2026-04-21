import { rmSync, existsSync, readFileSync, writeFileSync, mkdirSync, cpSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const electronAppDir = path.join(repoRoot, "packages", "electron-app");
const deployDir = path.join(electronAppDir, ".deploy");
const danmakuCoreDir = path.join(repoRoot, "packages", "danmaku-core");
const stagingDir = path.join(os.tmpdir(), "danmuclaw-electron-deploy");
const configJsonPath = path.join(electronAppDir, "out", "config.json");
const requiredPythonBins = process.platform === "win32"
  ? ["run.exe", "receiver.exe", "sender.exe"]
  : ["run", "receiver", "sender"];

function assertPythonBinaries(dir, bins, label) {
  const missing = bins.filter((bin) => !existsSync(path.join(dir, bin)));
  if (missing.length === 0) return;

  for (const bin of missing) {
    console.error(`[prepare-deploy] Missing ${label}: ${path.join(dir, bin)}`);
  }
  console.error("[prepare-deploy] Build Python binaries on the target OS before packaging Electron.");
  process.exit(1);
}

assertPythonBinaries(danmakuCoreDir, requiredPythonBins, "Python binary");

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
  isWin ? "pnpm.cmd" : "pnpm",
  ["install", "--prod", "--config.ignore-workspace-root-check=true", "--shamefully-hoist"],
  {
    cwd: stagingDir,
    stdio: "inherit",
    shell: false,
    env: { ...process.env, CI: process.env.CI ?? "true" },
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
      .relative(deployDir, danmakuCoreDir)
      .split(path.sep)
      .join("/");
    writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2));
  }
}

assertPythonBinaries(danmakuCoreDir, requiredPythonBins, "packaged Python binary source");
