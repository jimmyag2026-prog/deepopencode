# DeepOpenCode

**OpenCode 全栈 Agent 增强框架** — 以 Claude Code 源码方案为蓝本，通过 OpenCode 原生 Plugin/Skill/Agent 三层体系实现。

13 工具 · 3 技能 · 2 Agent · 零外部依赖 · 零实验性 API

## 模块

| 模块 | 工具数 | 说明 |
|------|--------|------|
| **openmem** | 3 | 记忆系统 — 即时提取 + 定时巩固 (复刻 CC extractMemories + autoDream) |
| **deepagent** | 6 | 增强工具包 — Brief / Sleep / Task CRUD |
| **remote-agent** | 4 | 远程执行 — SSH bridge + Git bundle 传输 |
| **deep-plan** | 1 | 迭代式规划 Skill |

## 快速安装

```bash
cd /path/to/your/project
cp /path/to/deepopencode/sandbox/.opencode/plugins/*.ts .opencode/plugins/
cp /path/to/deepopencode/sandbox/.opencode/skills/*/SKILL.md .opencode/skills/<name>/
opencode
```

详见 [GUIDEDEPLOY.md](./GUIDEDEPLOY.md)

## 架构

详见 [ARCHITECTURE.md](./ARCHITECTURE.md)

```
Skills 层   → dream / memory-clean / deep-plan
Plugins 层  → openmem / deepagent / remote-agent
Agents 层   → openmem-dream / openmem-extract
Storage 层  → ~/.opencode/memory/<hash>/ (markdown, 兼容 CC 格式)
```

## 设计决策

- **"拉" 模式**: agent 主动调用工具获取上下文，非自动注入 → 零实验性 API 依赖
- **Markdown 存储**: git 可追踪，人工可编辑，与 Claude Code 格式兼容
- **纯文件锁**: `fs.open(path, "wx")` 原子锁，无需外部依赖

## 文档

| 文档 | 内容 |
|------|------|
| [GUIDEDEPLOY.md](./GUIDEDEPLOY.md) | 部署指南 |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 架构设计 |
| [REFERENCE.md](./REFERENCE.md) | 工具/技能/Agent 参考 |
| [plan.md](./plan.md) | 实施计划 |
| [devlog.md](./devlog.md) | 开发日志 |
| [analysis/](./analysis/) | 8 篇 Claude Code vs OpenCode 深度分析 |
| [pros-cons/](./pros-cons/) | 利弊分析 |

## License

MIT
