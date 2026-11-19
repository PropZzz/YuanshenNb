import type { components } from "@/api/schema";

type Schemas = components["schemas"];

export type WsEventType = Schemas["WsEventType"];

export type WsEvent =
  | {
      version: number;
      eventId: string;
      occurredAt: string;
      type: "energy.updated";
      payload: Schemas["WsEnergyUpdatedPayload"];
    }
  | {
      version: number;
      eventId: string;
      occurredAt: string;
      type: "energy.overload_alert";
      payload: Schemas["WsEnergyOverloadAlertPayload"];
    }
  | {
      version: number;
      eventId: string;
      occurredAt: string;
      type: "schedule.updated";
      payload: Schemas["WsScheduleUpdatedPayload"];
    }
  | {
      version: number;
      eventId: string;
      occurredAt: string;
      type: "workspace.meeting_confirmed";
      payload: Schemas["WsWorkspaceMeetingConfirmedPayload"];
    }
  | {
      version: number;
      eventId: string;
      occurredAt: string;
      type: "workspace.meeting_cancelled";
      payload: Schemas["WsWorkspaceMeetingCancelledPayload"];
    }
  | {
      version: number;
      eventId: string;
      occurredAt: string;
      type: "workspace.meeting_responded";
      payload: Schemas["WsWorkspaceMeetingRespondedPayload"];
    }
  | {
      version: number;
      eventId: string;
      occurredAt: string;
      type: "workspace.availability_changed";
      payload: Schemas["WsAvailabilityChangedPayload"];
    };

const VALID_WS_EVENT_TYPES = new Set<string>([
  "energy.updated",
  "energy.overload_alert",
  "schedule.updated",
  "workspace.meeting_confirmed",
  "workspace.meeting_cancelled",
  "workspace.meeting_responded",
  "workspace.availability_changed",
]);

export function parseWsEvent(raw: string): WsEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const obj = parsed as Record<string, unknown>;
  if (
    typeof obj.eventId !== "string" ||
    typeof obj.occurredAt !== "string" ||
    typeof obj.type !== "string" ||
    !VALID_WS_EVENT_TYPES.has(obj.type) ||
    !obj.payload ||
    typeof obj.payload !== "object" ||
    Array.isArray(obj.payload)
  ) {
    return null;
  }

  const version = typeof obj.version === "number" ? obj.version : 1;
  if (!Number.isInteger(version) || version < 1) {
    return null;
  }

  return {
    version,
    eventId: obj.eventId,
    occurredAt: obj.occurredAt,
    type: obj.type,
    payload: obj.payload,
  } as WsEvent;
}

export type WsConnectionState = "disconnected" | "connecting" | "connected" | "reconnecting";

export interface ShixuWsClientOptions {
  getTicket: () => Promise<string>;
  buildUrl?: (ticket: string) => string;
  onEvent: (event: WsEvent) => void;
  onReconnected?: () => void;
  onStateChange?: (state: WsConnectionState) => void;
  WebSocketImpl?: typeof WebSocket;
}

const RECONNECT_BACKOFF_MS = [1000, 2000, 5000, 15000] as const;

export function defaultWsUrl(ticket: string): string {
  const apiBase = import.meta.env.VITE_API_BASE_URL;
  const encodedTicket = encodeURIComponent(ticket);
  if (apiBase) {
    const url = new URL(apiBase);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/api/v1/ws";
    url.search = `?ticket=${encodedTicket}`;
    return url.toString();
  }
  const protocol = typeof window !== "undefined" && window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = typeof window !== "undefined" ? window.location.host : "localhost:5173";
  return `${protocol}//${host}/api/v1/ws?ticket=${encodedTicket}`;
}

export class ShixuWsClient {
  private readonly options: ShixuWsClientOptions;
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private stopped = true;
  private hasConnectedBefore = false;

  constructor(options: ShixuWsClientOptions) {
    this.options = options;
  }

  connect(): void {
    this.stopped = false;
    void this.openConnection();
  }

  disconnect(): void {
    this.stopped = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.close(1000, "client disconnect");
      this.socket = null;
    }
    this.options.onStateChange?.("disconnected");
  }

  private async openConnection(): Promise<void> {
    if (this.stopped) {
      return;
    }

    this.options.onStateChange?.(this.hasConnectedBefore ? "reconnecting" : "connecting");

    let ticket: string;
    try {
      ticket = await this.options.getTicket();
    } catch {
      this.scheduleReconnect();
      return;
    }

    if (this.stopped) {
      return;
    }

    const WS = this.options.WebSocketImpl ?? globalThis.WebSocket;
    const url = (this.options.buildUrl ?? defaultWsUrl)(ticket);
    const ws = new WS(url);
    this.socket = ws;

    ws.addEventListener("open", () => {
      if (this.stopped) {
        ws.close(1000, "stopped");
        return;
      }
      const isReconnect = this.hasConnectedBefore;
      this.hasConnectedBefore = true;
      this.attempt = 0;
      this.options.onStateChange?.("connected");
      if (isReconnect) {
        this.options.onReconnected?.();
      }
    });

    ws.addEventListener("message", (event) => {
      if (typeof event.data !== "string") {
        return;
      }
      const parsed = parseWsEvent(event.data);
      if (parsed) {
        this.options.onEvent(parsed);
      }
    });

    ws.addEventListener("close", () => {
      if (this.socket === ws) {
        this.socket = null;
      }
      if (!this.stopped) {
        this.scheduleReconnect();
      }
    });

    ws.addEventListener("error", () => {
      ws.close();
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer !== null) {
      return;
    }
    const baseDelay =
      RECONNECT_BACKOFF_MS[Math.min(this.attempt, RECONNECT_BACKOFF_MS.length - 1)];
    const jitter = Math.floor(Math.random() * baseDelay * 0.25);
    this.attempt += 1;
    this.options.onStateChange?.("reconnecting");

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.openConnection();
    }, baseDelay + jitter);
  }
}
