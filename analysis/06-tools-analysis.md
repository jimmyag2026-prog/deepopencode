# Claude Code Tools 模块深度分析

## 1. 工具系统架构

### 1.1 核心接口

```typescript
// CC 的工具定义核心 (Tool.ts)
interface ToolDefinition {
  name: string
  description: string
  inputSchema: ToolInputJSONSchema

  // 生命周期
  isEnabled?: () => boolean           // 动态启用/禁用
  shouldDefer?: boolean               // 延迟加载(性能优化)

  // 执行
  validateInput?: (input) => ValidationResult
  checkPermissions?: (input, context) => Promise<PermissionResult>
  call: (input, context) => Promise<ToolResult>

  // 渲染
  renderToolUseMessage?: (input) => ReactElement
  renderToolResultMessage?: (result) => ReactElement
  renderToolUseErrorMessage?: (error) => ReactElement
}
```

### 1.2 ToolContext (执行上下文)

```typescript
interface ToolContext {
  // 状态
  getAppState: () => AppState
  setAppState: (fn) => void
  options: { abortController: AbortController; ... }

  // 模式
  permissionMode: PermissionMode
  querySource: QuerySource

  // 工具输出
  toolOutputFn?: (output, options) => void

  // 子代理
  forkAgent?: (options) => Promise<void>
}
```

## 2. OpenCode 工具清单 (~16个)

| 工具 | 对应 CC 工具 | 状态 |
|------|-------------|------|
| bash | BashTool | ✅ 匹配 |
| read | FileReadTool | ✅ 匹配 (CC 多 notebook pages) |
| edit | FileEditTool | ✅ 匹配 |
| write | FileWriteTool | ✅ 匹配 |
| apply_patch | (CC 无) | OC 独有 |
| grep | GrepTool | ✅ 匹配 |
| glob | GlobTool | ✅ 匹配 |
| list | (CC 无独立工具, 用 Bash ls) | OC 独有 |
| task | AgentTool | ⚠️ 部分 (CC 更灵活) |
| webfetch | WebFetchTool | ✅ 匹配 |
| websearch | WebSearchTool | ✅ 匹配 |
| question | AskUserQuestionTool | ⚠️ 部分 (CC 有复杂 UI) |
| todowrite | TodoWriteTool | ✅ 匹配 |
| skill | SkillTool | ✅ 匹配 |
| lsp (experimental) | LSPTool | ⚠️ 部分 (CC 更成熟) |
| MCP (native) | MCPTool + ListMcpResources + ReadMcpResource | ✅ 匹配 |

## 3. 值得引入的工具 (优先级排序)

### P0: 直接增强现有工具

| 增强 | 目标工具 | 说明 |
|------|---------|------|
| background/foreground mode | task | 允许子代理后台运行 |
| model selection | task | 允许指定子代理模型 |
| notebook 支持 | read | 读取 .ipynb 文件 |
| 详细参数 | grep | output_mode, head_limit, -A/-B/-C |

### P1: 新增高价值工具

| 工具 | 价值 | 难度 | 说明 |
|------|------|------|------|
| **Brief** | ⭐⭐⭐ | ⭐ | 模型向用户主动发消息, 批量结果汇报 |
| **Sleep** | ⭐⭐ | ⭐ | 可中断的延迟等待 (避免 busy-loop 轮询) |
| **ToolSearch** | ⭐⭐ | ⭐⭐ | 按关键词搜索可用工具, 工具发现 |
| **SyntheticOutput** | ⭐ | ⭐⭐ | 结构化 JSON 输出 (给 SDK/程序调用) |

### P2: 高级任务系统

| 工具组 | 价值 | 难度 | 说明 |
|--------|------|------|------|
| TaskCreate/Get/List/Update/Stop | ⭐⭐⭐ | ⭐⭐⭐ | 完整的 V2 任务 CRUD (长期任务管理) |
| TaskOutput | ⭐⭐⭐ | ⭐⭐ | 获取后台任务输出 (阻塞/非阻塞) |
| ScheduleCron | ⭐⭐ | ⭐⭐⭐ | 定时任务调度 |

### P3: 平台特定工具

| 工具 | 价值 | 难度 | 说明 |
|------|------|------|------|
| NotebookEdit | ⭐⭐ | ⭐⭐ | Jupyter 单元格编辑 |
| PowerShell | ⭐ | ⭐ | Windows PowerShell (非必要) |
| Config | ⭐⭐ | ⭐ | 模型中动态修改配置 |

## 4. 不建议引入的工具

| 工具 | 理由 |
|------|------|
| TeamCreate/Delete | 过度设计, OC 的 task 子代理已够用 |
| Enter/Exit Plan Mode | OC 用 agent 切换机制替代 |
| Enter/Exit Worktree | OC 已有 worktree API |
| REPL Tool | 过度抽象, 直接调用工具更清晰 |
| McpAuth Tool | OC 通过配置处理 MCP 认证 |
| RemoteTrigger | 依赖 CCR 远程基础设施 |
| Cron (完整) | 过度设计, Sleep 更简单实用 |

## 5. 推荐实现路径

```
Phase 1 (立即): 增强现有工具
  ├── task: 添加 background/model/cwd 参数
  ├── grep: 添加 head_limit 和 output_mode
  └── read: 添加 notebook 支持

Phase 2 (短期): 新增轻量工具
  ├── Brief: 模型主动消息通道
  ├── Sleep: 可中断延迟
  └── ToolSearch: 工具发现

Phase 3 (中期): 任务系统
  ├── TaskCreate/Get/List: V2 任务 CRUD
  └── TaskOutput: 后台任务输出

Phase 4 (长期): 调度系统
  └── ScheduleCron: 定时任务
```
