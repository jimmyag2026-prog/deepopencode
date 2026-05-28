import type { getLockMeta } from "./lock"
import { listFiles, fileExists } from "./storage"
import { join } from "path"

export interface GateConfig {
  enabled: boolean
  minHours: number
  minSessions: number
  scanIntervalMs: number
}

export const DEFAULT_GATE_CONFIG: GateConfig = {
  enabled: true,
  minHours: 6,
  minSessions: 3,
  scanIntervalMs: 10 * 60 * 1000,
}

let lastScanTime = 0

export async function checkConsolidationGate(
  lockPath: string,
  logDir: string,
  config: GateConfig,
  getLockMetaFn: typeof getLockMeta,
): Promise<boolean> {
  if (!config.enabled) return false

  const meta = await getLockMetaFn(lockPath)

  if (meta && Date.now() - meta.mtime < config.minHours * 3600_000) {
    return false
  }

  if (Date.now() - lastScanTime < config.scanIntervalMs) {
    return false
  }
  lastScanTime = Date.now()

  const lastConsolidatedAt = meta?.mtime ?? 0
  const logFiles = await countLogFilesAfter(logDir, lastConsolidatedAt)
  if (logFiles < config.minSessions) {
    return false
  }

  return true
}

async function countLogFilesAfter(logDir: string, afterMs: number): Promise<number> {
  let count = 0
  try {
    const years = await listFiles(logDir)
    for (const year of years) {
      const yearPath = join(logDir, year)
      const months = await listFiles(yearPath)
      for (const month of months) {
        const monthPath = join(yearPath, month)
        const days = await listFiles(monthPath)
        for (const day of days) {
          const dayPath = join(monthPath, day)
          if (await fileExists(dayPath)) {
            const stat = await import("fs/promises").then(m => m.stat(dayPath))
            if (stat.mtimeMs > afterMs) count++
          }
        }
      }
    }
  } catch {}
  return count
}
