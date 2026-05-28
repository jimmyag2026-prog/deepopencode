# Claude Code Teleport (CCR) 模块深度分析

## 1. 核心概念

Teleport = **Claude Code Remote (CCR)** 远程代码执行系统:

- 会话在 Anthropic 托管的云容器中运行
- 实时消息通过 WebSocket 传输
- 完整对话记录持久化在服务端

### 1.1 两种方向

| 方向 | 入口 | 行为 |
|------|------|------|
| **发往远程** | `teleportToRemote()` / `--remote` | 创建远程会话, 容器中运行 agent |
| **回到本地** | `--teleport <sessionId>` | 从云端拉取会话, 本地重建对话状态 |

### 1.2 架构组成

| 目录/文件 | 职责 |
|-----------|------|
| `utils/teleport/api.ts` | REST API: 环境查询, 会话 CRUD, 日志拉取 |
| `utils/teleport/environments.ts` | 环境类型: anthropic_cloud / byoc / bridge |
| `utils/teleport/environmentSelection.ts` | 环境选择逻辑: 默认→cloud→第一个非bridge |
| `utils/teleport/gitBundle.ts` | 3层渐进式 Git Bundle 打包上传 |
| `commands/teleport/` | 斜杠命令入口 |

### 1.3 Git Bundle 传输 — 3层渐进式回退

CCR 需要访问用户代码。若 GitHub App 不可用, 通过 bundle 上传:

| 层级 | 命令 | 内容 | 上限 |
|------|------|------|------|
| 1. `--all` | `git bundle create --all` | 所有分支/标签/引用 | 100MB |
| 2. `HEAD` | `git bundle create HEAD` | 当前分支完整历史 | 100MB |
| 3. `squashed` | `git commit-tree HEAD^{tree}` | 单次提交快照, 无历史 | 100MB |

额外处理:
- `git stash create` 捕获 WIP, 存入 `refs/seed/stash`
- WIP 恢复: 远程容器中 `git stash apply`
- 上传: POST /v1/files, 返回 fileId → 写入 SessionContext

## 2. OpenCode 现状

OpenCode **完全没有**远程执行能力。所有 agent 在本地进程运行。

现有相关能力:
- Worktree: 本地 Git worktree 隔离, 仍在本机执行
- API/WebSocket: 有 REST API + WebSocket, 但仅用于本地 agent
- PTY: terminal 的 pty 管理, 但仅限本机

## 3. 融合方案

### 3.1 核心挑战

| 挑战 | 说明 |
|------|------|
| 云基础设施 | CC 依赖 Anthropic 托管的容器集群, 无开源替代 |
| 会话持久化服务 | 需要服务端存储会话状态和日志 |
| WebSocket 双向通道 | 需要可靠的实时消息通道 |
| 安全隔离 | 容器沙箱, 权限控制 |
| Git 仓库传输 | Bundle 机制需要服务端解析 |

### 3.2 可行方案: 自建 Remote Agent 后端

**架构概览:**
```
┌─────────────────────────────────────┐
│          deepopencode (本地)          │
│  ┌───────────┐  ┌───────────────────┐│
│  │ Remote     │  │  Local Agent     ││
│  │ Agent Mgr  │  │  (正常模式)       ││
│  └─────┬─────┘  └───────────────────┘│
│        │ SSH/WS                       │
└────────┼─────────────────────────────┘
         │
┌────────┴─────────────────────────────┐
│     Remote Runner (SSH 服务器上)       │
│  ┌─────────────────────────────────┐ │
│  │  opencode-agent (headless)      │ │
│  │  - 沙箱(容器/chroot)             │ │
│  │  - 消息通过 SSH/WS 回传          │ │
│  │  - 结果写入共享存储               │ │
│  └─────────────────────────────────┘ │
└──────────────────────────────────────┘
```

**实现路径:**
1. **SSH 方式** (最简单, 优先): 通过 SSH 在远程机器上运行 `opencode-agent`
2. **WebSocket 方式** (更灵活): 自建消息中继, 远程 agent 通过 WS 连接
3. **Docker 方式** (隔离最好): 远程宿主机上创建容器运行 agent

**Git 传输:**
- 复用 CC 的 3层 bundle 策略
- 或通过 GitHub/GitLab URL clone (如果远程有权限)

### 3.3 最小可行方案 (MVP)

```typescript
// Remote Agent 插件核心接口
interface RemoteAgentPlugin {
  // 创建远程会话
  createSession(options: {
    environment: 'ssh' | 'docker' | 'custom'
    host: string
    workdir: string
    model?: string
  }): Promise<{ sessionId: string }>

  // 获取会话状态
  getSessionStatus(sessionId: string): Promise<{
    status: 'running' | 'idle' | 'completed' | 'failed'
    log: Message[]
  }>

  // 轮询会话事件
  pollEvents(sessionId: string, afterId?: string): AsyncIterable<Event>

  // 终止会话
  stopSession(sessionId: string): Promise<void>

  // 恢复会话
  resumeSession(sessionId: string): Promise<void>
}
```

### 3.4 实现优先级

| 优先级 | 特性 | 实现方式 | 工作量 |
|--------|------|---------|--------|
| P1 | SSH Remote Agent | 通过 SSH 在远程执行 agent | 大(~1500行) |
| P1 | Git Bundle 传输 | 复用 3层策略 | 中(~400行) |
| P2 | 会话恢复 | 从服务端拉取日志重建 | 大(~600行) |
| P2 | Docker 沙箱 | 容器执行 | 中(~500行) |
| P3 | WebSocket 消息通道 | 实时双向通信 | 大(~800行) |
| P3 | 多环境管理 | UI 选择/切换环境 | 中(~400行) |

## 4. 利弊分析速览

**利:**
- 解放本地终端, 后台执行长任务
- 可在更强硬件上运行(如 GPU 机器)
- 任务可恢复, 不怕断连
- 支持团队共享执行环境

**弊:**
- 需要额外基础设施(服务器/Docker)
- 网络延迟影响实时性
- 安全性需要仔细设计(SSH 密钥, 容器沙箱)
- 开发和维护成本较高
