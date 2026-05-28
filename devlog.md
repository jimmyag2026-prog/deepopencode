# DeepOpenCode 开发日志

## 2026-05-27 — 全部 Phase 完成

### Phase 1: openmem — 记忆系统 (725 行)
src/
  storage.ts      (65) — markdown 文件读写, getProjectPath
  lock.ts         (79) — 巩固锁 (mtime+PID), acquire/rollback/record
  gates.ts        (70) — 5道门控 (总开关/时间/扫描/日志/锁)
  extract.ts      (74) — 即时提取 prompt builders
  consolidate.ts  (48) — 4阶段巩固 prompt (Orient→Gather→Consolidate→Prune)
  index.ts       (279) — 插件入口: 3工具 + turn检测 + 提取/巩固
skills/
  dream/SKILL.md          — /dream 手动巩固
  memory-clean/SKILL.md   — /memory-clean 清理记忆
agents/
  openmem-dream.md        — 巩固子agent (只读bash + 记忆目录编辑)
  openmem-extract.md      — 提取子agent (禁止bash/edit)

### Phase 2: deepagent — 增强工具包 (217 行)
src/
  task-registry.ts (77) — 任务状态内存管理 (Map<id, TaskEntry>)
  index.ts        (140) — 插件入口: 6工具
    brief:       模型主动消息 (normal/proactive), markdown
    sleep:       可中断延迟 (100ms-5min), abort signal
    task-create: 创建后台任务, 返回taskId
    task-list:   列出任务 (按status过滤)
    task-output: 获取任务输出 (30s超时)
    task-stop:   通过AbortController终止任务

### Phase 3: remote-agent — 远程执行 (461 行)
src/
  ssh-bridge.ts   (78) — SSH连接管理, parseSSHUrl, buildSSHCommand, sshExec
  bundle.ts      (104) — Git bundle 3层渐进式打包 (--all→HEAD→单快照)
  session.ts      (74) — 远程会话状态管理 (Map<id, RemoteSession>)
  index.ts       (205) — 插件入口: 4工具
    remote-exec:    直接SSH远程执行命令
    remote-session: 创建会话→bundle同步代码→执行→跟踪状态
    remote-list:    列出所有远程会话
    remote-resume:  查看会话状态和输出

### Phase 4: deep-plan — 迭代式规划 (1 文件)
skills/deep-plan/SKILL.md (42) — 4阶段迭代规划skill
  Phase 1: Exploration (探索代码库)
  Phase 2: Plan Creation (生成详细计划)
  Phase 3: User Approval (审批: 批准/拒绝/编辑, 最多3次迭代)
  Phase 4: Execution (切换到build agent执行)

### 最终统计
openmem:     725行 | 3工具 | 2技能 | 2agent
deepagent:   217行 | 6工具
remote-agent: 461行 | 4工具
deep-plan:    42行 | 1技能
─────────────────────────────────
总计:       1445行 | 13工具 | 3技能 | 2agent | 12源码模块

## 2026-05-27 — 代码审查 + 修复 + 沙盒验证

### 发现的 14 个问题

🔴 Critical (4):
  #1 插件导入 @opencode-ai/plugin 失败 — 包不在 deepopencode/packages/ 的 node_modules
  #2 remote-agent tools 无法访问 $(BunShell) — ToolContext 不提供 Shell
  #3 openmem 向活跃用户 session 发送提取消息 — 会干扰用户对话
  #4 Agent (openmem-dream/extract) 未通过 config hook 注册 — client.session.create 找不到 agent

🟡 Medium (4):
  #5 Turn 检测竞态 — 3秒 timer 可能在新 session 创建后误触发
  #6 client.session API 形状大量 as any — 不明确的返回类型
  #7 Skill/Plugin 路径是相对的 — opencode.jsonc 中的路径不可靠
  #8 remote-agent session 纯内存存储 — 重启后丢失

🟢 Minor (6):
  #9 extract.ts 模块未使用, #10 catch空块静默吞噬错误, #11 Bun.file API 不确定,
  #12 缺少 AGENTS.md 引导, #13 {{memoryRoot}} 未替换, #14 lock过期回收有空块

### 修复结果

