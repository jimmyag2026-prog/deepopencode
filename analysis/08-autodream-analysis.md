# Claude Code AutoDream 模块深度分析

## 1. 核心概念

AutoDream = **后台记忆巩固子代理系统**:

> 每轮对话结束后, 满足条件时 fork 独立子代理, 反思/合并/修剪记忆文件, 更新 MEMORY.md 索引。

### 1.1 架构组成

| 文件 | 职责 |
|------|------|
| `services/autoDream/autoDream.ts` | 核心调度: 闭包状态, 门控 + fork 逻辑 |
| `services/autoDream/config.ts` | 开关控制: 用户设置 > GrowthBook feature flag |
| `services/autoDream/consolidationLock.ts` | 文件锁: 基于 mtime 的分布式锁 + session 计数 |
| `services/autoDream/consolidationPrompt.ts` | Prompt 构建: 4阶段巩固指令 |
| `tasks/DreamTask/DreamTask.ts` | 任务注册: 将 fork 子代理注册到 UI 任务系统 |

### 1.2 4阶段巩固流程

```
Phase 1 - Orient (定向)
  ├─ ls 记忆目录
  ├─ 读取 MEMORY.md 索引
  └─ 浏览已有 topic 文件

Phase 2 - Gather (收集)
  ├─ 每日日志: logs/YYYY/MM/YYYY-MM-DD.md
  ├─ 过时/矛盾事实检测
  └─ Transcripts grep 关键词搜索

Phase 3 - Consolidate (巩固)
  ├─ 创建/更新记忆文件
  ├─ 合并到已有 topic 文件
  ├─ 相对日期→绝对日期转换
  └─ 删除矛盾/过时事实

Phase 4 - Prune & Index (修剪索引)
  ├─ 更新 MEMORY.md 索引
  ├─ 保持 ≤25KB (~150字符/条目)
  └─ 移除过时/错误指针
```

### 1.3 门控机制 (5道门)

| 门 | 条件 | 默认值 | 目的 |
|----|------|--------|------|
| 总开关 | isAutoDreamEnabled() + !KAIROS + !remote | - | 全局启用/禁用 |
| 时间门 | 距上次巩固 >= minHours | 24h | 避免过于频繁 |
| 扫描节流 | 距上次扫描 >= 10min | 10min | 避免每轮都扫描 |
| Session门 | 新增 transcript >= minSessions | 5 | 确保有新数据 |
| 锁 | tryAcquireConsolidationLock() | - | 防止并发 |

### 1.4 锁机制

```typescript
// 锁文件: .consolidate-lock (mtime = lastConsolidatedAt)
tryAcquireConsolidationLock():
  1. stat 锁文件 mtime + PID
  2. mtime < 1h && PID 存活 → null (被占用)
  3. PID 已死 || mtime > 1h → 回收(reclaim)
  4. 写入当前 PID
  5. 重读验证一致性 → 成功 || 回滚
```

### 1.5 子代理权限

```typescript
// 工具权限: Bash 只读 + 只写记忆目录
canUseTool:
  Bash: ls, find, grep, cat, stat (只读)
  FileEdit/FileWrite: 仅限 getAutoMemPath() 目录内
```

## 2. OpenCode 现状

OpenCode **没有**记忆巩固系统。

相关能力:
- Compaction: 上下文压缩(消息摘要), 但不会写入持久记忆
- AGENTS.md: 静态指令, 不自动积累知识
- Session 持久化: 会话记录, 但不提取记忆

### 2.1 缺失的核心能力

| 能力 | CC | OC | 说明 |
|------|-----|-----|------|
| 记忆提取 | ✅ extractMemories | ❌ | 从对话中提取 ## Memory 块写入文件 |
| 记忆巩固 | ✅ autoDream | ❌ | 定期合并/修剪/去重记忆 |
| 记忆索引 | ✅ MEMORY.md | ❌ | 集中式入口文件导航 |
| 每日日志 | ✅ logs/YYYY/MM/DD.md | ❌ | 按日期组织的会话日志 |
| 团队记忆同步 | ✅ teamMemorySync | ❌ | 团队级记忆共享 |
| 上下文压缩 | ✅ compaction | ✅ compaction | 两者均有 |

