# DeepOpenCode 代码审查报告

> 审查日期: 2026-05-27
> 审查范围: GUIDEDEPLOY.md + ARCHITECTURE.md + REFERENCE.md + 全部源码 + 分析文档
> 审查框架: 设计逻辑 → 实现正确性 → 效果达成度 → 潜在风险

---

## 一、总体评价

DeepOpenCode 定位为 OpenCode 的增强框架，以 Claude Code 源码为蓝本，通过 Plugin/Skill/Agent 三层体系补齐 OC 的功能缺口。**分析文档质量极高**（8 篇深度分析，含功能矩阵、优先级排序、架构对标），**但实现与分析之间存在显著落差**。

| 维度 | 评分 | 说明 |
|------|------|------|
| 分析深度 | ⭐⭐⭐⭐⭐ | CC vs OC 功能矩阵、逐模块拆解、优先级排序，堪称标杆 |
| 架构设计 | ⭐⭐⭐⭐ | 拉模式、markdown 存储、零实验性 API — 三个核心决策正确 |
| 代码质量 | ⭐⭐ | 可读性差（极度压缩）、关键功能未实现、安全隐患 |
| 功能达成度 | ⭐⭐ | 13 个工具中约 5 个是 stub/partial，task 系统完全是空壳 |
| 文档准确性 | ⭐⭐⭐ | 架构文档与实际代码有多处不一致 |

**核心结论: 分析先行的思路完全正确，但实现层赶工严重。建议进入 "分析 ✅ → 重写实现" 的迭代周期。**

---

## 二、架构设计审查

### 2.1 三个核心设计决策 — 全部正确

**决策 1: 拉模式 vs 推模式**

| | 推模式 (CC 做法) | 拉模式 (DeepOpenCode) |
|---|---|---|
| 实现 | `experimental.chat.system.transform` 每轮注入 | `check-memory` tool — agent 主动调用 |
| 依赖 | 实验性 API | stable `tool` hook |
| 开销 | 每次都注入 | 按需加载 |

✅ 正确选择。OC 的 experimental API 生命周期不确定，依赖它会随 OC 升级而 break。拉模式虽然有"agent 可能忘记调用"的风险，但可以通过 AGENTS.md 引导弥补。

**决策 2: Markdown vs 向量数据库**

✅ 正确选择。git 可追踪、人工可编辑、与 CC 格式兼容、零外部依赖。对个人/小团队场景，关键词搜索已够用。

**决策 3: 零实验性 API**

✅ 正确选择。全部基于 `tool` / `tool.execute.*` / `config` / `event` / `client.session` 等 stable hooks，版本兼容性有保障。

### 2.2 架构层面的问题

**问题 A: 拉模式缺乏强制机制**

`check-memory` 的调用完全依赖 agent 自觉。如果用户没有在 AGENTS.md 中添加引导，或者 agent 在某个 session 中"忘了"调用，记忆系统等于不存在。

建议:
- 在 plugin 的 `config` hook 中注入 system prompt 片段（如果 OC 支持）
- 或者在 `event(session.created)` 中自动调用 `check-memory` 并将结果注入 session context
- 至少在 GUIDEDEPLOY.md 中把 "AGENTS.md 配置" 从"推荐"改为"必须"

**问题 B: 分析文档与实现的 Gap**

分析文档 (01-feature-matrix.md) 列出 OC 缺失 26 个工具，建议优先实现 P0/P1 共 ~10 个。实际实现:
- task-create/list/output/stop: **空壳**（不执行任何异步操作）
- brief: 只返回文本，无真正的 UI 通知
- sleep: 实现正确
- remote-exec/session: 实现基本正确但有安全隐患

README 声称 "13 tools, 3 skills, 2 agents"，但 task 系列 4 个工具加起来约 30 行代码，没有任何异步执行逻辑。

---

## 三、模块逐一审查

### 3.1 openmem — 记忆系统 (最重要模块)

#### 实现正确性

**🔴 Critical: 即时提取没有对话数据来源**

