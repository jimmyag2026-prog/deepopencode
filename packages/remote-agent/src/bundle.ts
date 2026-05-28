import type { BunShell } from "@opencode-ai/plugin"

export const BUNDLE_MAX_SIZE = 100 * 1024 * 1024

let layer1Bundle: Buffer | null = null
let layer2Bundle: Buffer | null = null
let layer3Bundle: Buffer | null = null

export async function tryCreateGitBundle(
  $: BunShell,
  workdir: string,
): Promise<{
  layer: number
  data: Buffer
  description: string
} | null> {
  const gitAvailable = await checkGitAvailability($, workdir)
  if (!gitAvailable) return null

  const layer1 = await createLayer1Bundle($, workdir)
  if (layer1 && layer1.length <= BUNDLE_MAX_SIZE) {
    layer1Bundle = layer1
    return { layer: 1, data: layer1, description: "all branches, tags, refs" }
  }

  const layer2 = await createLayer2Bundle($, workdir)
  if (layer2 && layer2.length <= BUNDLE_MAX_SIZE) {
    layer2Bundle = layer2
    return { layer: 2, data: layer2, description: "current branch full history" }
  }

  const layer3 = await createLayer3Bundle($, workdir)
  if (layer3) {
    layer3Bundle = layer3
    return { layer: 3, data: layer3, description: "single snapshot, no history" }
  }

  return null
}

async function checkGitAvailability($: BunShell, workdir: string): Promise<boolean> {
  try {
    const result = await $`git -C ${workdir} rev-parse --git-dir`.quiet().nothrow()
    return result.exitCode === 0
  } catch {
    return false
  }
}

async function createLayer1Bundle($: BunShell, workdir: string): Promise<Buffer | null> {
  try {
    const tmpFile = `/tmp/git-bundle-layer1-${Date.now()}.bundle`
    await $`git -C ${workdir} bundle create ${tmpFile} --all`.quiet().nothrow()
    const file = await Bun.file(tmpFile).arrayBuffer()
    await Bun.file(tmpFile).delete?.().catch(() => {})
    return Buffer.from(file)
  } catch {
    return null
  }
}

async function createLayer2Bundle($: BunShell, workdir: string): Promise<Buffer | null> {
  try {
    const headResult = await $`git -C ${workdir} rev-parse --abbrev-ref HEAD`.quiet().nothrow()
    if (headResult.exitCode !== 0) return null
    const head = headResult.stdout?.toString().trim()
    if (!head || head === "HEAD") return null

    const tmpFile = `/tmp/git-bundle-layer2-${Date.now()}.bundle`
    await $`git -C ${workdir} bundle create ${tmpFile} ${head}`.quiet().nothrow()
    const file = await Bun.file(tmpFile).arrayBuffer()
    await Bun.file(tmpFile).delete?.().catch(() => {})
    return Buffer.from(file)
  } catch {
    return null
  }
}

async function createLayer3Bundle($: BunShell, workdir: string): Promise<Buffer | null> {
  try {
    const treeResult = await $`git -C ${workdir} rev-parse HEAD^{tree}`.quiet().nothrow()
    if (treeResult.exitCode !== 0) return null
    const tree = treeResult.stdout?.toString().trim()

    const commitResult = await $`git -C ${workdir} commit-tree ${tree} -m "seed snapshot"`.quiet().nothrow()
    if (commitResult.exitCode !== 0) return null
    const commit = commitResult.stdout?.toString().trim()

    const tmpFile = `/tmp/git-bundle-layer3-${Date.now()}.bundle`
    await $`git -C ${workdir} bundle create ${tmpFile} ${commit}`.quiet().nothrow()
    const file = await Bun.file(tmpFile).arrayBuffer()
    await Bun.file(tmpFile).delete?.().catch(() => {})

    return Buffer.from(file)
  } catch {
    return null
  }
}

export function clearBundles(): void {
  layer1Bundle = null
  layer2Bundle = null
  layer3Bundle = null
}
