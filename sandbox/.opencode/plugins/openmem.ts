import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { z } from "zod"
import { join } from "path"
import { mkdir, readFile, writeFile, readdir, stat, open } from "fs/promises"
import { homedir } from "os"
import { createHash } from "crypto"

const MEMORY_ROOT = join(homedir(), ".opencode", "memory")

async function projectPath(root: string) { const id = createHash("sha256").update(root).digest("hex").slice(0, 12); return join(MEMORY_ROOT, id) }
async function ensureDir(p: string) { await mkdir(p, { recursive: true }) }
async function readFileSafe(p: string) { try { return await readFile(p, "utf-8") } catch { return "" } }
async function writeFileSafe(p: string, c: string) { await ensureDir(join(p, "..")); await writeFile(p, c) }
async function fileExists(p: string) { try { await stat(p); return true } catch { return false } }
async function listFiles(d: string): Promise<string[]> { try { return await readdir(d) } catch { return [] } }
async function getLockMeta(p: string) { try { const s = await stat(p); const d = JSON.parse(await readFileSafe(p)); return { pid: d.pid, mtime: s.mtimeMs } } catch { return null } }
function isPidAlive(pid: number) { try { process.kill(pid, 0); return true } catch { return false } }

async function acquireLock(p: string, minMs: number): Promise<"acquired"|"blocked"> {
  const m = await getLockMeta(p); if (m && Date.now() - m.mtime < minMs && isPidAlive(m.pid)) return "blocked"
  try { const fh = await open(p, "wx"); await fh.writeFile(JSON.stringify({ pid: process.pid })); await fh.close(); return "acquired" }
  catch { return (await getLockMeta(p)) ? "blocked" : "blocked" }
}

const checkMemory = tool({
  description: "Load project memory context.",
  args: z.object({}),
  execute: async (_a, ctx) => {
    const pp = await projectPath(ctx.directory); const idx = await readFileSafe(join(pp, "MEMORY.md"))
    if (!idx) return { output: "No project memory found yet." }
    let out = "## Project Memory\n\n" + idx.slice(0, 3000)
    for (const f of (await listFiles(pp)).slice(0, 5)) { if (f.startsWith(".")||f==="MEMORY.md") continue; const c = await readFileSafe(join(pp,f)); if (c) out += `\n\n### ${f}\n${c.slice(0,1500)}` }
    return { output: out }
  },
})

const memorySearch = tool({
  description: "Search project memory.",
  args: z.object({ query: z.string() }),
  execute: async (args, ctx) => {
    const pp = await projectPath(ctx.directory); const kws = args.query.toLowerCase().split(/\s+/).filter(k=>k.length>1); const r: string[] = []
    for (const f of await listFiles(pp)) { if (f.startsWith(".")) continue; for (const s of (await readFileSafe(join(pp,f))).split("\n## ")) { if (kws.filter(k=>s.toLowerCase().includes(k)).length>0) r.push(`[${f}] ${s.slice(0,300)}`) } }
    return { output: r.length ? r.slice(0,5).join("\n\n") : "No results." }
  },
})

const memoryStatus = tool({
  description: "Memory system status.",
  args: z.object({}),
  execute: async (_a, ctx) => {
    const pp = await projectPath(ctx.directory); const fs = (await listFiles(pp)).filter(f=>!f.startsWith("."))
    const idx = await readFileSafe(join(pp,"MEMORY.md")); const lm = await getLockMeta(join(pp,".consolidate-lock"))
    return { output: [`Files: ${fs.length}`, `Index: ${idx.length}B`, `Last: ${lm ? new Date(lm.mtime).toISOString() : "never"}`].join("\n") }
  },
})