## 3. 融合方案

### 3.1 这是最重要的差距, 也是最值得做的

**autoDream 对 OpenCode 的价值:**
- 让代理逐步"理解"项目: 架构、约定、常见模式、已知坑
- 跨 session 记忆: 下次对话中代理直接读取之前的洞察
- 减少重复: 不必每次都重新解释项目结构

### 3.2 设计: 双层记忆系统

```
openmem (记忆系统插件)
├── Layer 1: 即时提取 (对应 CC extractMemories)
│   └── 每轮结束后: LLM 提取 key insights → 写入 MEMORY.md 增量
│
├── Layer 2: 定时巩固 (对应 CC autoDream)
│   └── 满足条件时: fork 子代理 → 4阶段巩固 → 更新索引
│
└── 存储结构:
    ~/.opencode/memory/<project-hash>/
    ├── MEMORY.md          # 入口索引
    ├── architecture.md    # 架构相关记忆
    ├── patterns.md        # 代码模式/约定
    ├── decisions.md       # 设计决策
    ├── pitfalls.md        # 已知坑
    └── logs/
        └── YYYY/
            └── MM/
                └── DD.md  # 每日日志
```

### 3.3 实现作为 OC 插件

```typescript
// ~/.config/opencode/plugins/openmem.ts
export default (async ({ client, project }) => {
  const memDir = path.join(os.homedir(), '.opencode', 'memory', hashProject(project))

  return {
    // 钩子1: 即时记忆提取 — 每轮结束后
    "experimental.chat.messages.transform": async (input, output) => {
      // 1. 用 small_model 提取关键 insights
      // 2. 写入 memDir 下的分类文件
      // 3. 更新 MEMORY.md 索引
    },

    // 钩子2: 定时巩固 — 满足门控条件时
    "experimental.session.compacting": async (input) => {
      if (shouldConsolidate(memDir)) {
        // fork 子代理执行 4阶段巩固
      }
    },

    // 暴露命令
    command: {
      "dream": { /* 手动触发巩固 */ },
      "memory-status": { /* 查看记忆状态 */ }
    }
  }
}) satisfies Plugin
```

### 3.4 门控实现

```typescript
function shouldConsolidate(memDir: string): boolean {
  const lockPath = path.join(memDir, '.consolidate-lock')

  // 1. 时间门: 距上次 >= 6h
  const lastTime = getLockMtime(lockPath)
  if (Date.now() - lastTime < 6 * 3600_000) return false

  // 2. Session门: 新增 >= 3 个 session 的日志
  const newSessions = countNewSessions(memDir, lastTime)
  if (newSessions < 3) return false

  // 3. 锁: tryAcquire
  return tryAcquireLock(lockPath, process.pid)
}
```

### 3.5 Prompt 继承

复用 CC 的 4 阶段 prompt 结构:
1. Orient — 浏览记忆目录, 读取 MEMORY.md
2. Gather — 收集新信号 (日志/现有记忆矛盾/transcripts)
3. Consolidate — 创建/更新记忆, 消除矛盾
4. Prune & Index — 清理过时内容, 更新索引

## 4. 价值评估

| 维度 | 评分 | 说明 |
|------|------|------|
| 实现复杂度 | ⭐⭐⭐ | 中等: 插件可实现, 不需要改 core |
| 用户价值 | ⭐⭐⭐⭐⭐ | 极高: 代理跨 session "记住" 项目 |
| 风险 | ⭐⭐ | 子代理权限受限, 写入文件可控 |
| 维护成本 | ⭐⭐ | prompt 需要持续调优 |
| 差异化 | ⭐⭐⭐⭐ | 这是 OC 与 CC 最大的功能差距之一 |

**结论: 强烈推荐实现。** 这是 OpenCode 最需要的增强, 并且可以完全通过插件实现, 无需修改 core。
