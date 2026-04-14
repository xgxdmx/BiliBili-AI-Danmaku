# Bilibili弹幕Claw

实时监听B站直播间弹幕，关键词匹配后推送大模型 AI，自动以弹幕形式回复。

## 架构概览

```
B站直播间 ──WebSocket──▶ Python blivedm ──JSON-RPC/stdio──▶ Electron ──▶ 大模型 API
                    ◀──────────── 发送弹幕 ◀────────────────── AI 回复 ◀─────┘
                                                          ▲
                                                     Electron GUI (配置/监控)
```

## 项目结构

```
bilibili-danmaku-claw/
├── packages/
│   ├── shared/                        # 共享类型定义
│   │   └── src/types.ts               # 类型 (DanmakuMessage, KeywordRule 等)
│   │
│   ├── danmaku-core/                  # Python 弹幕核心
│   │   ├── main.py                    # JSON-RPC 服务器 + blivedm 客户端
│   │   └── requirements.txt           # Python 依赖
│   │
│   └── electron-app/                  # Electron GUI 客户端
│       ├── main/
│       │   ├── index.ts               # 主进程入口
│       │   ├── danmaku-service.ts     # 弹幕服务 (管理 Python 子进程)
│       │   ├── ai-relay.ts           # 大模型对话中继
│       │   └── quick-reply-engine.ts  # 固定回复引擎
│       ├── preload/
│       │   └── index.ts               # IPC 桥接
│       └── renderer/
│           ├── index.html
│           └── src/
│               ├── App.vue            # 主布局 (侧边栏+路由)
│               ├── main.ts            # Vue 入口
│               └── pages/
│                   ├── DanmakuView.vue # 弹幕实时监控页
│                   ├── ModelSettingsView.vue # 大模型配置页
│                   └── SettingsView.vue # 设置页 (房间/关键词)
```

## 核心流程

1. **Python (blivedm)** 连接B站弹幕 WebSocket，实时接收弹幕
2. 通过 **stdio JSON-RPC** 将弹幕数据传递给 Node 进程
3. **KeywordFilter** 对每条弹幕做关键词/正则匹配
4. 匹配到的弹幕被转发给 **大模型 API** 处理
5. AI 的回复通过弹幕发送 API 发回直播间
6. **Electron GUI** 提供可视化配置和实时弹幕监控

## 快速开始

### 前置要求

- Node.js >= 18
- Python >= 3.8
- pnpm >= 8
- B站账号 Cookie (SESSDATA, bili_jct, buvid3)

### 安装

```bash
# 安装 Node 依赖
pnpm install

# 安装 Python 依赖
cd packages/danmaku-core
pip install -r requirements.txt
```

### 开发

```bash
# 启动 Electron 开发模式
pnpm dev

# 构建 Electron 应用
pnpm build:electron
```

### 打包

```bash
# 完整打包 (Python EXE + Electron 安装包)
pnpm pack

# 只更新了前端，跳过 Python 构建
pnpm pack:electron

# 只更新了 Python，跳过 Electron 打包
pnpm pack:python
```

### 配置

1. 在 Electron GUI 的「设置」页面填写：
   - 直播间房间号
   - B站 Cookie (SESSDATA, bili_jct)
   - 关键词规则 (支持纯文本和正则)
   - 大模型配置 (在「大模型」页面配置 API Key)
2. 点击「开始监听」即可

## 关键词匹配

支持两种匹配模式：

- **关键词模式**：子串包含匹配，可切换大小写敏感
- **正则模式**：使用 JavaScript 正则表达式，支持捕获组

示例规则：
```json
[
  { "pattern": "你好", "type": "keyword", "caseSensitive": false },
  { "pattern": "^签到$", "type": "regex" },
  { "pattern": "问(.+?)答", "type": "regex" }
]
```

## 技术栈

| 组件 | 技术 |
|------|------|
| 弹幕核心 | Python 3 + blivedm |
| 进程通信 | JSON-RPC over stdio |
| 大模型对接 | TypeScript (ai-relay.ts) |
| GUI 客户端 | Electron + Vue 3 + Vite |
| 类型共享 | TypeScript project references |