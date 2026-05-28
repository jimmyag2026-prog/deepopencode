# Claude Code vs OpenCode 功能对标矩阵

## 一、总览

| 维度 | Claude Code (CC) | OpenCode (OC) | 差距评估 |
|------|-------------------|---------------|---------|
| 源码规模 | 1884 TS/TSX 文件, ~16.3万行 | npm 包, 二进制分发 | - |
| 工具数量 | 42 个内置工具 | ~16 个内置工具 | **CC 多 26 个** |
| 斜杠命令 | 100+ 个 | 自定义 + 少量内置 | CC 多 |
| 代理类型 | primary / subagent + swarm teammate | primary / subagent / all | CC 多 swarm |
| LSP 集成 | 完整(9种操作+被动诊断) | 基础(实验性, 7种操作) | CC 更成熟 |
| 远程执行 | Teleport/CCR 完整云容器 | 无 | **OC 无** |
| 规划模式 | UltraPlan(云端外包) | Plan Agent(本地只读) | CC 架构不同 |
| 记忆系统 | extractMemories + autoDream | 无(仅有 compaction) | **OC 无** |
| 桌面自动化 | Computer Use(macOS原生) | 无 | **OC 无** |
| 插件系统 | 完整(安装/管理/CLI命令) | 完整(钩子系统+TUI) | 各有优势 |

## 二、工具对标详情

### 2.1 完全匹配 (11/42)

| 工具 | CC | OC | 说明 |
|------|-----|-----|-----|
| Bash/Shell 执行 | BashTool | bash | CC 多 sandbox/dangerouslyDisableSandbox |
| 文件编辑 | FileEditTool | edit | 均支持精确字符串替换 |
| 文件读取 | FileReadTool | read | CC 多 pages 参数(笔记本支持) |
| 文件写入 | FileWriteTool | write | 功能等价 |
| Glob 搜索 | GlobTool | glob | 功能等价 |
| Grep 搜索 | GrepTool | grep | CC 多 output_mode/head_limit/A-B-C |
| Web 获取 | WebFetchTool | webfetch | 功能等价 |
| Web 搜索 | WebSearchTool | websearch | 功能等价 |
| 技能加载 | SkillTool | skill | 功能等价 |
| MCP 工具 | MCPTool | MCP(原生) | 均支持动态MCP工具 |
| Todo/待办 | TodoWriteTool | todowrite | 功能等价 |

### 2.2 部分匹配 (5/42)

| 工具 | CC 实现 | OC 实现 | 差距 |
|------|---------|---------|------|
| 用户提问 | AskUserQuestionTool: 多选/单选, 预览框 | question: 简单互动 | CC 有复杂的预览和导航 UI |
| 子代理 | AgentTool: 支持后台/前台/team/model/cwd | task: 子代理调用 | CC 更灵活, 支持更多参数 |
| MCP 资源读取 | ReadMcpResourceTool + ListMcpResourcesTool | MCP 原生支持 | OC 无显式列表工具 |
| 计划模式 | EnterPlanMode/ExitPlanMode: 模型可主动切换 | Plan Agent: 预设只读代理 | CC 模型中可自主切换 |
| LSP 操作 | LSPTool: 9种操作含被动诊断 | lsp(实验性): 7种操作 | CC 更成熟 |

### 2.3 OpenCode 缺失 (26/42)

| 类别 | 工具 | 核心功能 |
|------|------|---------|
| **后台任务** | TaskCreate/Get/List/Update/Stop/Output | 完整的 V2 任务 CRUD 系统 |
| **团队协作** | TeamCreate/Delete | 多代理 Swarm 编队 |
| **代理间通信** | SendMessage | 子代理→主代理消息传递 |
| **Cron 调度** | ScheduleCron(Create/Delete/List) | 定时任务调度 |
| **Worktree** | EnterWorktree/ExitWorktree | Git worktree 隔离环境 |
| **Notebook** | NotebookEdit | Jupyter Notebook 单元格编辑 |
| **PowerShell** | PowerShell | Windows PowerShell 执行 |
| **REPL 模式** | REPLTool | 批量工具调用虚拟 Shell |
| **配置管理** | Config | 模型中获取/设置配置 |
| **消息输出** | Brief | 模型主动向用户发消息 |
| **远程触发** | RemoteTrigger(CRUD) | 远程工作流触发器管理 |
| **合成输出** | SyntheticOutput | 结构化 JSON 输出(给 SDK) |
| **工具发现** | ToolSearch | 按关键词搜索工具 |
| **暂停** | Sleep | 可中断的等待 |
| **MCP 认证** | McpAuth | MCP OAuth 内联认证 |

## 三、架构能力对标

### 3.1 LSP (语言服务器协议)

