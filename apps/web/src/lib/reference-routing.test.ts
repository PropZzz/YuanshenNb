import { expect,it } from "vitest";
import { resolveReferenceRoute } from "./reference-routing";
it("preserves original secondary entrances instead of silently dropping visitors on focus",()=>{
 expect(resolveReferenceRoute("/create-schedule","?day=2026-11-20")).toBe("/calendar?day=2026-11-20&new=1");
 expect(resolveReferenceRoute("/calendar-import")).toBe("/calendar?import=1");
 expect(resolveReferenceRoute("/schedule-detail","?id=real-id")).toBe("/calendar?detail=real-id");
 expect(resolveReferenceRoute("/settings-drawer")).toBe("/focus?preferences=1");
 expect(resolveReferenceRoute("/microtask-entry")).toBe("/microtasks?panel=entry");
 expect(resolveReferenceRoute("/emotion-energy")).toBe("/energy");
});
it("does not interpret external addresses or unsupported names as internal navigation",()=>{
 expect(resolveReferenceRoute("//evil.example")).toBeNull();expect(resolveReferenceRoute("/not-a-reference-screen")).toBeNull();
});
