# DeepOpenCode 工具/技能/Agent 参考

## 工具总览 (13 个)

### 记忆系统 (openmem)

| 工具 | 描述 | 参数 | 返回 |
|------|------|------|------|
| `check-memory` | 加载项目记忆到上下文 | 无 | MEMORY.md + topic 文件内容 |
| `memory-search` | 关键词搜索记忆文件 | `query: string` | 匹配的文件片段 (≤5条) |
| `memory-status` | 查看记忆系统状态 | 无 | 文件数、索引大小、最后巩固时间 |

### 增强工具包 (deepagent)

| 工具 | 描述 | 参数 | 返回 |
|------|------|------|------|
| `brief` | 向用户发送消息 | `message: string`, `status: "normal"\|"proactive"` | toast 通知 |
| `sleep` | 等待指定时长 | `duration: number` (ms), `reason?: string` | 完成后继续 |
| `task-create` | 创建后台任务 | `description: string`, `prompt: string`, `agent?: string`, `model?: string` | taskId |
| `task-list` | 列出任务 | `status?: "running"\|"completed"\|"failed"\|"stopped"\|"all"` | 任务列表 |
| `task-output` | 查询任务输出 | `taskId: string`, `timeout?: number` (ms) | 状态/输出 |
| `task-stop` | 终止后台任务 | `taskId: string` | 确认/错误 |

### 远程执行 (remote-agent)

| 工具 | 描述 | 参数 | 返回 |
|------|------|------|------|
| `remote-exec` | SSH 远程执行命令 | `host: string`, `command: string`, `workdir?: string`, `timeout?: number` | stdout/stderr/exitCode |
| `remote-session` | 创建远程会话+同步代码 | `host: string`, `workdir?: string`, `command?: string` | sessionId + 执行结果 |
| `remote-list` | 列出远程会话 | 无 | 会话列表 |
| `remote-resume` | 查看会话状态 | `sessionId: string` | 会话详情 |

## 技能 (3 个)

### dream

- **触发**: `/dream` 命令，或 `@dream` 引用
- **流程**: 读取 MEMORY.md → 浏览每日日志 → 更新 topic 文件 → 清理索引
- **权限**: 仅限记忆目录读写

### memory-clean

- **触发**: `/memory-clean` 命令
- **流程**: 检查状态 → 识别过期/矛盾信息 → 清理 topic 文件 → 更新索引

### deep-plan

- **触发**: `/deep-plan` 或切换到 deep-plan agent
- **流程**: 探索代码库(4阶段) → 生成计划 → 用户审批(精多3次) → 执行
- **模式**: 只读规划，批准后切换到 build agent

## Agent (2 个)

### openmem-dream

```
模式: subagent
隐藏: true
权限: edit → ~/.deepopencode/memory/** (allow), *(deny)
      bash → ls/find/grep/cat/stat (allow), *(deny)
触发器: session.idle + 5门控满足
任务: 4阶段记忆巩固 (Orient→Gather→Consolidate→Prune)
```

### openmem-extract

```
模式: subagent
隐藏: true
权限: edit → deny
      bash → deny
触发器: turn结束时 quiet timer 触发
任务: 从对话提取 key insights → 追加到每日日志
```

## 存储格式

### MEMORY.md

```markdown
# Project Memory Index

- [architecture.md] 项目架构概览
- [patterns.md] 代码模式和约定
- [decisions.md] 重要设计决策
- [pitfalls.md] 已知坑和注意事项
```

- 最大 25KB
- 每行 ~150 字符 (短期描述 + 文件指针)
- 定期由巩固流程更新

### 每日日志

```markdown
## 2026-05-27
- 项目使用 monorepo 结构，packages/ 下独立发布
- src/auth.ts 是认证中间件，所有 API 路由必须经过
- 已知坑: sqlite-vec 扩展在 Node 20 下需要额外编译标志
```

- 纯 bullet list
- 每条用 `- ` 开头
- 由即时提取流程追加

### Topic 文件

```markdown
# Architecture Decisions

## 2026-05-27
采用 monorepo 结构，packages/ 下每个子包独立发布。
原因: 团队需要独立版本和发布周期。

## 2026-05-20
使用 Effect-TS 作为核心运行时。
原因: 类型安全的错误处理和资源管理。
```

- 按时间倒序
- 每条包含日期和决策原因

### 远程会话持久化文件

```json
{
  "rem_1716920000000_1": {
    "id": "rem_1716920000000_1",
    "host": "10.0.1.5",
    "user": "deploy",
    "port": 22,
    "workdir": "/tmp/opencode-session",
    "status": "completed",
    "lastOutput": "Build successful",
    "exitCode": 0,
    "createdAt": 1716920000000
  }
}
```

## 配置文件参考

### 项目 opencode.json

```jsonc
{
  "$schema": "https://opencode.ai/config.json"
}
// Plugin 文件放在 .opencode/plugins/*.ts 自动加载，无需声明
// 全局 config (~/.config/opencode/) 保持原有 provider 配置不变
```

### openmem 配置 (可选)

```jsonc
// .opencode/openmem.json
{
  "enabled": true,
  "extract": { "enabled": true, "model": null },
  "consolidation": { "enabled": true, "minHours": 6, "minSessions": 3, "model": null },
  "storage": { "path": "~/.deepopencode/memory", "maxIndexSize": 25600 }
}
```

### ACL 权限参考

```jsonc
// ~/.config/opencode/opencode.jsonc
{
  "permission": {
    // 允许记忆目录内部编辑，禁止外部编辑
    "edit": { "~/.deepopencode/memory/**": "allow", "*": "ask" },
    // 远程执行需要 SSH 权限
    "bash": { "ssh *": "allow", "scp *": "allow", "*": "ask" }
  }
}
```

## API 钩子使用矩阵

| 钩子 | openmem | deepagent | remote-agent |
|------|---------|-----------|--------------|
| `tool` | 3 tools | 6 tools | 4 tools |
| `config` | 注册 agent | — | — |
| `tool.execute.before` | turn 计数 | — | — |
| `tool.execute.after` | turn 检测 + 提取触发 | — | — |
| `event(session.idle)` | 巩固触发 | — | — |
| `plugin factory($)` | — | — | SSH 执行 |

## 版本兼容性

| OpenCode 版本 | 兼容 | 备注 |
|--------------|------|------|
| 1.15.x | ✅ | 测试通过 |
| 1.14.x | ✅ | stable hooks 相同 |
| 1.13.x | ⚠️ | client.session API 可能有差异 |
| < 1.13 | ❌ | plugin 系统不完整 |