单文件版 `openmem.ts` 第 81-95 行的 `em()` 函数:
```typescript
async function em() {
    // ...
    const existing = (await readFileSafe(logPath)).trim().split("\n").filter(Boolean)
    if (existing.length < 5) return          // ← 读的是已有日志，不是当前对话
    const recent = existing.slice(-40).join("\n")  // ← 同上
    // 然后把 recent 发给 LLM 提取...
}
```

这个函数读取的是**已有的每日日志文件**，而不是当前 session 的对话内容。它没有从 `tool.execute.before/after` 的 hook 参数中捕获对话内容。结果是：
- 如果日志文件为空 → 直接 return，永远不会提取
- 如果日志文件有内容 → 重复提取已经提取过的内容

多文件版 `extract.ts` 更离谱:
```typescript
const result = await ctx.extractWithModel("")  // ← 传空字符串
```

**根因**: `tool.execute.after` hook 只提供 `toolName` 和 `sessionID`，不提供对话内容。要获取对话内容需要用 `client.session.get()` 或类似的 API，但代码中没有这样做。

**🟡 Medium: 巩固锁竞态条件**

`acquireLock()` 的 "check then act" 不是原子操作:
```typescript
async function acquireLock(lockPath, minMs) {
    const meta = await getLockMeta(lockPath)     // ← 读
    if (meta && Date.now() - meta.mtime < minMs && isPidAlive(meta.pid))
        return "blocked"
    await writeFileSafe(lockPath, ...)           // ← 写 (与读之间有时间窗口)
    const verify = await readFileSafe(lockPath)  // ← 验证
}
```

两个进程可以同时通过 check，同时 write，然后 verify 时只有一个能成功（PID 不匹配的那个返回 blocked）。这在大多数场景下不会触发（OC 单进程），但如果用户同时在两个终端开 opencode，就可能出问题。

CC 的做法是用 `flock()` 系统调用做原子锁，建议参考。

**🟡 Medium: 搜索质量差**

```typescript
// memory-search 实现
const kws = args.query.toLowerCase().split(/\s+/).filter(k=>k.length>1)
for (const f of await listFiles(pp)) {
    for (const sec of content.split("\n## ").slice(0,3)) {
        if (kws.filter(k=>sec.toLowerCase().includes(k)).length > 0)
            results.push(...)
    }
}
```

问题:
1. 只搜索每个文件的前 3 个 section（`split("\n## ").slice(0,3)`），大文件后半部分完全不可搜索
2. 纯 exact match，"auth" 搜不到 "authentication"
3. 没有 ranking，匹配度高的结果不会优先显示
4. 没有 fuzzy matching

建议: 至少用 `rg` (ripgrep) 替代手动 split+includes，或者搜索全部 section。

**🟢 Minor: check-memory 截断过于激进**

