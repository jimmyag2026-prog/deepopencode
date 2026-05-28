interface TaskEntry {
  id: string
  description: string
  status: "running" | "completed" | "failed" | "stopped"
  sessionID: string
  createdAt: number
  controller: AbortController
  startTime: number
}

const tasks = new Map<string, TaskEntry>()

let taskCounter = 0

export function createTask(
  description: string,
  sessionID: string,
  controller: AbortController,
): TaskEntry {
  taskCounter++
  const id = `task_${Date.now()}_${taskCounter}`
  const entry: TaskEntry = {
    id,
    description,
    status: "running",
    sessionID,
    createdAt: Date.now(),
    controller,
    startTime: Date.now(),
  }
  tasks.set(id, entry)
  return entry
}

export function getTask(id: string): TaskEntry | undefined {
  return tasks.get(id)
}

export function listTasks(status?: string): TaskEntry[] {
  const all = Array.from(tasks.values())
  if (!status || status === "all") return all
  return all.filter(t => t.status === status)
}

export function markTaskCompleted(id: string): void {
  const task = tasks.get(id)
  if (task) task.status = "completed"
}

export function markTaskFailed(id: string): void {
  const task = tasks.get(id)
  if (task) task.status = "failed"
}

export function markTaskStopped(id: string): void {
  const task = tasks.get(id)
  if (task) task.status = "stopped"
}

export function removeTask(id: string): void {
  tasks.delete(id)
}

export function formatTaskList(status?: string): string {
  const entries = listTasks(status)
  if (entries.length === 0) return "No tasks."

  return entries
    .map(t => {
      const elapsed = Math.round((Date.now() - t.startTime) / 1000)
      const elapsedStr = elapsed > 60
        ? `${Math.round(elapsed / 60)}m`
        : `${elapsed}s`
      return `[${t.id}] ${t.status} (${elapsedStr}) ${t.description}`
    })
    .join("\n")
}
