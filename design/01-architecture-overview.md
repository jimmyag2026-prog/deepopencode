# DeepOpenCode 总体架构设计

## 1. 设计哲学

> 不 fork OpenCode, 而是以 **插件 + 技能 + MCP** 三层叠加的方式增强 OpenCode。

### 选择理由

| 方式 | 优点 | 缺点 |
|------|------|------|
| Fork OpenCode | 完全控制 | 维护成本高, 上游更新困难 |
| **插件+技能+MCP (推荐)** | 无侵入, 上游兼容, 社区可复用 | 受限于 hook 暴露面 |
| 独立新项目 | 完全自由 | 重新造轮子, 工作量大 |

## 2. DeepOpenCode 组件全景

```
deepopencode/
├── plugins/              # OpenCode 插件 (核心增强)
│   ├── openmem/          # 记忆系统 (autoDream + extractMemories)
│   ├── magicdocs/        # 活文档系统
│   ├── deepagent/        # 增强子代理 (Task 系统)
│   ├── lsp-diagnostics/  # LSP 被动诊断投递
│   └── remote-agent/     # 远程代理 (SSH)
│
├── skills/               # OpenCode 技能 (提示词增强)
│   ├── deep-plan/        # 迭代式规划
│   ├── deep-review/      # 代码评审
│   └── deep-memory/      # 记忆操作 (/dream, /memory-status)
│
├── mcp/                  # MCP 服务器 (外部集成)
│   ├── computer-use/     # 桌面自动化 (可选)
│   └── task-scheduler/   # 定时任务 (可选)
│
├── config/               # 预设配置
│   ├── opencode.jsonc    # 完整 OpenCode 配置模板
│   ├── agents/           # 自定义代理
│   └── rules/            # AGENTS.md 增强
│
├── analysis/             # 分析文档 (已完成)
├── design/               # 设计文档
└── pros-cons/            # 利弊分析
```

## 3. 分层架构

```
┌─────────────────────────────────────────────────┐
│                DeepOpenCode                      │
├─────────────────────────────────────────────────┤
│  Skills 层        │  提示词增强 (计划/评审/记忆) │
├─────────────────────────────────────────────────┤
│  Plugins 层       │  核心增强 (记忆/文档/代理)  │
├─────────────────────────────────────────────────┤
│  MCP 层           │  外部集成 (桌面/调度)       │
├─────────────────────────────────────────────────┤
│  OpenCode Core    │  底层引擎 (不改动)          │
└─────────────────────────────────────────────────┘
```

## 4. 核心插件设计

### 4.1 openmem — 记忆系统

```
openmem/
├── index.ts              # 插件入口
├── extract.ts            # 即时记忆提取
├── consolidate.ts        # 记忆巩固 (autoDream)
├── lock.ts               # 巩固锁
├── prompts/
│   ├── extract.md        # 提取 prompt
│   └── consolidate.md    # 巩固 prompt
├── storage.ts            # 文件存储管理
└── cli.ts                # /dream, /memory-status 命令
```

**存储结构:**
```
~/.opencode/memory/<project-id>/
├── MEMORY.md             # 入口索引 (≤25KB)
├── <topic>.md            # 分类记忆文件
└── logs/
    └── YYYY/MM/DD.md     # 每日日志
```

**门控逻辑:**
```
每轮结束:
  ├── 即时提取(总是) → extractMemories
  └── 巩固(条件) → autoDream
       ├── 总开关: 启用
       ├── 时间门: ≥6h
       ├── 日志门: ≥3 个新 session
       └── 锁门: acquire
```

### 4.2 magicdocs — 活文档

```
magicdocs/
├── index.ts              # 插件入口
├── detector.ts           # MAGIC DOC header 检测
├── updater.ts            # 文档更新调度
├── prompts/
│   └── update.md         # 更新 prompt
└── cli.ts                # /update-docs, /create-doc 命令
```

### 4.3 lsp-diagnostics — 诊断投递

```
lsp-diagnostics/
├── index.ts              # 插件入口
├── registry.ts           # DiagnosticRegistry (去重+限流)
├── formatter.ts          # LSP 诊断 → OC Attachment 格式化
└── integration.ts        # 与 OC LSP 系统的集成
```

