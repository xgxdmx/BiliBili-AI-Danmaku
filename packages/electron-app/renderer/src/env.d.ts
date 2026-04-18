/// <reference types="vite/client" />

import type { DanmakuAPI } from "../../preload/index";

declare const __APP_BUILD_DATE__: string;
declare const __APP_VERSION__: string;

declare global {
  interface Window {
    danmakuAPI: DanmakuAPI;
  }
}

export {};