// ============================================================
// Auth Window - B站登录窗口与 Cookie 抓取
//
// 职责：
//   1. 创建并管理独立的 B站登录窗口
//   2. 监听 Cookie 变化并提取登录凭证
//   3. 通过 IPC 向渲染进程同步登录状态
// ============================================================

import { BrowserWindow, ipcMain } from "electron";
import type { MainAppContext } from "./app-context";
import { setConfigPath } from "./config-store";

/** B站登录页地址，用于弹出独立登录窗口 */
const BILI_LOGIN_URL = "https://passport.bilibili.com/login";

/**
 * 从 Electron session 中提取 B站登录 Cookie。
 * 在登录窗口 cookie 变更时调用，自动抓取 SESSDATA / bili_jct / buvid3。
 */
async function getCredentialCookiesFromElectronSession(targetWin: BrowserWindow): Promise<{
  sessdata: string;
  biliJct: string;
  buvid3: string;
}> {
  const cookieStore = targetWin.webContents.session.cookies;
  const allCookies = await cookieStore.get({});
  const getCookie = (name: string): string => allCookies.find((c) => c.name === name)?.value || "";
  return {
    sessdata: getCookie("SESSDATA"),
    biliJct: getCookie("bili_jct"),
    buvid3: getCookie("buvid3"),
  };
}

export function registerAuthIpcHandlers(context: MainAppContext): void {
  /**
   * 打开 B站登录窗口。窗口内嵌到 passport.bilibili.com，
   * 监听 cookie 变化自动提取 SESSDATA / bili_jct / buvid3，
   * 成功后自动关闭窗口并持久化凭证。
   */
  ipcMain.handle("auth:openLoginWindow", async () => {
    const existingWindow = context.getBiliLoginWindow();
    if (existingWindow && !existingWindow.isDestroyed()) {
      existingWindow.focus();
      return { status: "ok", state: "opened" as const, message: "登录窗口已打开" };
    }

    const parent = context.getMainWindow() || undefined;
    const loginWindow = new BrowserWindow({
      width: 980,
      height: 760,
      parent,
      modal: false,
      autoHideMenuBar: true,
      title: "B站登录",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    context.setBiliLoginWindow(loginWindow);

    const sendLoginStatus = (payload: Record<string, unknown>) => {
      context.getMainWindow()?.webContents.send("auth:loginStatus", payload);
    };

    const checkAndPersistCookies = async () => {
      if (!loginWindow || loginWindow.isDestroyed()) return;
      try {
        const creds = await getCredentialCookiesFromElectronSession(loginWindow);
        if (creds.sessdata && creds.biliJct) {
          setConfigPath("credentials", creds);
          sendLoginStatus({
            state: "confirmed",
            message: "登录成功，已抓取 Cookie",
            credentials: creds,
          });
          try {
            loginWindow.close();
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore intermittent cookie-read failures
      }
    };

    // 始终允许检查 cookie（窗口关闭时触发）
    const onCookieChanged = () => {
      void checkAndPersistCookies();
    };

    loginWindow.webContents.session.cookies.on("changed", onCookieChanged);

    loginWindow.webContents.on("did-finish-load", () => {
      sendLoginStatus({ state: "opened", message: "请在登录窗口扫码或登录" });
    });

    // 用户关闭登录窗口时保存 cookie
    loginWindow.on("close", () => {
      // 尝试保存当前登录的 cookie
      void checkAndPersistCookies();
    });

    loginWindow.on("closed", () => {
      try {
        loginWindow.webContents.session.cookies.removeListener("changed", onCookieChanged);
      } catch {
        // ignore
      }
      if (context.getBiliLoginWindow() === loginWindow) {
        context.setBiliLoginWindow(null);
      }
      sendLoginStatus({ state: "closed", message: "登录窗口已关闭" });
    });

    await loginWindow.loadURL(BILI_LOGIN_URL);
    sendLoginStatus({ state: "opened", message: "登录窗口已打开" });
    return { status: "ok", state: "opened" as const, message: "登录窗口已打开" };
  });
}
