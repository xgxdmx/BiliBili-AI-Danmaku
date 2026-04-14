# AGENTS

## 项目目标
- 做一个"B站直播弹幕监听 + 大模型 AI 回复"系统。
- 关键链路：B站直播间 → Python 弹幕核心 → Electron → 大模型 API → 回发弹幕。
- GUI 只负责配置和监控，不负责替代核心弹幕逻辑。

## 技术栈
- Monorepo：`pnpm workspace`
- TS 侧：`TypeScript + project references`
- 弹幕核心：`Python 3 + blivedm + aiohttp`
- GUI：`Electron + Vue 3 + electron-vite`
- 通信：`JSON-RPC over stdio`

## 必要目录
- `README.md`：整体架构、安装和运行方式，先读。
- `packages/shared`：共享类型，供 Electron 复用。
- `packages/danmaku-core`：Python 弹幕核心；入口是 `main.py`。
- `packages/electron-app`：桌面 GUI；主进程在 `main/`，渲染层在 `renderer/`。

## 创建项目时的最小骨架
```text
packages/
  shared/
    src/types.ts
  danmaku-core/
    main.py
    requirements.txt
  electron-app/
    main/index.ts
    main/danmaku-service.ts
    main/ai-relay.ts
    main/quick-reply-engine.ts
    preload/index.ts
    renderer/src/main.ts
    renderer/src/App.vue
    renderer/src/pages/DanmakuView.vue
    renderer/src/pages/SettingsView.vue
    renderer/src/pages/ModelSettingsView.vue
```

## 包职责
- `shared`
  - 只放跨包共享类型。
  - 至少包含：弹幕消息类型、关键词规则类型、配置相关类型。
- `danmaku-core`
  - 负责连接 B 站弹幕 WebSocket。
  - 负责接收/发送弹幕。
  - 通过 stdio 暴露 JSON-RPC，而不是直接依赖 Electron。
- `electron-app`
  - 负责 GUI 配置、状态展示、监听开关。
  - 负责大模型 AI 对话中继（ai-relay.ts）。
  - 负责固定回复引擎（quick-reply-engine.ts）。
  - 主进程编排服务；渲染层只做界面和交互。

## 必须保持的数据流
1. Python 核心连接 B站直播间并接收弹幕。
2. Python 通过 `JSON-RPC over stdio` 把弹幕事件送到 TS 侧。
3. TS 侧按关键词/正则过滤。
4. 命中的消息交给大模型 API（通过 ai-relay.ts）。
5. 大模型生成回复后，由 Python 发弹幕能力回发直播间。
6. Electron 读取配置并展示实时状态/弹幕。

## 真实入口
- 根开发入口：`pnpm dev`
- 根构建入口：`pnpm build`
- Electron 构建：`pnpm build:electron`
- 一键打包：`pnpm pack`
- 类型检查：`pnpm typecheck`
- Python 入口：`packages/danmaku-core/main.py`
- Electron 主进程入口：`packages/electron-app/main/index.ts`
- Electron 渲染入口：`packages/electron-app/renderer/src/main.ts`

## 安装/启动顺序
1. `pnpm install`
2. 进入 `packages/danmaku-core` 安装 `requirements.txt`
3. 在 GUI 设置里填：房间号、B站 Cookie、关键词规则
4. 开发时优先跑 `pnpm dev`

## 关键约束
- 先看 `README.md` 再动手。
- 优先复用当前包边界：共享类型在 `shared`，不要到处复制类型。
- Python 核心与 Electron 解耦，靠 stdio JSON-RPC 通信。
- GUI 问题先看 `packages/electron-app/renderer`。
- 服务编排或子进程问题先看 `packages/electron-app/main`。
- 弹幕收发问题先看 `packages/danmaku-core`。

## 默认不要动
- 未被要求时，不改 `config*.json`。
- 未被要求时，不改 `dist/`、`build/`、`node_modules/`、`.venv/`。
- 未被要求时，不升级依赖、不改工程结构、不改运行命令。

## 实现同类项目时的硬性要求
- 必须保留 Python 弹幕核心，而不是把弹幕逻辑硬塞进 Electron。
- 必须保留共享类型层，而不是各写一套协议。
- 必须使用可替换的桥接层；不要让 GUI 直接耦合特定大模型内部实现。
- 关键词规则至少支持：普通关键词、正则、大小写控制。
- 配置入口至少覆盖：房间号、Cookie、关键词规则、大模型配置。

## 验证
- TS 改动后至少跑：`pnpm typecheck`
- 构建相关改动再跑对应 `build`
- Python 改动只做定点修改，避免顺手重写工作流
