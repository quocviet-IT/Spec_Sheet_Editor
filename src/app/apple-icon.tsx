import { ImageResponse } from "next/og";
import { LOGO_COLORS, logoShapes } from "@/ui/logo-geometry";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Home-screen icon: the detailed mark, full-bleed (the OS rounds the corners). */
export default function AppleIcon() {
  const s = logoShapes(64);
  return new ImageResponse(
    (
      <svg width="180" height="180" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <rect width="64" height="64" fill={LOGO_COLORS.tile} />
        <circle
          cx={s.ring.cx}
          cy={s.ring.cy}
          r={s.ring.r}
          fill="none"
          stroke={LOGO_COLORS.ring}
          strokeWidth={s.ring.strokeWidth}
        />
        <path d={s.stone} fill={LOGO_COLORS.ring} />
        {s.measure.map((m) => (
          <path key={m.d} d={m.d} fill="none" stroke={LOGO_COLORS.measure} strokeWidth={m.strokeWidth} />
        ))}
      </svg>
    ),
    { ...size },
  );
}
