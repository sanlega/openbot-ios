import { runCli } from "./cli.js";

runCli(process.argv.slice(2)).catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