```typescript
let out = "## Project Memory\n\n" + idx.slice(0, 3000)  // MEMORY.md 只取 3000 字符
// ...
out += `\n\n### ${f}\n${c.slice(0,1500)}`  // 每个 topic 文件只取 1500 字符
```

MEMORY.md 最大 25KB，但 check-memory 只读 3KB。如果索引较长，后面的内容全部丢失。建议至少读 8-10KB。

**🟢 Minor: 项目 Hash 只取 12 字符**

```typescript
const id = createHash("sha256").update(projRoot).digest("hex").slice(0, 12)
```

SHA256 的 12 个 hex 字符 = 48 bits。根据生日攻击，约 2^24 ≈ 1600 万个项目后有 50% 碰撞概率。对个人使用场景足够，但如果是共享环境（比如团队共用 `~/.opencode/memory/`），碰撞风险不可忽视。建议至少用 16 字符。

#### 效果达成度

| CC 功能 | 实现状态 | 说明 |
|---------|---------|------|
| extractMemories (即时提取) | ❌ 未工作 | 没有对话数据来源 |
| autoDream (定时巩固) | ⚠️ 框架在，未验证 | 依赖 extract 产出的日志，而 extract 不工作 |
| MEMORY.md 索引 | ✅ | 初始创建 + 手动 /dream 可更新 |
| 每日日志 | ❌ | 永远不会写入（extract 不工作） |
| check-memory | ✅ | 基本可用 |
| memory-search | ⚠️ | 能用但质量差 |

**结论: openmem 的核心价值（自动积累记忆）目前完全不工作。只有手动 `check-memory` 和 `/dream` 能用。**

---

### 3.2 deepagent — 工具包

#### 实现正确性

**🔴 Critical: task-create 不创建任何异步任务**

```typescript
"task-create": tool({
    execute: async (args, ctx) => {
        counter++; const id = `bg_${Date.now()}_${counter}`
        tasks.set(id, { id, description: args.description, status: "running",
                        sessionID: ctx.sessionID, controller: new AbortController(),
                        createdAt: Date.now() })
        return { output: `Task ${id} created: ${args.description}` }
        // ← 没有启动任何异步操作！没有 client.session.create()！
    },
}),
```

这个工具只是在内存 Map 中注册了一个条目，**完全没有启动任何异步工作**。`task-output` 查询时永远返回 "still running"（因为没有东西会把 status 改为 completed/failed）。`task-stop` 调用 `controller.abort()` 但没有东西在监听这个 abort 信号。

CC 的 TaskCreate 会真正 fork 一个子 agent 执行 prompt。这里什么都没做。

**修复建议**: 用 `client.session.create()` + `client.session.prompt()` 启动真正的异步子 agent，在完成后更新 task status。

**🟡 Medium: brief 工具功能存疑**

```typescript
brief: tool({
    execute: async (args) => ({
        title: args.status === "proactive" ? "Notification" : "Message",
        output: args.message,
        metadata: { status: args.status }
    }),
}),
```

brief 只是返回 `{ output: message }`，这跟 agent 直接回复用户没有区别。CC 的 Brief 会通过特殊的 UI 通道（toast notification）显示，不占用对话上下文。在 OC 中，brief 的输出会被当作工具结果注入对话，这意味着它**占据了上下文空间**，反而比直接回复更差。

建议: 需要确认 OC 是否有 toast/notification API。如果没有，brief 工具的价值有限。

**✅ sleep 实现正确**

使用 `ctx.abort` 监听用户取消，有 min/max 边界检查，Promise 正确处理。这是唯一完整实现的 deepagent 工具。

#### 效果达成度

| 工具 | 实现状态 | 说明 |
|------|---------|------|
| brief | ⚠️ 部分 | 返回文本但无独立 UI 通道 |
| sleep | ✅ 完整 | 正确实现 |
| task-create | ❌ 空壳 | 不创建异步任务 |
| task-list | ⚠️ 部分 | 只列出空壳条目 |
| task-output | ❌ 不可用 | 永远返回 "still running" |
| task-stop | ⚠️ 部分 | 能标记 stopped 但无实际效果 |

**结论: 6 个工具中只有 sleep 完整实现。task 系列 4 个工具全是空壳。**

---

### 3.3 remote-agent — 远程执行

#### 实现正确性

**🔴 Critical: Shell 注入漏洞**

```typescript
// remote-exec
const full = wd ? `${sc} "cd ${wd} && ${cmd}"` : `${sc} "${cmd}"`
```

`wd` (workdir) 和 `cmd` (command) 直接拼接进 shell 命令，没有任何转义。如果 agent 被诱导传入恶意 workdir（如 `/tmp"; rm -rf / #`），会导致任意命令执行。

```typescript
// remote-session
await sshExec($, cfg, `rm -rf "${args.workdir}" && mkdir -p "${args.workdir}"`)
```

虽然用了双引号包裹，但 `${args.workdir}` 中如果包含 `"` 或 `$()` 仍然可以逃逸。

**修复建议**: 使用 `shell-quote` 或手动转义所有用户输入。对于 SSH 命令，考虑用 `--` 终止选项解析。

**🟡 Medium: Git bundle layer 3 命令构造错误**

