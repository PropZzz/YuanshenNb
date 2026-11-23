const coreRoutes = new Set(["focus", "login", "register", "calendar", "team", "energy", "settings"]);

export function resolveReferenceRoute(path: string, search = ""): string | null {
  const name = path.replace(/^\//, "").replace(/\/$/, "");
  if (!name || name.includes("/")) return null;
  const query = new URLSearchParams(search);
  const finish = (route: string) => `/${route}${query.size ? `?${query}` : ""}`;

  if (coreRoutes.has(name)) return finish(name);
  if (name === "profile") return finish("settings");
  if (name === "diagnostics") {
    query.set("tab", "diagnostics");
    return finish("settings");
  }
  if (name === "integrations" || name === "mcp") {
    query.set("import", "1");
    return finish("calendar");
  }
  if (name === "schedule" || name === "smart-calendar") return finish("calendar");
  if (["micro", "micro-tasks", "microtasks", "microtask-entry", "microtask-entry-breakdown", "microtask-detail"].includes(name)) {
    return finish("focus");
  }
  if (["goals", "review", "bluetooth"].includes(name)) return finish("focus");
  if (["emotion-energy", "emotion"].includes(name)) return finish("energy");
  if (name === "settings-drawer") {
    query.set("tab", "account");
    return finish("settings");
  }
  if (name === "create-schedule") {
    query.set("new", "1");
    return finish("calendar");
  }
  if (name === "schedule-detail") {
    query.set("detail", query.get("id") ?? "missing");
    query.delete("id");
    return finish("calendar");
  }
  if (["urgent-task", "insert-urgent-task", "rescue-comparison", "urgent-rescue-comparison"].includes(name)) {
    query.set("rescue", "1");
    return finish("calendar");
  }
  if (name === "calendar-options") {
    query.set("options", "1");
    return finish("calendar");
  }
  if (["calendar-import", "import-schedule"].includes(name)) {
    query.set("import", "1");
    return finish("calendar");
  }
  return null;
}
