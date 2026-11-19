export function remainingSeconds(deadline: number, now = Date.now()): number { return Math.max(0, Math.ceil((deadline - now) / 1000)); }
export function formatTimer(seconds: number): string { const value = Math.max(0, Math.floor(seconds)); return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`; }
