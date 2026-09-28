import {
  buildServer,
  computeBindHostFlags,
  createCoreContext,
  loadConfig,
  resolveBindHost,
  runDoctor,
} from "@openbot/core";
import { bootstrapHarness } from "./bootstrap.js";

import { startFileLog } from "./log-file.js";

const USAGE = "Usage: openbot <serve|doctor|pair> [options]";

/**
 * `openbot serve|doctor|pair` (plan §3/§5 WS1). This is the entire headless
 * CLI surface WS1 owns for `apps/server`; `apps/desktop` (WS6) drives the
 * same `@openbot/core` APIs from its Electron `utilityProcess` instead of
 * shelling out to this CLI.
 */
export async function runCli(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  switch (command) {
    case "serve":
      return serve();
    case "doctor":
      return doctor();
    case "pair":
      return pair(rest);
    default:
      console.error(command ? `Unknown command "${command}".\n${USAGE}` : USAGE);
      process.exitCode = command ? 1 : 0;
  }
}

async function serve(): Promise<void> {
  const ctx = await createCoreContext();
  startFileLog(ctx.config.openbotHome);
  const app = await buildServer(ctx, { wireRemote: false });
  await bootstrapHarness(ctx, app);
  const host = resolveBindHost(computeBindHostFlags(ctx));
  ctx.bindHost = host;
  const address = await app.listen({ port: ctx.config.port, host });
  console.log(`OpenBot server listening on ${address} (bind host: ${host})`);
}

async function doctor(): Promise<void> {
  const config = loadConfig();
  const report = await runDoctor(config);
  for (const check of report.checks) {
    const icon = check.ok ? "✔" : check.required ? "✘" : "…";
    console.log(`${icon} ${check.name}: ${check.detail}`);
  }
  console.log(
    report.ok ? "\nAll required checks passed." : "\nOne or more required checks failed.",
  );
  process.exitCode = report.ok ? 0 : 1;
}

interface PairResponse {
  device: { id: string; role: "owner" | "approver" };
  token: string;
}

/** Pairs a new device via the same `/api/devices/pair` route a real client would call — an in-process `inject`, no network hop needed. */
async function pair(args: string[]): Promise<void> {
  const name = args.find((arg) => !arg.startsWith("--")) ?? "cli-device";
  const roleArg = args.find((arg) => arg.startsWith("--role="))?.split("=")[1];
  const role = roleArg === "owner" || roleArg === "approver" ? roleArg : undefined;

  const ctx = await createCoreContext();
  const app = await buildServer(ctx);
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/devices/pair",
      payload: { name, role, via: "lan" },
    });
    if (response.statusCode !== 201) {
      console.error(`Pairing failed (${response.statusCode}): ${response.body}`);
      process.exitCode = 1;
      return;
    }
    const body = response.json<PairResponse>();
    console.log(`Paired device "${name}" as ${body.device.role} (id: ${body.device.id})`);
    console.log(`Token: ${body.token}`);
  } finally {
    await app.close();
    ctx.closeDb();
  }
}
