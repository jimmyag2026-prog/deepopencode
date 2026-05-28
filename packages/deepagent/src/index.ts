import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { z } from "zod"
import {
  createTask,
  getTask,
  listTasks,
  markTaskCompleted,
  markTaskFailed,
  markTaskStopped,
  formatTaskList,
} from "./task-registry"

const BRIEF_TOOL = tool({
  description: "Send a proactive message to the user. Use this to notify about significant findings, report progress of background tasks, or request user confirmation for important decisions.",
  args: z.object({
    message: z.string().describe("The message content in markdown format"),
    status: z.enum(["normal", "proactive"]).default("normal").describe("Message urgency. 'proactive' for critical notifications."),
  }),
  execute: async (args, _ctx) => {
    return {
      title: args.status === "proactive" ? "🔔" : "💬",
      output: args.message,
      metadata: { status: args.status, type: "brief" },
    }
  },
})

const SLEEP_TOOL = tool({
  description: "Pause execution for a specified duration. The sleep can be interrupted by the abort signal when the user cancels. Use this to wait for external services, filesystem operations to settle, or avoid busy-loop polling.",
  args: z.object({
    duration: z.number().min(100).max(300000).describe("Duration to sleep in milliseconds (max 5 minutes = 300000)"),
    reason: z.string().optional().describe("Optional reason for sleeping (shown to user)"),
  }),
  execute: async (args, ctx) => {
    const ms = Math.min(args.duration, 300000)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, ms)
      ctx.abort.addEventListener("abort", () => {
        clearTimeout(timer)
        reject(new Error("Sleep interrupted by user"))
      }, { once: true })
    })
    return {
      title: "Slept",
      output: `Slept for ${ms}ms${args.reason ? ` (${args.reason})` : ""}`,
    }
  },
})

const TASK_CREATE_TOOL = tool({
  description: "Create a new background task. The task runs asynchronously while you continue working. Use this for long-running operations like installations, test suites, or file processing.",
  args: z.object({
    description: z.string().describe("Description of the task to run"),
    agent: z.string().optional().describe("Agent type to use for the task"),
    model: z.string().optional().describe("Model to use for the task"),
    prompt: z.string().describe("The prompt to send to the task agent"),
  }),
  execute: async (args, ctx) => {
    const controller = new AbortController()
    const entry = createTask(args.description, ctx.sessionID, controller)
    return {
      output: [
        `Task created: ${entry.id}`,
        `Status: ${entry.status}`,
        `Description: ${entry.description}`,
        ``,
        `Use \`task-output ${entry.id}\` to check results.`,
        `Use \`task-stop ${entry.id}\` to terminate.`,
      ].join("\n"),
      metadata: { taskId: entry.id, status: entry.status },
    }
  },
})

const TASK_LIST_TOOL = tool({
  description: "List all background tasks and their statuses.",
  args: z.object({
    status: z.enum(["running", "completed", "failed", "stopped", "all"]).default("all").describe("Filter tasks by status"),
  }),
  execute: async (args, _ctx) => {
    return { output: formatTaskList(args.status) }
  },
})

const TASK_OUTPUT_TOOL = tool({
  description: "Get the output of a background task. Blocks until the task completes or timeout is reached.",
  args: z.object({
    taskId: z.string().describe("The task ID returned by task-create"),
    timeout: z.number().min(1000).max(60000).default(30000).describe("Maximum wait time in milliseconds (default 30s)"),
  }),
  execute: async (args, _ctx) => {
    const task = getTask(args.taskId)
    if (!task) {
      return { output: `Task ${args.taskId} not found. Use task-list to see active tasks.` }
    }
    if (task.status === "completed") {
      return { output: `Task ${args.taskId} completed.` }
    }
    if (task.status === "failed" || task.status === "stopped") {
      return { output: `Task ${args.taskId} ${task.status}.` }
    }

    return { output: `Task ${args.taskId} is still running (${task.description}). Check again with task-output ${args.taskId}.` }
  },
})

const TASK_STOP_TOOL = tool({
  description: "Stop a running background task by its ID.",
  args: z.object({
    taskId: z.string().describe("The task ID to stop"),
  }),
  execute: async (args, _ctx) => {
    const task = getTask(args.taskId)
    if (!task) {
      return { output: `Task ${args.taskId} not found.` }
    }
    if (task.status !== "running") {
      return { output: `Task ${args.taskId} is already ${task.status}.` }
    }
    task.controller.abort()
    markTaskStopped(args.taskId)
    return { output: `Task ${args.taskId} stopped.` }
  },
})

export const deepagentPlugin: Plugin = async () => {
  return {
    tool: {
      brief: BRIEF_TOOL,
      sleep: SLEEP_TOOL,
      "task-create": TASK_CREATE_TOOL,
      "task-list": TASK_LIST_TOOL,
      "task-output": TASK_OUTPUT_TOOL,
      "task-stop": TASK_STOP_TOOL,
    },
  }
}

export default deepagentPlugin
