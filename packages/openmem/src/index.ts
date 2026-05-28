import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { z } from "zod"
import {
  getProjectPath, ensureDir, readFileSafe, writeFileSafe,
  listFiles, fileExists, DEFAULT_CONFIG,
} from "./storage"
import { join } from "path"
import { checkConsolidationGate, DEFAULT_GATE_CONFIG } from "./gates"
import {
  getLockMeta, acquireConsolidationLock,
  recordConsolidation, rollbackConsolidationLock,
} from "./lock"
import { buildConsolidationPrompt } from "./consolidate"

const QUIET_MS = 3000

interface TurnState {
  hasSignificantWork: boolean
  quietTimer: ReturnType<typeof setTimeout> | null
  pendingToolCalls: number
  lastToolTime: number
  currentSessionID: string
}

const CHECK_MEMORY_TOOL = tool({
  description: "Load project memory context. Call this at the start of a session to recall previously learned facts about the project.",
  args: z.object({}),
  execute: async (_args, ctx) => {
    const projPath = await getProjectPath(DEFAULT_CONFIG, ctx.directory)
    const indexContent = await readFileSafe(join(projPath, "MEMORY.md"))
    if (!indexContent) {
      return { output: "No project memory found yet." }
    }
    let output = "## Project Memory\n\n" + indexContent.slice(0, 3000)
    const files = await listFiles(projPath)
    for (const file of files.slice(0, 5)) {
      if (file.startsWith(".") || file === "MEMORY.md") continue
      const content = await readFileSafe(join(projPath, file))
      if (content) output += `\n\n### ${file}\n${content.slice(0, 1500)}`
    }
    return { output }
  },
})

const MEMORY_SEARCH_TOOL = tool({
  description: "Search project memory files for relevant information using keywords.",
  args: z.object({
    query: z.string().describe("Search keywords or question"),
  }),
  execute: async (args, ctx) => {
    const projPath = await getProjectPath(DEFAULT_CONFIG, ctx.directory)
    const results: string[] = []
    const query = args.query.toLowerCase()
    const keywords = query.split(/\s+/).filter(k => k.length > 1)

    const files = await listFiles(projPath)
    for (const file of files) {
      if (file.startsWith(".")) continue
      const content = await readFileSafe(join(projPath, file))
      if (!content) continue
      const sections = content.split("\n## ")
      for (const section of sections.slice(0, 3)) {
        const lower = section.toLowerCase()
        const hits = keywords.filter(k => lower.includes(k)).length
        if (hits > 0) {
          results.push(`[${file}] ${section.slice(0, 300)}`)
        }
      }
    }

    if (results.length === 0) return { output: "No relevant memories found." }
    return { output: results.slice(0, 5).join("\n\n---\n\n") }
  },
})

const MEMORY_STATUS_TOOL = tool({
  description: "Check the status of the project memory system.",
  args: z.object({}),
  execute: async (_args, ctx) => {
    const projPath = await getProjectPath(DEFAULT_CONFIG, ctx.directory)
    const files = await listFiles(projPath)
    const memFiles = files.filter(f => !f.startsWith("."))
    const indexContent = await readFileSafe(join(projPath, "MEMORY.md"))
    const lockPath = join(projPath, ".consolidate-lock")
    const lockMeta = await getLockMeta(lockPath)

    return {
      output: [
        `Memory files: ${memFiles.length}`,
        `Index size: ${indexContent.length} bytes`,
        `Files: ${memFiles.join(", ") || "none"}`,
        lockMeta
          ? `Last consolidated: ${new Date(lockMeta.mtime).toISOString()}`
          : "Never consolidated",
      ].join("\n"),
    }
  },
})

