# DeepOpenCode 实施计划 v2.0

> 全栈 Agent 增强框架 | 基于 OpenCode Plugin/Skill 体系 | 以 CC 源码为蓝本
> 2026-05-27

---

## 核心定位

```
deepopencode = openmem + deepagent + remote-agent + deep-plan
    记忆系统      工具包      远程执行       迭代规划
```

## 不做的事

- MagicDocs — Anthropic 自己已删除, 降为 P3
- LSP 诊断 — OC 原生支持
- ComputerUse — 仅 Darwin, 范围外
- Swarm — 社区已有 opencode-swarm

## 模块详情

### Phase 1: openmem (记忆系统)

复刻 CC 的 extractMemories + autoDream 双重设计:
- 即时提取: tool.execute.after → small_model → 追加日志
- 定时巩固: 5道门控 → fork subagent → 4阶段(Orient→Gather→Consolidate→Prune)
- 存储: ~/.deepopencode/memory/<project>/ markdown, 兼容 CC 格式
- 工具: check-memory, memory-search, memory-status, /dream
- 零实验性 API 依赖, 全用 stable hooks

### Phase 2: deepagent (增强工具包)

- Brief: 模型向用户主动发消息
- Sleep: 可中断延迟等待
- Task CRUD: TaskCreate/List/Output/Stop

### Phase 3: remote-agent (远程 Agent)

- SSH 基础: key-based auth → bundle 传输代码 → 远程执行 → stdout 回传
- Bundle 3层: git bundle --all → HEAD → commit-tree 快照

### Phase 4: deep-plan (迭代式规划)

- SKILL.md: 支持 3 次拒绝→修改循环

## 项目结构

deepopencode/
  packages/
    openmem/src/{extract,consolidate,lock,storage,gates,prompts,tools}/
    deepagent/src/tools/{brief,sleep,task-create,task-list,task-output,task-stop}/
    remote-agent/src/{ssh-bridge,bundle,session,commands}/
  skills/deep-plan/SKILL.md
  config/{opencode.jsonc,openmem.jsonc,agents/}
