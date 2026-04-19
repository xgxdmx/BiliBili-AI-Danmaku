import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import vue from "@vitejs/plugin-vue";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf-8"));

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve("main/index.ts"),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve("preload/index.ts"),
      },
    },
  },
  renderer: {
    root: resolve("renderer"),
    build: {
      outDir: resolve("out/renderer"),
      rollupOptions: {
        input: resolve("renderer/index.html"),
      },
    },
    define: {
      __APP_BUILD_DATE__: JSON.stringify(new Date().toISOString().split("T")[0]),
      __APP_VERSION__: JSON.stringify(packageJson.version || "0.0.0"),
    },
    resolve: {
      alias: {
        "@": resolve("renderer/src"),
      },
    },
    plugins: [vue()],
  },
});