export const openmemPlugin: Plugin = async ({ client, directory }) => {
  const projectRoot = directory
  const projectPath = await getProjectPath(DEFAULT_CONFIG, projectRoot)
  await ensureDir(projectPath)
  await ensureDir(join(projectPath, "logs"))
  await ensureBootMemory(projectPath)

  const state: TurnState = {
    hasSignificantWork: false,
    quietTimer: null,
    pendingToolCalls: 0,
    lastToolTime: 0,
    currentSessionID: "",
  }
  let consolidationRunning = false

  return {
    tool: {
      "check-memory": CHECK_MEMORY_TOOL,
      "memory-search": MEMORY_SEARCH_TOOL,
      "memory-status": MEMORY_STATUS_TOOL,
    },

    "tool.execute.before": async (input) => {
      state.pendingToolCalls++
      state.currentSessionID = input.sessionID
      if (state.quietTimer) {
        clearTimeout(state.quietTimer)
        state.quietTimer = null
      }
    },

    "tool.execute.after": async (input) => {
      state.pendingToolCalls--
      state.lastToolTime = Date.now()
      state.currentSessionID = input.sessionID

      const toolName = input.tool
      if (toolName === "bash" || toolName === "edit" || toolName === "write") {
        state.hasSignificantWork = true
      }

      if (state.pendingToolCalls <= 0) {
        scheduleQuietCheck()
      }
    },

    event: async (input) => {
      const evt = input.event
      if (evt.type === "session.idle" && !consolidationRunning) {
        tryConsolidation().catch(err => console.error("[openmem] cons:", err))
      }
      if (evt.type === "session.created") {
        state.hasSignificantWork = false
        state.pendingToolCalls = 0
      }
    },
  }

  function scheduleQuietCheck() {
    if (state.quietTimer) clearTimeout(state.quietTimer)
    state.quietTimer = setTimeout(() => {
      if (Date.now() - state.lastToolTime < QUIET_MS) return
      if (state.pendingToolCalls > 0) return
      if (state.hasSignificantWork) {
        state.hasSignificantWork = false
        extractMemories().catch(err => console.error("[openmem] extract:", err))
      }
    }, QUIET_MS)
  }

  async function extractMemories() {
    const logDir = join(projectPath, "logs")
    const today = new Date()
    const year = today.getFullYear().toString()
    const month = (today.getMonth() + 1).toString().padStart(2, "0")
    const day = today.getDate().toString().padStart(2, "0")
    const logPath = join(logDir, year, month, `${day}.md`)

    await ensureDir(join(logDir, year, month))
    const existing = await readFileSafe(logPath)
    const lines = existing.trim().split("\n").filter(Boolean)
    if (lines.length < 5) return

    const recent = lines.slice(-40).join("\n")
    if (!recent || recent.length < 80) return

    try {
      const sid = state.currentSessionID
      const sidParam: any = {}
      if (sid) sidParam.sessionID = sid
      else {
        const created = await client.session.create({ directory: projectRoot } as any)
        const raw = created as any
        if (raw?.data?.id) sidParam.sessionID = raw.data.id
        else if (raw?.id) sidParam.sessionID = raw.id
      }

      if (!sidParam.sessionID) return

      const prompt = buildExtractPrompt(recent)
      await client.session.prompt({
        ...sidParam,
        directory: projectRoot,
        parts: [{ type: "text", text: prompt }] as any,
        system: "You are a technical note taker. Extract facts briefly.",
        tools: { "bash": false, "edit": false, "write": false, "task": false },
      } as any)
    } catch (err) {
    }
  }

  function buildExtractPrompt(conversation: string): string {
    return `Extract key technical facts from the conversation below.
Output as bullet lines starting with "- ". Be concise.

Recent work:
${conversation}

Output format:
- [fact]`
  }

  async function tryConsolidation() {
    const lockPath = join(projectPath, ".consolidate-lock")
    const logDir = join(projectPath, "logs")

    const ok = await checkConsolidationGate(lockPath, logDir, DEFAULT_GATE_CONFIG, getLockMeta)
    if (!ok) return

    const acquired = await acquireConsolidationLock(lockPath, DEFAULT_GATE_CONFIG.minHours * 3600_000)
    if (acquired !== "acquired") return

    consolidationRunning = true
    try {
      await runConsolidation(lockPath)
    } catch (err) {
      console.error("[openmem] consolidation failed:", err)
      await rollbackConsolidationLock(lockPath, 0)
    } finally {
      consolidationRunning = false
    }
  }

  async function runConsolidation(lockPath: string) {
    const prompt = buildConsolidationPrompt(projectPath, [])
    try {
      const created = await client.session.create({
        directory: projectRoot,
        agent: "openmem-dream",
      } as any)
      const raw = created as any
      const sid = raw?.data?.id || raw?.id
      if (sid) {
        await client.session.prompt({
          sessionID: sid,
          directory: projectRoot,
          parts: [{ type: "text", text: prompt }] as any,
          system: "You are a memory consolidation agent. Update memory files to reflect new knowledge.",
        } as any)
      }
      await recordConsolidation(lockPath)
    } catch (err) {
      console.error("[openmem] dream session:", err)
    }
  }
}

async function ensureBootMemory(projPath: string) {
  const indexPath = join(projPath, "MEMORY.md")
  if (!(await fileExists(indexPath))) {
    await writeFileSafe(
      indexPath,
      `# Project Memory Index\n\nThis file indexes topic-specific memory files.\n\n`,
    )
  }
}

export default openmemPlugin
