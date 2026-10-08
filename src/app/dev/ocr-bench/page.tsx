import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { devPagesEnabled } from "@/lib/dev-pages";
import { Bench } from "./bench";

export const metadata: Metadata = { title: "OCR bench" };

/** Developer tool (TC-20, TC-24): not user-facing, so its text is English only. */
export default function OcrBenchPage() {
  if (!devPagesEnabled()) notFound();
  return <Bench />;
}
