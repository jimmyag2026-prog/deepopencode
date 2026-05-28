# DeepOpenCode 部署指南

## 概述

DeepOpenCode 是一套 OpenCode 增强框架，包含 **13 个工具、3 个技能、2 个 Agent**。以 Claude Code 源码为蓝本设计，通过 OpenCode 原生 Plugin/Skill/Agent 三层体系实现。

```
openmem (记忆系统)    → 3 tools + 2 skills + 2 agents
deepagent (工具包)     → 6 tools
remote-agent (远程)    → 4 tools (可选)
deep-plan (规划)       → 1 skill
```

## 前置条件

- **OpenCode >= 1.15.0**（`opencode --version` 验证）
- macOS / Linux（remote-agent 依赖 SSH）
- 无额外依赖（Plugin 运行时由 OpenCode 提供 `@opencode-ai/plugin` 和 `zod`）

## 安装

### 1. 复制 Plugin 文件

```bash
# 进入目标项目目录
cd /path/to/your/project

# 创建 opencode 插件目录
mkdir -p .opencode/plugins .opencode/skills

# 复制插件（从 deepopencode/sandbox 复制单文件版本）
cp /Users/jimmyclaw/deepopencode/sandbox/.opencode/plugins/openmem.ts .opencode/plugins/
cp /Users/jimmyclaw/deepopencode/sandbox/.opencode/plugins/deepagent.ts .opencode/plugins/
cp /Users/jimmyclaw/deepopencode/sandbox/.opencode/plugins/remote-agent.ts .opencode/plugins/  # 可选
```

### 2. 复制 Skill 文件

```bash
cp /Users/jimmyclaw/deepopencode/sandbox/.opencode/skills/dream/SKILL.md .opencode/skills/dream/
cp /Users/jimmyclaw/deepopencode/sandbox/.opencode/skills/memory-clean/SKILL.md .opencode/skills/memory-clean/
cp /Users/jimmyclaw/deepopencode/sandbox/.opencode/skills/deep-plan/SKILL.md .opencode/skills/deep-plan/
```

### 3. 启动

```bash
cd /path/to/your/project
opencode
# 首次对话输入: "check-memory"
```

## 验证安装

```bash
# 启动时查看日志确认插件加载
opencode --log-level DEBUG 2>&1 | grep "plugin.*path="
# 应看到:
#   plugin path=file:///.../openmem.ts loading plugin
#   plugin path=file:///.../deepagent.ts loading plugin
#   plugin path=file:///.../remote-agent.ts loading plugin (可选)
```

或在 opencode 中输入以下命令验证：
- `check-memory` — 查看项目记忆
- `memory-status` — 查看记忆系统状态
- `brief "hello"` — 测试 Brief 工具
- `task-list` — 查看后台任务
- `/dream` — 手动触发记忆巩固

## 配置

### openmem 配置

在项目 `.opencode/` 目录创建 `openmem.json`：

```jsonc
{
  "enabled": true,
  "extract": {
    "enabled": true,
    "model": null           // null = 使用 small_model，可设为具体模型名
  },
  "consolidation": {
    "enabled": true,
    "minHours": 6,          // 最小巩固间隔（小时）
    "minSessions": 3,       // 最小新 session 数才触发巩固
    "model": null
  },
  "storage": {
    "path": "~/.deepopencode/memory",   // 记忆存储根目录
    "maxIndexSize": 25600           // MEMORY.md 最大字节数
  }
}
```

### Agent 引导（推荐）

在 `AGENTS.md` 中添加：

```markdown
## Memory
- 每次 session 开始时调用 `check-memory` 加载项目记忆
- 遇到不了解的内容时用 `memory-search` 搜索相关记忆
- 重大决策或发现坑时简要记录，系统会自动保存到记忆
```

## 与社区插件共存

| 插件 | 兼容性 | 说明 |
|------|--------|------|
| opencode-mem | 独立 | 各自存储，不冲突 |
| opencode-supermemory | 独立 | 不同存储后端 |
| opencode-swarm | 兼容 | 可同时启用 |
| opencode-token-tracker | 兼容 | 无冲突 |

## 卸载

```bash
rm .opencode/plugins/openmem.ts
rm .opencode/plugins/deepagent.ts
rm .opencode/plugins/remote-agent.ts
rm -rf .opencode/skills/dream .opencode/skills/memory-clean .opencode/skills/deep-plan
# 记忆文件保留在 ~/.deepopencode/memory/，手动删除
```

## 故障排查

| 问题 | 检查 |
|------|------|
| 插件未加载 | `ls .opencode/plugins/` 确认 .ts 文件存在（必须是扁平文件，非子目录） |
| 工具不可用 | 重启 opencode（config 在启动时读取一次） |
| 记忆未保存 | 检查 `~/.deepopencode/memory/<hash>/logs/` 是否生成 |
| 巩固未触发 | 需要满足门控：>= 6小时 + >= 3个新session |
| Agent 找不到 | `config` hook 在启动时注册，确保 `openmem.ts` 已加载 |
