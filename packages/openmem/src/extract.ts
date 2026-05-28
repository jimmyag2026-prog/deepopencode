import { join } from "path"
import { appendToFile, ensureDir, getProjectPath, DEFAULT_CONFIG } from "./storage"

const EXTRACT_PROMPT = `Extract key technical insights from the conversation below. Output ONLY a bullet list.
For each insight, write ONE concise bullet point starting with "- ".
Focus on: architecture decisions, new entry points, discovered pitfalls, important patterns, key dependencies.
Skip: code style details, temporary debugging, conversations without technical conclusions.

Format example:
- Project uses monorepo with packages/ containing independent sub-packages
- src/auth.ts is the auth middleware, all API routes must pass through it
- Known issue: sqlite-vec extension requires extra compile flags on Node 20

Conversation:
{{conversation}}`

export function buildExtractPrompt(conversation: string): string {
  return EXTRACT_PROMPT.replace("{{conversation}}", conversation)
}

export function buildLogPath(projectRoot: string): string {
  const now = new Date()
  const year = now.getFullYear().toString()
  const month = (now.getMonth() + 1).toString().padStart(2, "0")
  const day = now.getDate().toString().padStart(2, "0")
  return join(year, month, `${day}.md`)
}

export interface ExtractContext {
  projectRoot: string
  extractWithModel: (prompt: string) => Promise<string>
}

let turnCount = 0
let hasEditOrBash = false

export function markToolCall(toolName: string): void {
  if (toolName === "edit" || toolName === "write" || toolName === "bash") {
    hasEditOrBash = true
  }
}

let lastAssistantToolPending = false

export function markAssistantResponse(hasToolUse: boolean): void {
  turnCount++
  lastAssistantToolPending = hasToolUse
  if (hasToolUse) {
    hasEditOrBash = true
  }
}

export async function maybeExtractMemories(ctx: ExtractContext): Promise<void> {
  if (lastAssistantToolPending) return
  if (!hasEditOrBash) return

  turnCount = 0
  hasEditOrBash = false
  lastAssistantToolPending = false

  try {
    const projectPath = await getProjectPath(DEFAULT_CONFIG, ctx.projectRoot)
    const logPath = join(projectPath, "logs", buildLogPath(ctx.projectRoot))
    await ensureDir(join(projectPath, "logs"))

    const result = await ctx.extractWithModel("")
    if (result && result.trim()) {
      const entry = `\n## ${new Date().toISOString().slice(0, 10)}\n${result.trim()}\n`
      await appendToFile(logPath, entry)
    }
  } catch (err) {
    console.error("[openmem] extract failed:", err)
  }
}
