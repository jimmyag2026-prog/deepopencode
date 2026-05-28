# Claude Code Computer Use 模块深度分析

## 1. 核心概念

Computer Use = **macOS 桌面自动化系统** (仅 darwin)。

### 1.1 能力矩阵

| 能力 | 实现方式 | 底层技术 |
|------|---------|---------|
| 屏幕捕获 | SCContentFilter, exclude bundleId | @ant/computer-use-swift (Swift Native) |
| 鼠标控制 | 移动/点击/滚动/拖拽, ease-out cubic动画 | @ant/computer-use-input (Rust/enigo) |
| 键盘控制 | 击键/输入/粘贴, pbcopy/pbpaste | enigo + macOS pasteboard |
| 应用枚举 | Spotlight 级别, 路径白名单过滤 | Swift Native |
| 权限检查 | TCC Accessibility / ScreenRecording | Swift Native |

### 1.2 架构组成

| 文件 | 职责 |
|------|------|
| `executor.ts` | 核心执行器: prepareForAction → screenshot → action → cleanup |
| `gates.ts` | GrowthBook 动态开关: 像素校验/动画/隐藏/剪贴板 |
| `hostAdapter.ts` | MCP Host Adapter: 连接 executor + TCC权限 + 屏幕坐标转换 |
| `swiftLoader.ts` | Swift 原生模块延迟加载 + CFRunLoop泵送(防死锁) |
| `drainRunLoop.ts` | CFRunLoop 泵送调度: setInterval(1ms) + 引用计数 |
| `computerUseLock.ts` | 文件锁: tryCreateExclusive + PID存活检查 + 竞态回收 |
| `cleanup.ts` | Turn 结束清理: 恢复隐藏应用 + 释放锁 + 取消热键 |
| `escHotkey.ts` | 全局 CGEventTap 监听 Escape 中断 |
| `setup.ts` | MCP 服务器配置: 动态创建进程内 MCP server |
| `mcpServer.ts` | MCP 服务端子进程: 替换 ListTools 处理器 |
| `toolRendering.tsx` | UI 渲染: 每个操作的摘要/结果展示 |
| `wrapper.tsx` | 工具覆盖: call() + dispatch + sessionContext |
| `appNames.ts` | 应用名过滤: 路径白名单 + Helper/Agent 后缀过滤 + 50条限制 |

### 1.3 关键设计

**CFRunLoop 泵送 — 解决 Node.js/libuv 下 Swift MainActor 死锁问题:**
```
Swift @MainActor 方法 → DispatchQueue.main
                           │
                           ▼ 不会自动 drain
Node.js libuv event loop  ──▶ Promise 永久挂起

解决方案: drainRunLoop()
  └─ setInterval(1ms) → RunLoop.main.run
  └─ 引用计数 (多个调用共享一个泵)
  └─ 30秒超时 + .catch(noop) 防泄漏
```

**文件锁机制:**
```
tryAcquireComputerUseLock():
  1. writeFile(path, buf, {flag:'wx'}) — 原子创建
  2. EEXIST → 读锁 → 检查 PID 存活
  3. 死进程 → unlink + 重试(竞态回收)
  4. 活进程 → 返回 blocked
```

## 2. OpenCode 现状

OpenCode **完全没有**桌面自动化能力。设计目标也不包含此项。

## 3. 融合可行性

### 3.1 核心挑战

| 挑战 | 说明 |
|------|------|
| **平台锁定** | 仅 Darwin(macOS), 需要 Swift + Rust 原生模块 |
| **权限敏感** | 需要 Accessibility + Screen Recording 权限, TCC 弹窗 |
| **安全风险** | 全局输入/屏幕捕获访问面极大, 安全隐患 |
| **原生依赖** | 需要 `@ant/computer-use-swift` 或等价原生库 |
| **Node.js 兼容** | MainActor/runloop 问题需要 drainRunLoop 解决方案 |

### 3.2 是否应该引入?

**不建议作为 OpenCode core 功能引入**:

1. **范围偏差**: 桌面自动化超出了"编码代理"的核心定位
2. **平台锁定**: OC 是跨平台的, 仅 Darwin 支持不合适
3. **安全面**: 输入/截屏权限需要非常谨慎的设计
4. **替代方案**: MCP 已有 `@playwright/mcp` 提供浏览器自动化, 覆盖大量桌面需求

### 3.3 如要做 — 作为独立 MCP 服务器

```
computer-use-mcp (独立项目)
  ├── 依赖: @anthropic-ai/computer-use-swift (或开源替代)
  ├── 暴露: MCP 工具 (screenshot, click, type, scroll, ...)
  └── 配置: opencode.json mcp: { "computer-use": { ... } }
```

这样架构干净, 不耦合 core, 用户按需启用。

## 4. 价值评估

| 维度 | 评分 | 说明 |
|------|------|------|
| 实现复杂度 | ⭐⭐⭐⭐⭐ | 需要 Swift + Rust 原生模块 + 大量边缘情况处理 |
| 用户价值 | ⭐⭐⭐ | 特定场景有用(测试自动化/桌面操作) |
| 安全风险 | ⭐⭐⭐⭐⭐ | 全局输入/屏幕捕获, 极高 |
| 维护成本 | ⭐⭐⭐⭐⭐ | 随 macOS 版本更新需要持续适配 |
| 适用面 | ⭐⭐ | 仅 Darwin 平台 |

**结论: 不建议引入。** 保持 OpenCode 聚焦代码编辑, 桌面自动化留给专门工具。
