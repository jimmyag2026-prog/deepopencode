# Claude Code MagicDocs 模块深度分析

## 1. 核心概念

MagicDocs = **对话驱动的活文档系统**:

> 以 `# MAGIC DOC:` header 标记的 .md 文件, 在每次对话轮次结束后由受限子 agent 自动增量更新。

### 1.1 架构

| 文件 | 职责 |
|------|------|
| `services/MagicDocs/magicDocs.ts` | 核心: 文件追踪 + 子 agent 调度 + canUseTool 白名单 |
| `services/MagicDocs/prompts.ts` | Prompt 构建: 内置模板 + 自定义覆盖 |

### 1.2 触发链路

```
启动 → initMagicDocs()
  ├─ registerFileReadListener → detectMagicDocHeader()
  │    正则: /^#\s*MAGIC\s+DOC:\s*(.+)$/im
  │    ├─ 匹配 → registerMagicDoc(filePath) 存入 trackedMagicDocs
  │    └─ 不匹配 → 忽略
  │
  └─ registerPostSamplingHook(updateMagicDocs)
       └─ 每轮对话结束后:
           ├─ 条件: querySource === 'repl_main_thread' && 无未完成 tool call
           └─ 遍历 trackedMagicDocs → updateMagicDoc()
                ├─ 重新读取文件内容
                ├─ 构建 prompt (对话上下文 + 文档当前内容)
                ├─ fork 受限子 agent (仅有 Edit 工具, 仅可编辑目标文件)
                └─ 子 agent 就地更新文档
```

### 1.3 文档格式

```markdown
# MAGIC DOC: Project Architecture
_custom instructions for the updater_

... 文档内容, 由子 agent 自动维护 ...
```

- 第一行 `# MAGIC DOC: title` — header, 不会被修改
- 第二行斜体 — 可选, 自定义更新指引
- 正文 — 子 agent 自由编辑区域

### 1.4 Prompt 结构

```
优先级: ~/.claude/magic-docs/prompt.md(用户自定义) > 内置模板

内置模板关键规则:
  - 保留 header 和斜体行不变
  - 就地更新, 不写 changelog
  - 删除过时信息
  - 只记录: 架构概览, 入口点, 设计决策, 非明显模式/坑, 关键依赖
  - 不记录: 代码显而易见的细节, 函数逐个文档, 实现步骤
```

### 1.5 安全限制

```typescript
// canUseTool: 只允许编辑目标文档
canUseTool = (toolName, input) => {
  if (toolName === FILE_EDIT_TOOL_NAME && input.file_path === docInfo.path) {
    return true
  }
  return false
}
```

## 2. OpenCode 现状

OpenCode 没有自动文档更新系统。

相关能力:
- AGENTS.md: 静态全局指令, 不自动更新
- Skill 系统: 可定义文档相关 skill, 但需手动触发
- 子 agent: 可通过 Task 工具创建 fork agent

## 3. 融合方案

### 3.1 设计: 作为 OpenCode 插件实现

MagicDocs 非常适合用 OpenCode 的插件系统实现:

```typescript
// ~/.config/opencode/plugins/magic-docs.ts
import type { Plugin } from "@opencode-ai/plugin"

export default (async ({ client, project, directory }) => {
  const trackedDocs = new Map<string, { title: string, instructions?: string }>()

  return {
    // 钩子1: 文件读取时检测 MAGIC DOC header
    "tool.execute.after": async (input, output) => {
      if (input.tool !== 'read') return
      const content = output.result
      const match = content?.match(/^#\s*MAGIC\s+DOC:\s*(.+)$/im)
      if (match) {
        trackedDocs.set(input.params.file_path, {
          title: match[1],
          instructions: extractInstructions(content)
        })
      }
    },

    // 钩子2: 对话结束后更新文档
    "experimental.chat.messages.transform": async (input, output) => {
      // 在每轮结束后检查是否需要更新
      for (const [path, doc] of trackedDocs) {
        await updateMagicDoc(path, doc, output.messages)
      }
    }
  }
}) satisfies Plugin
```

### 3.2 增强方案

| 特性 | CC 实现 | OC 增强建议 |
|------|---------|------------|
| 文档发现 | FileReadTool 被动检测 | + 启动时扫描 `*.md` 文件主动发现 |
| 更新触发 | 每轮结束后门控检查 | + 手动 `/update-docs` 命令 |
| 子 agent 权限 | 仅 Edit → 目标文件 | 复用 OC 的权限系统 |
| 自定义 prompt | ~/.claude/magic-docs/prompt.md | 支持 `.opencode/magic-docs/prompt.md` |
| 多种文档 | 单文件 | + 支持目录级别追踪 |
| 文档生成 | 无 | + 新增: 从零生成 MAGIC DOC |

### 3.3 实现步骤

1. **Phase 1: 核心插件** — 文件检测 + 对话结束自动更新
2. **Phase 2: 主动发现** — 启动时扫描项目中的 MAGIC DOC
3. **Phase 3: 手动触发** — `/update-docs` 命令立即更新所有文档
4. **Phase 4: 文档生成** — `/create-doc <path>` 从零创建活文档

### 3.4 价值评估

| 维度 | 评分 | 说明 |
|------|------|------|
| 实现复杂度 | ⭐⭐ | 纯插件可实现, 无需改 core |
| 用户价值 | ⭐⭐⭐⭐ | 项目文档自动随代码演变 |
| 风险 | ⭐ | 子 agent 权限受限, 仅编辑目标文件 |
| 维护成本 | ⭐⭐ | prompt 需要调优 |
