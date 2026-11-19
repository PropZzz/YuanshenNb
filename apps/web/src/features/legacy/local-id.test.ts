import { afterEach, expect, it, vi } from "vitest";
import { createLocalId } from "./local-id";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("uses the browser UUID implementation when available", () => {
  const randomUUID = vi.fn(() => "native-id"), getRandomValues = vi.fn();
  vi.stubGlobal("crypto", { randomUUID, getRandomValues });
  expect(createLocalId()).toBe("native-id");
  expect(getRandomValues).not.toHaveBeenCalled();
});

it("builds a version 4 UUID from random bytes when randomUUID is restricted", () => {
  const getRandomValues = vi.fn((bytes: Uint8Array) => bytes.fill(0xff));
  vi.stubGlobal("crypto", { randomUUID: () => { throw new Error("Unavailable"); }, getRandomValues });
  expect(createLocalId()).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
  expect(getRandomValues).toHaveBeenCalledTimes(1);
});

it("keeps local-only fallback keys distinct even within the same millisecond", () => {
  vi.stubGlobal("crypto", undefined);
  vi.spyOn(Date, "now").mockReturnValue(1000);
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  const first = createLocalId(), second = createLocalId();
  expect(first).toMatch(/^local-/); expect(second).toMatch(/^local-/);
  expect(first).not.toBe(second);
});

it("still provides a local key if the browser random-byte source throws", () => {
  vi.stubGlobal("crypto", { getRandomValues: () => { throw new Error("Unavailable"); } });
  expect(createLocalId()).toMatch(/^local-/);
});
