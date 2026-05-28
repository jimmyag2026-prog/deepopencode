import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { z } from "zod"
import { join } from "path"
import { mkdir, readFile, writeFile, readdir, stat, open } from "fs/promises"
import { homedir } from "os"
import { createHash } from "crypto"

const MEMORY_ROOT = join(homedir(), ".opencode", "memory")
const QUIET_MS = 3000

async function projectPath(root: string) { const id = createHash("sha256").update(root).digest("hex").slice(0, 12); return join(MEMORY_ROOT, id) }
async function ensureDir(p: string) { await mkdir(p, { recursive: true }) }
async function readFileSafe(p: string) { try { return await readFile(p, "utf-8") } catch { return "" } }
async function writeFileSafe(p: string, c: string) { await ensureDir(join(p, "..")); await writeFile(p, c) }
async function fileExists(p: string) { try { await stat(p); return true } catch { return false } }
async function listFiles(d: string): Promise<string[]> { try { return await readdir(d) } catch { return [] } }

async function getLockMeta(lockPath: string) { try { const s = await stat(lockPath); const body = await readFileSafe(lockPath); const d = JSON.parse(body); return { pid: d.pid, mtime: s.mtimeMs } } catch { return null } }
function isPidAlive(pid: number) { try { process.kill(pid, 0); return true } catch { return false } }

async function acquireLock(lockPath: string, minMs: number): Promise<"acquired"|"blocked"> {
  const meta = await getLockMeta(lockPath)
  if (meta && Date.now() - meta.mtime < minMs && isPidAlive(meta.pid)) return "blocked"
  try {
    const fh = await open(lockPath, "wx")
    await fh.writeFile(JSON.stringify({ pid: process.pid }))
    await fh.close()
    return "acquired"
  } catch {
    const meta2 = await getLockMeta(lockPath)
    if (meta2 && Date.now() - meta2.mtime < minMs && isPidAlive(meta2.pid)) return "blocked"
    try {
      const fh = await open(lockPath, "w")
      await fh.writeFile(JSON.stringify({ pid: process.pid }))
      await fh.close()
      return "acquired"
    } catch {
      return "blocked"
    }
  }
}

async function countLogsAfter(logDir: string, afterMs: number): Promise<number> {
  let c = 0
  try { for (const yr of await listFiles(logDir)) { for (const mo of await listFiles(join(logDir,yr))) { for (const dy of await listFiles(join(logDir,yr,mo))) { const s = await stat(join(logDir,yr,mo,dy)).catch(()=>null); if (s && s.mtimeMs>afterMs) c++ } } } } catch {}
  return c
}

const checkMemory = tool({
  description: "Load project memory context. Call this at the start of a session to recall previously learned facts about the project.",
  args: z.object({}),
  execute: async (_a, ctx) => {
    const pp = await projectPath(ctx.directory)
    const idx = await readFileSafe(join(pp, "MEMORY.md"))
    if (!idx) return { output: "No project memory found yet." }
    let out = "## Project Memory\n\n" + idx.slice(0, 3000)
    for (const f of (await listFiles(pp)).slice(0, 5)) { if (f.startsWith(".")||f==="MEMORY.md") continue; const c = await readFileSafe(join(pp,f)); if (c) out += `\n\n### ${f}\n${c.slice(0,1500)}` }
    return { output: out }
  },
})

const memorySearch = tool({
  description: "Search project memory files for relevant information using keywords.",
  args: z.object({ query: z.string().describe("Search keywords") }),
  execute: async (args, ctx) => {
    const pp = await projectPath(ctx.directory); const kws = args.query.toLowerCase().split(/\s+/).filter(k=>k.length>1); const results: string[] = []
    for (const f of await listFiles(pp)) {
      if (f.startsWith(".")) continue; const content = await readFileSafe(join(pp,f))
      for (const sec of content.split("\n## ")) {
        if (kws.filter(k=>sec.toLowerCase().includes(k)).length>0) results.push(`[${f}] ${sec.slice(0,300)}`)
      }
    }
    return { output: results.length ? results.slice(0,5).join("\n\n---\n\n") : "No relevant memories found." }
  },
})

const memoryStatus = tool({
  description: "Check the status of the project memory system.",
  args: z.object({}),
  execute: async (_a, ctx) => {
    const pp = await projectPath(ctx.directory); const memFiles = (await listFiles(pp)).filter(f=>!f.startsWith("."))
    const idx = await readFileSafe(join(pp,"MEMORY.md")); const lockMeta = await getLockMeta(join(pp,".consolidate-lock"))
    return { output: [`Memory files: ${memFiles.length}`, `Index size: ${idx.length} bytes`, `Files: ${memFiles.join(", ")||"none"}`, lockMeta ? `Last consolidated: ${new Date(lockMeta.mtime).toISOString()}` : "Never consolidated"].join("\n") }
  },
})

