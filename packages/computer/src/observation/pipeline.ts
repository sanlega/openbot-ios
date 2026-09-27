import { withCdp } from "./cdp-client.js";
import { observeDom } from "./dom.js";
import { observeAx } from "./ax-cdp.js";
import { observeAtspi } from "./atspi.js";
import { observeOcr } from "./ocr.js";
import { createShellExec } from "./shell.js";
import type { ObservationPipelineOptions, ObservationResult, ShellExec } from "./types.js";

const MIN_ELEMENTS = 2;

/**
 * Observation pipeline (plan WS9): DOM over CDP → accessibility tree → OCR.
 * In `auto` mode, each stage runs only if the previous one returned too few elements.
 */
export async function runObservationPipeline(
  options: ObservationPipelineOptions,
  shell: ShellExec = createShellExec(),
): Promise<ObservationResult> {
  const mode = options.mode ?? "auto";
  const port = options.debugPort ?? 9222;
  const display = options.display ?? ":0";
  const cdpTimeoutMs = options.cdpTimeoutMs;

  if (mode === "ocr") {
    return withCdp(port, async (client) => observeOcr(client, shell, display), cdpTimeoutMs);
  }

  if (mode === "ax") {
    const ax = await withCdp(port, (client) => observeAx(client), cdpTimeoutMs);
    if (ax.elements.length >= MIN_ELEMENTS) return ax;
    const atspi = await observeAtspi(shell, display);
    if (atspi.elements.length >= MIN_ELEMENTS) return atspi;
    return withCdp(port, (client) => observeOcr(client, shell, display), cdpTimeoutMs);
  }

  if (mode === "dom") {
    return withCdp(port, (client) => observeDom(client), cdpTimeoutMs);
  }

  // auto: dom → ax (cdp then atspi) → ocr
  const dom = await withCdp(port, (client) => observeDom(client), cdpTimeoutMs);
  if (dom.elements.length >= MIN_ELEMENTS) return dom;

  const ax = await withCdp(port, (client) => observeAx(client), cdpTimeoutMs);
  if (ax.elements.length >= MIN_ELEMENTS) return ax;

  const atspi = await observeAtspi(shell, display);
  if (atspi.elements.length >= MIN_ELEMENTS) return atspi;

  return withCdp(port, (client) => observeOcr(client, shell, display), cdpTimeoutMs);
}
