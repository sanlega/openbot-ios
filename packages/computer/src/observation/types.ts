import type { Observation, ObservedElement } from "@openbot/contracts";

export type ObservationMode = "dom" | "ax" | "ocr" | "auto";

/** Extended element metadata kept server-side for act() targeting (not sent to Jev). */
export interface ObservedElementMeta extends ObservedElement {
  bounds?: { x: number; y: number; width: number; height: number };
  backendNodeId?: number;
  selector?: string;
}

export interface ObservationResult extends Observation {
  /** Which pipeline stage produced the elements (`dom`, `ax`, `ocr`). */
  source?: "dom" | "ax" | "ocr";
  /** Full metadata for act(); stripped before building Jev state. */
  _meta?: ObservedElementMeta[];
}

export interface ObservationPipelineOptions {
  mode?: ObservationMode;
  display?: string;
  debugPort?: number;
  screenshotDir?: string;
  cdpTimeoutMs?: number;
}

export interface ShellExec {
  run(
    cmd: string,
    args: string[],
    env?: NodeJS.ProcessEnv,
  ): Promise<{ code: number; stdout: string; stderr: string }>;
}

export function stripMeta(observation: ObservationResult): Observation {
  const { _meta: _ignored, source: _source, ...rest } = observation;
  return rest;
}

export function normalizeElements(
  items: Array<{
    role: string;
    label: string;
    value?: string;
    bounds?: ObservedElementMeta["bounds"];
    backendNodeId?: number;
    selector?: string;
  }>,
): ObservationResult {
  const elements: ObservedElementMeta[] = items.map((item, index) => ({
    index,
    role: item.role,
    label: item.label,
    value: item.value,
    bounds: item.bounds,
    backendNodeId: item.backendNodeId,
    selector: item.selector,
  }));
  return {
    elements: elements.map(({ index, role, label, value }) => ({ index, role, label, value })),
    _meta: elements,
  };
}
