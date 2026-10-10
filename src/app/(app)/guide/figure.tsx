import Image, { type StaticImageData } from "next/image";

export type Point = { n: number; x: number; y: number };

/**
 * A screenshot with numbered circles on it. The wrapper is as wide as the image, and each point is a percentage of it, so a circle
 * stays on its control at any width. A point is the left edge of its control, at mid height; the circle is drawn just to the left of
 * the point, so it never covers the control, and its white ring keeps it readable over light and dark parts of the picture.
 */
export function Figure({ image, alt, points }: { image: StaticImageData; alt: string; points: Point[] }) {
  return (
    <div className="relative w-full overflow-visible">
      <Image
        src={image}
        alt={alt}
        unoptimized
        sizes="(min-width: 1024px) 880px, 100vw"
        className="block h-auto w-full rounded-lg border border-line bg-white"
      />
      {points.map((p) => (
        <span
          key={p.n}
          aria-hidden
          className="pointer-events-none absolute grid size-6 place-items-center rounded-full bg-accent text-xs font-bold leading-none text-accent-ink shadow-[0_0_0_2px_#fff,0_1px_4px_rgba(0,0,0,0.35)]"
          style={{ left: `${p.x}%`, top: `${p.y}%`, transform: "translate(calc(-100% - 5px), -50%)" }}
        >
          {p.n}
        </span>
      ))}
    </div>
  );
}

/** The same circle, used beside a step in the list. */
export function Badge({ n }: { n?: number }) {
  if (n === undefined) {
    return <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-ink-3" />;
  }
  return (
    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-xs font-bold leading-none text-accent-ink">
      <span className="sr-only">{n}.</span>
      <span aria-hidden>{n}</span>
    </span>
  );
}
