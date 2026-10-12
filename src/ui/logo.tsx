import { LOGO_COLORS, logoShapes } from "./logo-geometry";

/**
 * The app mark: a ring with a measured diameter on a green tile.
 * Decorative (aria-hidden) unless a `title` is given.
 */
export function Logo({ size, title }: { size: number; title?: string }) {
  const s = logoShapes(size);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className="shrink-0"
      {...(title ? { role: "img" } : { "aria-hidden": true, focusable: false })}
    >
      {title ? <title>{title}</title> : null}
      <rect width="64" height="64" rx="14" fill={LOGO_COLORS.tile} />
      {/* hairline so the tile edge stays visible on a dark surface */}
      <rect x="0.5" y="0.5" width="63" height="63" rx="13.5" fill="none" stroke="rgba(255,255,255,0.12)" />
      <circle {...s.ring} fill="none" stroke={LOGO_COLORS.ring} />
      <path d={s.stone} fill={LOGO_COLORS.ring} />
      {s.measure.map((m) => (
        <path key={m.d} d={m.d} fill="none" stroke={LOGO_COLORS.measure} strokeWidth={m.strokeWidth} />
      ))}
    </svg>
  );
}