export const openmemPlugin: Plugin = async ({ client, directory }) => {
  const pp = await projectPath(directory); await ensureDir(pp); await ensureDir(join(pp,"logs"))
  if (!(await fileExists(join(pp,"MEMORY.md")))) await writeFileSafe(join(pp,"MEMORY.md"), "# Project Memory Index\n\nThis file indexes topic-specific memory files.\n\n")

  type TS = { hw: boolean; t: ReturnType<typeof setTimeout>|null; p: number; lt: number; sid: string; cr: boolean }
  const s: TS = { hw: false, t: null, p: 0, lt: 0, sid: "", cr: false }
  let ed = false
  function ct() { if (s.t) { clearTimeout(s.t); s.t = null } }
  function rt() { ct(); s.hw = false; s.p = 0 }

  async function fetchRecentConversation(): Promise<string> {
    if (!s.sid) return ""
    try {
      const r = await client.session.messages({ sessionID: s.sid, directory, limit: 10 }) as any
      const messages = r?.data || []
      const parts: string[] = []
      for (const m of messages.slice(-6)) {
        for (const p of (m.parts || [])) {
          if (p.type === "text" && p.text) parts.push(p.text)
          else if (p.type === "tool_call" && p.tool && p.args) parts.push(`[${p.tool}] ${JSON.stringify(p.args).slice(0,200)}`)
          else if (p.type === "tool_result" && p.output) parts.push(`=> ${String(p.output).slice(0,200)}`)
        }
      }
      return parts.join("\n")
    } catch {
      return ""
    }
  }

  async function em() {
    const today = new Date(); const [y,m,d] = [today.getFullYear().toString(),(today.getMonth()+1).toString().padStart(2,"0"),today.getDate().toString().padStart(2,"0")]
    const logPath = join(pp,"logs",y,m,`${d}.md`); await ensureDir(join(logPath,".."))

    const conversation = await fetchRecentConversation()
    if (!conversation || conversation.length < 100) return

    try {
      const prompt = `Extract key technical facts from the conversation below.\nOutput as bullet lines starting with "- ". Be concise. Skip debugging steps.\n\nRecent work:\n${conversation.slice(-4000)}\n\nOutput format:\n- [fact]`
      const created = await client.session.create({ directory }) as any; const sid = created?.data?.id||created?.id
      if (!sid) return
      const r = await client.session.prompt({ sessionID: sid, directory, parts: [{ type: "text", text: prompt }], system: "You are a technical note taker. Extract facts briefly.", tools: { bash: false, edit: false, write: false, task: false } } as any) as any
      const extracted = r?.data?.parts?.find((p:any) => p.type === "text")?.text || ""
      if (extracted.trim()) {
        const entry = `\n## ${today.toISOString().slice(0, 10)}\n${extracted.trim()}\n`
        await writeFileSafe(logPath, (await readFileSafe(logPath)) + entry)
      }
      await client.session.delete({ sessionID: sid, directory } as any).catch(()=>{})
    } catch {}
  }

  function sq() { ct(); s.t = setTimeout(()=>{ if (Date.now()-s.lt<QUIET_MS||s.p>0||!s.hw||ed) return; ed=true; em().finally(()=>{ed=false}); s.hw=false }, QUIET_MS) }

  async function tc() {
    if (s.cr) return; const lockPath = join(pp,".consolidate-lock"); const logDir = join(pp,"logs")
    const meta = await getLockMeta(lockPath); if (meta && Date.now()-meta.mtime<6*3600_000) return
    const newLogs = await countLogsAfter(logDir, meta?.mtime??0); if (newLogs < 3) return
    const ok = await acquireLock(lockPath, 6*3600_000); if (ok !== "acquired") return
    s.cr = true
    try {
      const prompt = `You are a memory consolidation agent. Maintain project memory files in ${pp}.\n\nPhase 1 - Orient: List memory directory. Read MEMORY.md. Browse topic files.\nPhase 2 - Gather: Read new daily logs in logs/YYYY/MM/DD.md. Scan for outdated/contradictory facts. Use grep.\nPhase 3 - Consolidate: Create/update topic files. Merge related content. Convert relative dates to absolute. Delete contradictions. Max ~500 words per file.\nPhase 4 - Prune: Update MEMORY.md index. Keep under 25KB. Remove dead links.`
      const created = await client.session.create({ directory, agent: "openmem-dream" }) as any; const sid = created?.data?.id||created?.id
      if (sid) { await client.session.prompt({ sessionID: sid, directory, parts: [{ type: "text", text: prompt }], system: "You are a memory consolidation agent. Update memory files." } as any) }
      await writeFileSafe(lockPath, JSON.stringify({ pid: process.pid }))
    } catch (err) { console.error("[openmem] consolidation failed:", err) }
    finally { s.cr = false }
  }

  return {
    config: async (cfg: any) => {
      cfg.agent = cfg.agent || {}
      cfg.agent["openmem-dream"] = { mode: "subagent", hidden: true, description: "Memory consolidation agent", permission: { edit: { [join(homedir(),".opencode","memory","**")]: "allow", "*": "deny" }, bash: { "ls *": "allow", "find *": "allow", "grep *": "allow", "cat *": "allow", "stat *": "allow", "*": "deny" } } }
      cfg.agent["openmem-extract"] = { mode: "subagent", hidden: true, description: "Technical note taker for memory extraction", permission: { edit: "deny", bash: "deny" } }
    },
    tool: { "check-memory": checkMemory, "memory-search": memorySearch, "memory-status": memoryStatus },
    "tool.execute.before": (i: any) => { s.p++; s.sid = i.sessionID; ct() },
    "tool.execute.after": (i: any) => { s.p--; s.lt = Date.now(); s.sid = i.sessionID; if (["bash","edit","write"].includes(i.tool)) s.hw = true; if (s.p <= 0) sq() },
    event: async (i: any) => { if (i.event?.type === "session.idle") tc().catch(()=>{}); if (i.event?.type === "session.created") rt() },
  }
}
export default openmemPlugin
