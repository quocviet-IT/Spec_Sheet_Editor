import type { ReactNode } from "react";

/** A key cap. */
export function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-line bg-sunk px-1.5 py-0.5 font-mono text-[0.8em] leading-none text-ink shadow-[0_1px_0_var(--line)]">
      {children}
    </kbd>
  );
}

/**
 * Dictionary text with two marks: **bold** for interface names and `Key` for keys. Plain text elsewhere; nothing from the
 * dictionaries is ever treated as HTML.
 */
export function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={i} className="font-semibold text-ink">{part.slice(2, -2)}</strong>;
        if (part.startsWith("`") && part.endsWith("`") && part.length > 2) return <Key key={i}>{part.slice(1, -1)}</Key>;
        return part;
      })}
    </>
  );
}
