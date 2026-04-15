<h1 align="center">📺 BiliBili AI 弹幕姬</h1>

<p align="center">
  <strong>🎙️ B站直播间弹幕监听 + 🤖 AI 自动回复</strong><br>
  实时捕获弹幕 ⚡ 关键词精准匹配 🎯 大模型智能回复 💬 以弹幕形式回发直播间
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Python-3.8+-3776AB?style=flat-square&logo=python&logoColor=white" alt="Python" />
  <img src="https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/Electron-41-47848F?style=flat-square&logo=electron&logoColor=white" alt="Electron" />
  <img src="https://img.shields.io/badge/Vue-3-4FC08D?style=flat-square&logo=vue.js&logoColor=white" alt="Vue 3" />
  <img src="https://img.shields.io/badge/License-Apache%202.0-yellow?style=flat-square" alt="License" />
</p>

---

## ✨ 功能特性

- 🔴 **实时弹幕监听** — 基于 B站 WebSocket 协议，毫秒级接收弹幕、🎁礼物、💎SC
- 🎯 **关键词/正则匹配** — 支持纯文本、正则两种匹配模式，可配置大小写敏感和匹配范围（固定回复 / AI / 两者皆可）
- 🤖 **大模型回复** — 对接 OpenAI 兼容 API，支持自定义 Prompt、发送间隔、队列上限、跳过规则
- ⚡ **固定回复引擎** — 关键词命中后直接发送预设回复，低延迟无需等待 AI
- 🔑 **B站一键登录** — 内置 B站扫码登录弹窗，自动提取 Cookie，无需手动复制
- 🔒 **配置加密持久化** — 凭证本地加密存储，支持导出/导入配置文件
- 📊 **弹幕监控面板** — 实时弹幕流、匹配命中列表、AI 队列状态一目了然

## 🏗️ 架构概览

```
📺 B站直播间 ──WebSocket──> 🐍 Python 弹幕核心 ──stdio──> ⚡ Electron 主进程
                                           │
                              ┌────────────┼────────────┐
                              ▼            ▼            ▼
                          🎯 关键词    ⚡固定回复    🤖 AI 中继
                              │            │            │
                              │            └─────┬──────┘
                              │                  ▼
                              │           🌐 OpenAI API
                              │
                              └──────────────> 📤 弹幕回复
                                                  ▲
                                                  │
                                         🎨 Vue 3 GUI ──┘
```

**核心数据流：**

1. 🐍 Python 核心通过 WebSocket 连接 B站弹幕服务器，实时接收弹幕
2. 📡 弹幕数据通过 **stdio JSON-RPC** 传递给 Electron 主进程
3. 🎯 关键词过滤器对每条弹幕做匹配，按 `scope` 路由到固定回复或 AI
4. 🤖 AI 回复经发送间隔控制后回传 Python，以弹幕形式发回直播间
5. 🖥️ GUI 提供可视化配置和实时状态监控

## 📁 项目结构

```
packages/
├── shared/                             # 📦 共享类型定义 (TypeScript)
│   └── src/
│       ├── index.ts                    # 📤 统一导出
│       └── types.ts                    # 📋 类型定义
│
├── danmaku-core/                       # 🐍 Python 弹幕核心
│   ├── receiver.py                     # 📥 弹幕接收器
│   ├── sender.py                       # 📤 弹幕发送器
│   ├── run.py                          # 🚪 入口
│   └── requirements.txt                # 📦 依赖
│
└── electron-app/                       # ⚡ Electron 桌面客户端
    ├── main/
    │   ├── index.ts                    # 🏠 主进程
    │   ├── danmaku-service.ts           # 🔌 弹幕服务
    │   ├── ai-relay.ts                 # 🤖 AI 中继
    │   ├── quick-reply-engine.ts       # ⚡ 固定回复
    │   ├── config-store.ts             # 🔐 配置存储
    │   └── logger.ts                   # 📝 日志
    ├── preload/
    │   └── index.ts                     # 🌉 桥接
    └── renderer/
        ├── index.html
        └── src/
            ├── App.vue                  # 🎨 主界面
            ├── main.ts                  # 🚀 启动
            └── pages/
                ├── DanmakuView.vue      # 💬 弹幕监控
                ├── RoomView.vue         # 📺 直播间
                ├── KeywordsView.vue     # 🎯 关键词
                ├── ModelSettingsView.vue# 🤖 AI 配置
                ├── MatchedView.vue      # ✅ 命中记录
                └── DevView.vue          # 🔧 开发
```

## 🚀 快速开始

### 📋 前置要求