| 子能力 | Claude Code | OpenCode | 备注 |
|--------|-------------|----------|------|
| 协议操作 | 9 种 | 7 种 | CC 多 prepareCallHierarchy/incomingCalls/outgoingCalls |
| 诊断系统 | 被动诊断通知 + DiagnosticRegistry | 基础状态查询 | **CC 独有**: 翻译通知 -> 去重 -> 附件投递 |
| 文件同步 | didOpen/Change/Save/Close | 基础 | CC 更完整 |
| 配置源 | 插件.lsp.json + manifest | opencode.json lsp字段 | 各有优势 |
| 崩溃恢复 | 状态机 + 最大重启限制 | - | CC 更健壮 |
| 音量限制 | 10条/文件, 30条/总计 LRU去重 | - | CC 防止上下文淹没 |
| LSP工具 | 1-based↔0-based坐标转换 | - | CC 更用户友好 |

### 3.2 远程执行系统

| 子能力 | Claude Code (Teleport/CCR) | OpenCode |
|--------|---------------------------|----------|
| 远程容器执行 | ✅ 完整的CCR容器系统 | ❌ |
| 环境选择 | ✅ anthopic_cloud/byoc/bridge | ❌ |
| Git Bundle传输 | ✅ 3层渐进式回退 | ❌ |
| 会话持久化 | ✅ WebSocket + HTTP API | ❌ |
| 会话恢复 | ✅ telport / --resume | ❌ |
| 多环境 | ✅ 支持默认环境配置 | ❌ |
| WIP捕获 | ✅ git stash create | ❌ |

### 3.3 规划系统

| 子能力 | Claude Code (UltraPlan) | OpenCode (Plan Agent) |
|--------|------------------------|----------------------|
| 执行模型 | 云端容器(不阻塞终端) | 本地进程(阻塞) |
| 并发性 | 终端可继续本地工作 | 终端被阻塞 |
| 模型 | 专用 Ultraplan 模型(Opus) | 当前agent模型 |
| 审批 | 浏览器界面或传回终端 | 终端内对话框 |
| 执行目标 | local/remote/PR 三种选择 | 仅本地 |
| 细化迭代 | 浏览器多次拒绝→修改 | 终端内一次性 |
| 恢复 | 支持session恢复 | 不支持 |
| 关键字触发 | "ultraplan" 自动路由 | 需显式 /plan |

### 3.4 记忆系统

| 子能力 | Claude Code | OpenCode |
|--------|-------------|----------|
| 自动记忆提取 | ✅ extractMemories(每turn结束) | ❌ |
| 记忆巩固 | ✅ autoDream(定时合并/修剪) | ❌ |
| 索引文件 | ✅ MEMORY.md(入口+导航) | ❌ |
| 日志系统 | ✅ 每日日志 logs/YYYY/MM/ | ❌ |
| 团队记忆同步 | ✅ teamMemorySync + 密钥扫描 | ❌ |
| Session记忆 | ✅ SessionMemory(项目上下文) | ❌ |
| 上下文压缩 | ✅ compaction | ✅ compaction |
| 活文档 | ✅ MagicDocs(对话驱动更新) | ❌ |

### 3.5 桌面自动化

| 子能力 | Claude Code (Computer Use) | OpenCode |
|--------|---------------------------|----------|
| 屏幕捕获 | ✅ SCContentFilter, 多显示器 | ❌ |
| 鼠标控制 | ✅ CGEvent(移动/点击/拖拽) | ❌ |
| 键盘控制 | ✅ enigo(按键/输入/粘贴) | ❌ |
| 应用管理 | ✅ 枚举/过滤/隐藏 | ❌ |
| Swift桥接 | ✅ Native模块 + CFRunLoop泵送 | ❌ |
| 权限检查 | ✅ TCC Accessibility/ScreenRecording | ❌ |
| 进程锁 | ✅ 文件锁 + 竞态处理 | ❌ |
| Escape热键 | ✅ 全局CGEventTap | ❌ |
| Turn清理 | ✅ 恢复隐藏/释放锁 | ❌ |

## 四、总结

### OpenCode 已具备(无需补充)
- ✅ 核心文件操作工具(Read/Write/Edit/Glob/Grep)
- ✅ Web 搜索和抓取
- ✅ MCP 客户端(本地+远程)
- ✅ 子代理系统(Task)
- ✅ 权限模型(支持 glob 模式匹配)
- ✅ 插件系统(完整生命周期钩子)
- ✅ 技能系统(按需加载)
- ✅ 上下文压缩
- ✅ 基础 LSP 支持
- ✅ 工作树(Worktree)支持

### 值得融合的模块(按优先级)

| 优先级 | 模块 | 理由 |
|--------|------|------|
| **P0** | 记忆系统(autoDream + extractMemories) | 让代理越来越"懂"项目, 这是当前OC最大差距 |
| **P0** | LSP 被动诊断 | OC已有LSP基础, 补充诊断投递大幅提升代码理解 |
| **P1** | 增强工具集(Task管理/ScheduleCron/Brief) | 显著提升代理自主能力 |
| **P1** | MagicDocs 活文档 | 项目文档自动随代码演变, 实用性强 |
| **P2** | 远程执行(Teleport) | 需要后端基础设施, 但价值巨大 |
| **P2** | UltraPlan式远程规划 | 解放终端, 提升规划质量 |
| **P3** | 桌面自动化(ComputerUse) | 仅 Darwin, 需要原生模块, 访问面广 |
