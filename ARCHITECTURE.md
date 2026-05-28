# DeepOpenCode 架构设计

## 1. 总览

```
┌─────────────────────────────────────────────────────────┐
│                     DeepOpenCode                         │
├─────────────────────────────────────────────────────────┤
│  Skills 层     │  dream / memory-clean / deep-plan      │
│                 │  提示词增强, 按需加载                    │
├─────────────────────────────────────────────────────────┤
│  Plugins 层    │  openmem / deepagent / remote-agent    │
│                 │  注册工具 + 生命周期钩子 + config注入    │
├─────────────────────────────────────────────────────────┤
│  Agents 层     │  openmem-dream / openmem-extract        │
│                 │  config hook 动态注册, 子agent权限受限   │
├─────────────────────────────────────────────────────────┤
│  OpenCode Core │  16 hooks + SDK client + MCP + LSP     │
│                 │  (不可修改, 全部基于 stable API)        │
├─────────────────────────────────────────────────────────┤
│  Storage       │  ~/.deepopencode/memory/<hash>/          │
│                 │  markdown 文件系统, 兼容 CC 格式         │
└─────────────────────────────────────────────────────────┘
```

## 2. 核心设计决策

### 2.1 "拉" 模式 vs "推" 模式

| | 推模式 (CC 做法) | 拉模式 (DeepOpenCode) |
|---|---|---|
| 实现 | `experimental.chat.system.transform` 每轮自动注入 | `check-memory` tool — agent 主动调用 |
| 依赖 | 实验性 API, 上游可能 break | stable `tool` hook |
| 开销 | 每次都注入, 即使不需要 | 按需加载, 节省 token |
| 可靠性 | 不参与注入失败的决策 | agent 明确知道何时获取上下文 |

### 2.2 Markdown vs 向量数据库

| | 向量数据库 | Markdown 文件 |
|---|---|---|
| 存储 | SQLite + 嵌入向量 | 纯文本 |
| 搜索 | 语义搜索 | 关键词 + grep |
| 可读性 | 需要工具查看 | 可直接编辑 |
| 跨工具 | 绑定特定插件 | 兼容 Claude Code 格式 |
| 复杂度 | 需要嵌入模型 | 零依赖 |

选择 markdown 因为: git 可追踪, 人工可编辑, 与 CC 格式兼容, 零外部依赖。

### 2.3 零实验性 API

所有功能基于 OC stable hooks:
- `tool` — 注册自定义工具
- `tool.execute.before/after` — 工具拦截
- `config` — 注入 agent/command 定义
- `event` — 监听 session 生命周期
- `client.session` — 创建/管理子 session

不依赖 `experimental.chat.*` 系列钩子, 不受 OC 版本升级影响。

## 3. openmem — 记忆系统

### 3.1 数据流

```
[用户对话]
     │
     │ tool.execute.before/after 跟踪
     ▼
[Turn 检测器]
     │ 3秒 quiet timer
     │ hasSignificantWork (edit/bash/write)
     ▼
[即时提取]   ──→  small_model 提取 key insights
     │            ──→ 追加到 logs/YYYY/MM/DD.md
     │
     │ session.idle 事件
     ▼
[门控检查]   ──→  时间门(≥6h) → 日志门(≥3sessions) → 锁
     │
     ▼
[定时巩固]   ──→  fork openmem-dream subagent
     │            4阶段: Orient→Gather→Consolidate→Prune
     ▼
[更新]      ──→  topic/*.md + MEMORY.md 索引
```

### 3.2 存储结构

```
~/.deepopencode/memory/<sha256(projectRoot)>/
├── MEMORY.md          # 入口索引 (≤25KB)
├── architecture.md    # 架构相关
├── patterns.md        # 模式/约定
├── decisions.md       # 设计决策
├── pitfalls.md        # 已知坑
├── .consolidate-lock  # 巩固锁 (mtime + PID)
└── logs/
    └── YYYY/
        └── MM/
            └── DD.md  # 每日日志
```

### 3.3 巩固锁机制

```
acquireConsolidationLock():
  1. stat 锁文件 → 读取 mtime + PID
  2. mtime < 6h 且 PID 存活 → blocked
  3. mtime >= 6h 或 PID 已死 → 回收
  4. 写入当前 PID → 重读验证 → acquired/blocked

rollbackConsolidationLock():
  fork 失败时恢复 mtime 到获取前值
```

### 3.4 5 道门控

```
总开关 (enabled)
  → 时间门 (last_consolidation + 6h)
    → 扫描节流 (10min 内不重复扫描)
      → Session门 (新增 ≥3 个 session)
        → 锁门 (acquireConsolidationLock)
          → 执行巩固
```

## 4. deepagent — 工具包

### 4.1 Brief

```
brief(message, status)
  → output: message (markdown)
  → metadata: { status: "normal"|"proactive" }
  → UI 渲染为 toast/notification

场景: 后台任务完成通知 / 主动汇总发现
```

### 4.2 Sleep

```
sleep(duration_ms, reason?)
  → setTimeout + ctx.abort listener
  → 用户 Ctrl+C 中断时 reject
  → max: 5min (300000ms)
```

### 4.3 Task CRUD

```
task-create(description, prompt, agent?, model?)
  → 内存注册 TaskEntry
  → 返回 taskId

task-list(status?)
  → 过滤 running/completed/failed/all

task-output(taskId, timeout?)
  → 轮询状态

task-stop(taskId)
  → AbortController.abort()
```

## 5. remote-agent — 远程执行

### 5.1 SSH Bridge

```
remote-exec(host, command, workdir?)
  → parseSSHUrl("ssh://user@host:22")
  → sshTest (echo ok)
  → sshExec (bash -c "ssh ... cd workdir && command")
  → 返回 stdout/stderr/exitCode
```

### 5.2 Git Bundle 传输

```
3 层渐进式回退:
  Layer 1: git bundle --all (所有分支)
  Layer 2: git bundle HEAD (当前分支)
  Layer 3: git commit-tree (单快照)

每层 ≤100MB, 超限则回退到下一层
上传 via SCP, 远程 unbundle + checkout
```

### 5.3 会话持久化

```
~/.deepopencode/remote-sessions.json
  → 每个 session: { id, host, user, port, workdir, status, lastOutput, exitCode }
  → 启动时加载, 每次操作后保存
```

## 6. deep-plan — 迭代式规划

```
Skill 4 阶段:
  Phase 1: 探索代码库
  Phase 2: 生成详细计划 (markdown)
  Phase 3: 用户审批 (批准/拒绝/编辑, 最多 3 次)
  Phase 4: 切换到 build agent 执行
```

## 7. 插件加载机制

```
启动时 opencode 扫描 .opencode/plugins/*.ts:
  ├── import("@opencode-ai/plugin") ← 由 opencode runtime 提供
  ├── import("zod")                 ← 由 opencode runtime 提供
  └── import("path/fs/os/crypto")   ← Node.js 内置

每个 .ts 文件 export default PluginFunction
  → PluginFunction({ client, directory, $, project }) → { tool, event, config, ... }
  → OpenCode 解析 tools 注册到 agent 可用工具集
  → hooks (event, tool.execute.*) 按顺序执行
```
