import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { z } from "zod"
import {
  parseSSHUrl,
  sshExec,
  sshTest,
  sshEnsureDir,
  type SSHConfig,
} from "./ssh-bridge"
import {
  tryCreateGitBundle,
  clearBundles,
} from "./bundle"
import {
  createSession,
  getSession,
  listSessions,
  updateSessionStatus,
  removeSession,
  formatSessionList,
} from "./session"

const REMOTE_EXEC_TOOL = tool({
  description: "Execute a command on a remote server via SSH. Use this to run tests, builds, or deployments on remote machines.",
  args: z.object({
    host: z.string().describe("SSH host, e.g. 'ssh://user@host:22'"),
    command: z.string().describe("Shell command to execute on the remote server"),
    workdir: z.string().optional().describe("Working directory on remote server"),
    timeout: z.number().min(5000).max(300000).default(60000).describe("Timeout in ms (max 5 minutes)"),
  }),
  execute: async (args, ctx) => {
    const $ = (globalThis as any).BunShell
    if (!$) {
      return { output: "Shell execution not available in this context." }
    }

    const config = parseSSHUrl(args.host)
    const connected = await sshTest($, config)
    if (!connected) {
      return { output: `SSH connection to ${config.user}@${config.host}:${config.port} failed. Check host, user, and SSH key.` }
    }

    const { stdout, stderr, exitCode } = await sshExec(
      $, config, args.command, args.workdir,
    )

    return {
      output: [
        `Host: ${config.user}@${config.host}:${config.port}`,
        `Exit: ${exitCode}`,
        stdout ? `\nSTDOUT:\n${stdout.slice(0, 5000)}` : "",
        stderr ? `\nSTDERR:\n${stderr.slice(0, 2000)}` : "",
      ].join("\n"),
      metadata: { host: `${config.user}@${config.host}`, exitCode },
    }
  },
})

const REMOTE_SESSION_TOOL = tool({
  description: "Create a remote session — bundle and sync project code to a remote server, then execute a command. The session is tracked and can be resumed later.",
  args: z.object({
    host: z.string().describe("SSH host, e.g. 'ssh://user@host:22'"),
    workdir: z.string().optional().default("/tmp/opencode-session").describe("Remote working directory"),
    command: z.string().optional().describe("Command to execute on remote after syncing code"),
  }),
  execute: async (args, ctx) => {
    const $ = (globalThis as any).BunShell
    if (!$) {
      return { output: "Shell execution not available in this context." }
    }

    const config = parseSSHUrl(args.host)
    const connected = await sshTest($, config)
    if (!connected) {
      return { output: `SSH connection failed.` }
    }

    const session = createSession(
      config.host, config.user, config.port, args.workdir,
    )

    const bundle = await tryCreateGitBundle($, ctx.directory)

    if (bundle) {
      updateSessionStatus(session.id, "active", `Uploading git bundle (layer ${bundle.layer})...`)

      const bundlePath = `/tmp/seed-${session.id}.bundle`
      await Bun.write(bundlePath, bundle.data)

      try {
        await sshExec($, config, `rm -rf "${args.workdir}" && mkdir -p "${args.workdir}"`)

        const uploadResult = await $`scp ${bundlePath} ${config.user}@${config.host}:${args.workdir}/seed.bundle`.quiet().nothrow()
        if (uploadResult.exitCode !== 0) {
          updateSessionStatus(session.id, "failed", "Failed to upload git bundle")
          await Bun.file(bundlePath).delete?.().catch(() => {})
          return { output: `Failed to upload git bundle to ${config.user}@${config.host}.` }
        }

        await sshExec(
          $, config,
          `cd "${args.workdir}" && git init && git bundle unbundle seed.bundle && git checkout HEAD`,
          args.workdir,
        )

        const statusMsg = `Code synced (layer ${bundle.layer}: ${bundle.description}). Working directory: ${args.workdir}`
        updateSessionStatus(session.id, "active", statusMsg)

        let output = [
          `Session: ${session.id}`,
          `Host: ${config.user}@${config.host}`,
          `Workdir: ${args.workdir}`,
          statusMsg,
        ].join("\n")

        if (args.command) {
          const { stdout, stderr, exitCode } = await sshExec(
            $, config, args.command, args.workdir,
          )
          updateSessionStatus(
            session.id,
            exitCode === 0 ? "completed" : "failed",
            stdout || stderr,
            exitCode,
          )
          output += `\n\nCommand: ${args.command}\nExit: ${exitCode}`
          if (stdout) output += `\nSTDOUT:\n${stdout.slice(0, 3000)}`
          if (stderr) output += `\nSTDERR:\n${stderr.slice(0, 1000)}`
        }

        await Bun.file(bundlePath).delete?.().catch(() => {})
        return { output, metadata: { sessionId: session.id, layer: bundle.layer } }
      } catch (err: any) {
        updateSessionStatus(session.id, "failed", err.message)
        return { output: `Session failed: ${err.message}` }
      }
    } else {
      const { stdout, stderr, exitCode } = args.command
        ? await sshExec($, config, args.command, args.workdir)
        : { stdout: "", stderr: "", exitCode: 0 }

      updateSessionStatus(
        session.id,
        exitCode === 0 ? "completed" : "failed",
        stdout || stderr,
        exitCode,
      )

      return {
        output: [
          `Session: ${session.id}`,
          `Host: ${config.user}@${config.host}`,
          `No git repository to bundle.`,
          args.command ? `Command: ${args.command}\nExit: ${exitCode}\n${stdout}` : "",
        ].join("\n"),
        metadata: { sessionId: session.id },
      }
    }
  },
})

const REMOTE_LIST_TOOL = tool({
  description: "List all active and past remote sessions.",
  args: z.object({}),
  execute: async () => {
    return { output: formatSessionList() }
  },
})

const REMOTE_RESUME_TOOL = tool({
  description: "Get the status of a remote session, including its last output.",
  args: z.object({
    sessionId: z.string().describe("The remote session ID"),
  }),
  execute: async (args) => {
    const session = getSession(args.sessionId)
    if (!session) {
      return { output: `Session ${args.sessionId} not found. Use remote-list to see available sessions.` }
    }
    return {
      output: [
        `Session: ${session.id}`,
        `Status: ${session.status}`,
        `Host: ${session.user}@${session.host}:${session.port}`,
        `Workdir: ${session.workdir}`,
        session.exitCode !== undefined ? `Exit code: ${session.exitCode}` : "",
        session.lastOutput ? `\nLast output:\n${session.lastOutput.slice(0, 5000)}` : "",
      ].join("\n"),
    }
  },
})

export const remoteAgentPlugin: Plugin = async () => {
  return {
    tool: {
      "remote-exec": REMOTE_EXEC_TOOL,
      "remote-session": REMOTE_SESSION_TOOL,
      "remote-list": REMOTE_LIST_TOOL,
      "remote-resume": REMOTE_RESUME_TOOL,
    },
  }
}

export default remoteAgentPlugin
