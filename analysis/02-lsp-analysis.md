# Claude Code LSP 模块深度分析

## 1. 架构全景

### 1.1 文件清单 (10 个核心文件)

| 文件 | 行数 | 职责 |
|------|------|------|
| `services/lsp/LSPClient.ts` | 447 | JSON-RPC 传输层: stdio子进程管理, `vscode-jsonrpc` Connection 包装 |
| `services/lsp/LSPServerInstance.ts` | 511 | 单服务器状态机: stopped→starting→running→error, 崩溃恢复, ContentModified重试 |
| `services/lsp/LSPServerManager.ts` | 420 | 多服务器路由: extensionMap, 文件同步, 请求路由 |
| `services/lsp/manager.ts` | 289 | 全局单例编排: 初始化/关闭/重新初始化, 代际追踪 |
| `services/lsp/config.ts` | 79 | 配置加载: 从插件合并 LSP 服务器定义 |
| `services/lsp/passiveFeedback.ts` | 328 | 诊断通知→附件: 注册 publishDiagnostics 处理器, 格式化转化 |
| `services/lsp/LSPDiagnosticRegistry.ts` | 386 | 诊断存储/去重: LRU(500文件), 音量限制(10/文件, 30/总计) |
| `tools/LSPTool/LSPTool.ts` | 860 | 工具定义: 9种操作, 权限检查, git-ignored过滤 |
| `tools/LSPTool/formatters.ts` | 592 | 结果格式化: DocumentSymbol/SymbolInformation/调用层次结构 |
| `utils/plugins/lspPluginIntegration.ts` | 387 | 插件 LSP 配置: .lsp.json 解析, 环境变量替换, schema 验证 |

### 1.2 数据流

```
启动 → initializeLspServerManager()
  ├─ 从插件加载 LSP 配置 (.lsp.json + manifest)
  ├─ 为每个配置创建 LSPServerInstance(惰性初始化 LSPClient)
  └─ 注册 textDocument/publishDiagnostics 处理器

查询时:
  附件系统 → checkForLSPDiagnostics() → 去重/音量限制 → Attachment[] 注入上下文
  LSPTool.call():
    ├─ 确保文件已打开 (didOpen)
    ├─ 发送 LSP 请求 (definition/references/hover/...)
    ├─ 过滤 git-ignored 结果
    └─ 格式化结果文本 → 返回给 LLM

关键词/文件工具:
  FileEdit/FileWrite → clearDeliveredDiagnosticsForFile() 清除过时诊断
```

### 1.3 状态机 (LSPServerInstance)

```
  ┌─────────┐     ┌──────────┐     ┌────────┐
  │ stopped │────▶│ starting │────▶│running │
  └─────────┘     └──────────┘     └────────┘
        ▲                │               │
        │                ▼               ├──────▶ stopping ──▶ stopped
        │            ┌───────┐           │
        └────────────│ error │◀──────────┘
                     └───────┘
```

关键策略:
- **惰性加载**: LSPClient 只在首次 start() 时 require, 避免加载 vscode-jsonrpc
- **崩溃抑制**: `crashSuppressUntil` 时间窗口避免重复崩溃的无限重启
- **ContentModified 重试**: (-32801) 错误最多重试 3 次, 500ms 指数退避

## 2. OpenCode 现有 LSP 能力

OpenCode 已有 LSP 支持:
- 配置: `lsp: true/false/object` 在 opencode.json 中
- 实验性工具: `lsp` 工具 (需 `OPENCODE_EXPERIMENTAL_LSP_TOOL=true`)
- 操作: goToDefinition, findReferences, hover, documentSymbol, workspaceSymbol, goToImplementation, callHierarchy
- API: `app.lsp().status()` 提供 LSP 状态

### OpenCode LSP 缺失的部分

| 能力 | CC | OC | 影响 |
|------|-----|-----|------|
| 被动诊断投递 | ✅ 自动注入到下一轮上下文 | ❌ | 模型无法感知代码错误, 只能主动查询 |
| 诊断去重 | ✅ LRU缓存, 跨轮次去重 | ❌ | 相同错误重复出现, 浪费上下文 |
| 诊断音量限制 | ✅ 10条/文件, 30条/总计 | ❌ | 大量诊断淹没上下文窗口 |
| 文件同步 | ✅ didOpen/Change/Save/Close 完整 | 基础 | CC 可确保 LSP 服务器状态与文件系统同步 |
| 崩溃恢复 | ✅ 状态机 + 最大重启 | - | CC 更健壮 |
| 坐标转换 | ✅ 1-based ↔ 0-based | - | CC 更用户友好 |
| 调用层次结构 | ✅ prepareCallHierarchy + incoming/outgoingCalls | callHierarchy | CC 更完整 |
| 插件配置 | ✅ .lsp.json + manifest | opencode.json | 各有优势 |

## 3. 融合方案设计

### 3.1 策略: 增强 OC 现有 LSP, 非重写

OC 已有 LSP 基础, 应在其上增量添加 CC 的优秀特性:

```
现有 OC LSP 模块
  │
  ├── 【新增】诊断通知管道 (passiveFeedback)
  │     ├── 注册 textDocument/publishDiagnostics
  │     ├── 诊断转化器 (LSP severity → OC severity)
  │     └── DiagnosticRegistry (存储 + 去重 + 音量限制)
  │
  ├── 【新增】文件同步完整性
  │     ├── 在 read/edit/write 工具中触发 didOpen/didChange
  │     └── 追踪已打开文件列表
  │
  ├── 【增强】LSP 工具
  │     ├── 添加 prepareCallHierarchy 操作
  │     ├── 添加 1-based↔0-based 坐标转换
  │     └── git-ignored 结果过滤
  │
  └── 【新增】插件 LSP 配置
        └── 支持从 .opencode/lsp/ 目录加载配置
```

### 3.2 诊断投递管道 (核心增值)

这是 CC LSP 模块中最值得借鉴的设计:

```
[LSP 服务器进程]
    │ notification: textDocument/publishDiagnostics
    ▼
[DiagnosticHandler] — 对每个打开的文件注册
    │
    ├── 转换: LSP Diagnostic → { message, severity, source, code, range }
    ├── 过滤: 忽略 hint 级别, 仅保留 Error/Warning/Info
    └── 存储: → DiagnosticRegistry(Map<uri, Diagnostic[]>)
            │
            ▼ 下一轮对话开始时
[AttachmentsBuilder]
    │
    ├── 去重: LRU set<uri> 检查之前已投递的诊断
    ├── 限流: ≤10 条/文件, ≤30 条/总计
    └── 输出: Attachment[] → 注入到 system prompt 上下文
```

### 3.3 实现优先级

| 优先级 | 特性 | 工作量 | 影响 |
|--------|------|--------|------|
| P0 | 诊断投递管道 | 中(~400行) | 高: 模型自动感知代码错误 |
| P1 | 诊断去重+限流 | 小(~150行) | 中: 防止上下文淹没 |
| P1 | 文件同步完整性 | 小(~100行) | 中: LSP 服务器状态一致性 |
| P2 | 调用层次结构 | 小(~80行) | 低: 小众需求 |
| P2 | 插件LSP配置 | 中(~200行) | 中: 扩展性 |
