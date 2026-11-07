import { useSyncExternalStore } from "react";

const KEY = "onshift.theme";

export type ThemePreference = "light" | "dark" | null;

function readStored(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

function systemDark() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Apply preference to <html>. Call before first paint when possible. */
export function applyTheme(preference: ThemePreference) {
  const root = document.documentElement;
  if (preference) root.dataset.theme = preference;
  else delete root.dataset.theme;
}

export function bootTheme() {
  applyTheme(readStored());
}

let preference: ThemePreference = null;
let booted = false;

function ensureBoot() {
  if (booted) return;
  booted = true;
  preference = readStored();
  applyTheme(preference);
}

const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  ensureBoot();
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    preference = readStored();
    applyTheme(preference);
    emit();
  };
  const onScheme = () => {
    if (preference === null) emit();
  };
  window.addEventListener("storage", onStorage);
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", onScheme);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
    mq.removeEventListener("change", onScheme);
  };
}

function getPreference(): ThemePreference {
  ensureBoot();
  return preference;
}

export function setThemePreference(next: "light" | "dark") {
  ensureBoot();
  preference = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* ignore */
  }
  applyTheme(next);
  emit();
}

export function useTheme() {
  const pref = useSyncExternalStore(subscribe, getPreference, () => null);
  const dark = pref ? pref === "dark" : systemDark();
  return {
    preference: pref,
    dark,
    toggle: () => setThemePreference(dark ? "light" : "dark"),
  };
}
