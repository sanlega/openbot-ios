import { createServer } from "./index.js";

/** `openbot serve` entrypoint (default port 4577; override with `PORT`). WS1 replaces this with the real `serve|doctor|pair` CLI. */
async function main(): Promise<void> {
  const app = createServer();
  const port = Number(process.env.PORT ?? 4577);
  const address = await app.listen({ port, host: "127.0.0.1" });
  console.log(`OpenBot server listening on ${address}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
