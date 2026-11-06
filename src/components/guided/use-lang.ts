"use client";

import { useCallback, useSyncExternalStore } from "react";
import { STRINGS, type Lang, type Strings } from "./strings";

/**
 * The student's language for Guided Session screens, per device. Read
 * through useSyncExternalStore with English as the server snapshot, so a
 * stored "es" can't cause a hydration mismatch (the theme toggle's pattern),
 * and every read and write is wrapped: school Chromebooks may disable storage.
 */
const KEY = "prephub:guided-lang";
const listeners = new Set<() => void>();
/** Used when storage is unavailable, so the switch still works until a reload. */
let memory: Lang | null = null;

function read(): Lang {
  if (memory) return memory;
  try {
    return window.localStorage.getItem(KEY) === "es" ? "es" : "en";
  } catch {
    return "en";
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useGuidedLang(): { lang: Lang; t: Strings; toggle: () => void } {
  const lang = useSyncExternalStore(subscribe, read, () => "en" as Lang);
  const toggle = useCallback(() => {
    const next: Lang = read() === "es" ? "en" : "es";
    try {
      window.localStorage.setItem(KEY, next);
      memory = null;
    } catch {
      // Storage disabled: the choice lasts until the page reloads.
      memory = next;
    }
    listeners.forEach((l) => l());
  }, []);
  return { lang, t: STRINGS[lang], toggle };
}
