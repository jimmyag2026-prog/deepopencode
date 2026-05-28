---
name: dream
description: Manually trigger memory consolidation. Use when the user wants to save and organize project memories, or after completing a significant piece of work.
---

# Dream — Manual Memory Consolidation

You have access to memory tools:
- `check-memory` — load current project memory
- `memory-search` — search for specific memories
- `memory-status` — check memory system state

To trigger consolidation manually:
1. First use `check-memory` to see current state
2. Review the daily logs in `~/.opencode/memory/<project>/logs/`
3. Read existing topic files to understand current knowledge
4. Consolidate: update topic files with new insights, remove outdated info, update MEMORY.md index

Follow the consolidation rules:
- Each topic file max ~500 words
- MEMORY.md index max ~25KB
- Convert relative dates to absolute
- Delete outdated information aggressively
- Keep it terse and high-signal
