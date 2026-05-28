export interface RemoteSession {
  id: string
  host: string
  user: string
  port: number
  workdir: string
  status: "active" | "completed" | "failed" | "disconnected"
  createdAt: number
  lastOutput: string
  exitCode?: number
}

const sessions = new Map<string, RemoteSession>()
let sessionCounter = 0

export function createSession(
  host: string,
  user: string,
  port: number,
  workdir: string,
): RemoteSession {
  sessionCounter++
  const id = `rem_${Date.now()}_${sessionCounter}`
  const session: RemoteSession = {
    id,
    host,
    user,
    port,
    workdir,
    status: "active",
    createdAt: Date.now(),
    lastOutput: "",
  }
  sessions.set(id, session)
  return session
}

export function getSession(id: string): RemoteSession | undefined {
  return sessions.get(id)
}

export function listSessions(): RemoteSession[] {
  return Array.from(sessions.values())
}

export function updateSessionStatus(
  id: string,
  status: RemoteSession["status"],
  output?: string,
  exitCode?: number,
): void {
  const session = sessions.get(id)
  if (!session) return
  session.status = status
  if (output !== undefined) session.lastOutput = output
  if (exitCode !== undefined) session.exitCode = exitCode
}

export function removeSession(id: string): void {
  sessions.delete(id)
}

export function formatSessionList(): string {
  const all = listSessions()
  if (all.length === 0) return "No remote sessions."

  return all
    .map(s => {
      const elapsed = Math.round((Date.now() - s.createdAt) / 1000)
      const elapsedStr = elapsed > 60 ? `${Math.round(elapsed / 60)}m ago` : `${elapsed}s ago`
      return `[${s.id}] ${s.status} ${s.user}@${s.host}:${s.port} ${s.workdir} (${elapsedStr})`
    })
    .join("\n")
}
