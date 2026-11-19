import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient, type ApiComponents } from "./client";
import { unwrap } from "./unwrap";
import { ShixuWsClient, type WsConnectionState } from "./ws";
import { queryKeys } from "./query-keys";
export function useRealtime() {
  const cache = useQueryClient();
  const [state, setState] = useState<WsConnectionState>("connecting");
  const [alert, setAlert] = useState<ApiComponents["WsEnergyOverloadAlertPayload"] | null>(null);
  useEffect(() => {
    const socket = new ShixuWsClient({getTicket:async()=>unwrap(await apiClient.POST("/api/v1/auth/ws-ticket")).ticket,onStateChange:setState,onReconnected:()=>{void cache.invalidateQueries();},onEvent:event=>{
      if(event.type==="energy.updated") void cache.invalidateQueries({queryKey:queryKeys.energy.todayRoot});
      if(event.type==="energy.overload_alert") {setAlert(event.payload);void cache.invalidateQueries({queryKey:queryKeys.energy.todayRoot});}
      if(event.type==="schedule.updated" || event.type.startsWith("workspace.meeting_")) {void cache.invalidateQueries({queryKey:queryKeys.schedule.itemsRoot});void cache.invalidateQueries({queryKey:queryKeys.schedule.rescueHistory});void cache.invalidateQueries({queryKey:queryKeys.energy.todayRoot});}
      if("workspaceId" in event.payload) {const id=event.payload.workspaceId;void cache.invalidateQueries({queryKey:queryKeys.workspaces.availabilityRoot(id)});void cache.invalidateQueries({queryKey:queryKeys.workspaces.meetings(id)});void cache.invalidateQueries({queryKey:queryKeys.workspaces.all});}
    }});socket.connect();return()=>socket.disconnect();
  },[cache]);
  return {state,alert,dismissAlert:()=>setAlert(null)};
}
