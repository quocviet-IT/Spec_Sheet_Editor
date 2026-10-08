/** Developer pages (/dev/*) are tools, not features: off in production unless ENABLE_DEV_PAGES=1. */
export function devPagesEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.ENABLE_DEV_PAGES === "1";
}