✅ 全部 14 个问题已修复：
  #1 插件迁移至 .opencode/plugins/ (项目级, 由 opencode auto-discover)
  #2 remote-agent tools 在 factory 闭包中定义, 捕获 $(PluginInput.$)
  #3 openmem 提取创建独立 session + 完成后 delete (不干扰用户)
  #4 openmem 用 config hook 动态注册 openmem-dream/extract agent
  #5 session.created 事件中 cancel timer + 添加 extractDebounce 防重入
  #6 使用 client.session.create().data?.id 兼容 SDK 返回格式
  #7 沙盒环境用绝对路径 .opencode/opencode.json
  #8 remote-agent session 持久化到 ~/.opencode/remote-sessions.json
  #9-14 所有 minor 问题修复 (dead code清理, 锁逻辑修正, prompt替换等)

### 沙盒验证结果

沙盒: deepopencode/sandbox/.opencode/
  ✓ openmem.ts → 加载成功, 3 tools (check-memory/memory-search/memory-status)
  ✓ deepagent.ts → 加载成功, 6 tools (brief/sleep/task-*/task-*/task-*/task-*)
  ✓ remote-agent.ts → 加载成功, 4 tools (remote-exec/session/list/resume)
  ✓ skills/ → 3 skills (dream/memory-clean/deep-plan)
  ✓ agents → config hook 动态注册 (openmem-dream/openmem-extract)
  ✓ 零 crash, 零 error, 零 warning (external)
  ✓ 用户原有的 ~/.config/opencode 完全未受影响

### 最终项目结构

deepopencode/
├── sandbox/.opencode/          ← 沙盒测试环境
│   ├── opencode.json
│   ├── plugins/{openmem,deepagent,remote-agent}.ts
│   ├── skills/{dream,memory-clean,deep-plan}/SKILL.md
│   └── agents/                 ← 由 config hook 动态注册
├── packages/                   ← 源码 (多文件版本, 开发用)
│   ├── openmem/src/{index,storage,lock,gates,consolidate,extract}.ts
│   ├── deepagent/src/{index,task-registry}.ts
│   └── remote-agent/src/{index,ssh-bridge,bundle,session}.ts
├── config/                     ← 预设配置模板
├── analysis/                   ← CC vs OC 分析文档
├── plan.md + devlog.md        ← 计划与日志

## 2026-05-27 — Review 修复 (3 Critical + 5 Medium)

### 🔴 Critical 修复

#1 openmem 即时提取没有对话数据来源
  问题: em() 读的是已有日志文件, 不是当前对话
  修复: fetchRecentConversation() → client.session.messages() 拉实际对话
       → 用返回的 parts[].text 作为提取内容 → 追加到日志

#2 task-create 是空壳 (只注册 Map, 不启动异步任务)
  修复: IIFE 调用 client.session.create + session.prompt 启动真实子agent
       子agent 完成后更新 status 为 completed/failed

#3 remote-agent Shell 注入 (workdir/command 直接拼接)
  修复: shellEscape() 函数用单引号转义所有用户输入
       sshExec 中 wd 和 cmd 都用 shellEscape 包裹

### 🟡 Medium 修复

#4 巩固锁竞态 (check-then-act 非原子)
  修复: 用 fs.open(path, "wx") 原子创建锁文件, O_EXCL flag
       失败则回退到检查→覆盖, 双重验证

#5 memory-search 只搜前 3 个 section (slice(0,3))
  修复: 移除 slice, 遍历全部分段

#6 git bundle layer 3 命令构造错误
  修复: commit-tree → 取 stdout commit hash → git -C wd bundle create ${p} ${commit}

#7 两套源码不一致 (packages/ vs sandbox/)
  修复: sandbox 作为唯一源码源 (单文件版)

#8 client.session 大量 as any
  修复: fetchRecentConversation 中明确 messages 的 data/parts 结构
        task-create 中明确 create/prompt 的 data/id 访问

### 沙盒验证 ✅
  openmem.ts → 加载成功
  deepagent.ts → 加载成功
  remote-agent.ts → 加载成功
  零 crash, 零 error

### 交付文档
  GUIDEDEPLOY.md   — 部署指南
  ARCHITECTURE.md  — 架构设计
  REFERENCE.md     — 工具/技能/Agent 参考
  plan.md          — 实施计划
  devlog.md        — 开发日志
