/** Plan §4.5 (WS9 implements; WS2/WS4/WS5 consume). `packages/computer/fake` implements this with DOM fixtures for CI. */

export interface ComputerStatus {
  ready: boolean;
  detail?: string;
}

export interface ObservedElement {
  index: number;
  role: string;
  label: string;
  value?: string;
}

export interface Observation {
  url?: string;
  title?: string;
  screenshotPath?: string;
  elements: ObservedElement[];
}

export type ActionOp =
  "click" | "type" | "key" | "scroll" | "select" | "navigate" | "wait" | "done" | "blocked";

/** `target` MUST be an observed element index (or `url` for `navigate`) — never a raw coordinate or an unobserved guess. */
export interface Action {
  op: ActionOp;
  target?: number;
  text?: string;
  url?: string;
}

export interface ActResult {
  ok: boolean;
  blocked?: boolean;
  reason?: string;
}

export interface Screen {
  observe(o?: { mode?: "dom" | "ax" | "ocr" | "auto" }): Promise<Observation>;
  act(a: Action): Promise<ActResult>;
  liveView(): Promise<{ url: string; token: string; expiresAt: string }>;
  takeover(on: boolean): Promise<void>;
}

export interface ComputerProvider {
  /** `'docker' | 'local' | 'fake'`. */
  id: string;
  status(): Promise<ComputerStatus>;
  ensureStarted(): Promise<void>;
  screen(botId: string): Promise<Screen>;
}

export interface ComputerTaskRequest {
  botId: string;
  chainId: string;
  goal: string;
  startUrl?: string;
  maxSteps?: number;
  provider?: string;
}

export interface ComputerTaskResult {
  status: "completed" | "failed" | "escalated";
  steps: number;
  usd: number;
  summary?: string;
}

export interface ComputerAgent {
  runTask(t: ComputerTaskRequest): Promise<ComputerTaskResult>;
}
