// Next.js declares the types of imported images (`import shot from "./shot.jpg"`) in next-env.d.ts, which it
// generates on `next dev` or `next build` and which is not committed. CI runs the type check before the build,
// so this reference gives a clean checkout the same declarations.
/// <reference types="next/image-types/global" />
