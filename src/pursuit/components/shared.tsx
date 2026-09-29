/**
 * src/pursuit/components/shared.tsx
 *
 * Small presentational primitives shared by the cockpit surfaces. Kept in one
 * file so the module stays portable and the visual language stays consistent.
 */

import { useCallback, useState, type ReactNode } from "react";

export function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="label-mono text-muted-foreground">{children}</p>;
}

export function ProvenanceBadge({
  provenance,
  edited,
}: {
  provenance?: string | null;
  edited?: boolean;
}) {
  if (edited) {
    return (
      <span className="memo-badge border border-amber-500/40 bg-amber-500/10 text-amber-500">
        User-edited
      </span>
    );
  }
  const tone =
    provenance === "SOURCE_BACKED"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
      : provenance === "DERIVED"
        ? "border-sky-500/40 bg-sky-500/10 text-sky-500"
        : "border-border bg-surface-raised text-muted-foreground";
  return (
    <span className={`memo-badge border ${tone}`}>
      {(provenance ?? "unverified").replace(/_/g, " ").toLowerCase()}
    </span>
  );
}

/** Copy-to-clipboard with a short confirmation, no toast dependency. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }, [text]);
  return (
    <button type="button" onClick={copy} className="pursuit-chip">
      {copied ? "Copied" : label}
    </button>
  );
}

/** Editable text that only commits on blur, so every edit is one clean signal. */
export function EditableText({
  value,
  onCommit,
  multiline = false,
  placeholder,
  className = "",
}: {
  value: string;
  onCommit: (next: string) => void;
  multiline?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  // Re-sync when regeneration replaces the underlying value and we are not editing.
  if (!focused && draft !== value) setDraft(value);

  const commit = () => {
    setFocused(false);
    if (draft.trim() !== value.trim()) onCommit(draft.trim());
  };

  const shared = `pursuit-input ${className}`;
  return multiline ? (
    <textarea
      value={draft}
      placeholder={placeholder}
      rows={Math.min(12, Math.max(3, Math.ceil(draft.length / 90)))}
      onFocus={() => setFocused(true)}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      className={shared}
    />
  ) : (
    <input
      value={draft}
      placeholder={placeholder}
      onFocus={() => setFocused(true)}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      className={shared}
    />
  );
}

export function downloadBase64(filename: string, mimeType: string, base64: string): void {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
