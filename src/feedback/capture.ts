import { SCREENSHOT_MAX_BYTES } from "./model";

/** A PNG of the page as it is now, without the controls marked as feedback chrome; null when the browser cannot draw it. */
export async function captureScreen(): Promise<Blob | null> {
  try {
    const { domToBlob } = await import("modern-screenshot"); // loaded only when someone reports
    const blob = await domToBlob(document.body, {
      scale: 0.6,
      type: "image/png",
      backgroundColor: getComputedStyle(document.body).backgroundColor,
      filter: (node) => !(node instanceof Element && node.closest("[data-feedback-chrome], [role='dialog']")),
    });
    return blob && blob.size > 0 && blob.size <= SCREENSHOT_MAX_BYTES ? blob : null;
  } catch {
    return null;
  }
}