```typescript
// 第 44 行
await $`bash -c git -C ${wd} bundle create ${p} ${commit.stdout.toString().trim()}`.quiet().nothrow()
```

`bash -c` 后面的参数应该是一个完整的字符串，但这里 `git -C ${wd} bundle create ...` 是作为多个独立参数传给 `bash` 的，而不是作为一个 `-c` 的参数。正确写法应该是:

```typescript
await $`bash -c ${`git -C ${wd} bundle create ${p} ${commitHash}`}`.quiet().nothrow()
```

**🟡 Medium: 同步文件操作阻塞插件加载**

```typescript
// 模块顶层
loadSessions()  // ← 在插件 import 时执行，使用 readFileSync
```

`readFileSync` 在模块加载时执行，如果 `~/.opencode/remote-sessions.json` 很大或在 NFS 上，会阻塞整个插件初始化。

**🟢 Minor: SSH 选项不完整**

```typescript
const p = ["ssh", "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=10"]
```

缺少:
- `-o BatchMode=yes` — 禁止交互式密码输入（否则 agent 会卡住等待）
- `-o LogLevel=ERROR` — 减少噪音
- `-i <key>` — 没有指定密钥文件的选项

#### 效果达成度

| 功能 | 实现状态 | 说明 |
|------|---------|------|
| SSH 远程执行 | ✅ 基本可用 | 有注入漏洞但功能完整 |
| Git bundle 传输 | ⚠️ 部分 | Layer 3 有 bug |
| 会话持久化 | ✅ | JSON 文件存储 |
| 会话恢复 | ⚠️ | 只能查看状态，不能真正恢复执行 |

---

### 3.4 deep-plan — 迭代式规划

**实现: 仅一个 SKILL.md 文件，无代码。**

这是合理的 — deep-plan 本质上是一个 prompt 工程，通过 SKILL.md 定义 4 阶段流程，由 agent 自身执行。OC 的 skill 系统天然支持这种模式。

**🟡 Medium: Phase 4 无法自动切换 agent**

```markdown
### Phase 4: Execution
1. Once approved, switch to `build` agent
```

OC 没有 "build" agent 的概念。在 CC 中，plan mode 和 build mode 是通过 `EnterPlanMode`/`ExitPlanMode` 工具切换的。在 OC 中，这需要用户手动退出 plan agent 进入默认 agent。SKILL.md 应该明确说明这一点。

**🟢 Minor: rejectCount 追踪不可靠**

SKILL.md 要求 "Track `rejectCount` — after each rejection, pivot more significantly"，但 agent 没有持久化的 counter，长对话中可能丢失计数。

---

## 四、潜在副作用与未考虑的风险

### 4.1 Token 消耗

| 操作 | 预估 Token |
|------|-----------|
| check-memory (每次 session 开始) | ~2000-4000 |
| 即时提取 (每个 turn) | ~1000-3000 |
| 巩固 (每 6h) | ~5000-15000 |

如果用户每天开 10 个 session，每个 session 20 turns:
- check-memory: 10 × 3000 = 30K tokens
- 即时提取: 200 × 2000 = 400K tokens（如果能工作的话）
- **每天额外消耗 ~430K tokens**

这在分析文档中没有提及。建议在 GUIDEDEPLOY.md 中增加 "Token 消耗预估" 段落。

### 4.2 并发安全

| 场景 | 风险 | 严重度 |
|------|------|--------|
| 两个 opencode 实例同时巩固 | 巩固锁竞态 | 🟡 |
| 同时写 remote-sessions.json | 数据丢失 | 🟡 |
| extract 和 consolidate 同时写日志 | 日志文件损坏 | 🟢 |

### 4.3 向后兼容

**🟡 OpenCode API 变更风险**

虽然选择了 stable hooks，但 `client.session` 的返回类型在代码中大量使用 `as any`:
```typescript
const created = await client.session.create({ directory }) as any
const sid = created?.data?.id || created?.id
```

这说明 OC 的 SDK 类型定义不完整或不稳定。`as any` 掩盖了类型错误，如果 OC 改变返回结构，代码不会报编译错误，只会运行时静默失败。

