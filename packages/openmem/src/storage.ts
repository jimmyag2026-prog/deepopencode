import { join, dirname } from "path"
import { mkdir, readFile, writeFile, readdir, stat, unlink } from "fs/promises"
import { homedir } from "os"
import { createHash } from "crypto"

export interface MemoryConfig {
  storagePath: string
  maxIndexSize: number
}

export const DEFAULT_CONFIG: MemoryConfig = {
  storagePath: join(homedir(), ".opencode", "memory"),
  maxIndexSize: 25600,
}

export async function getProjectPath(config: MemoryConfig, projectRoot: string): Promise<string> {
  const id = createHash("sha256").update(projectRoot).digest("hex").slice(0, 12)
  return join(config.storagePath, id)
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
}

export async function readFileSafe(path: string): Promise<string> {
  try {
    return await readFile(path, "utf-8")
  } catch {
    return ""
  }
}

export async function writeFileSafe(path: string, content: string): Promise<void> {
  await ensureDir(dirname(path))
  await writeFile(path, content, "utf-8")
}

export async function appendToFile(path: string, content: string): Promise<void> {
  await ensureDir(dirname(path))
  const existing = await readFileSafe(path)
  await writeFile(path, existing + content, "utf-8")
}

export async function listFiles(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch {
    return []
  }
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export async function removeFile(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch {}
}