### 4.4 deepagent — 增强子代理

```
deepagent/
├── index.ts              # 插件入口
├── background.ts         # 后台任务执行
├── task-registry.ts      # 任务 CRUD 系统
├── task-tools.ts         # TaskCreate/Get/List/Stop 工具定义
├── messenger.ts          # SendMessage 工具
└── tools/
    ├── brief.ts          # Brief 工具
    ├── sleep.ts          # Sleep 工具
    └── toolsearch.ts     # ToolSearch 工具
```

### 4.5 remote-agent — 远程执行（Phase 2）

```
remote-agent/
├── index.ts              # 插件入口
├── ssh-bridge.ts         # SSH 远程代理桥接
├── docker-bridge.ts      # Docker 沙箱桥接
├── bundle.ts             # Git bundle 打包上传
├── sync.ts               # 文件/状态同步
└── cli.ts                # /remote, /teleport 命令
```

## 5. 技能设计

### 5.1 deep-plan — 迭代式规划

```markdown
---
name: deep-plan
description: 迭代式规划模式。首次 plan 后允许用户多次拒绝和修改,
              直到满意再进入实施阶段。
---

# Deep Plan 模式

1. 进入只读模式
2. 探索代码库, 必要时使用 AskUserQuestion
3. 用 Todowrite 显示 plan 进度
4. 生成计划并提交
5. 用户可拒绝 → 修改重提 (记录 rejectCount)
6. 批准后切换到 build agent 执行
```

### 5.2 deep-memory — 记忆操作

```markdown
---
name: deep-memory
description: 手动操作项目记忆。Use when user asks about memory,
              wants to manually consolidate, check memory status,
              or search project memory.
---

# Deep Memory

/ dream             — 手动触发记忆巩固
/ memory-status     — 查看记忆状态 (文件数, 大小, 最后巩固时间)
/ memory-search     — 搜索项目记忆
/ memory-clean      — 清理过时记忆
```

## 6. 数据流总览

```
用户输入
  │
  ▼
OpenCode Agent (主循环)
  │
  ├─── 工具调用
  │     ├── read/edit/write → magicdocs 检测 MAGIC DOC
  │     └── bash → (无特殊处理)
  │
  ├─── 子代理
  │     ├── task → deepagent 增强 (background/model/cwd)
  │     └── plan agent → deep-plan 技能
  │
  └─── 轮次结束
        ├── openmem: 即时提取 (extractMemories)
        ├── openmem: 巩固门控 (autoDream)
        ├── magicdocs: 文档更新
        └── lsp-diagnostics: 诊断投递
              │
              ▼ 下一轮对话
        ┌──────────────┐
        │  系统提示词   │
        │  + MEMORY.md │  ← 记忆注入
        │  + LSP诊断   │  ← 诊断注入
        │  + MAGIC DOC │  ← 文档上下文
        └──────────────┘
```

## 7. 配置文件设计

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "model": "deepseek/deepseek-v4-flash",
  "small_model": "deepseek/deepseek-chat",

  "plugin": [
    "deepopencode-openmem",
    "deepopencode-magicdocs",
    "deepopencode-lsp-diagnostics",
    "deepopencode-deepagent"
    // "deepopencode-remote-agent", // Phase 2
  ],

  "lsp": {
    "typescript": { "enabled": true, "command": ["typescript-language-server", "--stdio"] },
    "python": { "enabled": true, "command": ["pyright-langserver", "--stdio"] },
    "rust": { "enabled": true, "command": ["rust-analyzer"] }
  },

  "agent": {
    "plan": {
      "mode": "primary",
      "description": "迭代式规划代理。探索代码库, 生成计划, 支持多次修改。"
    },
    "dream": {
      "mode": "subagent",
      "hidden": true,
      "model": "deepseek/deepseek-chat",
      "permission": { "bash": { "ls *": "allow", "find *": "allow", "grep *": "allow", "cat *": "allow" } }
    }
  },

  "permission": {
    "edit": "ask",
    "bash": "ask",
    "webfetch": "allow",
    "websearch": "allow"
  },

  "compaction": { "auto": true, "tail_turns": 3 }
}
```
