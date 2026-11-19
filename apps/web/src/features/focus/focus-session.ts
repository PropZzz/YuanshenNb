import { create } from "zustand";
import { useAuthStore } from "@/stores/auth-store";

type FocusSession = {
  ownerId: string | null;
  itemId: string | undefined;
  mode: "flow" | "countdown";
  startedAt: number | null;
  savedSeconds: number;
  choose: (ownerId: string, itemId: string) => void;
  start: (ownerId: string, itemId: string) => void;
  pause: () => void;
  setMode: (mode: "flow" | "countdown") => void;
  clear: () => void;
};
// Memory-only session survives view navigation, and is cleared on account changes.
export const useFocusSession = create<FocusSession>((set, get) => ({
  ownerId: null, itemId: undefined, mode: "flow", startedAt: null, savedSeconds: 0,
  choose: (ownerId,itemId) => set({ownerId,itemId,startedAt:null,savedSeconds:0}),
  start: (ownerId,itemId) => { const old=get(); set({ownerId,itemId,startedAt:Date.now(),savedSeconds:old.ownerId===ownerId&&old.itemId===itemId?old.savedSeconds:0}); },
  pause: () => { const old=get(); if(old.startedAt!==null) set({savedSeconds:old.savedSeconds+Math.max(0,Math.floor((Date.now()-old.startedAt)/1000)),startedAt:null}); },
  setMode: mode => set({mode}),
  clear: () => set({ownerId:null,itemId:undefined,startedAt:null,savedSeconds:0}),
}));
useAuthStore.subscribe((state,previous) => { if(state.status!=="authenticated"||state.user?.id!==previous.user?.id)useFocusSession.getState().clear(); });
