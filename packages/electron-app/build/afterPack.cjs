// ============================================================
// electron-builder afterPack 钩子
//
// 在 electron-builder 完成文件打包后、NSIS 安装包生成前执行。
// 由于 signAndEditExecutable: false（因 winCodeSign 符号链接权限问题），
// electron-builder 不会调用 rcedit 注入图标和版本信息。
// 此钩子直接调用 rcedit-x64.exe 可执行文件完成注入。
//
// 注意：rcedit npm 包 v5 是 ESM-only 模块，无法通过 require() 加载，
// 所以这里绕过 npm 模块，直接 spawn rcedit 二进制。
// ============================================================

const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

module.exports = async function (context) {
  // 仅处理 Windows 平台
  if (context.electronPlatformName !== "win32") return;

  const exeName = "bilibili-danmu-claw.exe";
  const exePath = path.join(context.appOutDir, exeName);
  const iconPath = path.join(context.appOutDir, "resources", "icon.ico");

  if (!fs.existsSync(exePath)) {
    console.log("[afterPack] exe not found, skipping rcedit:", exePath);
    return;
  }
  if (!fs.existsSync(iconPath)) {
    console.log("[afterPack] icon not found, skipping rcedit:", iconPath);
    return;
  }

  // 在源码目录的 node_modules 中查找 rcedit 二进制。
  // electron-builder 直接从源码 build/ 目录加载 afterPack.js，
  // 所以 __dirname = packages/electron-app/build，只需上一级即可到达 electron-app。
  const electronAppDir = path.resolve(__dirname, "..");
  const rceditBinPaths = [
    path.join(electronAppDir, "node_modules", "rcedit", "bin", "rcedit-x64.exe"),
  ];
  let rceditExe;
  for (const p of rceditBinPaths) {
    if (fs.existsSync(p)) { rceditExe = p; break; }
  }
  if (!rceditExe) {
    console.log("[afterPack] rcedit-x64.exe not found in any path, skipping icon injection");
    return;
  }

  // 构建 rcedit 命令行参数
  const args = [exePath];
  args.push("--set-icon", iconPath);
  args.push("--set-file-version", "0.4.0");
  args.push("--set-product-version", "0.4.0");
  args.push("--set-version-string", "FileDescription", "BiliBili AI弹幕姬");
  args.push("--set-version-string", "ProductName", "BiliBili AI弹幕姬");
  args.push("--set-version-string", "LegalCopyright", "Copyright © 2026 xgxdmx");
  args.push("--set-version-string", "CompanyName", "xgxdmx");
  args.push("--set-version-string", "OriginalFilename", exeName);

  try {
    const sizeBefore = fs.statSync(exePath).size;
    const { stdout, stderr } = await execFileAsync(rceditExe, args, {
      timeout: 30000,
      windowsHide: true,
    });
    const sizeAfter = fs.statSync(exePath).size;
    console.log(
      `[afterPack] ✔ rcedit: icon + version injected into ${exeName}`,
      `(exe: ${(sizeBefore / 1024).toFixed(0)}KB → ${(sizeAfter / 1024).toFixed(0)}KB)`
    );
    if (stderr) console.log("[afterPack] rcedit stderr:", stderr.trim());
  } catch (err) {
    console.error("[afterPack] ⚠ rcedit failed:", err.message);
    if (err.stderr) console.error("[afterPack] rcedit stderr:", err.stderr.trim());
    // 不抛出错误，让构建继续
  }
};
