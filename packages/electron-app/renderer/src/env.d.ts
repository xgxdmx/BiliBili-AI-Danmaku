/// <reference types="vite/client" />

import type { DanmakuAPI } from "../../preload/index";

declare const __APP_BUILD_DATE__: string;

declare global {
  interface Window {
    danmakuAPI: DanmakuAPI;
  }
}

export {};