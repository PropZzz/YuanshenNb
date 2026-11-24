import { useEffect, useState } from "react";

export type ProfileTone = "teal" | "gray" | "jade";
export type ProfileAppearance = { tone: ProfileTone; compact: boolean };

const defaultAppearance: ProfileAppearance = { tone: "teal", compact: false };
const changedEvent = "shixu:profile-appearance-changed";

export const profileAppearanceKey = (userId: string) => `shixu:profile-appearance:${userId}`;

export function readProfileAppearance(userId: string): ProfileAppearance {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(profileAppearanceKey(userId)) ?? "null");
    if (
      stored &&
      typeof stored === "object" &&
      "tone" in stored &&
      ["teal", "gray", "jade"].includes(String(stored.tone))
    ) {
      return {
        tone: stored.tone as ProfileTone,
        compact: "compact" in stored && stored.compact === true,
      };
    }
  } catch {
    // Fallback to default appearance when localStorage cannot be read.
  }
  return defaultAppearance;
}

export function applyProfileAppearanceToDom(appearance: ProfileAppearance) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (appearance.tone === "teal") delete root.dataset.profileTone;
  else root.dataset.profileTone = appearance.tone;
  if (appearance.compact) root.dataset.profileCompact = "true";
  else delete root.dataset.profileCompact;
}

export function clearProfileAppearanceFromDom() {
  if (typeof document === "undefined") return;
  delete document.documentElement.dataset.profileTone;
  delete document.documentElement.dataset.profileCompact;
}

export function useProfileAppearance(userId?: string) {
  const key = profileAppearanceKey(userId ?? "anonymous");
  const [appearance, setAppearance] = useState<ProfileAppearance>(() =>
    userId ? readProfileAppearance(userId) : defaultAppearance,
  );
  const [error, setError] = useState("");

  useEffect(() => {
    if (!userId) {
      setAppearance(defaultAppearance);
      clearProfileAppearanceFromDom();
      return;
    }
    const sync = () => {
      const next = readProfileAppearance(userId);
      setAppearance(next);
      applyProfileAppearanceToDom(next);
    };
    sync();
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === key) sync();
    };
    window.addEventListener(changedEvent, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(changedEvent, sync);
      window.removeEventListener("storage", onStorage);
      clearProfileAppearanceFromDom();
    };
  }, [userId, key]);

  function update(patch: Partial<ProfileAppearance>) {
    if (!userId) return;
    const next = { ...appearance, ...patch };
    setAppearance(next);
    applyProfileAppearanceToDom(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
      setError("");
      window.dispatchEvent(new Event(changedEvent));
    } catch {
      setError("外观已在本页生效，但浏览器未允许保存。刷新后将恢复。");
    }
  }

  return { appearance, update, error };
}
