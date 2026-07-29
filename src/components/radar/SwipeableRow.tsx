import { useRef, useState, type ReactNode, type PointerEvent } from "react";
import type { DecisionVerb } from "../../data/opportunity-fixtures";

const THRESHOLD = 96; // px to commit
const MAX_DRAG = 180;

/**
 * Horizontal swipe wrapper.
 *  - swipe LEFT  → onDecide("PASS")
 *  - swipe RIGHT → onDecide("PURSUE")
 * Falls back gracefully when the pointer is used vertically (scroll wins).
 */
export function SwipeableRow({
  children,
  onDecide,
  disabled,
}: {
  children: ReactNode;
  onDecide: (verb: DecisionVerb) => void;
  disabled?: boolean;
}) {
  const [dx, setDx] = useState(0);
  const [committing, setCommitting] = useState<null | "left" | "right">(null);
  const start = useRef<{ x: number; y: number; locked: null | "h" | "v" } | null>(null);

  const reset = () => {
    setDx(0);
    setCommitting(null);
    start.current = null;
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    
    // Ignore swipe gestures on nested interactive elements (buttons, links)
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("a")) {
      return;
    }
    
    start.current = { x: e.clientX, y: e.clientY, locked: null };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!start.current || disabled) return;
    const rawX = e.clientX - start.current.x;
    const rawY = e.clientY - start.current.y;

    if (start.current.locked === null) {
      if (Math.abs(rawX) < 8 && Math.abs(rawY) < 8) return;
      start.current.locked = Math.abs(rawX) > Math.abs(rawY) ? "h" : "v";
      if (start.current.locked === "h") {
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      }
    }

    if (start.current.locked !== "h") return;
    e.preventDefault();
    const clamped = Math.max(-MAX_DRAG, Math.min(MAX_DRAG, rawX));
    setDx(clamped);
  };

  const onPointerUp = () => {
    if (!start.current) return;
    if (start.current.locked === "h") {
      if (dx >= THRESHOLD) {
        setCommitting("right");
        setDx(MAX_DRAG * 1.4);
        window.setTimeout(() => {
          onDecide("PURSUE");
          reset();
        }, 220);
        return;
      }
      if (dx <= -THRESHOLD) {
        setCommitting("left");
        setDx(-MAX_DRAG * 1.4);
        window.setTimeout(() => {
          onDecide("PASS");
          reset();
        }, 220);
        return;
      }
    }
    reset();
  };

  const progress = Math.min(1, Math.abs(dx) / THRESHOLD);
  const showRight = dx > 0;
  const showLeft = dx < 0;

  return (
    <div className="relative touch-pan-y overflow-hidden">
      {/* Right (pursue) hint — revealed as row moves right */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 flex w-full items-center justify-start bg-gradient-to-r from-decision-pursue/15 to-transparent pl-6"
        style={{ opacity: showRight ? progress : 0 }}
      >
        <span className="rounded-sm border border-decision-pursue/40 bg-background/60 px-2 py-1 text-[10.5px] font-medium uppercase tracking-[0.18em] text-decision-pursue">
          → Pursue
        </span>
      </div>
      {/* Left (pass) hint */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 flex w-full items-center justify-end bg-gradient-to-l from-muted to-transparent pr-6"
        style={{ opacity: showLeft ? progress : 0 }}
      >
        <span className="rounded-sm border border-hairline bg-background/60 px-2 py-1 text-[10.5px] font-medium uppercase tracking-[0.18em] text-ink-muted">
          Pass ←
        </span>
      </div>

      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={reset}
        style={{
          transform: `translate3d(${dx}px, 0, 0)`,
          transition: committing
            ? "transform 220ms cubic-bezier(0.32,0.72,0,1), opacity 220ms"
            : start.current?.locked === "h"
              ? "none"
              : "transform 260ms cubic-bezier(0.32,0.72,0,1)",
          opacity: committing ? 0 : 1,
        }}
        className="bg-background"
      >
        {children}
      </div>
    </div>
  );
}
