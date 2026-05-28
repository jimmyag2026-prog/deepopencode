# Claude Code UltraPlan 模块深度分析

## 1. 核心概念

UltraPlan 不是简单的"plan mode"，而是**云端外包规划系统**:

> 将重规划任务丢到 CCR(Claude Code Remote)云容器中用最强模型(Opus)跑，终端完全解放，结果通过事件流回传。

### 1.1 架构组成

| 组件 | 文件 | 职责 |
|------|------|------|
| 入口命令 | `commands/ultraplan.tsx` | `/ultraplan` 斜杠命令 + launchUltraplan() |
| 核心状态机 | `utils/ultraplan/ccrSession.ts` | ExitPlanModeScanner + pollForApprovedExitPlanMode |
| 关键字检测 | `utils/ultraplan/keyword.ts` | 识别"ultraplan"触发词(排除误触发) |
| 会话创建 | `utils/teleport.tsx` | 注入 set_permission_mode + ultraplan 标记 |
| 远程任务 | `tasks/RemoteAgentTask/` | 通用远程轮询 + log/todoList 提取 |
| 输入拦截 | `utils/processUserInput/` | ultraplan → plan 替换 + 路由 |
| 状态管理 | `state/AppStateStore.ts` | ultraplanLaunching/url/pendingChoice 等状态 |

### 1.2 完整工作流

```
阶段1: 触发 (3种路径)
  /ultraplan <prompt>          — 显式命令
  "ultraplan" 关键字          — 自动检测
  ExitPlanMode对话框"Ultraplan" — 从本地plan跳转
        │
        ▼
阶段2: 远程创建
  teleportToRemote():
    ├─ permissionMode: 'plan'
    ├─ ultraplan: true
    ├─ initialMessage = buildUltraplanPrompt()
    └─ registerRemoteAgentTask(type='ultraplan')
        │
        ▼
阶段3: 远程规划 (CCR 容器内)
  ├─ Opus 运行在 plan mode
  ├─ 多代理探索 → 文件分析 → 生成计划
  ├─ TodoWrite 输出 todo list
  └─ AskUserQuestion 收集需求
        │
        ▼
阶段4: ExitPlanMode 检测 (双轮询器并行)
  startDetachedPoll() → ExitPlanModeScanner
    状态机判定: approved > terminated > rejected > pending > unchanged
  startRemoteSessionPolling() → 收集 log/todoList, 渲染进度UI
        │
        ▼
阶段5: 审批
  ├─ "Execute in CCR" → 远程继续执行, 结果作为 PR
  ├─ "Teleport back" → 计划文本注入本地 session
  └─ "Reject" → 浏览器中迭代修改
        │
        ▼
阶段6: 本地实施 (仅 executionTarget='local')
  计划 → 注入消息队列 → 本地 agent 进入 plan mode 执行
```

### 1.3 关键设计细节

**ExitPlanModeScanner 状态机:**
- 对每个 SDKMessage 批处理扫描 `tool_use` 和 `tool_result`
- 按优先级判定: approved > terminated > rejected > pending > unchanged
- 判断 phase: plan_ready / needs_input / running

**三种执行目标:**
| 目标 | 触发 | 行为 |
|------|------|------|
| remote | 用户在浏览器选"Execute in CCR" | CCR继续执行 |
| local | 检测 `__ULTRAPLAN_TELEPORT_LOCAL__` 哨兵 | 计划传回本地执行 |
| PR | CCR 自动创建 PR | 代码提交为 PR |

**恢复能力:**
- 支持 `--resume`: 从 sidecar 恢复 RemoteAgentTask 状态和轮询
- 30 分钟超时 (ULTRAPLAN_TIMEOUT_MS)

## 2. OpenCode 现有 Plan 能力

OpenCode 的 `plan` agent:
- 模式: 只读 primary agent (edit: deny, bash: ask)
- 调用: 用户切换 agent 或使用 `/plan`
- 流程: agent 在本地进程中运行, 用户阻塞等待
- 模型: 使用当前配置模型

## 3. 融合方案

### 3.1 核心差异分析

| 维度 | UltraPlan | OC Plan | 融合方向 |
|------|-----------|---------|---------|
| 执行位置 | 远程容器 | 本地进程 | 本地优先, 可选远程 |
| 并发性 | 不阻塞终端 | 阻塞终端 | OC 需要改进的关键点 |
| 模型选择 | 自动切最强模型 | 当前模型 | OC 可支持 |
| 审批方式 | 浏览器 / 终端 | 仅终端 | OC 足够 |

### 3.2 推荐融合路径: 本地增强 (Phase 1) + 可选远程 (Phase 2)

**Phase 1: 增强本地 Plan**
```
现有 plan agent:
  ├── 【增强】允许 AskUserQuestion 收集需求
  ├── 【增强】多次迭代(拒绝→修改→重新提交), 添加 rejectCount
  ├── 【增强】TodoWrite 输出 plan 进度
  └── 【保留】只读模式, 终端内交互
```

**Phase 2: 异步 Plan (不阻塞终端)**
```
plan agent 增强:
  ├── 【新增】异步模式: agent 运行在后台, 终端可继续本地工作
  ├── 【新增】Polling 检测 ExitPlanMode → 通知用户
  ├── 【新增】executionTarget: local | continue_in_background
  └── 【新增】Plan 恢复能力
```

### 3.3 不推荐引入的部分

| 能力 | 理由 |
|------|------|
| 远程 CCR 容器 | 需要 Anthropic 云基础设施, 无开源等价物 |
| 浏览器审批界面 | OC 是 TUI, 浏览器不是目标界面 |
| Teleport 会话恢复 | 依赖 CCR 服务端持久化 |
| 专用 Ultraplan 模型 | Opus 切换是 CC 的 API 集成 |

## 4. 实现建议

| 优先级 | 特性 | 实现方式 | 工作量 |
|--------|------|---------|--------|
| P0 | 迭代式 Plan | plan agent 拒绝后可修改重提 | 中(~300行) |
| P1 | AskUserQuestion 集成 | plan 中允许收集需求 | 小(~100行) |
| P1 | 异步 Plan | 后台运行, 完成时通知 | 大(~600行) |
| P2 | Plan 恢复 | 保存 plan 状态到 sidecar | 中(~400行) |
