import type { BunShell } from "@opencode-ai/plugin"

export interface SSHConfig {
  host: string
  port: number
  user: string
  keyPath?: string
}

export function parseSSHUrl(url: string): SSHConfig {
  const withoutProtocol = url.replace(/^ssh:\/\//, "")
  let host: string, user: string, port = 22

  if (withoutProtocol.includes("@")) {
    const [u, h] = withoutProtocol.split("@")
    user = u
    host = h
  } else {
    user = "root"
    host = withoutProtocol
  }

  if (host.includes(":")) {
    const [h, p] = host.split(":")
    host = h
    port = parseInt(p, 10) || 22
  }

  return { host, port, user, keyPath: undefined }
}

export function buildSSHCommand(config: SSHConfig): string {
  const parts = ["ssh", "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=10"]
  if (config.port !== 22) parts.push("-p", String(config.port))
  if (config.keyPath) parts.push("-i", config.keyPath)
  parts.push(`${config.user}@${config.host}`)
  return parts.join(" ")
}

export async function sshExec(
  $: BunShell,
  config: SSHConfig,
  command: string,
  workdir?: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const sshCommand = buildSSHCommand(config)
  const fullCommand = workdir
    ? `${sshCommand} "cd ${workdir} && ${command}"`
    : `${sshCommand} "${command}"`

  try {
    const result = await $`bash -c ${fullCommand}`.quiet().nothrow()
    return {
      stdout: result.stdout?.toString() ?? "",
      stderr: result.stderr?.toString() ?? "",
      exitCode: result.exitCode ?? 0,
    }
  } catch (err: any) {
    return {
      stdout: err?.stdout?.toString() ?? "",
      stderr: err?.stderr?.toString() ?? err?.message ?? String(err),
      exitCode: err?.exitCode ?? 1,
    }
  }
}

export async function sshTest($: BunShell, config: SSHConfig): Promise<boolean> {
  const result = await sshExec($, config, "echo ok")
  return result.exitCode === 0 && result.stdout.includes("ok")
}

export async function sshEnsureDir(
  $: BunShell,
  config: SSHConfig,
  remotePath: string,
): Promise<void> {
  await sshExec($, config, `mkdir -p "${remotePath}"`)
}
