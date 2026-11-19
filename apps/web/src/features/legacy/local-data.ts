import { useEffect, useState } from "react";
import { useAuthStore } from "@/stores/auth-store";
import { createLocalId } from "./local-id";

export type Priority = "P0" | "P1" | "P2" | "P3";
export type LocalTask = {
  id: string; title: string; description: string; duration: number; priority: Priority;
  load: "low" | "medium" | "high"; tags: string[]; completed: boolean;
  createdAt: string; completedAt?: string; goalId?: string; archived?: boolean;
};
export type GoalStep = { id: string; title: string; completed: boolean };
export type LocalGoal = { id: string; title: string; description: string; deadline: string; priority: Priority; steps: GoalStep[]; createdAt: string };
export type LocalWorkspace = { version: 1; tasks: LocalTask[]; goals: LocalGoal[]; drafts: { integration?: string; microtask?: string; reviewNote?: string; mood?: string } };
export const localWorkspaceKey = (id: string) => `shixu:local-workspace:v1:${id}`;
const emptyWorkspace = (): LocalWorkspace => ({ version: 1, tasks: [], goals: [], drafts: {} });
const changedEvent = "shixu:local-workspace-changed";
const priorityValues = ["P0", "P1", "P2", "P3"];

function isTask(value: unknown): value is LocalTask {
  if (!value || typeof value !== "object") return false;
  const task = value as LocalTask;
  return typeof task.id === "string" && typeof task.title === "string" && typeof task.description === "string" && Number.isFinite(task.duration) && task.duration > 0 && priorityValues.includes(task.priority) && ["low", "medium", "high"].includes(task.load) && Array.isArray(task.tags) && task.tags.every(tag => typeof tag === "string") && typeof task.completed === "boolean" && typeof task.createdAt === "string";
}
function isGoal(value: unknown): value is LocalGoal {
  if (!value || typeof value !== "object") return false;
  const goal = value as LocalGoal;
  return typeof goal.id === "string" && typeof goal.title === "string" && typeof goal.description === "string" && typeof goal.deadline === "string" && priorityValues.includes(goal.priority) && typeof goal.createdAt === "string" && Array.isArray(goal.steps) && goal.steps.every(step => typeof step?.id === "string" && typeof step.title === "string" && typeof step.completed === "boolean");
}
export function readLocalData(id: string): LocalWorkspace {
  const raw = localStorage.getItem(localWorkspaceKey(id));
  if (!raw) return emptyWorkspace();
  let value: LocalWorkspace;
  try { value = JSON.parse(raw) as LocalWorkspace; } catch { throw new Error("本机数据无法读取；原始内容已保留，未覆盖已有记录。"); }
  if (value?.version !== 1 || !Array.isArray(value.tasks) || !value.tasks.every(isTask) || !Array.isArray(value.goals) || !value.goals.every(isGoal) || !value.drafts || Object.values(value.drafts).some(draft => typeof draft !== "string")) throw new Error("本机数据格式不兼容，未覆盖已有记录。");
  return value;
}
export function exportLocalData(id: string): string {
  const { tasks, goals, drafts } = readLocalData(id);
  return JSON.stringify({ format: "shixu-local-workspace", version: 1, exportedAt: new Date().toISOString(), storage: "仅本机", tasks, goals, drafts }, null, 2);
}
export function downloadText(filename: string, content: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename;
  document.body.append(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function makeLocalTask(input: Pick<LocalTask, "title" | "duration" | "priority" | "load"> & Partial<LocalTask>): LocalTask {
  const title = input.title.trim();
  if (!title) throw new Error("请填写任务标题");
  if (!Number.isInteger(input.duration) || input.duration < 1 || input.duration > 1440) throw new Error("预估时长需为 1 至 1440 分钟的整数");
  return { id: createLocalId(), description: "", tags: [], completed: false, createdAt: new Date().toISOString(), ...input, title };
}
export function useLocalWorkspace() {
  const id = useAuthStore(state => state.user?.id ?? "anonymous");
  const [data, setData] = useState<LocalWorkspace>(() => { try { return readLocalData(id); } catch { return emptyWorkspace(); } });
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    function refresh() { try { setData(readLocalData(id)); setError(null); } catch (cause) { setError(cause instanceof Error ? cause : new Error("浏览器不允许读取本机数据")); } }
    refresh(); window.addEventListener(changedEvent, refresh); window.addEventListener("storage", refresh);
    return () => { window.removeEventListener(changedEvent, refresh); window.removeEventListener("storage", refresh); };
  }, [id]);
  function update(recipe: (current: LocalWorkspace) => LocalWorkspace): boolean {
    try {
      const next = recipe(readLocalData(id));
      localStorage.setItem(localWorkspaceKey(id), JSON.stringify(next)); setData(next); setError(null);
      window.dispatchEvent(new Event(changedEvent)); return true;
    } catch (cause) { setError(cause instanceof Error ? cause : new Error("无法保存到本机；请检查浏览器存储权限或可用空间")); return false; }
  }
  return { id, data, error, update };
}