export const openmemPlugin: Plugin = async ({ client, directory }) => {
  const pp = await projectPath(directory)
  await ensureDir(pp)
  await ensureDir(join(pp, "logs"))
  if (!(await fileExists(join(pp, "MEMORY.md")))) {
    await writeFileSafe(join(pp, "MEMORY.md"), "# Project Memory Index\n\n")
  }

  let hasWork = false
  let extracting = false
  let consolidating = false
  let pendingTools = 0
  let sessionID = ""
  let allMessages: { info?: any; parts?: any[] }[] = []

  function reset() { hasWork = false; pendingTools = 0; allMessages = [] }

  async function extract(msgs: { info?: any; parts?: any[] }[]) {
    if (msgs.length < 2) return
    const parts: string[] = []
    for (const m of msgs) {
      for (const p of (m.parts || [])) {
        if (p.type === "text" && typeof p.text === "string" && p.text.length > 0) {
          parts.push(p.text)
        } else if (p.type === "step-start") {
          if (p.tool) parts.push(`[${p.tool}]`)
        }
      }
    }
    if (parts.length < 2) return
    const conv = parts.join("\n")
    if (conv.length < 30) return
    try {
      const today = new Date()
      const y = today.getFullYear().toString()
      const m = (today.getMonth() + 1).toString().padStart(2, "0")
      const d = today.getDate().toString().padStart(2, "0")
      const logPath = join(pp, "logs", y, m, `${d}.md`)
      await ensureDir(join(pp, "logs", y, m))
      const entry = `\n## ${today.toISOString().slice(0, 10)}\n${conv.slice(0, 2000)}\n`
      await writeFileSafe(logPath, (await readFileSafe(logPath)) + entry)
    } catch (err) {
      console.error("[openmem] write failed:", String(err))
    }
  }

  async function consolidate() {
    if (consolidating) return
    const lockPath = join(pp, ".consolidate-lock")
    const meta = await getLockMeta(lockPath)
    if (meta && Date.now() - meta.mtime < 6 * 3600_000) return
    let logCount = 0
    try {
      for (const yr of await listFiles(join(pp, "logs"))) {
        for (const mo of await listFiles(join(pp, "logs", yr))) {
          for (const dy of await listFiles(join(pp, "logs", yr, mo))) {
            const s = await stat(join(pp, "logs", yr, mo, dy)).catch(() => null)
            if (s && s.mtimeMs > (meta?.mtime ?? 0)) logCount++
          }
        }
      }
    } catch {}
    if (logCount < 3) return
    if ((await acquireLock(lockPath, 6 * 3600_000)) !== "acquired") return
    consolidating = true
    try {
      const prompt = `You are a memory consolidation agent. Maintain project memory in ${pp}.\n\nPhase 1 - Orient: List memory directory. Read MEMORY.md. Browse topic files.\nPhase 2 - Gather: Read new daily logs in logs/YYYY/MM/DD.md. Scan for outdated or contradictory facts.\nPhase 3 - Consolidate: Create or update topic files. Merge related content. Convert relative dates to absolute. Delete contradictions. Keep each file under ~500 words.\nPhase 4 - Prune: Update MEMORY.md index. Keep under 25KB. Remove dead links.`
      const cr = await client.session.create({ directory, agent: "openmem-dream" }) as any
      const sid = cr?.data?.id || cr?.id
      if (sid) {
        await client.session.prompt({ sessionID: sid, directory, parts: [{ type: "text", text: prompt }], system: "Memory consolidation agent." } as any)
      }
      await writeFileSafe(lockPath, JSON.stringify({ pid: process.pid }))
    } catch (err) {
      console.error("[openmem] consolidation failed:", String(err))
    } finally {
      consolidating = false
    }
  }

  return {
    config: (cfg: any) => {
      cfg.agent = cfg.agent || {}
      const memRoot = join(homedir(), ".opencode", "memory")
      cfg.agent["openmem-dream"] = { mode: "subagent", hidden: true, description: "Memory consolidation", permission: { edit: { [`${memRoot}/**`]: "allow", "*": "deny" }, bash: { "ls *": "allow", "find *": "allow", "grep *": "allow", "cat *": "allow", "stat *": "allow", "*": "deny" } } }
      cfg.agent["openmem-extract"] = { mode: "subagent", hidden: true, description: "Memory extraction", permission: { edit: "deny", bash: "deny" } }
    },
    tool: { "check-memory": checkMemory, "memory-search": memorySearch, "memory-status": memoryStatus },

    "experimental.chat.messages.transform": (_i: any, o: any) => {
      if (o.messages) { allMessages = o.messages }
      const lastMsg = allMessages[allMessages.length - 1]
      if (lastMsg && hasWork && !extracting) {
        const hasStepFinish = lastMsg.parts?.some((p:any) => p.type === "step-finish")
        if (hasStepFinish) {
          extracting = true
          const captured = allMessages.slice()
          extract(captured).finally(() => { extracting = false; hasWork = false })
        }
      }
    },

    "tool.execute.before": (i: any) => {
      pendingTools++
      sessionID = i.sessionID
    },

    "tool.execute.after": (i: any) => {
      pendingTools--
      sessionID = i.sessionID
      if (["bash", "edit", "write"].includes(i.tool)) hasWork = true
    },

    event: (i: any) => {
      if (i.event?.type === "session.idle") consolidate().catch(() => {})
      if (i.event?.type === "session.created") reset()
    },
  }
}

export default openmemPlugin

