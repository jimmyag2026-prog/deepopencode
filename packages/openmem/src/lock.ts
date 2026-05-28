import { readFileSafe, writeFileSafe, fileExists } from "./storage"

const LOCKFILE = ".consolidate-lock"

export interface LockMeta {
  pid: number
  mtime: number
}

export async function getLockMeta(lockPath: string): Promise<LockMeta | null> {
  if (!(await fileExists(lockPath))) return null
  const stat = await import("fs/promises").then(m => m.stat(lockPath))
  const body = await readFileSafe(lockPath)
  try {
    const data = JSON.parse(body) as { pid: number }
    return { pid: data.pid, mtime: stat.mtimeMs }
  } catch {
    return { pid: 0, mtime: stat.mtimeMs }
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export async function acquireConsolidationLock(
  lockPath: string,
  minHoursMs: number,
): Promise<"acquired" | "blocked" | "skip"> {
  const meta = await getLockMeta(lockPath)
  const now = Date.now()

  if (meta && now - meta.mtime < minHoursMs && isPidAlive(meta.pid)) {
    return "blocked"
  }

  if (meta && now - meta.mtime < minHoursMs && !isPidAlive(meta.pid)) {
  }

  const preMtime = meta?.mtime ?? 0
  await writeFileSafe(lockPath, JSON.stringify({ pid: process.pid }))
  const verify = await readFileSafe(lockPath)
  try {
    const data = JSON.parse(verify) as { pid: number }
    if (data.pid !== process.pid) {
      return "blocked"
    }
  } catch {
    return "blocked"
  }

  return "acquired"
}

export async function recordConsolidation(lockPath: string): Promise<void> {
  await writeFileSafe(lockPath, JSON.stringify({ pid: process.pid }))
}

export async function rollbackConsolidationLock(
  lockPath: string,
  preMtime: number,
): Promise<void> {
  if (preMtime === 0) {
    const { removeFile } = await import("./storage")
    await removeFile(lockPath)
    return
  }
  const { utimes } = await import("fs/promises")
  try {
    const now = new Date()
    const prev = new Date(preMtime)
    await utimes(lockPath, now, prev)
  } catch {}
}
