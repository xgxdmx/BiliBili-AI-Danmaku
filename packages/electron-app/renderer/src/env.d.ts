/// <reference types="vite/client" />

import type { DanmakuAPI } from "../../preload/index";

declare global {
  interface Window {
    danmakuAPI: DanmakuAPI;
  }
}

export {};