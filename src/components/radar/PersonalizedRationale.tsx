export function PersonalizedRationale({ lines }: { lines: string[] }) {
  return (
    <ol className="space-y-4">
      {lines.map((line, i) => (
        <li key={i} className="flex gap-4">
          <span className="mt-1 font-mono text-xs text-brass">{String(i + 1).padStart(2, "0")}</span>
          <p className="font-serif text-xl leading-snug text-ink">{line}</p>
        </li>
      ))}
    </ol>
  );
}
