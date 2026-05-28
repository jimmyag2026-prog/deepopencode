import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { z } from "zod"
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs"
import { join, dirname } from "path"
import { homedir } from "os"
import { writeFile, readFile, unlink } from "fs/promises"

interface SSHConfig { host: string; port: number; user: string }
interface RemoteSession { id: string; host: string; user: string; port: number; workdir: string; status: "active"|"completed"|"failed"; lastOutput: string; exitCode?: number; createdAt: number }
const SESSION_FILE = join(homedir(), ".opencode", "remote-sessions.json")
let sessions: Map<string, RemoteSession> = new Map()
let counter = 0
function loadSessions() { try { if (existsSync(SESSION_FILE)) { const data = JSON.parse(readFileSync(SESSION_FILE,"utf-8")); sessions = new Map(Object.entries(data)); counter = sessions.size } } catch {} }
function saveSessions() { try { mkdirSync(dirname(SESSION_FILE), { recursive: true }); writeFileSync(SESSION_FILE, JSON.stringify(Object.fromEntries(sessions), null, 2)) } catch {} }
loadSessions()

function parseSSHUrl(url: string): SSHConfig {
  let stripped = url.replace(/^ssh:\/\//, ""), user = "root", port = 22, host = stripped
  if (host.includes("@")) { [user, host] = host.split("@") }
  if (host.includes(":")) { const [h, p] = host.split(":"); host = h; port = parseInt(p) || 22 }
  return { host, port, user }
}

function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'"
}

async function sshExec($: any, c: SSHConfig, cmd: string, wd?: string) {
  const parts = ["ssh","-o","StrictHostKeyChecking=accept-new","-o","ConnectTimeout=10"]
  if (c.port !== 22) parts.push("-p", String(c.port))
  parts.push(`${c.user}@${c.host}`)
  const sc = parts.join(" ")

  const wrapped = wd ? `cd ${shellEscape(wd)} && ${cmd}` : cmd
  const full = `${sc} ${shellEscape(wrapped)}`

  try { const r = await $`bash -c ${full}`.quiet().nothrow(); return { stdout: r.stdout?.toString()??"", stderr: r.stderr?.toString()??"", exitCode: r.exitCode??0 } }
  catch (e: any) { return { stdout: e?.stdout?.toString()??"", stderr: e?.stderr?.toString()??String(e), exitCode: e?.exitCode??1 } }
}
async function sshTest($: any, c: SSHConfig): Promise<boolean> { const r = await sshExec($, c, "echo ok"); return r.exitCode === 0 && r.stdout.includes("ok") }
async function createGitBundle($: any, wd: string): Promise<{ data: Buffer; layer: number; desc: string }|null> {
  try { await $`git -C ${wd} rev-parse --git-dir`.quiet() } catch { return null }
  const tmp = (n: string) => `/tmp/git-bundle-${n}-${Date.now()}`

  for (const [layer, cmd, desc] of [[1,`git -C ${wd} bundle create {TMP} --all`,"all branches"],[2,`git -C ${wd} bundle create {TMP} HEAD`,"current branch"]] as const) {
    const p = tmp(`l${layer}`)
    const r = await $`bash -c ${cmd.replace("{TMP}", p)}`.quiet().nothrow()
    if (r.exitCode === 0 && existsSync(p)) {
      try { const s = await import("fs/promises").then(m=>m.stat(p)); if (s.size <= 100*1024*1024) { const d = await readFile(p); await unlink(p).catch(()=>{}); return { data: d, layer, desc } } } catch {}
      await unlink(p).catch(()=>{})
    }
  }

  const p = tmp("l3")
  try {
    const treeResult = await $`git -C ${wd} rev-parse HEAD^{tree}`.quiet()
    if (treeResult.exitCode !== 0) return null
    const tree = treeResult.stdout.toString().trim()

    const commitResult = await $`git -C ${wd} commit-tree ${tree} -m "snapshot"`.quiet()
    if (commitResult.exitCode !== 0) return null
    const commit = commitResult.stdout.toString().trim()

    const bundleCmd = `git -C ${wd} bundle create ${p} ${commit}`
    const r = await $`bash -c ${bundleCmd}`.quiet().nothrow()
    if (r.exitCode === 0 && existsSync(p)) { const d = await readFile(p); await unlink(p).catch(()=>{}); return { data: d, layer: 3, desc: "single snapshot" } }
  } catch {}
  return null
}