建议: 定义本地类型接口，至少做基本的类型检查。

### 4.4 安全风险汇总

| 风险 | 严重度 | 模块 | 说明 |
|------|--------|------|------|
| Shell 注入 (SSH) | 🔴 | remote-agent | workdir/command 未转义 |
| Shell 注入 (git bundle) | 🔴 | remote-agent | directory 未转义 |
| 任意文件读取 | 🟡 | openmem | memory-search 可遍历 memory 目录所有文件 |
| PID 伪造 | 🟢 | openmem | 锁文件中的 PID 可被手动篡改 |

---

## 五、两套源码一致性问题

项目同时维护 `packages/` (多文件版) 和 `sandbox/.opencode/plugins/` (单文件版)，存在多处不一致:

| 问题 | packages/ | sandbox/ |
|------|-----------|----------|
| extract 调用 | `ctx.extractWithModel("")` 传空串 | 读已有日志文件 |
| task-create | 有 `controller` 参数 | 有 `controller` 但不使用 |
| task-registry | 独立模块，完整 | 内联到 deepagent.ts |
| consolidate prompt | `{{memoryRoot}}` 模板变量 | 直接字符串拼接 |
| lock 模块 | 有 `rollbackConsolidationLock` | 无 rollback |

**建议: 选择一套作为 source of truth，另一套用脚本自动生成。手动维护两套是 bug 温床。**

---

## 六、文档审查

### 6.1 GUIDEDEPLOY.md

✅ 清晰、简洁、可操作。安装步骤、验证命令、配置参考、故障排查一应俱全。

🟡 问题:
- "无额外依赖" 不准确 — remote-agent 需要 SSH 客户端
- AGENTS.md 配置应从"推荐"改为"必须"（否则 check-memory 不会被调用）
- 缺少 Token 消耗预估

### 6.2 ARCHITECTURE.md

✅ 架构图清晰，设计决策有对比表，数据流图完整。

🟡 问题:
- "5 道门控" 描述与代码实现有差异（代码中 `scanIntervalMs` 门控在单文件版中被合并到 `countLogsAfter` 中）
- Agent 权限描述 (`permission: { edit: {...}, bash: {...} }`) 未确认 OC 是否支持这种 glob 模式的 ACL

### 6.3 REFERENCE.md

✅ 工具/技能/Agent 参考表格式清晰。

🟡 问题:
- `task-output` 描述为 "获取任务输出 (阻塞/非阻塞)" — 实际不阻塞也不返回输出
- `remote-resume` 描述为 "查看会话状态" — 名字暗示能 "resume" 执行，实际只能看状态
- `dream` skill 描述说 "读取 MEMORY.md → 浏览每日日志 → 更新 topic 文件" — 但 agent 不知道 memory 路径在哪，需要 tool 辅助

### 6.4 分析文档 (analysis/)

⭐⭐⭐⭐⭐ 这是整个项目最出色的部分。

- 01-feature-matrix.md: 42 个 CC 工具逐一对标，差距评估清晰
- 06-tools-analysis.md: 优先级排序合理（P0-P3），"不建议引入" 的判断有理有据
- 08-autodream-analysis.md: 4 阶段流程、5 道门控、锁机制，文档比实现更准确

**分析文档应该成为实现的 contract，当前实现应该向文档对齐，而不是反过来。**

---

## 七、devlog "14 问题修复" 复查

| # | 问题描述 | 声称状态 | 实际状态 |
|---|---------|---------|---------|
| 1 | 插件导入失败 | ✅ 已修复 | ✅ 迁移到 .opencode/plugins/ |
| 2 | remote-agent 无法访问 $ | ✅ 已修复 | ✅ factory 闭包捕获 |
| 3 | 提取干扰用户 session | ✅ 已修复 | ⚠️ 创建独立 session 但提取本身不工作 |
| 4 | Agent 未注册 | ✅ 已修复 | ✅ config hook 注册 |
| 5 | Turn 检测竞态 | ✅ 已修复 | ⚠️ session.created 重置 timer，但 em() 无数据源 |
| 6 | client.session as any | ✅ 已修复 | ⚠️ 仍用 as any，只是加了 ?. 链 |
| 7 | 路径问题 | ✅ 已修复 | ✅ 沙盒用绝对路径 |
| 8 | session 纯内存 | ✅ 已修复 | ✅ JSON 文件持久化 |
| 9-14 | Minor issues | ✅ 已修复 | ✅ 基本修复 |

