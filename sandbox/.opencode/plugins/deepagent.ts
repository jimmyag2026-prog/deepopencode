import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { z } from "zod"

interface TaskEntry { id: string; description: string; status: "running"|"completed"|"failed"|"stopped"; sessionID: string; controller: AbortController; createdAt: number }
const tasks = new Map<string, TaskEntry>(); let counter = 0

export const deepagentPlugin: Plugin = async ({ client }) => ({
  tool: {
    brief: tool({
      description: "Send a proactive message to the user. Use to report significant findings, notify of background task progress, or request user confirmation.",
      args: z.object({ message: z.string().describe("Message content in markdown format"), status: z.enum(["normal","proactive"]).default("normal") }),
      execute: async (args) => ({ title: args.status === "proactive" ? "Notification" : "Message", output: args.message, metadata: { status: args.status } }),
    }),
    sleep: tool({
      description: "Pause execution for a specified duration. Interruptible by user cancel.",
      args: z.object({ duration: z.number().min(100).max(300000).describe("Duration in ms (max 5min)"), reason: z.string().optional() }),
      execute: async (args, ctx) => {
        const ms = Math.min(args.duration, 300000)
        await new Promise<void>((resolve, reject) => { const t = setTimeout(resolve, ms); ctx.abort.addEventListener("abort", () => { clearTimeout(t); reject(new Error("interrupted")) }, { once: true }) })
        return { title: "Slept", output: `Slept for ${ms}ms${args.reason ? ` (${args.reason})` : ""}` }
      },
    }),
    "task-create": tool({
      description: "Create a new background task that runs asynchronously. Use for long-running work like installations, tests, or file processing. The task runs in a separate session.",
      args: z.object({ description: z.string().describe("Task description"), prompt: z.string().describe("Prompt to send to the task agent"), agent: z.string().optional(), model: z.string().optional() }),
      execute: async (args, ctx) => {
        counter++; const id = `bg_${Date.now()}_${counter}`
        const controller = new AbortController()
        tasks.set(id, { id, description: args.description, status: "running", sessionID: ctx.sessionID, controller, createdAt: Date.now() })
        ;(async () => {
          try {
            const created: any = await client.session.create({
              directory: ctx.directory, parentID: ctx.sessionID,
              agent: args.agent || undefined,
              model: args.model ? { id: args.model, providerID: (args.model).split("/")[0] || args.model } : undefined,
            })
            const sid = created?.data?.id || created?.id
            if (!sid) { tasks.get(id)!.status = "failed"; return }
            const result: any = await client.session.prompt({
              sessionID: sid, directory: ctx.directory,
              parts: [{ type: "text", text: args.prompt }],
              system: "Complete the requested task efficiently.",
            })
            const output = result?.data?.parts?.find((p: any) => p.type === "text")?.text
              || JSON.stringify(result?.data?.parts || result?.data || result || "done")
            tasks.get(id)!.status = "completed"
          } catch (e: any) {
            tasks.get(id)!.status = "failed"
          }
        })()
        return { output: `Task ${id} created: ${args.description}\nUse task-list to see all tasks.`, metadata: { taskId: id } }
      },
    }),
    "task-list": tool({
      description: "List all background tasks and their statuses.",
      args: z.object({ status: z.enum(["running","completed","failed","stopped","all"]).default("all") }),
      execute: async (args) => {
        const all = [...tasks.values()].filter(t => args.status === "all" || t.status === args.status)
        return { output: all.length ? all.map(t => `[${t.id}] ${t.status} ${t.description} (${Math.round((Date.now()-t.createdAt)/1000)}s)`).join("\n") : "No tasks." }
      },
    }),
    "task-output": tool({
      description: "Get the output of a background task. Blocks until completion or timeout.",
      args: z.object({ taskId: z.string(), timeout: z.number().min(1000).max(60000).default(30000) }),
      execute: async (args) => { const t = tasks.get(args.taskId); return { output: t ? (t.status !== "running" ? `Task ${args.taskId} ${t.status}.` : `Task ${args.taskId} still running: ${t.description}. Check again.`) : `Task ${args.taskId} not found.` } },
    }),
    "task-stop": tool({
      description: "Stop a running background task.",
      args: z.object({ taskId: z.string() }),
      execute: async (args) => { const t = tasks.get(args.taskId); if (!t) return { output: `Task ${args.taskId} not found.` }; if (t.status !== "running") return { output: `Task ${args.taskId} already ${t.status}.` }; t.controller.abort(); t.status = "stopped"; return { output: `Task ${args.taskId} stopped.` } },
    }),
  },
})
export default deepagentPlugin