export const remoteAgentPlugin: Plugin = async ({ $, directory }) => ({
  tool: {
    "remote-exec": tool({
      description: "Execute a command on a remote server via SSH.",
      args: z.object({ host: z.string().describe("SSH host"), command: z.string(), workdir: z.string().optional(), timeout: z.number().min(5000).max(300000).default(60000) }),
      execute: async (args) => {
        const cfg = parseSSHUrl(args.host)
        if (!(await sshTest($, cfg))) return { output: `SSH connection to ${cfg.user}@${cfg.host}:${cfg.port} failed.` }
        const { stdout, stderr, exitCode } = await sshExec($, cfg, args.command, args.workdir)
        return { output: [`Host: ${cfg.user}@${cfg.host}:${cfg.port}`, `Exit: ${exitCode}`, stdout ? `\nSTDOUT:\n${stdout.slice(0,5000)}` : "", stderr ? `\nSTDERR:\n${stderr.slice(0,2000)}` : ""].join("\n"), metadata: { host: `${cfg.user}@${cfg.host}`, exitCode } }
      },
    }),
    "remote-session": tool({
      description: "Create a remote session — sync code and execute on remote.",
      args: z.object({ host: z.string().describe("SSH host"), workdir: z.string().optional().default("/tmp/opencode-session"), command: z.string().optional() }),
      execute: async (args) => {
        const cfg = parseSSHUrl(args.host)
        if (!(await sshTest($, cfg))) return { output: "SSH connection failed." }
        counter++; const sid = `rem_${Date.now()}_${counter}`; const sess: RemoteSession = { id: sid, host: cfg.host, user: cfg.user, port: cfg.port, workdir: args.workdir, status: "active", lastOutput: "", createdAt: Date.now() }
        sessions.set(sid, sess); saveSessions()
        const bundle = await createGitBundle($, directory)
        let output = [`Session: ${sid}`, `Host: ${cfg.user}@${cfg.host}`, `Workdir: ${args.workdir}`]
        if (bundle) {
          const bp = join("/tmp", `seed-${sid}.bundle`); await writeFile(bp, bundle.data)
          await sshExec($, cfg, `rm -rf ${shellEscape(args.workdir)} && mkdir -p ${shellEscape(args.workdir)}`)
          const uploadResult = await $`scp -o StrictHostKeyChecking=accept-new ${bp} ${cfg.user}@${cfg.host}:${shellEscape(args.workdir)}/seed.bundle`.quiet().nothrow()
          await unlink(bp).catch(()=>{})
          if (uploadResult.exitCode === 0) { await sshExec($, cfg, `cd ${shellEscape(args.workdir)} && git init && git bundle unbundle seed.bundle && git checkout HEAD`, args.workdir); output.push(`Code synced (layer ${bundle.layer}: ${bundle.desc})`) }
          else { sess.status = "failed"; sess.lastOutput = "Bundle upload failed"; saveSessions(); return { output: `Upload failed to ${cfg.user}@${cfg.host}.` } }
        } else { output.push("No git repository. Executing directly on remote.") }
        if (args.command) { const { stdout, stderr, exitCode } = await sshExec($, cfg, args.command, args.workdir); sess.status = exitCode === 0 ? "completed" : "failed"; sess.lastOutput = stdout || stderr || ""; sess.exitCode = exitCode; saveSessions(); output.push(`Command: ${args.command}`, `Exit: ${exitCode}`); if (stdout) output.push(`STDOUT:\n${stdout.slice(0,3000)}`); if (stderr) output.push(`STDERR:\n${stderr.slice(0,1000)}`) }
        return { output: output.join("\n"), metadata: { sessionId: sid } }
      },
    }),
    "remote-list": tool({ description: "List all remote sessions.", args: z.object({}), execute: async () => { const all = [...sessions.values()]; return { output: all.length ? all.map(s => `[${s.id}] ${s.status} ${s.user}@${s.host}:${s.port} ${s.workdir}`).join("\n") : "No remote sessions." } } }),
    "remote-resume": tool({ description: "Get status of a remote session.", args: z.object({ sessionId: z.string() }), execute: async (args) => { const s = sessions.get(args.sessionId); return { output: s ? [`Session: ${s.id}`, `Status: ${s.status}`, `Host: ${s.user}@${s.host}:${s.port}`, `Workdir: ${s.workdir}`, s.exitCode != null ? `Exit: ${s.exitCode}` : "", s.lastOutput ? `\nLast output:\n${s.lastOutput.slice(0,5000)}` : ""].join("\n") : `Session ${args.sessionId} not found.` } } }),
  },
})
export default remoteAgentPlugin
