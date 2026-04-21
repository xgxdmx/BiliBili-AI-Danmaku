import { rmSync, existsSync, readFileSync, writeFileSync, mkdirSync, cpSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Electron 部署目录准备脚本。
 *
 * 目标：
 * 1) 生成可用于 electron-builder 的 .deploy 目录。
 * 2) 把运行时必须资源（main/preload/renderer/out/build）复制进去。
 * 3) 在 .deploy 目录“原地安装”生产依赖，避免 pnpm 链接在复制后失效。
 * 4) 校验并修正 extraResources 中 danmaku-core 的来源路径。
 */
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const electronAppDir = path.join(repoRoot, "packages", "electron-app");
const deployDir = path.join(electronAppDir, ".deploy");
const danmakuCoreRuntimeDir = path.join(repoRoot, "packages", "danmaku-core", "runtime");
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

// 打包前先确认 Python runtime 已存在，否则直接失败。
assertRuntimeExecutable(runtimeExecutablePath, "Python runtime executable");

// 每次构建都重建 .deploy，避免残留文件污染当前包。
if (existsSync(deployDir)) {
  rmSync(deployDir, { recursive: true, force: true });
}
mkdirSync(deployDir, { recursive: true });

// 删除调试/测试期配置，避免被打包进入发布版。
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

// 这些目录是运行应用与打包所需的最小集合。
const dirsToCopy = ["main", "preload", "renderer", "out", "build"];

for (const entry of entriesToCopy) {
  const src = path.join(electronAppDir, entry);
  if (existsSync(src)) {
    cpSync(src, path.join(deployDir, entry));
  }
}

const rootNpmrc = path.join(repoRoot, ".npmrc");
if (existsSync(rootNpmrc)) {
  cpSync(rootNpmrc, path.join(deployDir, ".npmrc"));
}

for (const dir of dirsToCopy) {
  const srcDir = path.join(electronAppDir, dir);
  if (existsSync(srcDir)) {
    cpSync(srcDir, path.join(deployDir, dir), { recursive: true });
  }
}

const isWin = process.platform === "win32";
// 关键点：在 .deploy 目录原地安装 prod 依赖，避免“先安装后复制”导致 pnpm 依赖链损坏。
const installResult = spawnSync(
  isWin ? (process.env.ComSpec || "cmd.exe") : "pnpm",
  isWin
    ? ["/d", "/s", "/c", "pnpm.cmd", "install", "--prod", "--config.ignore-workspace-root-check=true", "--shamefully-hoist"]
    : ["install", "--prod", "--config.ignore-workspace-root-check=true", "--shamefully-hoist"],
  {
    cwd: deployDir,
    stdio: "inherit",
    shell: false,
    env: { ...process.env, CI: process.env.CI ?? "true" },
    windowsHide: true,
  }
);

if ((installResult.status ?? 0) !== 0) {
  process.exit(installResult.status ?? 1);
}

const packageJsonPath = path.join(deployDir, "package.json");
if (existsSync(packageJsonPath)) {
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
  const extraResources = pkg?.build?.extraResources;
  if (Array.isArray(extraResources) && extraResources.length > 0) {
    // 确保存在 danmaku-core 资源条目，并将路径修正为相对于 .deploy 的可打包路径。
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

// 最终再次确认 runtime 来源存在，防止中途路径被误改。
assertRuntimeExecutable(runtimeExecutablePath, "packaged Python runtime source");
