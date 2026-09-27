/**
 * Appearance preference: "system" follows the OS (prefers-color-scheme);
 * "light"/"dark" force a theme through `data-theme` on <html>, which the
 * tokens in styles/global.css key off. Stored per device in localStorage.
 */
export type ThemePreference = "system" | "light" | "dark";

const STORAGE_KEY = "openbot.theme";

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function getStoredTheme(): ThemePreference {
  try {
    const value = globalThis.localStorage?.getItem(STORAGE_KEY);
    return isThemePreference(value) ? value : "system";
  } catch {
    return "system";
  }
}

function applyTheme(theme: ThemePreference): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
}

/** Applies and persists a theme choice. Storage failures are ignored (the choice still applies). */
export function setTheme(theme: ThemePreference): void {
  applyTheme(theme);
  try {
    if (theme === "system") globalThis.localStorage?.removeItem(STORAGE_KEY);
    else globalThis.localStorage?.setItem(STORAGE_KEY, theme);
  } catch {
    // Private mode or blocked storage: keep the in-memory choice only.
  }
}

/** Call once at app start so the stored theme applies before the first paint of screens. */
export function applyStoredTheme(): ThemePreference {
  const theme = getStoredTheme();
  applyTheme(theme);
  return theme;
}
