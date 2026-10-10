import Image, { type StaticImageData } from "next/image";

export type Point = { n: number; x: number; y: number };

/**
 * A screenshot with numbered circles on it. The wrapper is as wide as the image, and each point is the CENTRE of a circle, as a
 * percentage of the image, so it stays on target at any width. The capture script moves each point clear of its control, so a
 * circle never covers anything. The circle's size follows the width of the figure (16 px on a phone, 24 px from about 920 px), and
 * its centre is clamped so the whole circle always stays inside the image. The image links to its full-size file for zooming.
 */
export function Figure({
  image,
  alt,
  openLabel,
  eager,
  points,
}: {
  image: StaticImageData;
  alt: string;
  openLabel: string;
  eager: boolean;
  points: Point[];
}) {
  return (
    <div className="[container-type:inline-size]">
      <div className="relative w-full [--d:clamp(16px,2.6cqw,24px)]">
        <a href={image.src} target="_blank" rel="noopener" aria-label={openLabel} className="block rounded-lg">
          <Image
            src={image}
            alt={alt}
            unoptimized
            loading={eager ? "eager" : "lazy"}
            sizes="(min-width: 1024px) 880px, 100vw"
            className="block h-auto w-full rounded-lg border border-line bg-white"
          />
        </a>
        {points.map((p) => (
          <span
            key={p.n}
            aria-hidden
            // Fixed colours: the screenshots stay light in every theme, so the callout must too.
            className="pointer-events-none absolute grid size-[var(--d)] place-items-center rounded-full bg-[#1d6b4b] text-[length:calc(var(--d)*0.5)] font-bold leading-none text-white shadow-[0_0_0_1.5px_#fff,0_0_0_2.5px_#16201b]"
            style={{
              left: `clamp(calc(var(--d) / 2), ${p.x}%, calc(100% - var(--d) / 2))`,
              top: `clamp(calc(var(--d) / 2), ${p.y}%, calc(100% - var(--d) / 2))`,
              transform: "translate(-50%, -50%)",
            }}
          >
            {p.n}
          </span>
        ))}
      </div>
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
