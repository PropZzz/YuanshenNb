let localSequence = 0;

// Browser-local record keys only: never use for credentials or request nonces.
export function createLocalId(): string {
  const source = globalThis.crypto;
  if (typeof source?.randomUUID === "function") {
    try { return source.randomUUID(); } catch { /* Try random bytes on restricted origins. */ }
  }
  if (typeof source?.getRandomValues === "function") {
    try {
      const bytes = source.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const value = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
      return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
    } catch { /* Local records remain usable when browser randomness is unavailable. */ }
  }
  localSequence++;
  return `local-${Date.now().toString(36)}-${localSequence.toString(36)}-${Math.random().toString(36).slice(2)}`;
}
