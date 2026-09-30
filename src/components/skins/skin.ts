/**
 * RADAR interface skins — permanent personalization.
 *
 * Two independent dimensions:
 *   skin       — typography and semantic token set (`data-skin` on <html>)
 *   appearance — light / dark / system (RADAR's existing `.dark` class)
 *
 * Both persist locally (localStorage). RADAR has no per-user preference
 * column today; when one is added, swap the read/write helpers here only —
 * no component needs to change.
 */

export type SkinId = "radar" | "boardroom" | "signal" | "atelier";
export type Appearance = "light" | "dark" | "system";

export interface SkinDefinition {
  id: SkinId;
  name: string;
  stance: string;
  /** Appearance this skin was designed around; only a hint for the gallery. */
  favours: Exclude<Appearance, "system">;
  swatch: [string, string, string];
}

export const SKINS: SkinDefinition[] = [
  {
    id: "radar",
    name: "RADAR",
    stance: "The default advisory memo — warm parchment and ink.",
    favours: "light",
    swatch: ["#f7f4ee", "#1c1a17", "#8a6a2f"],
  },
  {
    id: "boardroom",
    name: "Boardroom",
    stance: "The investment-committee memo — navy, bone and oxblood.",
    favours: "light",
    swatch: ["#f4f1ea", "#0f1b3d", "#7a1f2b"],
  },
  {
    id: "signal",
    name: "Signal",
    stance: "The flight deck — dense, high-contrast, amber and mint.",
    favours: "dark",
    swatch: ["#0a0a0a", "#ffb000", "#2dd4a8"],
  },
  {
    id: "atelier",
    name: "Atelier",
    stance: "The private adviser — cream, emerald and gold.",
    favours: "light",
    swatch: ["#f5f0e0", "#064e3b", "#c9a84c"],
  },
];

export const DEFAULT_SKIN: SkinId = "radar";
export const DEFAULT_APPEARANCE: Appearance = "system";

const SKIN_KEY = "radar.skin.v1";
const APPEARANCE_KEY = "radar.appearance.v1";

/**
 * Runs in <head> before styles paint so persisted appearance is visible from
 * the first frame, including the public login and skin gallery routes.
 */
export const SKIN_BOOTSTRAP_SCRIPT = `(() => {
  try {
    const root = document.documentElement;
    const skin = localStorage.getItem("radar.skin.v1");
    if (skin === "boardroom" || skin === "signal" || skin === "atelier") {
      root.dataset.skin = skin;
    } else {
      root.removeAttribute("data-skin");
    }

    const storedAppearance = localStorage.getItem("radar.appearance.v1");
    const appearance =
      storedAppearance === "light" || storedAppearance === "dark" || storedAppearance === "system"
        ? storedAppearance
        : "system";
    const dark =
      appearance === "dark" ||
      (appearance === "system" &&
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    root.classList.toggle("dark", dark);
    root.dataset.appearance = appearance;
  } catch {
    // Storage can be unavailable in strict privacy modes; defaults still render.
  }
})();`;

const isSkinId = (value: unknown): value is SkinId =>
  typeof value === "string" && SKINS.some((skin) => skin.id === value);

const isAppearance = (value: unknown): value is Appearance =>
  value === "light" || value === "dark" || value === "system";

function read(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode / quota: the session still renders, it just won't persist */
  }
}

export function readSkin(): SkinId {
  const stored = read(SKIN_KEY);
  return isSkinId(stored) ? stored : DEFAULT_SKIN;
}

export function readAppearance(): Appearance {
  const stored = read(APPEARANCE_KEY);
  return isAppearance(stored) ? stored : DEFAULT_APPEARANCE;
}

export function prefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Resolve an appearance choice to the concrete light/dark state. */
export function resolveAppearance(appearance: Appearance): "light" | "dark" {
  return appearance === "system" ? (prefersDark() ? "dark" : "light") : appearance;
}

/** Skin only: sets `data-skin` on <html>. Never touches the dark class. */
export function applySkin(skin: SkinId, persist = true) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (skin === DEFAULT_SKIN) root.removeAttribute("data-skin");
  else root.setAttribute("data-skin", skin);
  if (persist) write(SKIN_KEY, skin);
}

/** Appearance only: toggles RADAR's existing `.dark` class on <html>. */
export function applyAppearance(appearance: Appearance, persist = true) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", resolveAppearance(appearance) === "dark");
  root.dataset.appearance = appearance;
  if (persist) write(APPEARANCE_KEY, appearance);
}

/**
 * Restore both dimensions on first client render, and keep "system" in step
 * with the OS. Returns a disposer for the media-query listener.
 */
export function restorePersistedSkin(): () => void {
  if (typeof document === "undefined") return () => {};
  applySkin(readSkin(), false);
  applyAppearance(readAppearance(), false);

  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    if (readAppearance() === "system") applyAppearance("system", false);
  };
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
