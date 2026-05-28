# DeepOpenCode Roadmap

## Phase 1: MVP (2-4 周)

### Sprint 1: 记忆系统 (openmem)
- [ ] 存储目录结构设计
- [ ] 即时记忆提取 (extractMemories)
- [ ] MEMORY.md 索引生成
- [ ] 手动巩固命令 (`/dream`)
- [ ] 门控逻辑 (时间门/日志门/锁)
- [ ] 子代理权限白名单

### Sprint 2: LSP 诊断投递
- [ ] DiagnosticRegistry (去重+限流)
- [ ] publishDiagnostics 处理器注册
- [ ] LSP severity → OC 格式化
- [ ] Attachment 注入到系统提示词
- [ ] FileEdit/Write 后清除过时诊断

### Sprint 3: 活文档
- [ ] MAGIC DOC header 检测器
- [ ] 文档追踪 (trackedDocs)
- [ ] 子代理自动更新调度
- [ ] 自定义 prompt 支持
- [ ] `/update-docs` 命令

## Phase 2: 增强 (4-8 周)

### Sprint 4: 增强子代理
- [ ] Brief 工具 (模型主动消息)
- [ ] Sleep 工具 (可中断延迟)
- [ ] 后台任务模式 (task background)
- [ ] Task 基本 CRUD (Create/Get/List)

### Sprint 5: 自动巩固
- [ ] autoDream 门控完整实现
- [ ] 4阶段巩固 prompt
- [ ] 巩固锁 (mtime PID)
- [ ] DreamTask 注册 + UI 显示
- [ ] Session 日志记录

### Sprint 6: 迭代式规划
- [ ] deep-plan skill 定义
- [ ] 拒绝→修改循环
- [ ] rejectCount 跟踪
- [ ] AskUserQuestion 集成

## Phase 3: 高级 (8-16 周)

### Sprint 7: 远程执行
- [ ] SSH bridge 基础实现
- [ ] Git bundle 传输
- [ ] 远程会话创建/终止
- [ ] 事件轮询

### Sprint 8: 任务系统完善
- [ ] TaskUpdate/Stop/Output
- [ ] 任务状态持久化
- [ ] 后台任务队列管理
- [ ] Sleep 工具完善

## Phase 4: 实验 (后续)

### 可选项目
- [ ] computer-use-mcp (独立 MCP 项目)
- [ ] task-scheduler-mcp (Cron 定时任务)
- [ ] ToolSearch 工具
- [ ] SyntheticOutput 工具
- [ ] NotebookEdit 工具
- [ ] 团队记忆同步

---

## 技术决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| 实现方式 | Plugin + Skill + MCP | 不 fork, 保持上游兼容 |
| 语言 | TypeScript | 与 OC 一致 |
| 存储后端 | 文件系统 (markdown) | 纯文本, 可迁移, 可手动编辑 |
| 子代理模型 | small_model (cheap) | 降低成本 |
| 远程传输 | SSH (Phase 1) | 最简单, 最可靠 |
| 桌面自动化 | 独立 MCP | 不耦合 core |
