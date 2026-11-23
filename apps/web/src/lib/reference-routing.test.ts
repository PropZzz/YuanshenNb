import { expect, it } from "vitest";
import { resolveReferenceRoute } from "./reference-routing";

it("preserves original secondary entrances and redirects legacy routes cleanly", () => {
  expect(resolveReferenceRoute("/create-schedule", "?day=2026-11-20")).toBe(
    "/calendar?day=2026-11-20&new=1",
  );
  expect(resolveReferenceRoute("/calendar-import")).toBe("/calendar?import=1");
  expect(resolveReferenceRoute("/schedule-detail", "?id=real-id")).toBe(
    "/calendar?detail=real-id",
  );
  expect(resolveReferenceRoute("/settings-drawer")).toBe("/settings?tab=account");
  expect(resolveReferenceRoute("/microtask-entry")).toBe("/focus");
  expect(resolveReferenceRoute("/profile")).toBe("/settings");
  expect(resolveReferenceRoute("/diagnostics")).toBe("/settings?tab=diagnostics");
  expect(resolveReferenceRoute("/integrations")).toBe("/calendar?import=1");
  expect(resolveReferenceRoute("/emotion-energy")).toBe("/energy");
});

it("does not interpret external addresses or unsupported names as internal navigation", () => {
  expect(resolveReferenceRoute("//evil.example")).toBeNull();
  expect(resolveReferenceRoute("/not-a-reference-screen")).toBeNull();
});
