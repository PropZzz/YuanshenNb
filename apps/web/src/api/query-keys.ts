export const queryKeys = {
  system: {
    health: ["system", "health"] as const,
  },
  auth: {
    me: ["auth", "me"] as const,
  },
  energy: {
    todayRoot: ["energy", "today"] as const,
    today: (day: string) => ["energy", "today", day] as const,
    profile: ["energy", "profile"] as const,
  },
  schedule: {
    itemsRoot: ["schedule", "items"] as const,
    items: (from: string, to: string) => ["schedule", "items", from, to] as const,
    rescueHistory: ["schedule", "rescue", "history"] as const,
  },
  workspaces: {
    all: ["workspaces"] as const,
    members: (workspaceId: string) => ["workspace", workspaceId, "members"] as const,
    availabilityRoot: (workspaceId: string) => ["workspace", workspaceId, "availability"] as const,
    availability: (workspaceId: string, from: string, to: string) =>
      ["workspace", workspaceId, "availability", from, to] as const,
    meetings: (workspaceId: string) => ["workspace", workspaceId, "meetings"] as const,
  },
} as const;