**结论: 14 个问题中，#1/#2/#4/#7/#8 真正修复；#3/#5/#6 是 partial fix；#9-14 修复。devlog 的 "全部 14 个问题已修复" 声明不够准确。**

---

## 八、改进建议（按优先级排序）

### P0: 修复核心功能

1. **修复即时提取** — 从 `tool.execute.after` 或 `client.session` 获取对话内容，传给提取 prompt
2. **实现真正的 task 系统** — 用 `client.session.create()` + `client.session.prompt()` 启动异步子 agent
3. **修复 Shell 注入** — 所有用户输入进入 shell 命令前必须转义

### P1: 提升质量

4. **统一源码** — 选择 packages/ 或 sandbox/ 作为 source of truth，另一套自动生成
5. **改进 memory-search** — 用 ripgrep 替代 split+includes，搜索全部 section
6. **增加 Token 消耗预估** — 在 GUIDEDEPLOY.md 中添加
7. **AGENTS.md 配置改为必须** — 否则 check-memory 不会被调用

### P2: 增强健壮性

8. **巩固锁用 flock** — 参考 CC 的 `consolidationLock.ts` 使用系统级文件锁
9. **client.session 类型安全** — 定义本地接口替代 `as any`
10. **remote-agent SSH 选项补全** — BatchMode=yes, LogLevel=ERROR

### P3: 文档修正

11. **修正 REFERENCE.md** — task-output/remote-resume 描述与实际不符
12. **修正 devlog** — "全部修复" → "11/14 完全修复，3 个 partial"
13. **deep-plan SKILL.md** — 明确 Phase 4 需要用户手动切换 agent

---

## 九、总结

### 做得好的

1. **分析先行** — 8 篇 CC vs OC 深度分析，功能矩阵、优先级排序、"不做" 清单，这是正确的工程方法
2. **架构三决策** — 拉模式、markdown 存储、零实验性 API，全部正确
3. **插件系统利用** — tool/config/event/tool.execute hooks 使用正确
4. **文档质量** — GUIDEDEPLOY/ARCHITECTURE/REFERENCE 三件套清晰完整
5. **渐进式回退** — git bundle 3 层设计思路优秀（虽实现有 bug）

### 需要改进的

1. **实现与分析的 Gap** — 分析文档承诺的功能，实现只完成了约 40%
2. **task 系统是空壳** — 4 个工具加起来约 30 行，无异步执行
3. **即时提取不工作** — openmem 的核心价值（自动积累记忆）完全缺失
4. **安全问题** — Shell 注入、未转义的用户输入
5. **两套源码同步** — 手动维护 packages/ 和 sandbox/ 是 bug 温床

### 下一步建议

```
Sprint 1 (1-2天): 修复 P0
  ├── 修复 openmem 即时提取 (获取对话内容)
  ├── 实现 task-create 的真正异步执行
  └── 修复 remote-agent Shell 注入

Sprint 2 (1天): 提升 P1
  ├── 统一源码到 sandbox/ 单文件版
  ├── 改进 memory-search
  └── AGENTS.md 配置改为必须

Sprint 3 (半天): 文档修正
  ├── 修正 REFERENCE.md 中不准确的描述
  └── 增加 Token 消耗预估
```

**整体评价: 架构设计扎实，分析文档出色，但实现层需要一个 focused sprint 来补齐核心功能。当前状态适合 "概念验证"，还不适合 "生产使用"。**

---

*Review completed: 2026-05-27*
*Reviewer: Hermes Agent*