| 依赖 | 最低版本 |
|------|---------|
| [Node.js](https://nodejs.org/) | ≥ 18 |
| [Python](https://www.python.org/) | ≥ 3.8 |
| [pnpm](https://pnpm.io/) | ≥ 8 |

### 📥 安装

```bash
# 克隆仓库
git clone https://github.com/<your-username>/BilibiliClaw.git
cd BilibiliClaw

# 📦 安装 Node 依赖
pnpm install

# 🐍 安装 Python 依赖
cd packages/danmaku-core
pip install -r requirements.txt
cd ../..
```

### 🛠️ 开发

```bash
# 🚀 启动 Electron 开发模式 (hot-reload)
pnpm dev

# ✅ 仅类型检查
pnpm typecheck

# 🔨 构建
pnpm build
```

### 📦 打包发布

```bash
# 🎁 完整打包 (Python EXE + Electron 安装包)
pnpm pack

# 🐍 只打包 Python 部分
pnpm pack:python

# ⚡ 只打包 Electron 部分
pnpm pack:electron

# 🧹 清理构建产物
pnpm pack:clean
```

> 打包脚本使用 PowerShell，Windows 环境下直接运行即可。

## ⚙️ 配置说明

应用首次启动后会自动创建加密配置文件，所有配置均可在 GUI 中完成，无需手动编辑文件。

### 🖱️ 方式一：GUI 配置（推荐）

1. 启动后点击左侧「📺 直播间」图标
2. 点击「🔑 B站登录」按钮扫码登录，自动获取 Cookie
3. 填写直播间房间号，点击「▶️ 开始监听」
4. 在「🎯 关键词」页面添加匹配规则
5. 在「🤖 大模型」页面配置 API 和 Prompt

### 📂 方式二：配置导入

支持在 GUI 中导入/导出 JSON 配置文件，方便在多台机器间同步。

配置结构示例：

```jsonc
{
  "room": {
    "roomId": 12345,            // 📺 直播间房间号
    "enabled": true,
    "minMedalLevel": 0,         // 🏅 最低粉丝牌等级过滤
    "sendOnDisconnect": true,    // 👋 断开时自动发告别弹幕
    "disconnectMessage": "先下播啦，感谢大家陪伴，我们下次见～"
  },
  "credentials": {
    "sessdata": "***",           // 🔑 B站 Cookie (自动获取)
    "biliJct": "***",
    "buvid3": "***"
  },
  "keywords": [
    { "pattern": "你好", "type": "keyword", "caseSensitive": false, "scope": "both" },
    { "pattern": "^签到$", "type": "regex", "scope": "quickReply" }
  ],
  "quickReplies": [
    { "contains": ["签到"], "reply": "感谢签到～", "cooldownMs": 5000 }
  ],
  "aiModel": {
    "provider": "opencode",     // 🤖 或自定义 OpenAI 兼容端点
    "apiKey": "sk-***",
    "modelId": "minimax-m2.5-free",
    "endpoint": "https://opencode.ai/zen/v1/chat/completions",
    "prompt": "你是一个直播间助理，逐条回复，单条不超过40字。",
    "sendIntervalMs": 1800,     // ⏱️ 发送间隔 (防风控)
    "maxPending": 100,           // 📊 队列上限
    "ignoreUsernames": [],       // 🙈 忽略的用户名列表
    "skipReplies": ["NO_REPLY", "无需回复", "忽略"]
  }
}
```

### 🎯 关键词规则

| 字段 | 说明 |
|-----|------|
| `type: "keyword"` | 🔤 子串匹配，支持大小写控制 |
| `type: "regex"` | 📜 JavaScript 正则表达式，支持捕获组 |
| `scope: "both"` | 🎯 同时触发固定回复和 AI |
| `scope: "quickReply"` | ⚡ 仅触发固定回复，AI 处理所有弹幕 |
| `scope: "ai"` | 🤖 仅触发 AI，固定回复处理所有弹幕 |

### ⚡ 固定回复规则

| 字段 | 说明 |
|-----|------|
| `contains` | 🔎 包含任意关键词即命中 |
| `notContains` | 🚫 排除包含这些词的弹幕 |
| `regex` | 📜 正则匹配（与 contains 二选一） |
| `reply` | 💬 命中后发送的回复文本 |
| `cooldownMs` | ⏱️ 冷却时间 (ms)，防止刷屏 |

## 🧰 技术栈

| 层 | 技术 |
|---|------|
| 🐍 弹幕核心 | Python 3 + [blivedm](https://github.com/xfgryujk/blivedm) + aiohttp |
| 🔗 进程通信 | JSON-RPC 2.0 over stdio |
| 🤖 AI 对接 | TypeScript (OpenAI 兼容 API) |
| ⚡ 桌面客户端 | Electron 41 + Vue 3 + Vite |
| 🔄 状态管理 | Vue 3 Composition API (provide/inject) |
| 🔒 配置持久化 | electron-store (AES-256-GCM 加密) |
| 📦 类型共享 | TypeScript project references |
| 🔨 构建 | electron-vite + electron-builder + PyInstaller |

## ⚠️ 安全提醒

> 🔴 **配置文件包含 B站 Cookie 和 AI API Key 等敏感信息！**
>
> - 🔒 `config.json` 已在 `.gitignore` 中排除，**绝不可提交到版本控制**
> - 🏷️ 配置文件使用基于机器指纹的 AES-256-GCM 加密存储
> - 📄 导出的配置文件 (`config-export.json`) 为明文，仅用于本地迁移，**务必妥善保管**
> - 🚫 如需分享项目，请确保清除所有包含凭证的文件

## 📄 许可证

本项目基于 Apache License 2.0 开源许可。

- ✅ 可免费使用于商业和非商业目的
- ✅ 可自由修改和分发
- ✅ 需保留原始许可证声明
- ❌ 不得使用项目名称进行背书

详细条款请参阅 [LICENSE](./LICENSE) 文件。