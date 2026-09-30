/**
 * Compact header control for the two appearance dimensions: interface skin
 * and light/dark/system. Presentation only — it writes nothing to the server
 * and knows nothing about opportunities, candidates or pursuits.
 */

import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  SKINS,
  applyAppearance,
  applySkin,
  readAppearance,
  readSkin,
  type Appearance,
  type SkinId,
} from "./skin";

const APPEARANCES: Array<{ id: Appearance; label: string }> = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" },
];

export function SkinSwitcher({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [skin, setSkin] = useState<SkinId>("radar");
  const [appearance, setAppearance] = useState<Appearance>("system");
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSkin(readSkin());
    setAppearance(readAppearance());
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const chooseSkin = (id: SkinId) => {
    applySkin(id);
    setSkin(id);
  };

  const chooseAppearance = (id: Appearance) => {
    applyAppearance(id);
    setAppearance(id);
  };

  const active = SKINS.find((entry) => entry.id === skin) ?? SKINS[0];

  return (
    <div ref={panelRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Appearance and interface skin"
        data-testid="skin-switcher-trigger"
        className="flex items-center gap-2 rounded-full border border-border/60 bg-background px-2.5 py-1 text-foreground transition-colors hover:bg-muted"
      >
        <span className="flex items-center gap-0.5" aria-hidden="true">
          {active.swatch.map((colour) => (
            <span
              key={colour}
              className="h-2.5 w-2.5 rounded-full border border-border/40"
              style={{ backgroundColor: colour }}
            />
          ))}
        </span>
        <span className="label-mono hidden text-[0.62rem] sm:inline">{active.name}</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-72 rounded-lg border border-border bg-card p-3 shadow-lg"
          data-testid="skin-switcher-panel"
        >
          <p className="label-mono text-[0.6rem] text-muted-foreground">Appearance</p>
          <div className="mt-1.5 flex items-center gap-1 rounded-full border border-border/50 bg-muted/40 p-1">
            {APPEARANCES.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => chooseAppearance(entry.id)}
                className={`label-mono flex-1 rounded-full px-2 py-1 text-[0.6rem] transition-colors ${
                  appearance === entry.id
                    ? "bg-background font-semibold text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                data-testid={`appearance-option-${entry.id}`}
              >
                {entry.label}
              </button>
            ))}
          </div>

          <p className="label-mono mt-3 text-[0.6rem] text-muted-foreground">Interface skin</p>
          <ul className="mt-1.5 space-y-1">
            {SKINS.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => chooseSkin(entry.id)}
                  className={`flex w-full items-start gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors ${
                    skin === entry.id
                      ? "border-border-strong bg-muted/50"
                      : "border-transparent hover:bg-muted/40"
                  }`}
                  data-testid={`skin-option-${entry.id}`}
                >
                  <span className="mt-0.5 flex shrink-0 items-center gap-0.5" aria-hidden="true">
                    {entry.swatch.map((colour) => (
                      <span
                        key={colour}
                        className="h-3 w-3 rounded-full border border-border/40"
                        style={{ backgroundColor: colour }}
                      />
                    ))}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold text-foreground">{entry.name}</span>
                    <span className="mt-0.5 block text-[0.68rem] leading-snug text-muted-foreground">
                      {entry.stance}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <Link
            to="/skins"
            onClick={() => setOpen(false)}
            className="label-mono mt-3 block text-[0.6rem] text-muted-foreground hover:text-foreground"
          >
            See the full gallery →
          </Link>
        </div>
      )}
    </div>
  );
}
