import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_PORT = 4577;
export const PROTOCOL = "openbot";
export const APP_NAME = "OpenBot";

export function defaultOpenbotHome(): string {
  return process.env.OPENBOT_HOME ?? join(homedir(), ".openbot");
}

export function harnessBaseUrl(port = DEFAULT_PORT): string {
  return `http://127.0.0.1:${port}`;
}

export function harnessWsUrl(port = DEFAULT_PORT): string {
  return `ws://127.0.0.1:${port}/api/ws`;
}
